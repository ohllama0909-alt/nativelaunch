/**
 * NativeLaunch multi-tenant control panel server.
 *
 * Features:
 *   - Parses [INVENTORY_JSON] / [EVENT_JSON] / [CONFIG_UPDATE_JSON] markers
 *     from child stdout
 *   - Stores latest inventory per bot, streams over SSE
 *   - Auto-syncs bots.json when the child changes its own config via
 *     in-game / terminal commands (e.g. !chest, !spawner, !setslot)
 *   - Optional per-bot Discord webhook alerts on kick/disconnect/death/crash
 *   - Extended bot config: webhookUrl + boneCollector.spawnerPos / chestPos /
 *     collectSlot / cycleDelay
 *   - Filters out noisy prompt / banner lines from the terminal stream
 *
 * Performance fix (2026-02):
 *   - MAX_LOG_LINES reduced (per-bot in-memory buffer cap)
 *   - SSE snapshot replays only the recent tail so opening the panel after
 *     a long-running bot no longer ships ~1000 lines in a single frame.
 *   - Live log fan-out skipped entirely when no panel is subscribed.
 *   (DOM-side batching lives in src/web/multibot.html.)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const DATA_ROOT = (process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) ? path.resolve(process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) : ROOT;
const BOTS_DIR = path.join(DATA_ROOT, 'bots');
const BOTS_FILE = path.join(BOTS_DIR, 'bots.json');
const JOBS_FILE = path.join(DATA_ROOT, 'system_data', 'jobs.json');
const SCHEDULES_FILE = path.join(DATA_ROOT, 'system_data', 'schedules.json');
const { MODULE_CATALOG } = require('./utils/botModules.js');


const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const MAX_LOG_LINES = 400;          // Per-bot in-memory log buffer
const SNAPSHOT_LOG_LIMIT = 250;     // Panel snapshot on open
const MAX_JOBS = 50;                // Job history kept on disk
const MAX_SCHEDULES = 200;          // Pending actions + recent history
const MAX_BOTS_PER_ACCOUNT = 10;     // Maximum bots per non-admin account
const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));

// Mass-command jobs: execution is server-side so the panel tab can close and
// the run keeps going; history survives restarts.
let jobs = [];
try {
    jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')) || [];
} catch (_) { jobs = []; }
function persistJobs() {
    try {
        ensureDir(path.dirname(JOBS_FILE));
        fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
    } catch (_) { }
}

// Run one mass-command job. Server-side and resumable: every step is
// persisted (pos/next/nextAt) so a panel restart can pick a live run back up.
async function runJobLoop(job, ids, staggerMs) {
    try {
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const alive = liveState.bots.some(b => b.id === id);
            if (!alive) { job.skipped++; }
            else {
                const r = sendCommand(id, job.cmd);
                if (r.ok) job.ok++;
            }
            job.done = Math.min(job.total, job.done + 1);
            job.pos = i + 1;
            broadcastGlobal(viewer => {
                if (viewer && viewer.role !== 'admin' && job.ownerId !== viewer.id) return null;
                return { type: 'job', job: { ...job } };
            });
            if (i < ids.length - 1 && staggerMs > 0) {
                job.next = ids[i + 1];
                job.nextAt = Date.now() + staggerMs;
                persistJobs();
                await sleepMs(staggerMs);
            }
        }
    } catch (e) { console.error(`[jobs] ${job.id} worker error:`, e.message); }
    finally {
        job.status = 'done';
        job.finishedAt = new Date().toISOString();
        job.next = null;
        job.nextAt = null;
        persistJobs();
        broadcastGlobal(viewer => {
            if (viewer && viewer.role !== 'admin' && job.ownerId !== viewer.id) return null;
            return { type: 'job', job: { ...job } };
        });
    }
}

// Re-attach to any run that was mid-flight when the panel stopped, and retire
// legacy rows that can't be resumed (no target list recorded).
function resumeJobs() {
    for (const job of jobs) {
        if (job.status !== 'running') continue;
        if (!Array.isArray(job.botIds) || !job.botIds.length || job.done >= job.botIds.length) {
            job.status = 'done';
            job.finishedAt = new Date().toISOString();
            job.interrupted = true;
            persistJobs();
            continue;
        }
        runJobLoop(job, job.botIds.slice(job.pos || job.done), job.staggerMs || 0);
    }
}

// One-time bot lifecycle schedules. Execution belongs to the server so a
// browser can close and Atlas can restart without losing the requested time.
let schedules = [];
try {
    schedules = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8')) || [];
} catch (_) { schedules = []; }
if (!Array.isArray(schedules)) schedules = [];
// A process restart cannot leave an action genuinely running. Re-queue any
// in-flight records so the worker can finish them against the new process.
let schedulesNeedPersist = false;
for (const schedule of schedules) {
    if (schedule && schedule.status === 'running') {
        schedule.status = 'pending';
        delete schedule.startedAt;
        schedule.resumedAt = new Date().toISOString();
        schedulesNeedPersist = true;
    }
}

function persistSchedules() {
    try {
        ensureDir(path.dirname(SCHEDULES_FILE));
        fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2) + '\n');
    } catch (_) { }
}
if (schedulesNeedPersist) persistSchedules();

function trimSchedules() {
    while (schedules.length > MAX_SCHEDULES) {
        const i = schedules.findLastIndex(s => !['pending', 'running'].includes(s.status));
        if (i === -1) break;
        schedules.splice(i, 1);
    }
}

let scheduleWorker = null;
let scheduleTicking = false;

async function executeScheduledAction(schedule, state) {
    if (!schedule || schedule.status !== 'pending') return;
    schedule.status = 'running';
    schedule.startedAt = new Date().toISOString();
    schedule.results = [];
    persistSchedules();

    const owner = users.findById(schedule.ownerId);
    for (const id of schedule.botIds || []) {
        const bot = state.bots.find(b => b.id === id);
        if (!owner || !bot || !users.canManageBot(owner, bot)) {
            schedule.results.push({ id, result: 'failed', reason: 'Bot unavailable or access revoked' });
            continue;
        }

        const running = !!getBotState(id).proc;
        if (schedule.action === 'start' && running) {
            schedule.results.push({ id, result: 'skipped', reason: 'Already running' });
            continue;
        }
        if (schedule.action === 'stop' && !running) {
            schedule.results.push({ id, result: 'skipped', reason: 'Already stopped' });
            continue;
        }

        const result = schedule.action === 'start' ? startBot(state, bot) : stopBot(id);
        schedule.results.push({
            id,
            result: result.ok ? 'ok' : 'failed',
            ...(result.ok ? {} : { reason: result.reason || 'Action failed' })
        });
    }

    schedule.ok = schedule.results.filter(r => r.result === 'ok').length;
    schedule.skipped = schedule.results.filter(r => r.result === 'skipped').length;
    schedule.failed = schedule.results.filter(r => r.result === 'failed').length;
    schedule.status = schedule.failed ? (schedule.ok || schedule.skipped ? 'partial' : 'failed') : 'done';
    schedule.completedAt = new Date().toISOString();
    persistSchedules();
}

async function runScheduleTick(state) {
    if (scheduleTicking) return;
    scheduleTicking = true;
    try {
        const now = Date.now();
        const due = schedules
            .filter(s => s.status === 'pending' && new Date(s.runAt).getTime() <= now)
            .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
        for (const schedule of due) await executeScheduledAction(schedule, state);
    } finally {
        scheduleTicking = false;
    }
}

function startScheduleWorker(state) {
    if (scheduleWorker) clearInterval(scheduleWorker);
    scheduleWorker = setInterval(() => runScheduleTick(state), 1000);
    setTimeout(() => runScheduleTick(state), 100);
}

// Lines that should never hit the panel terminal (pure noise).
const NOISE_PATTERNS = [
    /^🍌\s*>\s*$/,                              // empty readline prompts
    /^\[🍌\]\s*Loaded system data for/i,        // SystemData chatter
    /^\[🍌\]\s*Saved system data for/i,
    /^\[debug\]/i,                              // debug logs from logger
    /^\s*\|?\s*_+\s*$/,                         // figlet banner lines
    /^\s*\|\s*[_\/|()\s]+\s*\|\s*$/,           // figlet middle rows
    /^={10,}/,                                  // banner separators
    /^\s*🍌\s+Lite Edition/i,                   // banner title
];

function isNoise(line) {
    const t = line.trim();
    if (!t) return true;
    return NOISE_PATTERNS.some(re => re.test(t));
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function loadBotsFile() {
    try {
        if (fs.existsSync(BOTS_FILE)) return JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'));
    } catch (_) { }
    return { bots: [] };
}
function saveBotsFile(data) {
    ensureDir(BOTS_DIR);
    fs.writeFileSync(BOTS_FILE, JSON.stringify(data, null, 2));
}

// ─── Runtime state ─────────────────────────────────────────────────────
const runtime = new Map();          // id → { proc, status, logs[], subs:Set<res>, inventory, lastEvent }
const globalSubs = new Set();
// The bots roster, published once start() builds it. broadcastGlobal needs to
// resolve a bot id → owner for events that carry only an id.
let liveState = null;
const SESSIONS_FILE = path.join(DATA_ROOT, 'system_data', 'sessions.json');
const SESSIONS = new Map();         // sessionToken → { userId, email, role, expiresAt }

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            const now = Date.now();
            for (const [token, data] of Object.entries(raw)) {
                if (now < data.expiresAt) SESSIONS.set(token, data);
            }
        }
    } catch (_) {}
}
function saveSessions() {
    try {
        ensureDir(path.dirname(SESSIONS_FILE));
        const obj = {};
        SESSIONS.forEach((v, k) => { obj[k] = v; });
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj));
    } catch (_) {}
}
loadSessions();

const { UserStore } = require('./utils/UserStore.js');
const users = new UserStore();
const { ProxyStore, toUri: proxyToUri, toLabel: proxyToLabel } = require('./utils/ProxyStore.js');
const proxies = new ProxyStore();
const { UsernameGenerator } = require('./utils/UsernameGenerator.js');
const usernameGenerator = new UsernameGenerator();
const { WorkspaceStore, normalizeScript } = require('./utils/WorkspaceStore.js');
const workspaces = new WorkspaceStore();

function aliasesFor(userId) {
    return userId ? workspaces.aliases(userId) : [];
}

function aliasMapFor(userId) {
    return Object.fromEntries(aliasesFor(userId).filter(a => a.name && a.cmd).map(a => [a.name, a.cmd]));
}

// Push one account's aliases only to bots owned by that account. An admin
// operating another tenant's bot does not replace that tenant's automation.
function pushCustomCmds(userId) {
    if (!userId || !liveState) return 0;
    const payload = `__custom_cmds ${JSON.stringify(aliasMapFor(userId))}\n`;
    let pushed = 0;
    for (const bot of liveState.bots) {
        if (bot.ownerId !== userId) continue;
        const s = getBotState(bot.id);
        if (!s.proc) continue;
        try { s.proc.stdin.write(payload); pushed++; } catch (_) { }
    }
    return pushed;
}

function pushCustomCmdsToBot(bot) {
    if (!bot || !bot.ownerId) return false;
    const s = getBotState(bot.id);
    if (!s.proc) return false;
    try {
        s.proc.stdin.write(`__custom_cmds ${JSON.stringify(aliasMapFor(bot.ownerId))}\n`);
        return true;
    } catch (_) { return false; }
}

function resolveCustomCmd(name, userId) {
    const key = String(name || '').trim().toLowerCase().replace(/^!/, '');
    const hit = aliasesFor(userId).find(c => c.name && c.name.trim().toLowerCase().replace(/^!/, '') === key);
    return hit && hit.cmd ? hit.cmd : null;
}

// First boot: adopt config/proxies.txt as the initial pool so an existing
// deployment doesn't come up with an empty Proxies page.
(function seedProxyPool() {
    if (proxies.list().length) return;
    const seedFile = path.join(ROOT, 'config/proxies.txt');
    try {
        if (fs.existsSync(seedFile)) {
            const r = proxies.seedIfEmpty(fs.readFileSync(seedFile, 'utf8'));
            if (r && r.added) console.log(`🛡️  Proxy pool seeded with ${r.added} entries from config/proxies.txt`);
        }
    } catch (_) { }
})();

// First-run bootstrap: create an admin account if no users exist.
// Credentials are read from env so they are never committed to source.
const FIRST_ADMIN_EMAIL = process.env.NATIVELAUNCH_ADMIN_EMAIL || process.env.BOTHIVE_ADMIN_EMAIL || process.env.BM_ADMIN_EMAIL || 'admin';
const configuredAdminPassword = process.env.NATIVELAUNCH_ADMIN_PASSWORD || process.env.BOTHIVE_ADMIN_PASSWORD || process.env.BM_ADMIN_PASSWORD || '';
const FIRST_ADMIN_PASSWORD = configuredAdminPassword || crypto.randomBytes(18).toString('base64url');
const firstAdmin = users.ensureFirstAdmin(FIRST_ADMIN_EMAIL, FIRST_ADMIN_PASSWORD);
if (firstAdmin && firstAdmin.ok && !configuredAdminPassword) {
    console.log('[NativeLaunch] First admin created. Set NATIVELAUNCH_ADMIN_PASSWORD before production.');
    console.log(`[NativeLaunch] Login: ${FIRST_ADMIN_EMAIL}`);
    console.log(`[NativeLaunch] Temporary password: ${FIRST_ADMIN_PASSWORD}`);
}


function nextBotId(state) {
    let n = 1;
    const ids = new Set(state.bots.map(b => b.id));
    while (ids.has(`bot-${n}`)) n++;
    return `bot-${n}`;
}

function getBotState(id) {
    if (!runtime.has(id)) {
        runtime.set(id, {
            proc: null, status: 'stopped', logs: [], subs: new Set(),
            inventory: null, lastEvent: null, shards: null
        });
    }
    return runtime.get(id);
}

function botScriptsDir(id) {
    const dir = path.resolve(BOTS_DIR, id, 'scripts');
    if (!dir.startsWith(BOTS_DIR + path.sep)) throw new Error('Invalid bot id');
    return dir;
}

function readBotScripts(id) {
    const dir = botScriptsDir(id);
    if (!fs.existsSync(dir)) return [];
    const rows = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        try {
            const script = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
            rows.push({ ...script, id: script.id || path.basename(name, '.json') });
        } catch (_) { }
    }
    return rows.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

function writeBotScript(id, raw, existing = {}) {
    const script = normalizeScript(raw, existing);
    if (!script) return { ok: false, reason: 'A valid script name, action, and trigger are required.' };
    delete script.botIds;
    const dir = botScriptsDir(id);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, `${script.id}.json`), JSON.stringify(script, null, 2));
    return { ok: true, script };
}

function deleteBotScript(id, scriptId) {
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(scriptId)) return false;
    const file = path.join(botScriptsDir(id), `${scriptId}.json`);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
}

function syncWorkspaceScriptTargets(userId, script, previousBotIds = []) {
    if (!liveState || !script) return 0;
    const next = new Set(Array.isArray(script.botIds) ? script.botIds : []);
    const all = new Set([...(previousBotIds || []), ...next]);
    let synced = 0;
    for (const botId of all) {
        const bot = liveState.bots.find(b => b.id === botId && b.ownerId === userId);
        if (!bot) continue;
        if (next.has(botId)) {
            const result = writeBotScript(botId, script, readBotScripts(botId).find(s => s.id === script.id) || {});
            if (result.ok) synced++;
        } else {
            deleteBotScript(botId, script.id);
        }
        if (getBotState(botId).proc) sendCommand(botId, '!script reload');
    }
    return synced;
}

/**
 * Fan an event out to the global SSE subscribers.
 *
 * Bot-scoped events are filtered per subscriber: each stream remembers the
 * account that opened it, so one tenant's bot never surfaces in another's panel
 * via the live feed — which would otherwise bypass the REST scoping entirely.
 * Events with no bot attached (pool-wide notices) go to everyone.
 *
 * `event` may be a function (viewer) => event for payloads that must differ per
 * account, such as a roster refresh.
 */
function broadcastGlobal(event, state = null) {
    const scope = state || liveState;
    globalSubs.forEach(r => {
        try {
            const viewer = r._bmUserId ? users.findById(r._bmUserId) : null;
            const payload = typeof event === 'function' ? event(viewer) : event;
            if (!payload) return;

            const botId = payload.id || (payload.bot && payload.bot.id);
            if (botId && viewer) {
                // Prefer the bot carried on the event; fall back to the live
                // roster for the id-only events (status/event/shards).
                const bot = payload.bot
                    || (scope && (scope.bots || []).find(b => b.id === botId))
                    || null;
                // Unknown bot means we can't prove the viewer owns it — stay
                // quiet rather than leak. Deletions pass their bot explicitly so
                // the real owner still gets the removal.
                if (!bot || !users.canManageBot(viewer, bot)) return;
            }
            r.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (_) { }
    });
}

function emitToBotSubs(id, event) {
    const s = getBotState(id);
    if (s.subs.size === 0) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    s.subs.forEach(r => { try { r.write(payload); } catch (_) { } });
}

function pushLog(id, line) {
    const s = getBotState(id);
    const clean = String(line).replace(ANSI_RE, '').replace(/\r/g, '');
    if (isNoise(clean)) return;                                 // drop noise
    const entry = { t: Date.now(), line: clean };
    s.logs.push(entry);
    if (s.logs.length > MAX_LOG_LINES) s.logs.splice(0, s.logs.length - MAX_LOG_LINES);
    if (s.subs.size > 0) emitToBotSubs(id, { type: 'log', ...entry });
}

function updateStatus(id, status) {
    const s = getBotState(id);
    s.status = status;
    emitToBotSubs(id, { type: 'status', status });
    broadcastGlobal({ type: 'status', id, status });
}

// ─── Discord webhook ───────────────────────────────────────────────────
function sendWebhook(url, payload) {
    if (!url) return;
    try {
        const u = new URL(url);
        const body = JSON.stringify(payload);
        const lib = u.protocol === 'http:' ? http : https;
        const req = lib.request({
            method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
            path: u.pathname + u.search,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => { res.on('data', () => { }); res.on('end', () => { }); });
        req.on('error', () => { });
        req.write(body); req.end();
    } catch (_) { /* ignore */ }
}

function colorFor(eventType) {
    switch (eventType) {
        case 'kicked': return 0xED4245;
        case 'disconnected': return 0xFEE75C;
        case 'death': return 0x9B59B6;
        case 'crash': return 0x992D22;
        case 'spawn': return 0x57F287;
        default: return 0x5865F2;
    }
}

function fireAlert(bot, ev) {
    const url = bot?.config?.webhookUrl;
    if (!url) return;
    const title = `🍌 ${bot.id} — ${ev.type.toUpperCase()}`;
    const fields = [
        { name: 'Minecraft', value: `\`${ev.username || bot.config.username}\``, inline: true },
        { name: 'Host', value: `\`${bot.config.host}:${bot.config.port}\``, inline: true }
    ];
    if (ev.reason) fields.push({ name: 'Reason', value: '```' + String(ev.reason).slice(0, 900) + '```' });
    const embed = {
        title, color: colorFor(ev.type), fields, timestamp: new Date().toISOString(),
        footer: { text: 'NativeLaunch Alerts' }
    };
    sendWebhook(url, { embeds: [embed] });
}

// ─── Marker parser ─────────────────────────────────────────────────────
function handleChildLine(state, bot, rawLine) {
    const id = bot.id;
    const trimmed = rawLine.replace(ANSI_RE, '').trim();

    let m = trimmed.match(/^\[INVENTORY_JSON\](.+)$/);
    if (m) {
        try {
            const data = JSON.parse(m[1]);
            const s = getBotState(id);
            s.inventory = data;
            emitToBotSubs(id, { type: 'inventory', data });
            return;
        } catch (_) { /* fall through */ }
    }

    m = trimmed.match(/^\[EVENT_JSON\](.+)$/);
    if (m) {
        try {
            const ev = JSON.parse(m[1]);
            const s = getBotState(id);
            s.lastEvent = ev;
            emitToBotSubs(id, { type: 'event', event: ev });
            broadcastGlobal({ type: 'event', id, event: ev });
            if (['kicked', 'disconnected', 'death', 'crash'].includes(ev.type)) fireAlert(bot, ev);
            return;
        } catch (_) { /* fall through */ }
    }

    m = trimmed.match(/^\[SHARDS_JSON\](.+)$/);
    if (m) {
        try {
            const data = JSON.parse(m[1]);
            const s = getBotState(id);
            s.shards = data.shards;
            bot.shards = data.shards;
            emitToBotSubs(id, { type: 'shards', shards: data.shards });
            broadcastGlobal({ type: 'shards', id, shards: data.shards });
            return;
        } catch (_) { /* fall through */ }
    }

    m = trimmed.match(/^\[CONFIG_UPDATE_JSON\](.+)$/);
    if (m) {
        try {
            const patch = JSON.parse(m[1]);
            bot.config = mergeConfig(bot.config, patch);
            saveBotsFile(state);
            // Per-viewer so publicBot redacts credentials for non-admin owners.
            broadcastGlobal(viewer => ({ type: 'bot-updated', bot: publicBot(bot, viewer) }), state);
            return;
        } catch (_) {
            /* fall through */
        }
    }

    m = trimmed.match(/^\[MODULES_JSON\](.+)$/);
    if (m) {
        try {
            const data = JSON.parse(m[1]);
            const s = getBotState(id);
            s.modules = Array.isArray(data.modules) ? data.modules : [];
            s.modulesAt = data.ts || Date.now();
            emitToBotSubs(id, { type: 'modules', modules: mergeModuleRows(bot, s) });
            return;
        } catch (_) { /* fall through */ }
    }

    // Any other machine marker is bot→panel plumbing, not user-facing log text.
    // Without this catch-all an unrecognised marker dumps a wall of JSON into
    // the console — which is exactly what [MODULES_JSON] did before it was
    // parsed above. New markers are now silent by default rather than noisy.
    if (/^\[[A-Z][A-Z0-9_]*_JSON\]/.test(trimmed)) return;

    pushLog(id, rawLine);
}

// ─── Spawn / kill ──────────────────────────────────────────────────────
function startBot(state, bot) {
    const s = getBotState(bot.id);
    if (s.proc) return { ok: false, reason: 'Bot already running' };

    const dataDir = path.join(BOTS_DIR, bot.id);
    ensureDir(dataDir);
    ensureDir(path.join(dataDir, 'system_data'));
    ensureDir(path.join(dataDir, 'scripts'));
    if (bot.ownerId) {
        for (const script of workspaces.scripts(bot.ownerId)) {
            if (Array.isArray(script.botIds) && script.botIds.includes(bot.id)) {
                writeBotScript(bot.id, script, readBotScripts(bot.id).find(s => s.id === script.id) || {});
            }
        }
    }

    const env = {
        ...process.env,
        BOT_CHILD: '1',
        BOT_CONFIG_JSON: JSON.stringify(bot.config),
        BOT_DATA_DIR: dataDir,
        FORCE_COLOR: '0'
    };

    const proc = spawn(process.execPath, [path.join(ROOT, 'index.js')], {
        cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe']
    });

    s.proc = proc;
    updateStatus(bot.id, 'running');
    pushLog(bot.id, `[panel] Bot "${bot.id}" spawned (pid ${proc.pid})`);
    pushCustomCmdsToBot(bot);

    let outBuf = '', errBuf = '';
    proc.stdout.on('data', (chunk) => {
        outBuf += chunk.toString();
        let idx;
        while ((idx = outBuf.indexOf('\n')) !== -1) {
            const line = outBuf.slice(0, idx);
            outBuf = outBuf.slice(idx + 1);
            if (line.trim().length) handleChildLine(state, bot, line);
        }
    });
    proc.stderr.on('data', (chunk) => {
        errBuf += chunk.toString();
        let idx;
        while ((idx = errBuf.indexOf('\n')) !== -1) {
            const line = errBuf.slice(0, idx);
            errBuf = errBuf.slice(idx + 1);
            if (line.trim().length) handleChildLine(state, bot, line);
        }
    });

    proc.on('exit', (code, signal) => {
        pushLog(bot.id, `[panel] process exited (code=${code} signal=${signal || ''})`);
        s.proc = null;
        updateStatus(bot.id, 'stopped');
    });
    proc.on('error', (err) => pushLog(bot.id, `[panel] spawn error: ${err.message}`));

    return { ok: true };
}

function stopBot(id) {
    const s = getBotState(id);
    if (!s.proc) return { ok: false, reason: 'Bot not running' };
    try { s.proc.stdin.write('!quit\n'); } catch (_) { }
    setTimeout(() => {
        try { if (s.proc) s.proc.kill('SIGTERM'); } catch (_) { }
        setTimeout(() => { try { if (s.proc) s.proc.kill('SIGKILL'); } catch (_) { } }, 2000);
    }, 1500);
    return { ok: true };
}

function sendCommand(id, cmd) {
    const s = getBotState(id);
    if (!s.proc) return { ok: false, reason: 'Bot not running' };
    try {
        s.proc.stdin.write(cmd + '\n');
        pushLog(id, `[panel→bot] ${cmd}`);
        return { ok: true };
    } catch (e) { return { ok: false, reason: e.message }; }
}

// ─── HTTP helpers ──────────────────────────────────────────────────────
function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', c => {
            body += c;
            if (body.length > 2e5) { reject(new Error('body too large')); req.destroy(); }
        });
        req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}
function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

function getSessionToken(req) {
    const cookies = req.headers.cookie || '';
    const m = cookies.match(/bm_session=([^;]+)/);
    return m ? m[1] : null;
}

function isAuthenticated(req) {
    const token = getSessionToken(req);
    if (!token) return false;
    const session = SESSIONS.get(token);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      SESSIONS.delete(token);
      saveSessions();
      return false;
    }
    return true;
}

function currentUser(req) {
    const token = getSessionToken(req);
    if (!token) return null;
    const session = SESSIONS.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      SESSIONS.delete(token);
      saveSessions();
      return null;
    }
    return users.findById(session.userId);
}

function requireAdmin(req) {
    const u = currentUser(req);
    return u && u.role === 'admin' ? u : null;
}

/**
 * Dial a proxy and read back the exit IP, so the panel can prove a proxy both
 * accepts our credentials and actually egresses somewhere.
 * Never throws — always resolves { ok, ms, ip, reason }.
 * @param {{host:string,port:number,username?:string,password?:string}} proxy
 * @param {number} timeoutMs
 */
async function probeProxy(proxy, timeoutMs = 10000) {
    const { SocksClient } = require('socks');
    const start = Date.now();
    try {
        const ip = await new Promise((resolve, reject) => {
            let settled = false;
            const done = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
            const fail = (err) => { if (settled) return; settled = true; clearTimeout(timer); reject(err); };
            const timer = setTimeout(
                () => fail(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`)),
                timeoutMs
            );
            SocksClient.createConnection({
                proxy: {
                    host: proxy.host, port: proxy.port, type: 5,
                    ...(proxy.username ? { userId: proxy.username } : {}),
                    ...(proxy.password ? { password: proxy.password } : {})
                },
                command: 'connect',
                destination: { host: 'icanhazip.com', port: 80 },
                timeout: timeoutMs
            }, (err, info) => {
                if (err) return fail(err);
                const socket = info.socket;
                let data = '';
                socket.on('data', chunk => { data += chunk.toString(); });
                socket.on('end', () => done(extractExitIp(data)));
                socket.on('error', error => {
                    // A tunnel that already proved itself is still a working
                    // proxy even if the IP site resets the connection mid-body.
                    const found = extractExitIp(data);
                    if (found) done(found);
                    else fail(error);
                });
                socket.setTimeout(Math.min(6000, timeoutMs), () => done(extractExitIp(data)));
                socket.write('GET / HTTP/1.0\r\nHost: icanhazip.com\r\nConnection: close\r\n\r\n');
            });
        });
        // A successful tunnel is a working proxy even when the IP site blocks
        // the request — only a failed handshake means dead.
        return { ok: true, ms: Date.now() - start, ip };
    } catch (e) {
        return { ok: false, ms: Date.now() - start, ip: null, reason: e.message };
    }
}

/** Pull an IPv4 or IPv6 address out of icanhazip's response body. */
function extractExitIp(body) {
    const text = String(body || '');
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || /^(HTTP\/[0-9.]+\s|<!doctype|<html|<|{)/i.test(line)) continue;
        const m = line.match(/\b(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){1,7})\b/);
        if (m) return m[0];
    }
    return null;
}

/** Run probes with bounded concurrency so 50 proxies don't open 50 sockets. */
async function probeMany(records, concurrency = 8) {
    const out = [];
    for (let i = 0; i < records.length; i += concurrency) {
        const batch = records.slice(i, i + concurrency);
        const res = await Promise.all(batch.map(async rec => {
            const check = await probeProxy(rec);
            proxies.recordCheck(rec.id, check);
            return { id: rec.id, ...check };
        }));
        out.push(...res);
    }
    return out;
}

/**
 * How many bots may share one proxy. Bots on the same proxy share its exit IP,
 * so this is a deliberate cap rather than a technical limit.
 */
const PROXY_MAX_BOTS = 3;

/**
 * Which bots currently use each proxy, keyed by "host:port".
 * Assignment lives on the bot config (config.proxy), not on the pool entry, so
 * this is derived rather than stored — that keeps the two from drifting apart.
 */
function proxyAssignments(state) {
    const { parseLine } = require('./utils/ProxyStore.js');
    const map = new Map(); // "host:port" → [{ id, username }]
    (state.bots || []).forEach(b => {
        const raw = b.config && b.config.proxy;
        if (!raw) return;
        const parsed = typeof raw === 'object'
            ? { host: raw.host || raw.hostname || raw.ip, port: parseInt(raw.port, 10) }
            : parseLine(raw);
        if (!parsed || !parsed.host || !parsed.port) return;
        const key = `${String(parsed.host).toLowerCase()}:${parsed.port}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ id: b.id, username: (b.config && b.config.username) || b.id });
    });
    return map;
}

/** Shape a pool record for the client, including derived assignment info. */
function proxyDto(rec, assignMap, viewer = null, visibleIds = null) {
    const key = `${String(rec.host).toLowerCase()}:${rec.port}`;
    const allAssigned = (assignMap && assignMap.get(key)) || [];
    // Capacity is global — a slot taken by a bot you can't see is still taken —
    // but the names are filtered, so a tenant never learns another's bot list.
    const assignedTo = visibleIds
        ? allAssigned.filter(h => visibleIds.has(h.id))
        : allAssigned;
    const owner = rec.owner ? users.findById(rec.owner) : null;
    return {
        id: rec.id,
        host: rec.host,
        port: rec.port,
        username: rec.username || null,
        hasAuth: !!rec.username,
        uri: viewer && viewer.role === 'admin' ? proxyToUri(rec) : maskProxyUri(proxyToUri(rec)),
        label: proxyToLabel(rec),
        note: rec.note || '',
        owner: rec.owner || null,
        // Admins get a global view, so the table needs to say whose pool each
        // row belongs to. Unclaimed legacy rows read as "Unassigned".
        ownerLabel: rec.owner ? (owner ? owner.email : 'deleted user') : 'Unassigned',
        isOwn: !!(viewer && rec.owner === viewer.id),
        addedAt: rec.addedAt || null,
        lastCheck: rec.lastCheck || null,
        // Convenience projections the panel table reads directly.
        alive: !!(rec.lastCheck && rec.lastCheck.ok),
        latency: rec.lastCheck ? (Number(rec.lastCheck.ms) || null) : null,
        checkedAt: rec.lastCheck ? (rec.lastCheck.at || null) : null,
        assignedTo,
        hiddenAssignments: Math.max(0, allAssigned.length - assignedTo.length),
        capacity: PROXY_MAX_BOTS,
        freeSlots: Math.max(0, PROXY_MAX_BOTS - allAssigned.length)
    };
}

/** The whole pool as this account should see it. */
function proxyDtos(state, user) {
    const assignMap = proxyAssignments(state);
    const visibleIds = new Set(users.filterBots(user, state.bots || []).map(b => b.id));
    return proxies.listFor(user).map(r => proxyDto(r, assignMap, user, visibleIds));
}

function createSession(user) {
    const token = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 1000 * 60 * 60 * 24; // 24 hours
    SESSIONS.set(token, { userId: user.id, email: user.email, role: user.role, expiresAt });
    saveSessions();
    return token;
}

function destroySession(req) {
    const token = getSessionToken(req);
    if (token) { SESSIONS.delete(token); saveSessions(); }
}

function revokeUserSessions(userId, exceptToken = null) {
    let changed = false;
    for (const [token, session] of SESSIONS.entries()) {
        if (session.userId === userId && token !== exceptToken) {
            SESSIONS.delete(token);
            changed = true;
        }
    }
    if (changed) saveSessions();
}

function maskProxyUri(value) {
    if (!value) return value;
    const raw = String(value);
    const schemeAt = raw.indexOf('://');
    const scheme = schemeAt >= 0 ? raw.slice(0, schemeAt + 3) : '';
    const endpoint = schemeAt >= 0 ? raw.slice(schemeAt + 3) : raw;
    return scheme + endpoint.slice(endpoint.lastIndexOf('@') + 1);
}

function publicBot(bot, user = null) {
    const s = getBotState(bot.id);
    const owner = bot.ownerId ? users.findById(bot.ownerId) : null;
    const base = {
        id: bot.id, config: { ...(bot.config || {}) }, status: s.status, pid: s.proc?.pid || null,
        hasInventory: !!s.inventory, shards: s.shards !== null && s.shards !== undefined ? s.shards : (bot.shards ?? null),
        ownerId: bot.ownerId || null,
        ownerLabel: user && user.role === 'admin' ? (owner ? owner.email : null) : null
    };
    const proxyRecord = base.config.proxy ? proxies.findByUri(base.config.proxy) : null;
    if (proxyRecord && (!user || proxies.canAccess(user, proxyRecord))) base.config.proxyId = proxyRecord.id;
    if (user && user.role !== 'admin') {
        // Tenants can operate their bot without receiving stored credentials.
        base.config = { ...base.config };
        base.config.loginPassword = null;
        base.config.proxy = maskProxyUri(base.config.proxy);
        if (base.config.discord) {
            base.config.discord = { ...base.config.discord, token: '', guildId: '' };
        }
        base.config.webhookUrl = '';
    }
    return base;
}

function publicUser(u) {
    return users.sanitize(u);
}

// ─── Routes ────────────────────────────────────────────────────────────
async function handleHttp(req, res, state) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:");

    if (p.startsWith('/api/') && ['POST', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin) {
        try {
            const originHost = new URL(req.headers.origin).host;
            // Reverse proxies (including the Next.js development rewrite) may
            // dial the API with their upstream Host while preserving the
            // browser-facing host in X-Forwarded-Host. Accept either exact
            // host; browsers cannot forge this header themselves.
            const forwardedHosts = String(req.headers['x-forwarded-host'] || '')
                .split(',').map(value => value.trim()).filter(Boolean);
            const allowedHosts = new Set([req.headers.host, ...forwardedHosts].filter(Boolean));
            if (!allowedHosts.has(originHost)) {
                return json(res, 403, { ok: false, reason: 'Cross-origin request blocked' });
            }
        } catch (_) { return json(res, 403, { ok: false, reason: 'Invalid request origin' }); }
    }

    // API access is same-origin. Preflight advertises methods without opening
    // the authenticated panel to arbitrary origins.
    if (req.method === 'OPTIONS' && p.startsWith('/api/')) {
        res.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && (p === '/' || p === '/index.html' || p === '/panel' || p === '/dashboard')) {
        return json(res, 200, { ok: true, name: 'NativeLaunch API', status: 'online' });
    }

    // ── Auth Routes ──────────────────────────────────────────────────
    if (req.method === 'POST' && p === '/api/login') {
        const body = await readJson(req);
        const user = users.authenticate(body.email, body.password);
        if (user) {
            const token = createSession(user);
            const secure = (process.env.NATIVELAUNCH_COOKIE_SECURE === '1' || process.env.BOTHIVE_COOKIE_SECURE === '1') ? '; Secure' : '';
            res.writeHead(200, {
                'Set-Cookie': `bm_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}`,
                'Content-Type': 'application/json'
            });
            return res.end(JSON.stringify({ ok: true, user: { ...publicUser(user), preferences: workspaces.preferences(user.id) } }));
        }
        return json(res, 401, { ok: false, reason: 'Invalid credentials' });
    }

    if (req.method === 'GET' && p === '/api/me') {
        const u = currentUser(req);
        return json(res, 200, {
            authenticated: !!u,
            user: u ? { ...publicUser(u), preferences: workspaces.preferences(u.id) } : null
        });
    }

    if (req.method === 'POST' && p === '/api/logout') {
        destroySession(req);
        res.writeHead(200, {
            'Set-Cookie': 'bm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
            'Content-Type': 'application/json'
        });
        return res.end(JSON.stringify({ ok: true }));
    }

    // Protect all other /api routes
    if (p.startsWith('/api/') && !isAuthenticated(req)) {
        return json(res, 401, { ok: false, reason: 'Unauthorized' });
    }

    if (req.method === 'POST' && p === '/api/usernames/generate') {
        const user = currentUser(req);
        try {
            const suggestion = await usernameGenerator.generate({
                ownerId: user.id,
                excluded: (state.bots || []).map(bot => bot.config && bot.config.username)
            });
            return json(res, 200, { ok: true, ...suggestion });
        } catch (error) {
            const unavailable = ['UPSTREAM_RATE_LIMIT', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_INVALID'].includes(error.code);
            return json(res, unavailable ? 503 : 409, {
                ok: false,
                reason: error.message || 'Could not generate a username right now'
            });
        }
    }

    // ── Account workspace ───────────────────────────────────────────
    if (p === '/api/preferences') {
        const user = currentUser(req);
        if (req.method === 'GET') return json(res, 200, { ok: true, preferences: workspaces.preferences(user.id) });
        if (req.method === 'PATCH') {
            const body = await readJson(req);
            const preferences = workspaces.updatePreferences(user.id, body);
            return json(res, 200, { ok: true, preferences });
        }
        return json(res, 405, { ok: false, reason: 'Method not allowed' });
    }

    if (p === '/api/account' && req.method === 'PATCH') {
        const user = currentUser(req);
        const body = await readJson(req);
        const patch = {};
        if (body.email !== undefined) patch.email = body.email;
        if (body.password !== undefined) patch.password = body.password;
        const result = users.update(user.id, patch);
        if (result.ok && body.password) revokeUserSessions(user.id, getSessionToken(req));
        return json(res, result.ok ? 200 : 400, result);
    }

    if (p === '/api/workspace' && req.method === 'GET') {
        const user = currentUser(req);
        return json(res, 200, { ok: true, ...workspaces.snapshot(user.id) });
    }

    if (p === '/api/scripts' || p.startsWith('/api/scripts/')) {
        const user = currentUser(req);
        const id = p.slice('/api/scripts'.length).replace(/^\//, '');
        if (req.method === 'GET' && !id) return json(res, 200, { ok: true, scripts: workspaces.scripts(user.id) });
        if (req.method === 'POST' && !id) {
            const result = workspaces.createScript(user.id, await readJson(req));
            if (result.ok) result.syncedTo = syncWorkspaceScriptTargets(user.id, result.script);
            return json(res, result.ok ? 201 : 400, result);
        }
        if (req.method === 'PATCH' && id) {
            const previous = workspaces.scripts(user.id).find(s => s.id === id);
            const result = workspaces.updateScript(user.id, id, await readJson(req));
            if (result.ok) result.syncedTo = syncWorkspaceScriptTargets(user.id, result.script, previous?.botIds || []);
            return json(res, result.ok ? 200 : 404, result);
        }
        if (req.method === 'DELETE' && id) {
            const previous = workspaces.scripts(user.id).find(s => s.id === id);
            const result = workspaces.deleteScript(user.id, id);
            if (result.ok && previous) {
                syncWorkspaceScriptTargets(user.id, { ...previous, botIds: [] }, previous.botIds || []);
            }
            return json(res, result.ok ? 200 : 404, result);
        }
        return json(res, 405, { ok: false, reason: 'Method not allowed' });
    }

    // ── User Management (admin only) ─────────────────────────────────
    if (req.method === 'GET' && p === '/api/users') {
        if (!requireAdmin(req)) return json(res, 403, { ok: false, reason: 'Forbidden' });
        return json(res, 200, { ok: true, users: users.list() });
    }

    if (req.method === 'POST' && p === '/api/users') {
        if (!requireAdmin(req)) return json(res, 403, { ok: false, reason: 'Forbidden' });
        const body = await readJson(req);
        const result = users.create({
            email: body.email,
            password: body.password,
            role: body.role,
            permissions: body.permissions || {
                allBots: body.allBots,
                botIds: body.botIds,
                categories: body.categories
            }
        });
        return json(res, result.ok ? 200 : 400, result);
    }

    const userRoute = p.match(/^\/api\/users\/([a-f0-9-]+)$/);
    if (userRoute) {
        if (!requireAdmin(req)) return json(res, 403, { ok: false, reason: 'Forbidden' });
        const id = userRoute[1];
        if (req.method === 'PATCH') {
            const body = await readJson(req);
            if (!body.permissions && (body.categories !== undefined || body.botIds !== undefined || body.allBots !== undefined)) {
                body.permissions = {
                    allBots: body.allBots,
                    botIds: body.botIds,
                    categories: body.categories
                };
            }
            const result = users.update(id, body);
            if (result.ok && body.password) revokeUserSessions(id, getSessionToken(req));
            return json(res, result.ok ? 200 : 400, result);
        }
        if (req.method === 'DELETE') {
            const me = currentUser(req);
            if (me && me.id === id) {
                return json(res, 400, { ok: false, reason: 'You cannot delete your own account.' });
            }
            const ownedBots = state.bots.filter(bot => bot.ownerId === id).length;
            const ownedProxies = proxies.list().filter(proxy => proxy.owner === id).length;
            if (ownedBots || ownedProxies) {
                return json(res, 409, {
                    ok: false,
                    reason: `Reassign or delete this account's ${ownedBots} bot(s) and ${ownedProxies} proxy endpoint(s) first.`
                });
            }
            const result = users.delete(id);
            if (result.ok) {
                revokeUserSessions(id);
                workspaces.deleteWorkspace(id);
            }
            return json(res, result.ok ? 200 : 404, result);
        }
    }

    // Mass command: send one command to many bots, optionally staggered.
    // body: { cmd, target?: 'running' | 'all', delaySeconds?: number,
    //         excludeCategories?: string[], includeCategories?: string[] }
    // (default 'running')
        if (req.method === 'POST' && p === '/api/mass-cmd') {
        const user = currentUser(req);
        const body = await readJson(req);
        let cmd = String(body.cmd || '').trim();
        if (!cmd) return json(res, 400, { ok: false, reason: 'cmd required' });
        // A saved custom command name is a valid command too; expand it to its
        // content so the job payload is stable even if targets aren't live.
        const resolved = resolveCustomCmd(cmd, user.id);
        if (resolved) cmd = resolved;
        let staggerMs = 0;
        if (body.staggerSec !== undefined) {
            staggerMs = Math.round(Number(body.staggerSec) * 1000);
        } else if (body.staggerMs !== undefined) {
            staggerMs = Number(body.staggerMs);
        }
        if (!Number.isFinite(staggerMs) || staggerMs < 0 || staggerMs > 300000) {
            return json(res, 400, { ok: false, reason: 'stagger must be between 0 and 300 seconds' });
        }
        const includeIds = Array.isArray(body.botIds) && body.botIds.length > 0
            ? new Set(body.botIds.map(s => String(s).trim()))
            : null;
        const targets = [];
        for (const bot of state.bots) {
            if (!users.canManageBot(user, bot)) continue;
            if (includeIds && !includeIds.has(bot.id)) continue;
            if (!getBotState(bot.id).proc) continue; // running bots only
            targets.push(bot);
        }
        if (!targets.length) {
            return json(res, 400, { ok: false, reason: 'No targets (nothing running or selected)' });
        }

        const job = {
            id: 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            ownerId: user.id,
            ownerLabel: user.email,
            cmd,
            botIds: targets.map(b => b.id),
            total: targets.length,
            done: 0, ok: 0, skipped: 0, pos: 0,
            staggerMs,
            status: 'running',
            next: targets.length > 1 ? null : null,
            nextAt: null,
            createdAt: new Date().toISOString()
        };
        jobs.unshift(job);
        if (jobs.length > MAX_JOBS) jobs.length = MAX_JOBS;
        persistJobs();
        broadcastGlobal(viewer => {
            if (viewer && viewer.role !== 'admin' && job.ownerId !== viewer.id) return null;
            return { type: 'job', job: { ...job } };
        });
        runJobLoop(job, job.botIds, staggerMs);

        return json(res, 202, { ok: true, jobId: job.id, total: job.total, job });
    }

    // Job history (mass commands). Sent to the panel so it can re-attach to a
    // run after a reload — execution itself never depends on an open tab.
    if (req.method === 'GET' && p === '/api/jobs') {
        const user = currentUser(req);
        const visible = user.role === 'admin' ? jobs : jobs.filter(job => job.ownerId === user.id);
        return json(res, 200, { ok: true, jobs: visible });
    }

    // Lifecycle schedules. Each account may schedule only bots it can manage;
    // execution checks that permission again in case access changes later.
    if (p === '/api/schedules') {
        const user = currentUser(req);
        if (req.method === 'GET') {
            const visible = schedules.filter(s => s.ownerId === user.id);
            return json(res, 200, { ok: true, schedules: visible });
        }
        if (req.method === 'POST') {
            const body = await readJson(req);
            const action = String(body.action || '').trim().toLowerCase();
            if (!['start', 'stop'].includes(action)) {
                return json(res, 400, { ok: false, reason: 'Action must be start or stop' });
            }

            const runAtMs = new Date(body.runAt).getTime();
            if (!Number.isFinite(runAtMs)) {
                return json(res, 400, { ok: false, reason: 'A valid runAt time is required' });
            }
            if (runAtMs < Date.now() + 1000) {
                return json(res, 400, { ok: false, reason: 'Schedule the action at least one second in the future' });
            }
            if (runAtMs > Date.now() + 366 * 24 * 60 * 60 * 1000) {
                return json(res, 400, { ok: false, reason: 'Schedule time cannot be more than one year away' });
            }

            const ids = Array.isArray(body.botIds)
                ? [...new Set(body.botIds.map(id => String(id).trim()).filter(Boolean))]
                : [];
            if (!ids.length || ids.length > 200) {
                return json(res, 400, { ok: false, reason: 'Choose between 1 and 200 bots' });
            }
            const allowed = new Set(users.filterBots(user, state.bots).map(bot => bot.id));
            if (ids.some(id => !allowed.has(id))) {
                return json(res, 403, { ok: false, reason: 'One or more selected bots are not available to your account' });
            }

            const schedule = {
                id: 'sch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                ownerId: user.id,
                ownerLabel: user.email,
                action,
                botIds: ids,
                runAt: new Date(runAtMs).toISOString(),
                timeZone: body.timeZone === 'UTC' ? 'UTC' : 'local',
                status: 'pending',
                createdAt: new Date().toISOString(),
                ok: 0,
                skipped: 0,
                failed: 0,
                results: []
            };
            schedules.unshift(schedule);
            trimSchedules();
            persistSchedules();
            return json(res, 201, { ok: true, schedule });
        }
        return json(res, 405, { ok: false, reason: 'Method not allowed' });
    }

    const scheduleRoute = p.match(/^\/api\/schedules\/([A-Za-z0-9_-]+)$/);
    if (scheduleRoute) {
        const user = currentUser(req);
        const schedule = schedules.find(s => s.id === scheduleRoute[1]);
        if (!schedule || schedule.ownerId !== user.id) {
            return json(res, 404, { ok: false, reason: 'Schedule not found' });
        }
        if (req.method !== 'DELETE') return json(res, 405, { ok: false, reason: 'Method not allowed' });

        if (schedule.status === 'running') {
            return json(res, 409, { ok: false, reason: 'This schedule is already running and cannot be cancelled' });
        }
        if (schedule.status === 'pending') {
            schedule.status = 'cancelled';
            schedule.cancelledAt = new Date().toISOString();
        } else {
            schedules.splice(schedules.indexOf(schedule), 1);
        }
        persistSchedules();
        return json(res, 200, { ok: true });
    }

    // ── Per-account aliases ─────────────────────────────────────────
    // Kept on the legacy route so older panel clients remain compatible.
    // Every user owns a separate list, pushed only to bots they own.
    if (p === '/api/custom-cmds' || p.startsWith('/api/custom-cmds/')) {
        const user = currentUser(req);
        const seg = p.slice('/api/custom-cmds'.length).replace(/^\//, '');

        if (req.method === 'GET' && seg === '') {
            const running = liveState.bots.filter(b => b.ownerId === user.id && getBotState(b.id).proc).length;
            return json(res, 200, { ok: true, cmds: aliasesFor(user.id), syncedTo: running });
        }

        if (req.method === 'POST' && seg === 'sync') {
            return json(res, 200, { ok: true, pushed: pushCustomCmds(user.id) });
        }

        if (req.method === 'POST' && seg === '') {
            const body = await readJson(req);
            const result = workspaces.createAlias(user.id, body);
            if (!result.ok) return json(res, 400, result);
            const pushed = pushCustomCmds(user.id);
            return json(res, 201, { ok: true, cmd: result.alias, alias: result.alias, pushed });
        }

        if (seg) {
            if (req.method === 'PATCH') {
                const result = workspaces.updateAlias(user.id, seg, await readJson(req));
                if (!result.ok) return json(res, 404, result);
                const pushed = pushCustomCmds(user.id);
                return json(res, 200, { ok: true, cmd: result.alias, alias: result.alias, pushed });
            }

            if (req.method === 'DELETE') {
                const result = workspaces.deleteAlias(user.id, seg);
                if (!result.ok) return json(res, 404, result);
                const pushed = pushCustomCmds(user.id);
                return json(res, 200, { ok: true, pushed });
            }
        }
        return json(res, 405, { ok: false, reason: 'Method not allowed' });
    }

    // ── Proxy Pool ───────────────────────────────────────────────────
    // Each entry belongs to one account. A tenant sees and mutates only their
    // own endpoints; admins get a global view with an owner column and may
    // reassign ownership.
    if (p === '/api/proxies' || p.startsWith('/api/proxies/')) {
        const user = currentUser(req);
        const seg = p.slice('/api/proxies'.length).replace(/^\//, '');
        const isAdmin = user && user.role === 'admin';

        if (req.method === 'GET' && seg === '') {
            return json(res, 200, {
                ok: true,
                capacity: PROXY_MAX_BOTS,
                canReassign: isAdmin,
                proxies: proxyDtos(state, user)
            });
        }

        if (req.method === 'POST' && seg === '') {
            const body = await readJson(req);
            const text = typeof body.text === 'string' ? body.text : '';
            if (!text.trim()) return json(res, 400, { ok: false, reason: 'No proxies supplied' });
            // Imports land in the importer's own pool. An admin may hand them to
            // another account with `owner`, which is how a tenant gets seeded.
            let owner = user.id;
            if (body.owner !== undefined && isAdmin) {
                if (body.owner === null || body.owner === '') owner = null;
                else if (users.findById(body.owner)) owner = body.owner;
                else return json(res, 400, { ok: false, reason: 'Unknown owner' });
            }
            const result = body.replace === true
                ? proxies.replaceAllFromText(text, owner, { takeover: isAdmin })
                : proxies.importText(text, owner, { takeover: isAdmin });
            return json(res, 200, {
                ok: true, ...result,
                proxies: proxyDtos(state, user)
            });
        }

        if (req.method === 'DELETE' && seg === '') {
            const body = await readJson(req).catch(() => ({}));
            const removed = Array.isArray(body.ids) && body.ids.length
                ? proxies.removeMany(body.ids, user)
                : proxies.clear(isAdmin ? null : user.id);
            return json(res, 200, { ok: true, removed });
        }

        if (req.method === 'POST' && seg === 'check-all') {
            const body = await readJson(req).catch(() => ({}));
            const mine = proxies.listFor(user);
            const targets = Array.isArray(body.ids) && body.ids.length
                ? mine.filter(r => body.ids.includes(r.id))
                : mine;
            if (!targets.length) return json(res, 200, { ok: true, results: [] });
            const results = await probeMany(targets);
            return json(res, 200, {
                ok: true, results,
                working: results.filter(r => r.ok).length,
                failed: results.filter(r => !r.ok).length,
                proxies: proxyDtos(state, user)
            });
        }

        // Hand out proxy slots to bots. Each proxy may take up to
        // PROXY_MAX_BOTS bots, but slots are dealt in rounds so every proxy
        // gets its first bot before any proxy gets a second — bots only end up
        // sharing an exit IP once the pool is genuinely exhausted.
        if (req.method === 'POST' && seg === 'assign') {
            const body = await readJson(req).catch(() => ({}));
            const onlyWorking = body.onlyWorking !== false;
            const overwrite = body.overwrite === true;

            // Only ever deal your own proxies to your own bots.
            const ownBots = users.filterBots(user, state.bots);
            const targetBots = Array.isArray(body.botIds) && body.botIds.length
                ? ownBots.filter(b => body.botIds.includes(b.id))
                : ownBots.slice();
            const candidates = targetBots.filter(b => overwrite || !b.config.proxy);
            const candidateIds = new Set(candidates.map(b => b.id));

            const assignMap = proxyAssignments(state);
            const caps = [];
            proxies.listFor(user).forEach(rec => {
                if (onlyWorking && !(rec.lastCheck && rec.lastCheck.ok)) return;
                const key = `${String(rec.host).toLowerCase()}:${rec.port}`;
                // Bots we're about to reassign give their slot back to the pool.
                const kept = (assignMap.get(key) || []).filter(h => !candidateIds.has(h.id));
                const free = PROXY_MAX_BOTS - kept.length;
                if (free > 0) caps.push({ rec, free });
            });

            // Deal round-robin: one slot per proxy per pass.
            const slots = [];
            const deepest = caps.reduce((m, c) => Math.max(m, c.free), 0);
            for (let round = 0; round < deepest; round++) {
                for (const c of caps) if (c.free > round) slots.push(c.rec);
            }

            if (!slots.length) {
                return json(res, 400, {
                    ok: false,
                    reason: onlyWorking
                        ? `No proxy slots free. Every verified proxy already has ${PROXY_MAX_BOTS} bots, or none are verified — run "Test all" first.`
                        : `No proxy slots free. Every proxy already has ${PROXY_MAX_BOTS} bots.`
                });
            }

            const assigned = [];
            candidates.forEach((bot, i) => {
                if (i >= slots.length) return;
                bot.config.proxy = proxyToUri(slots[i]);
                assigned.push({
                    botId: bot.id,
                    username: bot.config.username || bot.id,
                    proxy: proxyToLabel(slots[i])
                });
            });

            if (assigned.length) {
                saveBotsFile(state);
                assigned.forEach(a => {
                    const b = state.bots.find(x => x.id === a.botId);
                    if (b) broadcastGlobal(viewer => ({ type: 'bot-updated', bot: publicBot(b, viewer) }), state);
                });
            }

            return json(res, 200, {
                ok: true,
                assigned,
                skipped: Math.max(0, candidates.length - assigned.length),
                capacity: PROXY_MAX_BOTS,
                note: 'Running bots keep their current IP until restarted.'
            });
        }

        // /api/proxies/:id  and  /api/proxies/:id/check
        const m = seg.match(/^([A-Za-z0-9_]+)(?:\/(check))?$/);
        if (m) {
            const rec = proxies.get(m[1]);
            // Same 404 for "missing" and "not yours" — otherwise the response
            // confirms whether an id exists in another tenant's pool.
            if (!rec || !proxies.canAccess(user, rec)) {
                return json(res, 404, { ok: false, reason: 'Proxy not found' });
            }

            if (req.method === 'POST' && m[2] === 'check') {
                const check = await probeProxy(rec);
                proxies.recordCheck(rec.id, check);
                const assignMap = proxyAssignments(state);
                const visibleIds = new Set(users.filterBots(user, state.bots).map(b => b.id));
                return json(res, 200, { ok: true, check, proxy: proxyDto(proxies.get(rec.id), assignMap, user, visibleIds) });
            }
            if (req.method === 'PATCH' && !m[2]) {
                const body = await readJson(req);
                // Reassigning a proxy to another account is an admin action.
                const patch = { note: body.note };
                if (body.owner !== undefined) {
                    if (!isAdmin) return json(res, 403, { ok: false, reason: 'Admin only' });
                    if (body.owner && !users.findById(body.owner)) {
                        return json(res, 400, { ok: false, reason: 'Unknown owner' });
                    }
                    patch.owner = body.owner || null;
                }
                const updated = proxies.update(rec.id, patch);
                const assignMap = proxyAssignments(state);
                const visibleIds = new Set(users.filterBots(user, state.bots).map(b => b.id));
                return json(res, 200, { ok: true, proxy: proxyDto(updated, assignMap, user, visibleIds) });
            }
            if (req.method === 'DELETE' && !m[2]) {
                // Detach from any bot first, otherwise a bot would keep dialing
                // an endpoint the operator believes they deleted.
                const key = `${String(rec.host).toLowerCase()}:${rec.port}`;
                let detached = 0;
                proxyAssignments(state).get(key)?.forEach(h => {
                    const b = state.bots.find(x => x.id === h.id);
                    if (b) { delete b.config.proxy; detached++; broadcastGlobal(viewer => ({ type: 'bot-updated', bot: publicBot(b, viewer) }), state); }
                });
                if (detached) saveBotsFile(state);
                proxies.remove(rec.id);
                return json(res, 200, { ok: true, detached });
            }
        }

        return json(res, 404, { ok: false, reason: 'Unknown proxy route' });
    }

    // ── Proxy Checker (ad-hoc, used by the bot config form) ───────────
    if (req.method === 'POST' && p === '/api/proxy/check') {
        const user = currentUser(req);
        const body = await readJson(req);
        const { parseProxy } = require('./utils/proxy.js');
        const known = body.proxyId ? proxies.get(String(body.proxyId)) : proxies.findByUri(body.proxy);
        const proxy = parseProxy(known ? proxyToUri(known) : body.proxy);
        if (!proxy) return json(res, 400, { ok: false, reason: 'Invalid proxy format. Use socks5://user:pass@host:port or host:port' });

        // Non-admins may only probe endpoints from their own pool; an open
        // checker would otherwise dial arbitrary hosts on the panel's behalf.
        if (user.role !== 'admin' && !(known && proxies.canAccess(user, known))) {
            return json(res, 403, { ok: false, reason: 'You can only test proxies from your own pool' });
        }

        const check = await probeProxy(proxy);
        if (!check.ok) return json(res, 200, { ok: false, reason: check.reason, ms: check.ms });

        // Keep the pool's health view fresh when the proxy is a known one.
        if (known) proxies.recordCheck(known.id, check);

        return json(res, 200, { ok: true, ms: check.ms, ip: check.ip });
    }

    if (req.method === 'GET' && p === '/api/bots') {
        const user = currentUser(req);
        const visible = users.filterBots(user, state.bots);
        return json(res, 200, { bots: visible.map(b => publicBot(b, user)) });
    }

    if (req.method === 'POST' && p === '/api/bots') {
        const user = currentUser(req);
        const body = await readJson(req);
        const id = body.id && /^[a-zA-Z0-9_-]{1,24}$/.test(body.id) ? body.id : nextBotId(state);
        // Check against every bot, not just visible ones — ids are global, and a
        // silent collision would have two accounts sharing one bot.
        if (state.bots.some(b => b.id === id)) {
            return json(res, 400, { ok: false, reason: 'Bot ID already exists' });
        }
        const requestedUsername = String(body.username || id).trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(requestedUsername)) {
            return json(res, 400, { ok: false, reason: 'Minecraft usernames must be 3-16 letters, numbers, or underscores' });
        }
        if (state.bots.some(bot => String(bot.config && bot.config.username).toLowerCase() === requestedUsername.toLowerCase())) {
            return json(res, 409, { ok: false, reason: 'That Minecraft username is already used by another bot' });
        }
        body.username = requestedUsername;
        let ownerId = user.id;
        if (user.role === 'admin' && body.ownerId) {
            if (!users.findById(body.ownerId)) return json(res, 400, { ok: false, reason: 'Unknown owner' });
            ownerId = body.ownerId;
        }

        const targetOwner = users.findById(ownerId) || user;
        if (targetOwner.role !== 'admin') {
            const ownedCount = state.bots.filter(b => b.ownerId === ownerId).length;
            if (ownedCount >= MAX_BOTS_PER_ACCOUNT) {
                return json(res, 403, {
                    ok: false,
                    reason: `Bot limit reached. Non-admin accounts can have a maximum of ${MAX_BOTS_PER_ACCOUNT} bots (${ownedCount}/${MAX_BOTS_PER_ACCOUNT} used).`
                });
            }
        }

        if (body.proxyId) {
            const rec = proxies.get(String(body.proxyId));
            if (!rec || (user.role !== 'admin' && rec.owner !== user.id) || (user.role === 'admin' && rec.owner && rec.owner !== ownerId)) {
                return json(res, 400, { ok: false, reason: 'Proxy is not available to this account' });
            }
            const key = `${String(rec.host).toLowerCase()}:${rec.port}`;
            if ((proxyAssignments(state).get(key) || []).length >= PROXY_MAX_BOTS) {
                return json(res, 409, { ok: false, reason: 'That proxy has no slots left. Pick another endpoint.' });
            }
            body.proxy = proxyToUri(rec);
        }
        const config = buildConfigFromBody(body, id);

        // A tenant can only point a new bot at a proxy they own.
        if (config.proxy && user.role !== 'admin') {
            const known = proxies.findByUri(config.proxy);
            if (!known || !proxies.canAccess(user, known)) {
                return json(res, 400, { ok: false, reason: 'Proxy is not in your pool' });
            }
        }

        const bot = { id, ownerId, config };
        state.bots.push(bot);
        try { usernameGenerator.reserve(config.username, ownerId, { source: 'bot-created' }); } catch (_) { }
        saveBotsFile(state);
        broadcastGlobal(viewer => ({ type: 'bot-added', bot: publicBot(bot, viewer) }), state);
        return json(res, 200, { ok: true, bot: publicBot(bot, user) });
    }

    if (req.method === 'DELETE' && p === '/api/bots') {
        const user = currentUser(req);
        const body = await readJson(req).catch(() => ({}));
        const ids = Array.isArray(body.ids) ? body.ids : [];
        if (!ids.length) return json(res, 400, { ok: false, reason: 'No bot IDs provided' });

        let removed = 0;
        const removedBots = [];
        for (const id of ids) {
            const bot = state.bots.find(b => b.id === id);
            if (!bot || !users.canManageBot(user, bot)) continue;
            stopBot(id);
            state.bots = state.bots.filter(b => b.id !== id);
            runtime.delete(id);
            broadcastGlobal(viewer => ({ type: 'bot-removed', id, bot: publicBot(bot, viewer) }), state);
            users.revokeBotEverywhere(id);
            const dataDir = path.resolve(BOTS_DIR, id);
            if (dataDir.startsWith(BOTS_DIR + path.sep)) {
                try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { }
            }
            removed++;
            removedBots.push(id);
        }
        if (removed > 0) {
            saveBotsFile(state);
        }
        return json(res, 200, { ok: true, removed, ids: removedBots });
    }

    const m = p.match(/^\/api\/bots\/([a-zA-Z0-9_-]+)(?:\/(.+))?$/);
    if (m) {
        const user = currentUser(req);
        const id = m[1];
        const sub = m[2] || '';
        const bot = state.bots.find(b => b.id === id);
        if (!bot) return json(res, 404, { ok: false, reason: 'Bot not found' });
        if (!users.canManageBot(user, bot)) return json(res, 403, { ok: false, reason: 'Forbidden' });

        if (req.method === 'GET' && sub === '') {
            const s = getBotState(id);
            const recent = s.logs.length > SNAPSHOT_LOG_LIMIT ? s.logs.slice(-SNAPSHOT_LOG_LIMIT) : s.logs;
            return json(res, 200, { ok: true, bot: publicBot(bot, user), logs: recent, inventory: s.inventory });
        }
        if (req.method === 'DELETE' && sub === '') {
            stopBot(id);
            state.bots = state.bots.filter(b => b.id !== id);
            saveBotsFile(state);
            runtime.delete(id);
            // Announce before revoking: the filter in broadcastGlobal reads the
            // grants, so dropping them first would hide the removal from the
            // owner and leave a dead row in their sidebar.
            broadcastGlobal(viewer => ({ type: 'bot-removed', id, bot: publicBot(bot, viewer) }), state);
            users.revokeBotEverywhere(id);
            const dataDir = path.resolve(BOTS_DIR, id);
            if (dataDir.startsWith(BOTS_DIR + path.sep)) {
                try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { }
            }
            return json(res, 200, { ok: true });
        }
        if (req.method === 'PATCH' && sub === 'owner') {
            if (user.role !== 'admin') return json(res, 403, { ok: false, reason: 'Forbidden' });
            const body = await readJson(req);
            const owner = users.findById(body.ownerId);
            if (!owner) return json(res, 400, { ok: false, reason: 'Unknown owner' });
            if (owner.role !== 'admin') {
                const ownedCount = state.bots.filter(b => b.ownerId === owner.id && b.id !== id).length;
                if (ownedCount >= MAX_BOTS_PER_ACCOUNT) {
                    return json(res, 403, {
                        ok: false,
                        reason: `Target account has reached the maximum of ${MAX_BOTS_PER_ACCOUNT} bots (${ownedCount}/${MAX_BOTS_PER_ACCOUNT} used).`
                    });
                }
            }
            const dataDir = path.resolve(BOTS_DIR, id);
            const scriptsDir = path.join(dataDir, 'scripts');
            if (dataDir.startsWith(BOTS_DIR + path.sep)) {
                try { fs.rmSync(scriptsDir, { recursive: true, force: true }); } catch (_) { }
                ensureDir(scriptsDir);
                try { fs.unlinkSync(path.join(dataDir, 'aliases.json')); } catch (_) { }
            }
            bot.ownerId = owner.id;
            saveBotsFile(state);
            if (getBotState(id).proc) sendCommand(id, '!script reload');
            pushCustomCmdsToBot(bot);
            broadcastGlobal(viewer => ({ type: 'bot-updated', bot: publicBot(bot, viewer) }), state);
            return json(res, 200, { ok: true, bot: publicBot(bot, user) });
        }
        if (req.method === 'PATCH' && sub === 'config') {
            const body = await readJson(req);
            // The panel sends a pool id; resolve it to the canonical socks5 URI
            // the bot dials and keep both fields in sync. Empty id clears it.
            if (body.proxyId !== undefined) {
                const pid = String(body.proxyId || '').trim();
                if (pid) {
                    const rec = proxies.get(pid);
                    if (!rec || !proxies.canAccess(user, rec)) {
                        return json(res, 400, { ok: false, reason: 'Proxy is not in your pool' });
                    }
                    body.proxy = proxyToUri(rec);
                } else {
                    body.proxy = null;
                }
            }
            // Same rule as create: a tenant may only dial their own proxies.
            if (body.proxy && user.role !== 'admin') {
                const known = proxies.findByUri(body.proxy);
                if (!known || !proxies.canAccess(user, known)) {
                    return json(res, 400, { ok: false, reason: 'Proxy is not in your pool' });
                }
            }
            bot.config = mergeConfig(bot.config, body);
            saveBotsFile(state);
            broadcastGlobal(viewer => ({ type: 'bot-updated', bot: publicBot(bot, viewer) }), state);

            // Push live-updatable fields to the running bot immediately so
            // it doesn't need a restart to pick them up.
            const LIVE_FIELDS = ['rewardServerCmd', 'rewardWarpCmd', 'rewardInterval'];
            const livePatch = {};
            LIVE_FIELDS.forEach(k => { if (body[k] !== undefined) livePatch[k] = bot.config[k]; });
            if (Object.keys(livePatch).length) {
                const bs = getBotState(id);
                if (bs.proc) {
                    try { bs.proc.stdin.write(`__live_config ${JSON.stringify(livePatch)}\n`); } catch (_) {}
                }
            }

            return json(res, 200, { ok: true, bot: publicBot(bot, user) });
        }
        if (req.method === 'POST' && sub === 'start') return json(res, 200, startBot(state, bot));
        if (req.method === 'POST' && sub === 'stop') return json(res, 200, stopBot(id));
        if (req.method === 'POST' && sub === 'restart') {
            stopBot(id);
            setTimeout(() => startBot(state, bot), 2500);
            return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && sub === 'cmd') {
            const body = await readJson(req);
            if (!body.cmd) return json(res, 400, { ok: false, reason: 'cmd required' });
            return json(res, 200, sendCommand(id, String(body.cmd)));
        }
        if (req.method === 'POST' && sub === 'inventory/refresh') {
            const r = sendCommand(id, '!inventory');
            return json(res, 200, r);
        }
        if (req.method === 'GET' && sub === 'inventory') {
            const s = getBotState(id);
            return json(res, 200, { ok: true, inventory: s.inventory });
        }
        
        // ── Modules & Scripts ────────────────────────────────────────
        if (req.method === 'GET' && sub === 'modules') {
            const s = getBotState(id);
            // Live rows published by the bot's ModuleRegistry via [MODULES_JSON],
            // merged with the persisted armed/settings state. When the bot is
            // offline the static catalog renders so modules stay editable.
            return json(res, 200, { ok: true, modules: mergeModuleRows(bot, s), ts: s.modulesAt || 0 });
        }
        if (req.method === 'POST' && sub === 'modules') {
            const body = await readJson(req);
            const key = String(body.key || body.name || '').trim();
            const action = body.action || (body.enabled ? 'start' : 'stop');
            if (!key || !['start', 'stop', 'apply'].includes(action)) {
                return json(res, 400, { ok: false, error: 'Expected { key, action: start|stop|apply }' });
            }
            const s = getBotState(id);
            const entry = MODULE_CATALOG[key] || null;
            const saved = savedModules(bot);
            const persist = () => {
                bot.config.modules = saved;
                saveBotsFile(state);
                broadcastGlobal(viewer => ({ type: 'bot-updated', bot: publicBot(bot, viewer) }), state);
            };

            if (action === 'apply') {
                if (!entry || !entry.fields || !entry.fields.length) {
                    return json(res, 400, { ok: false, error: key + ' has no editable settings' });
                }
                const co = coerceModuleOpts(entry, body.opts || {});
                if (!co.ok) return json(res, 400, { ok: false, error: co.errors.join('; ') });
                if (!saved[key]) saved[key] = {};
                saved[key].opts = co.opts;
                persist();
                if (s.proc) sendCommand(id, `__modulecfg ${JSON.stringify({ key, opts: co.opts })}`);
                return json(res, 200, { ok: true, modules: mergeModuleRows(bot, s) });
            }

            if (action === 'start') {
                if (entry) {
                    const merged = { ...((saved[key] && saved[key].opts) || {}), ...(body.opts || {}) };
                    const co = coerceModuleOpts(entry, merged);
                    if (!co.ok) {
                        return json(res, 400, { ok: false, error: 'Set up ' + key + ' first: ' + co.errors.join('; '), requiresSetup: true });
                    }
                    if (!saved[key]) saved[key] = {};
                    saved[key].opts = co.opts;
                    saved[key].enabled = true;
                    persist();
                    if (s.proc) sendCommand(id, `__modulecfg ${JSON.stringify({ key, opts: co.opts, enabled: true })}`);
                    return json(res, 200, { ok: true, modules: mergeModuleRows(bot, s) });
                }
                // Module with no editable settings: plain live toggle.
                if (!s.proc) return json(res, 409, { ok: false, error: 'Bot is not running' });
                sendCommand(id, `!module ${key} start`);
                return json(res, 200, { ok: true, modules: mergeModuleRows(bot, s) });
            }

            // action === 'stop'
            if (entry) {
                if (saved[key]) {
                    saved[key].enabled = false;
                    persist();
                }
                if (s.proc) sendCommand(id, `__modulecfg ${JSON.stringify({ key, enabled: false })}`);
                return json(res, 200, { ok: true, modules: mergeModuleRows(bot, s) });
            }
            if (!s.proc) return json(res, 409, { ok: false, error: 'Bot is not running' });
            sendCommand(id, `!module ${key} stop`);
            return json(res, 200, { ok: true, modules: mergeModuleRows(bot, s) });
        }
        if (req.method === 'GET' && sub === 'scripts') {
            return json(res, 200, { ok: true, scripts: readBotScripts(id) });
        }
        if (req.method === 'POST' && sub === 'scripts') {
            const result = writeBotScript(id, await readJson(req));
            if (!result.ok) return json(res, 400, result);
            if (getBotState(id).proc) sendCommand(id, '!script reload');
            return json(res, 201, { ok: true, script: result.script, scripts: readBotScripts(id) });
        }
        if (req.method === 'POST' && sub === 'scripts/reload') {
            if (getBotState(id).proc) sendCommand(id, '!script reload');
            return json(res, 200, { ok: true, scripts: readBotScripts(id) });
        }
        if (sub.startsWith('scripts/')) {
            const sid = decodeURIComponent(sub.slice('scripts/'.length));
            if (!/^[a-zA-Z0-9_-]{2,64}$/.test(sid)) return json(res, 400, { ok: false, reason: 'Invalid script id' });
            const existing = readBotScripts(id).find(s => s.id === sid);
            if (!existing) return json(res, 404, { ok: false, reason: 'Script not found' });
            if (req.method === 'PATCH') {
                const result = writeBotScript(id, { ...(await readJson(req)), id: sid }, existing);
                if (!result.ok) return json(res, 400, result);
                if (getBotState(id).proc) sendCommand(id, '!script reload');
                return json(res, 200, { ok: true, script: result.script, scripts: readBotScripts(id) });
            }
            if (req.method === 'DELETE') {
                if (getBotState(id).proc) sendCommand(id, `!script delete ${sid}`);
                deleteBotScript(id, sid);
                return json(res, 200, { ok: true, scripts: readBotScripts(id) });
            }
            if (req.method === 'POST') {
                const body = await readJson(req);
                const action = String(body.action || '').toLowerCase();
                if (!['enable', 'disable', 'delete', 'reload'].includes(action)) return json(res, 400, { ok: false, reason: 'Invalid script action' });
                if (action === 'delete') {
                    if (getBotState(id).proc) sendCommand(id, `!script delete ${sid}`);
                    deleteBotScript(id, sid);
                } else if (action === 'reload') {
                    if (getBotState(id).proc) sendCommand(id, '!script reload');
                } else {
                    const next = { ...existing, enabled: action === 'enable' };
                    writeBotScript(id, next, existing);
                    if (getBotState(id).proc) sendCommand(id, `!script ${action} ${sid}`);
                }
                return json(res, 200, { ok: true, scripts: readBotScripts(id) });
            }
        }

        if (req.method === 'GET' && sub === 'events') {

            res.writeHead(200, {
                'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
                'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
            });
            const s = getBotState(id);
            // Replay only the tail so long-running bots don't ship a giant
            // payload that freezes the panel on open.
            const recent = s.logs.length > SNAPSHOT_LOG_LIMIT ? s.logs.slice(-SNAPSHOT_LOG_LIMIT) : s.logs;
            res.write(`data: ${JSON.stringify({ type: 'snapshot', status: s.status, logs: recent, inventory: s.inventory, shards: s.shards !== null && s.shards !== undefined ? s.shards : (bot.shards ?? null) })}\n\n`);
            s.subs.add(res);
            const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { } }, 25000);
            req.on('close', () => { clearInterval(ping); s.subs.delete(res); });
            return;
        }
    }

    if (req.method === 'GET' && p === '/api/events') {
        const user = currentUser(req);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
            'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
        });
        const visible = users.filterBots(user, state.bots);
        const visibleJobs = user.role === 'admin' ? jobs : jobs.filter(job => job.ownerId === user.id);
        const activeJob = visibleJobs.find(j => j.status === 'running') || visibleJobs[0] || null;
        res.write(`data: ${JSON.stringify({ type: 'hello', bots: visible.map(b => publicBot(b, user)), activeJob })}\n\n`);
        // Remember who is listening so broadcastGlobal can scope bot events.
        res._bmUserId = user.id;
        globalSubs.add(res);
        const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { } }, 25000);
        req.on('close', () => { clearInterval(ping); globalSubs.delete(res); });
        return;
    }

    // ── Hot reload ───────────────────────────────────────────────────
    // GET /reload (or /v2/reload, /api/reload) — reloads panel state WITHOUT
    // logging off any bot:
    //   1. Re-reads bots.json from disk (picks up new/edited bot entries)
    //   2. Tells every RUNNING bot to !reload its config live (no reconnect)
    //   3. Broadcasts the refreshed bot list to all open panels
    // Running child processes are never touched, so bots stay online.
    if (req.method === 'GET' && (p === '/reload' || p === '/api/reload')) {
        const isHtmlReload = (p === '/reload');
        const backHref = '/';
        // Re-read bots.json and merge onto the in-memory state. Existing bot
        // objects are updated in place so runtime (proc/logs/subs) is preserved.
        let added = 0, updated = 0;
        try {
            const disk = loadBotsFile();
            const byId = new Map(state.bots.map(b => [b.id, b]));
            (disk.bots || []).forEach(db => {
                const existing = byId.get(db.id);
                if (existing) {
                    existing.config = db.config;
                    if (db.ownerId) existing.ownerId = db.ownerId;
                    if (Array.isArray(db.sharedWith)) existing.sharedWith = db.sharedWith;
                    updated++;
                } else {
                    state.bots.push({ id: db.id, ownerId: db.ownerId || null, sharedWith: db.sharedWith || [], config: db.config });
                    added++;
                }
            });
            // Drop bots removed from disk that aren't currently running.
            const diskIds = new Set((disk.bots || []).map(b => b.id));
            state.bots = state.bots.filter(b => {
                if (diskIds.has(b.id)) return true;
                const bs = getBotState(b.id);
                if (bs.proc) return true;   // keep running bots even if absent on disk
                runtime.delete(b.id);
                return false;
            });
        } catch (_) { /* keep current state on parse error */ }

        // Live-reload config on every running bot (built-in !reload — no logoff).
        let reloaded = 0;
        for (const bot of state.bots) {
            const bs = getBotState(bot.id);
            if (bs.proc) { const r = sendCommand(bot.id, '!reload'); if (r.ok) reloaded++; }
        }

        // Refresh every open panel, each with its own visible roster.
        broadcastGlobal(viewer => ({
            type: 'reloaded',
            bots: users.filterBots(viewer, state.bots).map(b => publicBot(b, viewer))
        }), state);

        const summary = { ok: true, added, updated, reloaded, total: state.bots.length };

        // Browser hit → friendly HTML; API/fetch → JSON.
        const accept = req.headers.accept || '';
        if (isHtmlReload && accept.includes('text/html')) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(`<!doctype html><html><head><meta charset="utf-8">`
                + `<meta name="viewport" content="width=device-width,initial-scale=1">`
                + `<title>🍌 Reloaded</title><style>`
                + `body{background:#0f1410;color:#d6f5d6;font-family:system-ui,sans-serif;`
                + `display:flex;align-items:center;justify-content:center;height:100vh;margin:0}`
                + `.card{background:#16201688;border:1px solid #2e4d2e;border-radius:14px;`
                + `padding:28px 34px;text-align:center;box-shadow:0 8px 30px #0008}`
                + `h1{margin:0 0 8px;font-size:22px}p{margin:4px 0;color:#9fd29f}`
                + `b{color:#7CFC7C}a{color:#7CFC7C;text-decoration:none}</style></head><body>`
                + `<div class="card"><h1>🍌 Panel reloaded</h1>`
                + `<p>Bots stayed online — no logoffs.</p>`
                + `<p><b>${reloaded}</b> bot(s) live-reloaded config</p>`
                + `<p><b>${added}</b> added · <b>${updated}</b> updated · <b>${summary.total}</b> total</p>`
                + `<p style="margin-top:14px"><a href="${backHref}">← Back to panel</a></p>`
                + `</div></body></html>`);
        }
        return json(res, 200, summary);
    }

    res.writeHead(404); res.end('Not found');
}

function buildConfigFromBody(body, id) {
    return {
        host: body.host || 'play.bananasmp.net',
        port: parseInt(body.port) || 25565,
        username: body.username || id,
        version: body.version || '1.20.1',
        auth: body.auth || 'offline',
        autoReconnect: body.autoReconnect !== false,
        reconnectDelay: parseInt(body.reconnectDelay) || 5000,
        afkMode: body.afkMode !== false,
        proxy: (body.proxy && String(body.proxy).trim()) ? body.proxy : null,
        discord: body.discord || { enabled: false, token: '', guildId: '' },
        boneCollector: body.boneCollector || { collectSlot: 13, cycleDelay: 15000 },
        webhookUrl: body.webhookUrl || '',
        // Auth handshake for cracked servers. Kept on the bot config so the
        // panel owns it; BananaBot falls back to per-username systemData.
        autoRegister: body.autoRegister === true,
        autoLogin: body.autoLogin === true,
        loginPassword: (typeof body.loginPassword === 'string' && body.loginPassword.trim())
            ? body.loginPassword.trim() : null,
        category: (typeof body.category === 'string' && body.category.trim()) ? body.category.trim() : 'Uncategorized',
        colors: { theme: 'green' }
    };
}

function mergeConfig(current, patch) {
    const next = { ...current, ...patch };
    if (patch.discord) next.discord = { ...(current.discord || {}), ...patch.discord };
    if (patch.boneCollector) next.boneCollector = { ...(current.boneCollector || {}), ...patch.boneCollector };
    if (next.port !== undefined) next.port = parseInt(next.port) || 25565;
    if (next.reconnectDelay !== undefined) next.reconnectDelay = parseInt(next.reconnectDelay) || 5000;
    // Proxy: empty string / falsy means "remove proxy" (direct connection).
    if (typeof patch.proxy !== 'undefined') {
        const pv = typeof patch.proxy === 'string' ? patch.proxy.trim() : patch.proxy;
        next.proxy = pv ? pv : null;
    }
    if (typeof patch.category !== 'undefined') {
        const c = typeof patch.category === 'string' ? patch.category.trim() : '';
        next.category = c || 'Uncategorized';
    }
    ['autoRegister', 'autoLogin'].forEach(k => {
        if (typeof patch[k] !== 'undefined') next[k] = patch[k] === true;
    });
    if (typeof patch.loginPassword !== 'undefined') {
        // Empty string means "clear the password", which also disarms both
        // handshakes since neither fires without one.
        const pv = typeof patch.loginPassword === 'string' ? patch.loginPassword.trim() : patch.loginPassword;
        next.loginPassword = pv ? pv : null;
    }
    if (next.boneCollector) {
        const bc = next.boneCollector;
        if (bc.collectSlot !== undefined && bc.collectSlot !== null) bc.collectSlot = parseInt(bc.collectSlot);
        if (bc.cycleDelay !== undefined && bc.cycleDelay !== null) bc.cycleDelay = parseInt(bc.cycleDelay);
        ['spawnerPos', 'chestPos'].forEach(k => {
            if (bc[k] === null) { delete bc[k]; return; }
            if (bc[k] && typeof bc[k] === 'object') {
                if (bc[k].x === '' || bc[k].x === null || bc[k].x === undefined) { delete bc[k]; return; }
                bc[k] = { x: parseInt(bc[k].x), y: parseInt(bc[k].y), z: parseInt(bc[k].z) };
                if ([bc[k].x, bc[k].y, bc[k].z].some(isNaN)) delete bc[k];
            }
        });
    }
    return next;
}

// ─── Module settings helpers ───────────────────────────────────────────

function savedModules(bot) {
    return (bot && bot.config && bot.config.modules) || {};
}

// Validates raw panel input against a catalog field schema. Numbers are
// coerced and range-checked; lists become arrays; anything else is trimmed.
function coerceModuleOpts(entry, raw) {
    const out = {};
    const errors = [];
    for (const f of entry.fields || []) {
        const v = raw == null ? undefined : raw[f.key];
        if (v === undefined || v === null || String(v).trim() === '') {
            if (f.required) errors.push(`${f.label} (${f.key}) is required`);
            continue;
        }
        if (f.type === 'number') {
            const n = Number(String(v).trim());
            if (isNaN(n)) { errors.push(`${f.label} must be a number`); continue; }
            if (f.min != null && n < f.min) { errors.push(`${f.label} must be >= ${f.min}`); continue; }
            if (f.max != null && n > f.max) { errors.push(`${f.label} must be <= ${f.max}`); continue; }
            out[f.key] = n;
        } else if (f.type === 'list') {
            out[f.key] = String(v).split(',').map(x => x.trim()).filter(Boolean);
        } else {
            out[f.key] = String(v).trim();
        }
    }
    return { ok: !errors.length, opts: out, errors };
}

// Live registry rows merged with the panel's persisted intent (armed flag,
// saved settings). When the bot is offline or has not reported yet, renders
// the static catalog instead so modules stay visible and editable.
function mergeModuleRows(bot, s) {
    const live = (s && Array.isArray(s.modules)) ? s.modules : [];
    const saved = savedModules(bot);
    const rows = [];
    for (const r of live) {
        const entry = MODULE_CATALOG[r.key];
        const cfg = saved[r.key];
        rows.push({
            ...r,
            fields: (entry && entry.fields && entry.fields.length) ? entry.fields : null,
            editable: !!(entry && entry.fields && entry.fields.length),
            armed: !!(cfg && cfg.enabled) && !r.running,
            savedOpts: (cfg && cfg.opts) || null,
        });
    }
    if (!rows.length) {
        for (const key of Object.keys(MODULE_CATALOG)) {
            const e = MODULE_CATALOG[key];
            const cfg = saved[key];
            const row = {
                key, label: e.label, group: e.group, describe: e.describe,
                running: false, canStart: false, canStop: false,
                readOnly: !!e.readOnly, unavailable: e.unavailable || null,
                detail: null,
                fields: (e.fields && e.fields.length) ? e.fields : null,
                editable: !!(e.fields && e.fields.length),
                armed: !!(cfg && cfg.enabled),
                savedOpts: (cfg && cfg.opts) || null,
            };
            if (key === 'autoAuth') {
                const parts = [];
                if (bot.config.autoLogin) parts.push('login');
                if (bot.config.autoRegister) parts.push('register');
                row.detail = parts.length ? parts.join(' + ') : 'disarmed';
            }
            rows.push(row);
        }
        rows.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
    }
    return rows;
}

// ─── Entry ─────────────────────────────────────────────────────────────
async function start(port = 3123) {
    ensureDir(BOTS_DIR);
    const state = loadBotsFile();
    liveState = state;
    resumeJobs();
    startScheduleWorker(state);

    const server = http.createServer((req, res) => {
        handleHttp(req, res, state).catch(err => {
            try {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, reason: err.message }));
            } catch (_) { }
        });
    });

    const host = process.env.HOST || '127.0.0.1';
    server.listen(port, host, () => {
        console.log('');
        console.log('NativeLaunch Control Panel');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   → Panel : http://localhost:${port}`);
        console.log(`   → Bots  : ${state.bots.length} registered`);
        console.log(`   → Users : ${users.list().length} registered`);
        console.log('');
    });

    const cleanup = () => {
        console.log('\n🍌 Stopping all bots...');
        if (scheduleWorker) clearInterval(scheduleWorker);
        runtime.forEach((s) => { try { if (s.proc) s.proc.kill('SIGTERM'); } catch (_) { } });
        setTimeout(() => process.exit(0), 1000);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

module.exports = { start };
