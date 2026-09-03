/**
 * Per-account workspace storage.
 *
 * The panel keeps operational records (bots, proxies, schedules) separate
 * from account-owned preferences and automation. One small JSON document per
 * user makes deletion/export straightforward and prevents accidental global
 * aliases or scripts.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = (process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) ? path.resolve(process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) : path.join(__dirname, '../..');
const ROOT = path.join(DATA_ROOT, 'system_data/workspaces');
const DEFAULT_PREFERENCES = {
    theme: 'dark',
    density: 'comfortable',
    startPage: 'overview',
    sidebar: 'expanded',
    timezone: 'local',
    confirmDanger: true,
    autoRefresh: true
};

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanId(value, prefix) {
    const raw = String(value || '').trim();
    return /^[a-zA-Z0-9_-]{2,64}$/.test(raw) ? raw : `${prefix}_${crypto.randomUUID()}`;
}

function cleanText(value, max = 300) {
    return String(value || '').trim().slice(0, max);
}

function now() { return new Date().toISOString(); }

function defaultWorkspace() {
    return {
        version: 1,
        preferences: { ...DEFAULT_PREFERENCES },
        aliases: [],
        scripts: []
    };
}

function normalizeAlias(raw = {}, existing = {}) {
    const name = cleanText(raw.name ?? existing.name, 40);
    const cmd = cleanText(raw.cmd ?? existing.cmd, 300);
    if (!name || !cmd) return null;
    const createdAt = existing.createdAt || raw.createdAt || now();
    return {
        id: existing.id || cleanId(raw.id, 'alias'),
        name,
        cmd,
        desc: cleanText(raw.desc ?? raw.description ?? existing.desc, 200),
        createdAt,
        updatedAt: now()
    };
}

function normalizeScript(raw = {}, existing = {}) {
    const name = cleanText(raw.name ?? existing.name, 80);
    if (!name) return null;
    const type = raw.type ?? existing.type ?? 'interval';
    if (!['interval', 'message-trigger'].includes(type)) return null;
    const actionRaw = raw.action ?? existing.action ?? {};
    const actionType = actionRaw.type === 'chat' ? 'chat' : 'command';
    const actionValue = cleanText(actionRaw.value, 300);
    if (!actionValue) return null;
    const out = {
        id: existing.id || cleanId(raw.id, 'script'),
        name,
        type,
        enabled: raw.enabled ?? existing.enabled ?? true,
        description: cleanText(raw.description ?? existing.description, 200),
        action: { type: actionType, value: actionValue },
        botIds: Array.isArray(raw.botIds ?? existing.botIds)
            ? [...new Set((raw.botIds ?? existing.botIds).map(v => cleanText(v, 64)).filter(Boolean))].slice(0, 100)
            : [],
        createdAt: existing.createdAt || raw.createdAt || now(),
        updatedAt: now()
    };
    if (type === 'interval') {
        const interval = Number(raw.interval ?? existing.interval ?? 5000);
        out.interval = Number.isFinite(interval) ? Math.min(86400000, Math.max(1000, Math.round(interval))) : 5000;
    } else {
        const trigger = raw.trigger ?? existing.trigger ?? {};
        out.trigger = {
            pattern: cleanText(trigger.pattern, 200),
            matchType: ['contains', 'exact', 'regex'].includes(trigger.matchType) ? trigger.matchType : 'contains',
            ignoreCase: trigger.ignoreCase !== false,
            source: ['all', 'chat', 'system'].includes(trigger.source) ? trigger.source : 'all'
        };
        if (!out.trigger.pattern) return null;
        const cooldown = Number(raw.cooldown ?? existing.cooldown ?? 3000);
        out.cooldown = Number.isFinite(cooldown) ? Math.min(300000, Math.max(0, Math.round(cooldown))) : 3000;
    }
    return out;
}

class WorkspaceStore {
    constructor(root = ROOT) {
        this.root = root;
        ensureDir(root);
    }

    file(userId) {
        const id = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
        if (!id) throw new Error('A user id is required');
        return path.join(this.root, `${id}.json`);
    }

    _load(userId) {
        const file = this.file(userId);
        let data = defaultWorkspace();
        try {
            if (fs.existsSync(file)) data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
        } catch (_) { /* corrupt workspace falls back to a clean document */ }
        data.preferences = { ...DEFAULT_PREFERENCES, ...(data.preferences || {}) };
        data.aliases = Array.isArray(data.aliases) ? data.aliases : [];
        data.scripts = Array.isArray(data.scripts) ? data.scripts : [];
        return data;
    }

    _save(userId, data) {
        ensureDir(this.root);
        fs.writeFileSync(this.file(userId), JSON.stringify(data, null, 2));
    }

    snapshot(userId) {
        const data = this._load(userId);
        return {
            preferences: { ...data.preferences },
            aliases: data.aliases.map(a => ({ ...a })),
            scripts: data.scripts.map(s => ({ ...s }))
        };
    }

    preferences(userId) { return { ...this._load(userId).preferences }; }

    updatePreferences(userId, patch = {}) {
        const data = this._load(userId);
        const next = { ...data.preferences };
        if (['dark', 'light', 'system'].includes(patch.theme)) next.theme = patch.theme;
        if (['comfortable', 'compact'].includes(patch.density)) next.density = patch.density;
        if (['overview', 'bots', 'proxies', 'commands', 'schedules', 'account'].includes(patch.startPage)) next.startPage = patch.startPage;
        if (['expanded', 'collapsed'].includes(patch.sidebar)) next.sidebar = patch.sidebar;
        if (typeof patch.timezone === 'string' && patch.timezone.length <= 64) next.timezone = patch.timezone;
        if (patch.confirmDanger !== undefined) next.confirmDanger = !!patch.confirmDanger;
        if (patch.autoRefresh !== undefined) next.autoRefresh = !!patch.autoRefresh;
        data.preferences = next;
        this._save(userId, data);
        return { ...next };
    }

    aliases(userId) { return this._load(userId).aliases.map(a => ({ ...a })); }

    createAlias(userId, raw) {
        const data = this._load(userId);
        if (data.aliases.length >= 200) return { ok: false, reason: 'Alias limit reached.' };
        const alias = normalizeAlias(raw);
        if (!alias) return { ok: false, reason: 'Name and command are required.' };
        if (data.aliases.some(a => a.name.toLowerCase() === alias.name.toLowerCase())) {
            return { ok: false, reason: 'An alias with that name already exists.' };
        }
        data.aliases.push(alias);
        this._save(userId, data);
        return { ok: true, alias: { ...alias } };
    }

    updateAlias(userId, id, raw) {
        const data = this._load(userId);
        const index = data.aliases.findIndex(a => a.id === id);
        if (index < 0) return { ok: false, reason: 'Alias not found.' };
        const alias = normalizeAlias(raw, data.aliases[index]);
        if (!alias) return { ok: false, reason: 'Name and command are required.' };
        if (data.aliases.some((a, i) => i !== index && a.name.toLowerCase() === alias.name.toLowerCase())) {
            return { ok: false, reason: 'An alias with that name already exists.' };
        }
        data.aliases[index] = alias;
        this._save(userId, data);
        return { ok: true, alias: { ...alias } };
    }

    deleteAlias(userId, id) {
        const data = this._load(userId);
        const before = data.aliases.length;
        data.aliases = data.aliases.filter(a => a.id !== id);
        if (before === data.aliases.length) return { ok: false, reason: 'Alias not found.' };
        this._save(userId, data);
        return { ok: true };
    }

    scripts(userId) { return this._load(userId).scripts.map(s => ({ ...s })); }

    createScript(userId, raw) {
        const data = this._load(userId);
        if (data.scripts.length >= 200) return { ok: false, reason: 'Script limit reached.' };
        const script = normalizeScript(raw);
        if (!script) return { ok: false, reason: 'A valid script name, action, and trigger are required.' };
        if (data.scripts.some(s => s.name.toLowerCase() === script.name.toLowerCase())) return { ok: false, reason: 'A script with that name already exists.' };
        data.scripts.push(script);
        this._save(userId, data);
        return { ok: true, script: { ...script } };
    }

    updateScript(userId, id, raw) {
        const data = this._load(userId);
        const index = data.scripts.findIndex(s => s.id === id);
        if (index < 0) return { ok: false, reason: 'Script not found.' };
        const script = normalizeScript(raw, data.scripts[index]);
        if (!script) return { ok: false, reason: 'A valid script name, action, and trigger are required.' };
        if (data.scripts.some((s, i) => i !== index && s.name.toLowerCase() === script.name.toLowerCase())) return { ok: false, reason: 'A script with that name already exists.' };
        data.scripts[index] = script;
        this._save(userId, data);
        return { ok: true, script: { ...script } };
    }

    deleteScript(userId, id) {
        const data = this._load(userId);
        const before = data.scripts.length;
        data.scripts = data.scripts.filter(s => s.id !== id);
        if (before === data.scripts.length) return { ok: false, reason: 'Script not found.' };
        this._save(userId, data);
        return { ok: true };
    }

    deleteWorkspace(userId) {
        try {
            const file = this.file(userId);
            if (fs.existsSync(file)) fs.unlinkSync(file);
            return true;
        } catch (_) { return false; }
    }
}

module.exports = { WorkspaceStore, DEFAULT_PREFERENCES, normalizeScript };
