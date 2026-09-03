/**
 * 🍌 BananaMoney Lite - Core Bot
 */

const mineflayer = require('mineflayer');
const readline = require('readline');
const Logger = require('./utils/logger.js');
const { AliasManager } = require('./utils/AliasManager.js');
const { BoneCollector } = require('./modules/BoneCollector.js');
const { BoneDropper } = require('./modules/BoneDropper.js');
const { GuiManager } = require('./modules/GuiManager.js');
const { DiscordBridge } = require('./modules/DiscordBridge.js');
const { TpKiller } = require('./modules/TpKiller.js');
const { MineAndSell } = require('./modules/MineAndSell.js');
const { InventoryCleaner } = require('./modules/InventoryCleaner.js');
const { PvCandleDropper } = require('./modules/PvCandleDropper.js');
const { BoxPvpMiner } = require('./modules/BoxPvpMiner.js');
const { Follower } = require('./modules/Follower.js');
const { GoTo } = require('./modules/GoTo.js');
const { Fight } = require('./modules/Fight.js');
const { ChatGames } = require('./modules/ChatGames.js');
const { AutoHome } = require('./modules/AutoHome.js');
const { CrystalTrap } = require('./modules/CrystalTrap.js');
const { AutoAuth } = require('./modules/AutoAuth.js');
const { AntiStuck } = require('./utils/AntiStuck.js');
const { buildConnect, describeProxy, parseProxy } = require('./utils/proxy.js');
const { applyClientProfile, clientOptions } = require('./utils/clientProfile.js');
const { LimboFreeze } = require('./utils/limboFreeze.js');
const { sendMessage: notifySend } = require('./utils/notify.js');
const { PayoutBridge } = require('./modules/PayoutBridge.js');
const { ProfileManager } = require('./utils/ProfileManager.js');
const { ScriptManager } = require('./utils/ScriptManager.js');
const { SystemData } = require('./utils/SystemData.js');
const { PayoutStore } = require('./utils/PayoutStore.js');
const { ModuleRegistry } = require('./utils/ModuleRegistry.js');
const { registerBotModules, MODULE_CATALOG } = require('./utils/botModules.js');
const { loadConfig } = require('./utils/config.js');
const { loader: autoEat } = require('mineflayer-auto-eat');
const Vec3 = require('vec3');

// ─── Markers consumed by MultiBotServer ────────────────────────────────
function emitMarker(tag, payload) {
    try { process.stdout.write(`\n[${tag}]${JSON.stringify(payload)}\n`); } catch (_) {}
}

// Render a Minecraft chat-component (object, JSON string, or plain string) to readable text.
// The 'kicked'/'error' reason can arrive as a parsed component object in modern mineflayer,
// which is why naive `${reason}` produced "[object Object]".
// Strip Minecraft NBT wrappers ({ type, value } nodes used by 1.20.3+ chat) into plain JS,
// so a uniform chat-component shape ({ text, translate, with, extra }) is left behind.
function nbtSimplify(v) {
    if (v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(nbtSimplify);
    const keys = Object.keys(v);
    if ('value' in v && (keys.length === 1 || (keys.length === 2 && 'type' in v))) {
        return nbtSimplify(v.value);
    }
    const out = {};
    for (const k of keys) out[k] = nbtSimplify(v[k]);
    return out;
}

function renderChatComponent(reason, _depth = 0) {
    if (reason == null) return 'Unknown reason';
    if (typeof reason === 'number' || typeof reason === 'boolean') return String(reason);

    // If it's a string, it may be plain text or a JSON-encoded component.
    if (typeof reason === 'string') {
        const trimmed = reason.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try { return renderChatComponent(JSON.parse(trimmed), _depth + 1); } catch (_) { return reason; }
        }
        return reason;
    }

    // Normalize NBT-wrapped components once at the top level.
    if (_depth === 0) reason = nbtSimplify(reason);

    if (Array.isArray(reason)) {
        return reason.map((r) => renderChatComponent(r, _depth + 1)).join('');
    }

    // Some libraries expose a ChatMessage with toString(); prefer its plain text.
    if (typeof reason.toString === 'function' && reason.toString !== Object.prototype.toString) {
        const s = reason.toString();
        if (s && s !== '[object Object]') return s;
    }

    let out = '';
    if (typeof reason.text === 'string') out += reason.text;
    // Translate keys like "multiplayer.disconnect.kicked"; show the key plus any args.
    if (typeof reason.translate === 'string') {
        const args = Array.isArray(reason.with) ? reason.with.map((r) => renderChatComponent(r, _depth + 1)).filter(Boolean) : [];
        out += args.length ? `${reason.translate} (${args.join(', ')})` : reason.translate;
    }
    if (Array.isArray(reason.extra)) {
        out += reason.extra.map((r) => renderChatComponent(r, _depth + 1)).join('');
    }

    if (out.trim()) return out.trim();

    // Never silently lose the reason: surface the raw structure for diagnosis.
    try { return JSON.stringify(reason); } catch (_) { return 'Unknown reason'; }
}

// Whether we are running inside the multibot panel as a child process
const IS_CHILD = process.env.BOT_CHILD === '1';

class BananaBot {
    constructor(config) {
        this.config = config;
        this.bot = null;
        this.boneCollector = null;
        this.boneDropper = null;
        this.mineAndSell = null;
        this.invCleaner = null;
        this.pvCandleDropper = null;
        this.boxPvpMiner = null;
        this.follower = null;
        this.goTo = null;
        this.fight = null;
        this.antiStuck = null;
        this.guiManager = null;
        this.aliasManager = null;
        this.scriptManager = null;
        this.discordBridge = null;
        this.tpKiller = null;
        this.chatGames = null;
        this.autoHome = null;
        this.crystalTrap = null;
        this.payoutBridge = null;
        this.payoutStore = null;
        this.systemData = new SystemData();

        // Only attach readline in standalone CLI mode. Under the panel the
        // process is a spawned child with piped stdio — keeping readline
        // open there is what caused ERR_USE_AFTER_CLOSE crashes.
        if (!IS_CHILD) {
            this.rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                prompt: '🍌 > '
            });
            Logger.setReadline(this.rl);
        } else {
            this.rl = null;
        }

        this.activeModules = {
            boneCollector: false,
            boneDropper: false,
            mineAndSell: false,
            mineBlock: null,
            tpKill: null,
            invCleaner: false,
            pvCandleDropper: false,
            boxPvpMiner: false,
            boxPvpBlock: null,
            hubChecker: null,  // server name string when running, null when off
            chatGames: false,
            autoHome: false,
            crystal: false
        };

        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.loginPassword = null;
        this.autoLoginEnabled = false;
        // Auto-register is opt-in the same way; both are turned on per bot from
        // the panel config (bots.json) or with !autoregister / !autologin.
        this.autoRegisterEnabled = false;
        // Inventory cleaner and reward checker are opt-in: a freshly started bot
        // never turns them on by itself. Enable them for the session with
        // !invclean on / !reward on (the panel's module toggles send the same
        // commands). Once enabled they survive in-game reconnects, but not a
        // process restart.
        this.invCleanerEnabled = false;
        this.hubTimer = null;
        this.loginHubTimer = null;
        this.isLoggingIn = false;

        // Reward checker state — simple repeating timer that sends
        // /server <cmd> + /warp <cmd> every N seconds.
        this.rewardCheckerTimer = null;
        this.rewardCheckerEnabled = false; // Session-scoped; toggle via !reward on/off

        // Hub checker state (independent, command-driven: !hubchecker <server>)
        this.hubCheckerTimer = null;
        this.hubCheckerTarget = null;  // server name passed to /server <name>

        // Shard emitter state (feeds the multibot panel's per-bot shard count)
        this.shardEmitterTimer = null;
        this.shardEarlyTimers = [];

        this.loadSystemData();
    }

    // Emit the full current config back to the panel so bots.json stays in
    // sync after any in-game / terminal command that mutates it.
    _emitConfigUpdate() {
        if (!IS_CHILD) return;
        try {
            const snapshot = {
                boneCollector: { ...(this.config.boneCollector || {}) },
                boneDropper: { ...(this.config.boneDropper || {}) },
                rewardServerCmd: this.config.rewardServerCmd,
                rewardWarpCmd: this.config.rewardWarpCmd,
                rewardInterval: this.config.rewardInterval
            };
            if (this.config.modules) snapshot.modules = this.config.modules;
            emitMarker('CONFIG_UPDATE_JSON', snapshot);
        } catch (_) { /* ignore */ }
    }

    loadSystemData() {
        const username = this.config.username;
        if (!username) return;
        const data = this.systemData.load(username);
        if (!this.config.boneCollector) this.config.boneCollector = {};
        if (!this.config.boneDropper) this.config.boneDropper = {};
        if (data.spawnerPos) this.config.boneCollector.spawnerPos = data.spawnerPos;
        if (data.dropperPos) this.config.boneDropper.spawnerPos = data.dropperPos;
        if (data.chestPos) this.config.boneCollector.chestPos = data.chestPos;
        if (data.collectSlot !== undefined) this.config.boneCollector.collectSlot = data.collectSlot;
        if (data.cycleDelay !== undefined) this.config.boneCollector.cycleDelay = data.cycleDelay;
        if (!this.config.crystal) this.config.crystal = {};
        if (data.crystalPos) this.config.crystal.pos = data.crystalPos;
        if (data.crystalPlayers !== undefined) this.config.crystal.playerThreshold = data.crystalPlayers;
        if (data.crystalRadius !== undefined) this.config.crystal.radius = data.crystalRadius;
        if (data.crystalMinHealth !== undefined) this.config.crystal.minHealth = data.crystalMinHealth;
        if (data.loginPassword) this.loginPassword = data.loginPassword;
        if (data.autoLogin !== undefined) this.autoLoginEnabled = data.autoLogin;
        if (data.autoRegister !== undefined) this.autoRegisterEnabled = data.autoRegister;
        // Panel config (bots.json → BOT_CONFIG_JSON) wins over the per-username
        // systemData fallback, so the auth setup is visible and editable in the
        // panel instead of only in a file next to the bot.
        if (this.config.loginPassword) this.loginPassword = this.config.loginPassword;
        if (this.config.autoLogin !== undefined) this.autoLoginEnabled = !!this.config.autoLogin;
        if (this.config.autoRegister !== undefined) this.autoRegisterEnabled = !!this.config.autoRegister;
        // rewardEnabled / invCleanerEnabled are deliberately NOT restored here.
        // Reloading a saved "on" is what made every bot start cleaning its
        // inventory and cycling /server + /warp the moment it spawned.
        // SystemData as fallback only — panel config (BOT_CONFIG_JSON) takes priority.
        if (this.config.rewardServerCmd === undefined && data.rewardServerCmd !== undefined)
            this.config.rewardServerCmd = data.rewardServerCmd;
        if (this.config.rewardWarpCmd === undefined && data.rewardWarpCmd !== undefined)
            this.config.rewardWarpCmd = data.rewardWarpCmd;
        if (this.config.rewardInterval === undefined && data.rewardInterval !== undefined)
            this.config.rewardInterval = data.rewardInterval;
        if (this.loginPassword && !IS_CHILD) {
            Logger.system(`Auto-login: password loaded for "${username}" (autoLogin=${this.autoLoginEnabled}, autoRegister=${this.autoRegisterEnabled})`);
        }

        // Apply bone-collector positions passed through the panel config as fallback
        if (this.config.boneCollector) {
            const bc = this.config.boneCollector;
            if (bc.spawnerPos) this.systemData.update(username, { spawnerPos: bc.spawnerPos });
            if (bc.chestPos) this.systemData.update(username, { chestPos: bc.chestPos });
            if (bc.collectSlot !== undefined) this.systemData.update(username, { collectSlot: bc.collectSlot });
            if (bc.cycleDelay !== undefined) this.systemData.update(username, { cycleDelay: bc.cycleDelay });
        }

        if (this.config.boneDropper) {
            const bd = this.config.boneDropper;
            if (bd.spawnerPos) this.systemData.update(username, { dropperPos: bd.spawnerPos });
        }

        if (this.config.rewardServerCmd !== undefined)
            this.systemData.update(username, { rewardServerCmd: this.config.rewardServerCmd });
        if (this.config.rewardWarpCmd !== undefined)
            this.systemData.update(username, { rewardWarpCmd: this.config.rewardWarpCmd });
        if (this.config.rewardInterval !== undefined)
            this.systemData.update(username, { rewardInterval: this.config.rewardInterval });

        // Let the panel see the current bone-collector config right away.
        this._mirrorPersistedOpts();
        this._emitConfigUpdate();
    }

    // Panel-saved module settings live under config.modules; the modules
    // themselves read their settings from config sections (boneCollector,
    // chatGames, crystal, ...), so mirror the saved opts into those sections.
    _mirrorPersistedOpts() {
        const mods = this.config.modules || {};
        for (const key of Object.keys(mods)) {
            const entry = MODULE_CATALOG[key];
            const opts = mods[key].opts;
            if (!entry || !entry.mirror || !opts || typeof opts !== 'object') continue;
            const sec = this.config[entry.mirror] = this.config[entry.mirror] || {};
            for (const f of entry.fields) {
                if (opts[f.key] !== undefined) sec[f.key] = opts[f.key];
            }
        }
    }

    // Persisted opts for a module key, or null when there are none.
    _moduleOpts(key) {
        const mods = this.config.modules;
        return (mods && mods[key] && mods[key].opts) || null;
    }

    // Settings the modules cache on the instance at construction need a live
    // nudge; the rest read their config section fresh on every run.
    _syncModuleInstance(key) {
        const entry = MODULE_CATALOG[key];
        if (!entry) return;
        if (key === 'chatGames' && this.chatGames) {
            const cg = this.config.chatGames || {};
            for (const k of ['startSec', 'stepSec', 'maxSec', 'jitterSec', 'longWordLetters', 'longWordBonusSec', 'spamStartDelayMs', 'spamGapMs']) {
                if (cg[k] !== undefined) this.chatGames.opts[k] = cg[k];
            }
            return;
        }
        if (key === 'crystalTrap' && this.crystalTrap) {
            const c = this.config.crystal || {};
            if (typeof c.playerThreshold === 'number') this.crystalTrap.playerThreshold = c.playerThreshold;
            if (typeof c.radius === 'number') this.crystalTrap.radius = c.radius;
            if (typeof c.minHealth === 'number') this.crystalTrap.minHealth = c.minHealth;
            return;
        }
        if (key === 'pvCandleDropper' && this.pvCandleDropper) {
            const o = this.config.pvCandleDropper || {};
            if (Array.isArray(o.pvs)) this.pvCandleDropper.pvs = o.pvs;
            if (typeof o.interval === 'number') this.pvCandleDropper.checkInterval = o.interval;
            return;
        }
        if (key === 'autoHome' && this.autoHome) this.autoHome.loadConfig();
    }

    // Panel → bot module config push. Persists under config.modules, mirrors
    // the opts into the config section the module reads, and either starts,
    // stops, or restarts the module so new settings apply to a running one.
    async applyModuleCfg(payload) {
        if (!payload || !payload.key) return;
        if (!this.moduleRegistry || !this.moduleRegistry.has(payload.key)) {
            Logger.error(`[modules] Unknown module: ${payload.key}`);
            return;
        }
        const key = payload.key;
        const entry = MODULE_CATALOG[key];
        const saved = this.config.modules = this.config.modules || {};
        if (!saved[key]) saved[key] = {};

        if (payload.opts && typeof payload.opts === 'object') {
            saved[key].opts = { ...(saved[key].opts || {}), ...payload.opts };
            if (entry && entry.mirror) this._mirrorPersistedOpts();
            this._syncModuleInstance(key);
            Logger.system(`🔧 ${key}: settings updated live.`);
        }

        const rows = this.moduleRegistry.snapshot();
        const row = rows.find(r => r.key === key);
        const wasRunning = !!(row && row.running);

        // start()/stop() can run indefinitely for loop-based modules
        // (BoneCollector, MineAndSell, ...), so never await them here — the
        // registry poll keeps the panel honest, and _emitConfigUpdate below
        // must run now so the server persists the new config.
        const attempt = (p) => p.then(res => {
            if (res && !res.ok && !res.noop) Logger.error(`[modules] ${key}: ${res.error}`);
        });
        if (payload.enabled === true) {
            if (!wasRunning) attempt(this.moduleRegistry.start(key, this._moduleOpts(key)));
            else Logger.system(`${row.label}: already running.`);
        } else if (payload.enabled === false) {
            if (wasRunning) attempt(this.moduleRegistry.stop(key));
        } else if (payload.opts && wasRunning) {
            // Settings change on a running module: restart it on the new config.
            Logger.system(`🔄 ${key}: restarting with new settings.`);
            attempt(this.moduleRegistry.stop(key).then(() => this.moduleRegistry.start(key, this._moduleOpts(key))));
        }

        this._emitConfigUpdate();
    }

    // Starts every module the panel marked "enabled" in the config, so a bot
    // that goes online picks up the panel's armed modules by itself. Runs
    // after resumeActiveModules, which already covers this-session flags.
    _autoStartConfiguredModules() {
        if (!this.moduleRegistry) return;
        const mods = this.config.modules || {};
        const rows = this.moduleRegistry.snapshot();
        for (const key of Object.keys(mods)) {
            const st = mods[key];
            if (!st || !st.enabled) continue;
            if (!this.moduleRegistry.has(key)) continue;
            const row = rows.find(r => r.key === key);
            if (row && (row.running || row.readOnly || row.unavailable)) continue;
            if (row && !row.canStart) continue;
            this.moduleRegistry.start(key, st.opts || null).then(res => {
                if (res && res.ok && !res.noop) Logger.system(`🔄 Module "${key}" auto-started from panel config.`);
                if (res && !res.ok) Logger.error(`[modules] auto-start ${key}: ${res.error}`);
            });
        }
    }

    async init() {
        Logger.showBanner();
        this.connect();
        this.setupConsole();
        await this.initDiscord();
        await this.initPayoutBridge();
        if (this.rl) this.rl.prompt();
    }

    async initDiscord() {
        if (this.config.discord?.enabled) {
            this.discordBridge = new DiscordBridge(this.config, (cmd) => this.handleDiscordCommand(cmd));
            Logger.setLogCallback((msg) => {
                if (this.discordBridge) this.discordBridge.queueLog(msg);
            });
            await this.discordBridge.init();
        }
    }

    async initPayoutBridge() {
        this.payoutStore = new PayoutStore();
        const s = this.payoutStore.get();
        if (!s.discord.enabled || !s.discord.token || !s.discord.guildId) return;
        try {
            this.payoutBridge = new PayoutBridge(this.payoutStore, (username, amount) => this._executePayout(username, amount));
            await this.payoutBridge.start();
        } catch (e) {
            Logger.error(`Payout bridge failed to start: ${e.message}`);
        }
    }

    _executePayout(username, amount) {
        if (!this.bot || !this.bot.entity) return false;
        const cmd = `/pay ${username} ${amount}`;
        this.bot.chat(cmd);
        Logger.system(`💸 Payout chat: ${cmd}`);
        return true;
    }

    async handleDiscordCommand(input) {
        if (input.startsWith('chat ')) {
            const message = input.slice(5);
            if (this.bot && this.bot.entity) {
                this.bot.chat(message);
                Logger.log(`[DISCORD] ${message}`, 'CHAT');
            }
            return;
        }
        await this.handleCommand(input);
    }

    connect() {
        Logger.system(`Connecting to ${this.config.host} as ${this.config.username}...`);
        this.firstSpawn = true;
        this.isLoggingIn = false;
        // A reconnect is a fresh session for the auth plugin, so allow the
        // register/login handshake to run again.
        if (this.autoAuth) this.autoAuth.reset();
        if (this.hubTimer) { clearInterval(this.hubTimer); this.hubTimer = null; }
        if (this.loginHubTimer) { clearInterval(this.loginHubTimer); this.loginHubTimer = null; }
        this.stopRewardChecker();
        this.stopShardEmitter();

        const afkMode = this.config.afkMode === true;
        const profile = clientOptions(this.config);
        const botOptions = {
            host: this.config.host,
            port: this.config.port,
            username: this.config.username,
            version: this.config.version,
            auth: this.config.auth,
            hideErrors: true,
            // Physics MUST stay ON: LimboFilter drops the player into the void
            // and verifies Y deltas match vanilla gravity exactly. AFK mode only
            // trims the claimed view distance; it never disables physics.
            physicsEnabled: true,
            viewDistance: afkMode ? 2 : (profile.viewDistance || 2),
            brand: profile.brand
        };

        // Per-player SOCKS5 proxy: if attached, route this bot's TCP connection
        // through it so it exits from the proxy's IP.
        const connect = buildConnect(this.config);
        if (connect) {
            botOptions.connect = connect;
            Logger.verbose(`🛡️  Proxy attached: ${describeProxy(this.config.proxy)}`);
        }

        this.bot = mineflayer.createBot(botOptions);

        // Apply native client profile (locale, view distance, skin parts, main
        // hand) so mineflayer sends ONE clean settings packet for anti-bot checks.
        // We must wait for inject_allowed because bot.settings is created by the
        // settings plugin, which is injected asynchronously after createBot().
        this.bot.once('inject_allowed', () => applyClientProfile(this.bot, this.config));

        // Freeze all movement/modules while GUARD/LimboFilter/Sonar verify the
        // connection. Idle jitter from modules is a common "do not move" fail.
        this.limboFreeze = new LimboFreeze(this.bot, this.config);
        this.limboFreeze.start();

        this.setupEvents();
        if (afkMode) {
            Logger.verbose('⚡ AFK Mode: physics kept ON (LimboFilter safe), view distance trimmed.');
        }
        this.bot.loadPlugin(autoEat);
        this.initModules();
    }

    // Movement modules need physics. AFK bots spawn with physics disabled to
    // save CPU, so enable it on demand the moment a walking/mining module runs.
    _wakeForMovement() {
        if (this.bot && this.bot.physicsEnabled === false) {
            this.bot.physicsEnabled = true;
            Logger.system('⚡ Physics enabled for movement (AFK idle paused).');
        }
    }

    initModules() {
        // Movement modules are always available. afkMode only controls the
        // INITIAL physics/view-distance for cheap idling; starting any of these
        // wakes physics on demand via _wakeForMovement().
        this.boneCollector = new BoneCollector(this.bot, this.config);
        this.boneDropper = new BoneDropper(this.bot, this.config);
        this.mineAndSell = new MineAndSell(this.bot, this.config);
        this.boxPvpMiner = new BoxPvpMiner(this.bot, this.config);
        this.tpKiller = new TpKiller(this.bot, this.config);
        // Gate the cleaner on shards being visible on the scoreboard — that's
        // our signal the bot is actually on the money server (not hub/limbo).
        this.invCleaner = new InventoryCleaner(this.bot, this.config, () => this._getShards() !== null);
        this.pvCandleDropper = new PvCandleDropper(this.bot, this.config);
        this.follower = new Follower(this.bot, this.config);
        this.goTo = new GoTo(this.bot, this.config);
        this.fight = new Fight(this.bot, this.config);
        this.chatGames = new ChatGames(this.bot, this.config, this.systemData);
        this.autoHome = new AutoHome(this.bot, this.config);
        this.crystalTrap = new CrystalTrap(this.bot, this.config);
        // Answers the auth plugin's register/login prompt. Owns both so a
        // combined "use /login or /register" line can only fire once.
        this.autoAuth = new AutoAuth(this.bot, {
            isRegisterEnabled: () => this.autoRegisterEnabled,
            isLoginEnabled: () => this.autoLoginEnabled,
            getPassword: () => this.loginPassword,
            onAuthStart: () => {
                // The hub cycler would fight the handshake by warping mid-login.
                if (this.hubTimer) { clearInterval(this.hubTimer); this.hubTimer = null; }
                this.isLoggingIn = true;
            },
            onAuthDone: () => {
                this.isLoggingIn = false;
                this.resumeActiveModules();
            }
        });
        // Global pathfinder watchdog: covers every nav module so the bot won't
        // stay wedged. Self-gates on pathfinder.isMoving() — no-op while idle.
        this.antiStuck = new AntiStuck(this.bot, { digEscape: false });
        // Don't start AntiStuck until after the first real spawn. Starting it in
        // limbo/verification causes movement packets that trip GUARD's "do not move".
        this.bot.once('spawn', () => {
            if (!this.limboFreeze?.frozen) this.antiStuck.start();
        });
        this.guiManager = new GuiManager(this.bot);
        this.profileManager = new ProfileManager();
        this.aliasManager = new AliasManager(this.config);
        this.scriptManager = new ScriptManager(this.bot, this.config, (cmd) => this.handleCommand(cmd));

        this.bot.on('spawn', () => {
            if (this.firstSpawn) {
                this.firstSpawn = false;
                this.boneCollector?.init();
                this.boneDropper?.init();
                this.mineAndSell?.init();
                this.scriptManager?.init();
                if (!this.autoLoginEnabled) this.resumeActiveModules();
                // Start pathfinder watchdog now that we're on the real server.
                if (this.antiStuck && !this.antiStuck.enabled) this.antiStuck.start();
                if (this.limboFreeze) this.limboFreeze.stop();
            }

            if (this.isLoggingIn) {
                Logger.system('🔄 Spawned (auto-login in progress, skipping module resume).');
                return;
            }
        });

        // Publish live module state to the panel. The descriptors read straight
        // off these module instances, so a module toggled from chat, a script,
        // or the panel always reports the same state to all three.
        this.moduleRegistry = new ModuleRegistry();
        registerBotModules(this.moduleRegistry, this);
        this.moduleRegistry.startWatching();
    }

    // Chat, scripts and the panel all route module toggles through the registry,
    // so the three surfaces can never disagree about what is running.
    // handleCommand() lowercases input, so resolve the real key case-insensitively.
    async _handleModule(args) {
        const reg = this.moduleRegistry;
        if (!reg) { Logger.error('Module registry is not ready yet.'); return; }

        const rows = reg.snapshot();
        const wanted = (args[1] || '').trim();
        const action = (args[2] || 'toggle').trim();

        // Bare "!module" answers the only question worth asking at a glance:
        // what is actually on right now.
        if (!wanted || wanted === 'list') {
            const on = rows.filter(r => r.running);
            Logger.system(`Modules ON (${on.length}/${rows.length}): ${on.length ? on.map(r => r.key).join(', ') : 'none'}`);
            return;
        }

        const row = rows.find(r => r.key.toLowerCase() === wanted);
        if (!row) { Logger.error(`Unknown module: ${wanted}`); return; }

        const result = action === 'start' ? await reg.start(row.key)
            : action === 'stop' ? await reg.stop(row.key)
                : await reg.toggle(row.key);

        if (!result.ok) { Logger.error(`${row.label}: ${result.error}`); return; }
        if (result.noop) { Logger.system(`${row.label} already ${result.running ? 'ON' : 'OFF'}.`); return; }
        Logger.system(`${row.label}: ${result.running ? 'ON' : 'OFF'}`);
    }

    saveAndStopActiveModules() {
        this.activeModules.boneCollector = this.boneCollector?.running || false;
        this.activeModules.boneDropper = this.boneDropper?.running || false;
        this.activeModules.mineAndSell = this.mineAndSell?.running || false;
        this.activeModules.mineBlock = this.mineAndSell?.targetBlock || null;
        this.activeModules.tpKill = this.tpKiller?.mode ? { mode: this.tpKiller.mode, target: this.tpKiller.targetPlayer } : null;
        this.activeModules.invCleaner = this.invCleaner?.running || false;
        this.activeModules.pvCandleDropper = this.pvCandleDropper?.running || false;
        this.activeModules.boxPvpMiner = this.boxPvpMiner?.running || false;
        this.activeModules.boxPvpBlock = this.boxPvpMiner?.targetBlock || null;
        this.activeModules.hubChecker = this.hubCheckerTimer ? this.hubCheckerTarget : null;
        this.activeModules.chatGames = this.chatGames?.running || false;
        this.activeModules.autoHome = this.autoHome?.running || false;
        this.activeModules.crystal = this.crystalTrap?.running || false;

        const active = [];
        if (this.activeModules.boneCollector) active.push('BoneCollector');
        if (this.activeModules.boneDropper) active.push('BoneDropper');
        if (this.activeModules.mineAndSell) active.push('MineAndSell');
        if (this.activeModules.tpKill) active.push('TpKill');
        if (this.activeModules.invCleaner) active.push('InvCleaner');
        if (this.activeModules.pvCandleDropper) active.push('PvCandleDropper');
        if (this.activeModules.boxPvpMiner) active.push('BoxPvpMiner');
        if (this.activeModules.chatGames) active.push('ChatGames');
        if (this.activeModules.autoHome) active.push('AutoHome');
        if (this.activeModules.crystal) active.push('CrystalTrap');
        if (active.length) Logger.system(`Pausing active modules: ${active.join(', ')}`);

        if (this.boneCollector?.running) this.boneCollector.stop();
        if (this.boneDropper?.running) this.boneDropper.stop();
        if (this.mineAndSell?.running) this.mineAndSell.stop();
        if (this.tpKiller?.mode) this.tpKiller.stop();
        if (this.invCleaner?.running) this.invCleaner.stop();
        if (this.pvCandleDropper?.running) this.pvCandleDropper.stop();
        if (this.boxPvpMiner?.running) this.boxPvpMiner.stop();
        if (this.chatGames?.running) this.chatGames.stop();
        if (this.autoHome?.running) this.autoHome.stop();
        if (this.crystalTrap?.running) this.crystalTrap.stop();
        this.stopRewardChecker();
        this._stopHubChecker();

        this.saveScriptStates();
    }

    // ─── Reward Checker ────────────────────────────────────────────────
    // Simple repeating timer: every N seconds, send /server <cmd> then
    // /warp <cmd> with a 3s gap. No detection — just keeps re-warping.

    startRewardChecker() {
        this.stopRewardChecker();
        const intervalSec = this.config.rewardInterval || 60;
        const serverCmd = this.config.rewardServerCmd || '/server boxpvp';
        const warpCmd   = this.config.rewardWarpCmd   || '/warp afk';
        Logger.system(`🎁 Reward checker started — running ${serverCmd} → ${warpCmd} every ${intervalSec}s`);

        this.rewardCheckerTimer = setInterval(() => {
            if (!this.bot || !this.bot.entity) return;

            // Don't collide with the inventory cleaner
            if (this._invCleanBusy()) {
                Logger.system('🎁 Skipping cycle — inventory cleaning is active.');
                return;
            }

            const sc = this.config.rewardServerCmd || '/server boxpvp';
            const wc = this.config.rewardWarpCmd   || '/warp afk';
            Logger.system(`🎁 Running ${sc}...`);
            this.bot.chat(sc);

            setTimeout(() => {
                if (this.bot && this.bot.entity) {
                    Logger.system(`🎁 Running ${wc}...`);
                    this.bot.chat(wc);
                }
            }, 3000);
        }, intervalSec * 1000);
    }

    // True while the inventory cleaner is mid-clean or finished very
    // recently (within the command-cooldown window). Used to keep the reward
    // checker from sending /server boxpvp + /warp afk during a clean.
    _invCleanBusy() {
        const ic = this.invCleaner;
        if (!ic) return false;
        if (ic.cleaning) return true;
        const last = ic.lastCleanFinishedAt || 0;
        return last > 0 && (Date.now() - last) < 4000;
    }

    // ─── Shard Emitter ─────────────────────────────────────────────────
    // Reads the scoreboard shard count and emits it to the panel so the
    // sidebar can show each bot's shards in front of its name. Refreshes
    // periodically; only meaningful when running as a panel child.
    _emitShards() {
        if (!IS_CHILD) return;
        try {
            const shards = this._getShards();
            emitMarker('SHARDS_JSON', { username: this.config.username, shards });
        } catch (_) { /* ignore */ }
    }

    startShardEmitter() {
        this.stopShardEmitter();
        // Hunched tries right after spawn: the scoreboard takes a moment to
        // populate, so sample aggressively and surface a count to the panel
        // within a few seconds instead of the first 15s poll.
        this.shardEarlyTimers = [];
        [500, 1500, 3000, 6000, 10000].forEach((ms) => {
            this.shardEarlyTimers.push(setTimeout(() => this._emitShards(), ms));
        });
        this.shardEmitterTimer = setInterval(() => this._emitShards(), 15000);
    }

    stopShardEmitter() {
        if (this.shardEmitterTimer) {
            clearInterval(this.shardEmitterTimer);
            this.shardEmitterTimer = null;
        }
        if (this.shardEarlyTimers) {
            for (const t of this.shardEarlyTimers) clearTimeout(t);
            this.shardEarlyTimers = [];
        }
    }

    stopRewardChecker() {
        if (this.rewardCheckerTimer) {
            clearInterval(this.rewardCheckerTimer);
            this.rewardCheckerTimer = null;
            Logger.system('🎁 Reward checker stopped.');
        }
    }

    saveScriptStates() {
        if (!this.scriptManager || !this.config.username) return;
        const scripts = this.scriptManager.listScripts();
        const scriptsEnabled = {};
        scripts.forEach(s => { scriptsEnabled[s.id] = s.enabled; });
        this.systemData.update(this.config.username, { scriptsEnabled });
    }

    restoreScriptStates() {
        if (!this.scriptManager || !this.config.username) return;
        const data = this.systemData.load(this.config.username);
        const scriptsEnabled = data.scriptsEnabled || {};
        const keys = Object.keys(scriptsEnabled);
        if (!keys.length) return;
        keys.forEach(id => {
            if (scriptsEnabled[id]) this.scriptManager.enableScript(id);
            else this.scriptManager.disableScript(id);
        });
    }

    async resumeActiveModules() {
        await new Promise(r => setTimeout(r, 1500));
        this.restoreScriptStates();
        if (this.invCleanerEnabled && this.invCleaner && !this.invCleaner.running) {
            Logger.system('🧹 Resuming Inventory Cleaner (enabled this session)...');
            this.invCleaner.start();
        }
        if (this.activeModules.boneCollector) { Logger.system('🔄 Auto-resuming Bone Collector...'); this.boneCollector?.start(); }
        if (this.activeModules.boneDropper) { Logger.system('🔄 Auto-resuming Bone Dropper...'); this.boneDropper?.start(); }
        if (this.activeModules.mineAndSell && this.activeModules.mineBlock) {
            Logger.system(`🔄 Auto-resuming Mine & Sell (${this.activeModules.mineBlock})...`);
            this.mineAndSell?.start(this.activeModules.mineBlock);
        }
        if (this.activeModules.tpKill) {
            const { mode, target } = this.activeModules.tpKill;
            Logger.system(`🔄 Auto-resuming TP Kill (${mode}: ${target})...`);
            if (mode === 'main') this.tpKiller?.startMain(target);
            else if (mode === 'send') this.tpKiller?.startSend(target);
        }
        if (this.activeModules.invCleaner) { Logger.system('🔄 Auto-resuming Inventory Cleaner...'); this.invCleaner?.start(); }
        if (this.activeModules.pvCandleDropper) { Logger.system('🔄 Auto-resuming PV Candle Dropper...'); this.pvCandleDropper?.start(); }
        if (this.activeModules.boxPvpMiner && this.activeModules.boxPvpBlock) {
            Logger.system(`🔄 Auto-resuming BoxPVP Miner (${this.activeModules.boxPvpBlock})...`);
            this.boxPvpMiner?.start(this.activeModules.boxPvpBlock);
        }
        if (this.activeModules.hubChecker) {
            Logger.system(`🔄 Auto-resuming Hub Checker (server: ${this.activeModules.hubChecker})...`);
            this._startHubChecker(this.activeModules.hubChecker);
        }
        if (this.activeModules.chatGames) {
            Logger.system('🔄 Auto-resuming ChatGames solver...');
            this.chatGames?.start();
        }
        if (this.activeModules.autoHome) {
            Logger.system('🔄 Auto-resuming Auto Home...');
            this.autoHome?.start();
        }
        if (this.activeModules.crystal) {
            Logger.system('🔄 Auto-resuming Crystal Trap...');
            this.crystalTrap?.start();
        }
        this._autoStartConfiguredModules();
    }

    setupAutoEat() {
        this.bot.autoEat.options = { priority: 'foodPoints', minHunger: 14, bannedFood: [] };
        this.bot.autoEat.on('eatStart', (opts) => Logger.info(`Auto-eating ${opts.food ? opts.food.name : 'unknown'}...`));
        this.bot.autoEat.on('eatFinish', () => Logger.info('Finished eating.'));
        // Silenced — was "Auto-eat module initialized." on every respawn.
    }

    setupEvents() {
        this.bot._client.on('error', (err) => Logger.error(`Protocol error (ignored): ${err.message}`));
        process.on('uncaughtException', (err) => {
            if (err.message?.includes('passengers') || err.message?.includes('Cannot read properties of undefined')) {
                Logger.error(`Mineflayer bug caught (ignored): ${err.message}`);
                return;
            }
            Logger.error(`Uncaught Exception: ${err.message}`);
            emitMarker('EVENT_JSON', { type: 'crash', reason: err.message });
            try { console.error(err.stack); } catch (_) { /* ignore */ }
        });
        process.on('unhandledRejection', (reason) => {
            Logger.error(`Unhandled Rejection: ${reason}`);
        });

        let welcomeShown = false;
        this.bot.on('spawn', () => {
            if (!welcomeShown) {
                welcomeShown = true;
                Logger.system('Bot successfully spawned! 🍌');
                Logger.system('Use !help for commands');
                this.setupAutoEat();
                // Emit an initial inventory snapshot silently (no console log)
                setTimeout(() => this._emitInventory(true), 1500);
            }
            // A clean spawn means the endpoint is healthy again: reset backoff.
            this.reconnectAttempts = 0;
            emitMarker('EVENT_JSON', { type: 'spawn', username: this.config.username, host: this.config.host });
            // Only resumes if !reward on was issued earlier in this process —
            // a fresh start leaves the reward checker off.
            if (this.rewardCheckerEnabled) this.startRewardChecker();
            this.startShardEmitter();
        });

        this.bot.on('health', () => {
            if (this.bot?.health !== undefined && this.bot.health <= 0) {
                emitMarker('EVENT_JSON', { type: 'death', username: this.config.username });
            }
        });

        this.bot.on('messagestr', (message, position) => {
            if (position === 'game_info') {
                return;
            }
            Logger.log(message, 'CHAT');

            if (!this.isLoggingIn) {
                this.autoAuth.handleMessage(message);
            }
        });

        this.bot.on('windowOpen', (w) => Logger.system(`Window opened: ${w.title || w.type}`));
        this.bot.on('error', (err) => {
            Logger.error(`Error: ${err.message}`);
            // Proxy timeouts and connection failures throw error events that don't
            // always trigger 'end', so handle reconnect here for those cases.
            const isProxyError = err.message?.includes('Proxy connection timed out') ||
                                 err.message?.includes('Proxy connect failed') ||
                                 err.message?.includes('connect ETIMEDOUT') ||
                                 err.message?.includes('connect ECONNREFUSED');
            
            if (isProxyError && !this.isReconnecting) {
                emitMarker('EVENT_JSON', { type: 'proxy_error', reason: err.message, username: this.config.username });
                notifySend(`🛑 Bot "${this.config.username}" proxy disconnected — ${describeProxy(this.config.proxy)} (${err.message})`);
                this.stopShardEmitter();
                this.saveAndStopActiveModules();
                // Proxies need time to recover — start backoff at 10s.
                this._scheduleReconnect(10000);
            }
        });
        this.bot.on('kicked', (reason) => {
            const msg = renderChatComponent(reason);
            Logger.error(`Kicked: ${msg}`);
            emitMarker('EVENT_JSON', { type: 'kicked', reason: msg, username: this.config.username });
            notifySend(`🚫 Bot "${this.config.username}" kicked — ${msg}`);
        });

        this.bot.on('end', () => {
            // Skip duplicate reconnects if error handler already scheduled one
            if (this.isReconnecting) {
                Logger.error('Disconnected (reconnect already scheduled).');
                return;
            }

            emitMarker('EVENT_JSON', { type: 'disconnected', username: this.config.username });
            this.stopShardEmitter();
            this.saveAndStopActiveModules();

            if (this.config.autoReconnect) {
                this._scheduleReconnect(this.config.reconnectDelay || 5000);
            }
        });
    }

    // Reconnect with exponential backoff + jitter, capped at 60s. Repeated
    // failures (dead server, bad proxy, kick-loop) no longer hammer the host at
    // a fixed interval; a successful spawn resets the delay to the base value.
    _scheduleReconnect(baseMs) {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        const attempt = this.reconnectAttempts || 0;
        const backoff = Math.min(baseMs * Math.pow(2, attempt), 60000);
        const jitter = Math.floor(Math.random() * 1000);
        const delay = backoff + jitter;
        this.reconnectAttempts = attempt + 1;
        Logger.error(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);
        notifySend(`⚠️ Bot "${this.config.username}" disconnected — reconnecting in ${Math.round(delay / 1000)}s`);
        setTimeout(() => {
            this.isReconnecting = false;
            this.connect();
        }, delay);
    }

    _emitInventory(silent = false) {
        if (!this.bot || !this.bot.inventory) {
            emitMarker('INVENTORY_JSON', { items: [], equipped: null, error: 'bot not ready' });
            return;
        }
        try {
            const items = (this.bot.inventory.items() || []).map(it => ({
                slot: it.slot,
                name: it.name,
                displayName: it.displayName || it.name,
                count: it.count,
                type: it.type
            }));
            const slotsArr = this.bot.inventory.slots || [];
            const armor = [5, 6, 7, 8].map(i => slotsArr[i]).filter(Boolean).map(it => ({
                slot: it.slot, name: it.name, displayName: it.displayName || it.name, count: it.count, type: it.type
            }));
            const held = slotsArr[this.bot.getEquipmentDestSlot ? this.bot.getEquipmentDestSlot('hand') : 36];
            const offhand = slotsArr[45];
            emitMarker('INVENTORY_JSON', {
                username: this.config.username,
                items,
                armor,
                held: held ? { name: held.name, count: held.count } : null,
                offhand: offhand ? { name: offhand.name, count: offhand.count } : null,
                empty: this.bot.inventory.emptySlotCount(),
                totalItems: items.length,
                timestamp: Date.now()
            });
            if (!silent) Logger.system(`📦 Inventory snapshot sent (${items.length} items)`);
        } catch (e) {
            emitMarker('INVENTORY_JSON', { items: [], error: e.message });
        }
    }

    setupConsole() {
        if (!this.rl) return; // child mode uses stdin-line handling below
        this.rl.on('line', (input) => this._processInputLine(input));

        // In child mode we still accept panel → bot commands via stdin.
    }

    _processInputLine(input) {
        let raw = String(input || '').trim();
        if (!raw) { if (this.rl) this.rl.prompt(); return; }

        // Internal module config push from the panel. Applies settings, arms /
        // disarms the module in the persisted config, and restarts a running
        // module so the new settings take effect immediately. Intercepted
        // before alias resolution, exactly like __live_config.
        if (raw.startsWith('__modulecfg ')) {
            try {
                const payload = JSON.parse(raw.slice('__modulecfg '.length));
                this.applyModuleCfg(payload).catch(err => Logger.error(`[modules] config error: ${err.message}`));
            } catch (_) {}
            return;
        }

        // Live custom-command map push from the panel. Replaces the stored map
        // wholesale so renamed / deleted commands vanish here too.
        if (raw.startsWith('__custom_cmds ')) {
            try {
                const map = JSON.parse(raw.slice('__custom_cmds '.length));
                if (map && typeof map === 'object') this.config.customCommands = map;
                Logger.system(`🆕 ${Object.keys(this.config.customCommands || {}).length} custom commands synced from panel.`);
            } catch (_) {}
            return;
        }

        // Internal live config push from the panel (not user-facing, must be
        // intercepted before alias resolution to avoid being sent as chat).
        if (raw.startsWith('__live_config ')) {
            try {
                const patch = JSON.parse(raw.slice('__live_config '.length));
                Object.assign(this.config, patch);
                // Also persist so the values survive reconnects.
                if (this.config.username) {
                    const sd = {};
                    if (patch.rewardServerCmd !== undefined) sd.rewardServerCmd = patch.rewardServerCmd;
                    if (patch.rewardWarpCmd   !== undefined) sd.rewardWarpCmd   = patch.rewardWarpCmd;
                    if (patch.rewardInterval  !== undefined) sd.rewardInterval  = patch.rewardInterval;
                    if (Object.keys(sd).length) this.systemData.update(this.config.username, sd);
                }
                // If the reward checker is running, restart it to pick up new interval/commands
                if (this.rewardCheckerTimer) {
                    this.startRewardChecker();
                }
                Logger.system('🔄 Live config updated from panel.');
            } catch (_) {}
            return;
        }

        // Custom commands from the panel: a saved name ("chest") is
        // interchangeable with its full content ("!chest 10 64 7"), with
        // extra args appended. Applied before aliases, like the pushes above.
        if (this.config.customCommands && typeof this.config.customCommands === 'object') {
            const m = raw.trim().match(/^(!?)([^\s]+)(?:\s+(.*))?$/);
            if (m) {
                const key = m[2].toLowerCase().replace(/^!/, '');
                const hit = Object.keys(this.config.customCommands).find(k => k.toLowerCase().replace(/^!/, '') === key);
                if (hit && this.config.customCommands[hit]) {
                    const content = this.config.customCommands[hit];
                    raw = content + (m[3] ? ' ' + m[3] : '');
                }
            }
        }

        if (this.aliasManager) raw = this.aliasManager.resolve(raw);

        if (raw.startsWith('!')) {
            this.handleCommand(raw.slice(1)).catch(err => Logger.error(`Command error: ${err.message}`));
        } else {
            if (this.bot && this.bot.entity) {
                this.bot.chat(raw);
                Logger.log(`[YOU] ${raw}`, 'CHAT');
            } else Logger.error('Bot not connected.');
        }
        if (this.rl) this.rl.prompt();
    }

    _ask(question, def) {
        return new Promise((resolve) => {
            if (!this.rl) return resolve(def || '');
            const suffix = def !== undefined && def !== '' ? ` (${def})` : '';
            this.rl.question(`${question}${suffix}: `, (a) => resolve(a.trim() || def || ''));
        });
    }

    async handleCommand(input) {
        const args = input.toLowerCase().split(' ');
        const cmd = args[0];

        switch (cmd) {
            case 'quit':
            case 'exit':
                Logger.system('🍌 Shutting down gracefully...');
                if (this.boneCollector) this.boneCollector.stop();
                if (this.boneDropper) this.boneDropper.stop();
                if (this.mineAndSell) this.mineAndSell.stop();
                if (this.tpKiller) this.tpKiller.stop();
                if (this.invCleaner) this.invCleaner.stop();
                if (this.pvCandleDropper) this.pvCandleDropper.stop();
                if (this.chatGames) this.chatGames.stop();
                if (this.autoHome) this.autoHome.stop();
                if (this.crystalTrap) this.crystalTrap.stop();
                if (this.moduleRegistry) this.moduleRegistry.destroy();
                if (this.scriptManager) this.scriptManager.destroy();
                if (this.payoutBridge) await this.payoutBridge.stop();
                if (this.bot) { this.bot.removeAllListeners('end'); this.bot.quit(); }
                if (this.discordBridge) this.discordBridge.destroy();
                if (this.rl) { try { this.rl.close(); } catch (_) {} }
                Logger.system('👋 Goodbye!');
                // Give stdout a moment to flush before exiting
                setTimeout(() => process.exit(0), 50);
                break;

            case 'reconnect':
                Logger.system('🔄 Manually reconnecting...');
                if (this.bot) {
                    const isAuto = this.config.autoReconnect;
                    this.bot.quit();
                    if (!isAuto) setTimeout(() => this.connect(), 2000);
                } else this.connect();
                break;

            case 'reload':
                Logger.system('🔄 Reloading config from disk...');
                try {
                    const newConfig = loadConfig();
                    Object.assign(this.config, newConfig);
                    this.loadSystemData();
                    if (this.boneCollector) this.boneCollector.config = this.config.boneCollector || {};
                    if (this.boneDropper) this.boneDropper.config = this.config.boneDropper || {};
                    if (this.aliasManager) this.aliasManager.reload();
                    Logger.system('✅ Config reloaded!');
                } catch (err) { Logger.error(`Reload failed: ${err.message}`); }
                break;

            case 'help':
                Logger.system('=== General Commands ===');
                Logger.info('!bones on/off       - Toggle bone collector');
                Logger.info('!dropper on/off     - Toggle bone dropper');
                Logger.info('!invclean on/off    - Toggle inventory cleaner');
                Logger.info('!inventory          - Emit current inventory JSON');
                Logger.info('!gui / !click / !shift / !close');
                Logger.info('!spawner x y z      - Set spawner pos');
                Logger.info('!spawnerdrop x y z  - Set dropper pos');
                Logger.info('!chest x y z        - Set chest pos');
                Logger.info('!stats / !drop / !look / !eat / !autoeat');
                Logger.info('!setlogin / !autologin on/off / !autoregister on/off');
                Logger.info('!reload / !reconnect / !quit');
                Logger.system('=== Mine & Sell ===');
                Logger.info('!mine <block> | !mine off | !mine status | !mine radius <n>');
                Logger.system('=== Follow ===');
                Logger.info('!follow <player> [range] - Follow a player around');
                Logger.info('!follow status           - Show follow state');
                Logger.info('!unfollow                - Stop following');
                Logger.info('!goto <x> <y> <z> [range] - Walk to a position');
                Logger.info('!setgo                   - Save current spot as go-spot');
                Logger.info('!goto                    - Walk to saved go-spot');
                Logger.info('!goto status             - Show walk state');
                Logger.info('!stopgoto                - Stop walking');
                Logger.system('=== Fight ===');
                Logger.info('!fight <player>          - Go to player and fight them');
                Logger.info('!fight off               - Stop fighting');
                Logger.info('!fight status            - Show fight state');
                Logger.info('!stopfight               - Stop fighting');
                Logger.system('=== Proxy (SOCKS5) ===');
                Logger.info('!proxy                   - Show current proxy');
                Logger.info('!proxy set socks5://user:pass@host:port - Attach proxy');
                Logger.info('!proxy off               - Remove proxy');
                Logger.system('=== BoxPVP Miner ===');
                Logger.info('!boxpvp <block> | !boxpvp off');
                Logger.system('=== TP Kill ===');
                Logger.info('!tpkill main/send/off/status <player>');
                Logger.system('=== Scripts / Triggers / Aliases ===');
                Logger.info('!script / !repeat / !trigger / !alias / !profile');
                Logger.system('=== Payout Bot (Discord + Web) ===');
                Logger.info('!linkdc              - Interactive setup & start payout bot');
                Logger.info('!linkdc stop         - Stop the payout bot & web panel');
                Logger.info('!linkdc status       - Show current state');
                Logger.info('!linkdc balance <n>  - Set pool balance (raw)');
                Logger.info('!linkdc amount <x>   - Set per-user amount (e.g. 50M)');
                Logger.system('=== PV & Reward ===');
                Logger.info('!pv [number]         - Count pink/magenta candles in /pv (default: /pv 1)');
                Logger.info('!pvdrop on/off       - Drop all candles from PVs');
                Logger.info('!pvdrop pvs <nums>   - Configure PV numbers to drop candles from');
                Logger.info('!shard               - Check shards from scoreboard');
                Logger.info('!reward              - Show reward checker status');
                Logger.info('!reward on/off       - Start/stop reward checker');
                Logger.info('!reward server <cmd> - Set server command (e.g. /server boxpvp)');
                Logger.info('!reward warp <cmd>   - Set warp command (e.g. /warp afk)');
                Logger.info('!reward time <secs>  - Set interval in seconds (e.g. 60)');
                Logger.system('=== Hub Checker ===');
                Logger.info('!hubchecker <server> - Run /server <server> when hub detected (3 hotbar items)');
                Logger.info('!hubchecker off      - Stop hub checker');
                Logger.info('!hubchecker status   - Show current state');
                Logger.system('=== ChatGames ===');
                Logger.info('!chatgames on/off    - Auto-solve server chat games');
                Logger.info('!chatgames status    - Show solver state & next delay');
                Logger.info('!chatgames wins      - Show win counts (!wins) ');
                Logger.info('!chatgames reset     - Reset win counters');
                Logger.system('=== Auto Home ===');
                Logger.info('!autohome on/off     - /home + click light blue bed, re-home on death');
                Logger.info('!autohome status     - Show auto home state');
                Logger.system('=== Crystal Trap ===');
                Logger.info('!crystal pos <x> <y> <z> - Set obsidian block position');
                Logger.info('!crystal on/off      - Keep crystal placed, detonate when players near');
                Logger.info('!crystal players <n> - Players needed to detonate (default 10)');
                Logger.info('!crystal radius <n>  - Detection radius in blocks (default 6)');
                Logger.info('!crystal health <n>  - Min hearts to crystal, eats below it (default 7)');
                Logger.info('!crystal status      - Show trap state, HP gate & nearby players');
                break;

            case 'inventory':
            case 'inv':
                this._emitInventory();
                break;

            case 'alias': await this._handleAlias(args, input); break;
            case 'bones':
                if (args[1] === 'on') { this._wakeForMovement(); this.boneCollector?.start(); }
                else if (args[1] === 'off') this.boneCollector?.stop();
                else Logger.error('Usage: !bones on/off');
                break;
            case 'dropper':
                if (args[1] === 'on') { this._wakeForMovement(); this.boneDropper?.start(); }
                else if (args[1] === 'off') this.boneDropper?.stop();
                else Logger.error('Usage: !dropper on/off');
                break;
            case 'autohome':
                if (args[1] === 'on') this.autoHome?.start();
                else if (args[1] === 'off') this.autoHome?.stop();
                else if (args[1] === 'status') this.autoHome?.showStatus();
                else Logger.error('Usage: !autohome on/off/status');
                break;
            case 'crystal':
                if (args[1] === 'on') this.crystalTrap?.start();
                else if (args[1] === 'off') this.crystalTrap?.stop();
                else if (args[1] === 'status') this.crystalTrap?.showStatus();
                else if (args[1] === 'pos' && args.length === 5) {
                    const x = parseInt(args[2]), y = parseInt(args[3]), z = parseInt(args[4]);
                    if ([x, y, z].some(isNaN)) { Logger.error('Invalid coords.'); break; }
                    if (!this.config.crystal) this.config.crystal = {};
                    this.config.crystal.pos = { x, y, z };
                    this.systemData.update(this.config.username, { crystalPos: { x, y, z } });
                    if (this.crystalTrap) this.crystalTrap.pos = { x, y, z };
                    Logger.system(`💥 Crystal obsidian pos saved: ${x},${y},${z}`);
                    this._emitConfigUpdate();
                }
                else if (args[1] === 'players' && args[2]) {
                    const n = parseInt(args[2]);
                    if (isNaN(n) || n < 1) { Logger.error('Usage: !crystal players <number>'); break; }
                    if (!this.config.crystal) this.config.crystal = {};
                    this.config.crystal.playerThreshold = n;
                    this.systemData.update(this.config.username, { crystalPlayers: n });
                    if (this.crystalTrap) this.crystalTrap.playerThreshold = n;
                    Logger.system(`💥 Crystal trigger set to ${n} nearby players`);
                    this._emitConfigUpdate();
                }
                else if (args[1] === 'radius' && args[2]) {
                    const n = parseInt(args[2]);
                    if (isNaN(n) || n < 1) { Logger.error('Usage: !crystal radius <blocks>'); break; }
                    if (!this.config.crystal) this.config.crystal = {};
                    this.config.crystal.radius = n;
                    this.systemData.update(this.config.username, { crystalRadius: n });
                    if (this.crystalTrap) this.crystalTrap.radius = n;
                    Logger.system(`💥 Crystal detection radius set to ${n} blocks`);
                    this._emitConfigUpdate();
                }
                else if (args[1] === 'health' && args[2]) {
                    const hearts = parseFloat(args[2]);
                    if (isNaN(hearts) || hearts < 0.5 || hearts > 10) { Logger.error('Usage: !crystal health <hearts> (0.5-10)'); break; }
                    const hp = Math.round(hearts * 2);
                    if (!this.config.crystal) this.config.crystal = {};
                    this.config.crystal.minHealth = hp;
                    this.systemData.update(this.config.username, { crystalMinHealth: hp });
                    if (this.crystalTrap) this.crystalTrap.minHealth = hp;
                    Logger.system(`💥 Min crystal health set to ${hearts} hearts (${hp} HP)`);
                    this._emitConfigUpdate();
                }
                else Logger.error('Usage: !crystal on/off/status | pos <x> <y> <z> | players <n> | radius <n> | health <hearts>');
                break;
            case 'gui': case 'window': this.guiManager?.showWindow(); break;
            case 'click': args[1] ? this.guiManager?.clickSlot(args[1]) : Logger.error('Usage: !click <slot>'); break;
            case 'shift': args[1] ? this.guiManager?.shiftClick(args[1]) : Logger.error('Usage: !shift <slot>'); break;
            case 'close': this.guiManager?.closeWindow(); break;

            case 'spawner': case 'chest':
                if (args.length === 4) {
                    const x = parseInt(args[1]), y = parseInt(args[2]), z = parseInt(args[3]);
                    if ([x, y, z].some(isNaN)) { Logger.error('Invalid coords.'); break; }
                    if (!this.config.boneCollector) this.config.boneCollector = {};
                    const key = cmd === 'spawner' ? 'spawnerPos' : 'chestPos';
                    this.config.boneCollector[key] = { x, y, z };
                    this.systemData.update(this.config.username, { [key]: { x, y, z } });
                    Logger.system(`${cmd} saved: ${x},${y},${z}`);
                    if (this.boneCollector) this.boneCollector.config[key] = { x, y, z };
                    this._emitConfigUpdate();
                } else Logger.error(`Usage: !${cmd} <x> <y> <z>`);
                break;

            case 'spawnerdrop':
                if (args.length === 4) {
                    const x = parseInt(args[1]), y = parseInt(args[2]), z = parseInt(args[3]);
                    if ([x, y, z].some(isNaN)) { Logger.error('Invalid coords.'); break; }
                    if (!this.config.boneDropper) this.config.boneDropper = {};
                    this.config.boneDropper.spawnerPos = { x, y, z };
                    this.systemData.update(this.config.username, { dropperPos: { x, y, z } });
                    Logger.system(`spawnerdrop saved: ${x},${y},${z}`);
                    if (this.boneDropper) this.boneDropper.config.spawnerPos = { x, y, z };
                    this._emitConfigUpdate();
                } else Logger.error(`Usage: !spawnerdrop <x> <y> <z>`);
                break;

            case 'setslot':
            {
                const n = parseInt(args[1]);
                if (isNaN(n)) { Logger.error('Usage: !setslot <number>'); break; }
                if (!this.config.boneCollector) this.config.boneCollector = {};
                this.config.boneCollector.collectSlot = n;
                this.systemData.update(this.config.username, { collectSlot: n });
                if (this.boneCollector) this.boneCollector.config.collectSlot = n;
                Logger.system(`Collect slot set to ${n}`);
                this._emitConfigUpdate();
            }
                break;

            case 'setdelay':
            {
                const n = parseInt(args[1]);
                if (isNaN(n)) { Logger.error('Usage: !setdelay <ms>'); break; }
                if (!this.config.boneCollector) this.config.boneCollector = {};
                this.config.boneCollector.cycleDelay = n;
                this.systemData.update(this.config.username, { cycleDelay: n });
                if (this.boneCollector) this.boneCollector.config.cycleDelay = n;
                Logger.system(`Cycle delay set to ${n}ms`);
                this._emitConfigUpdate();
            }
                break;

            case 'repeat': case 'loop':
                if (args.length >= 3) {
                    const seconds = parseFloat(args[1]);
                    const commandToRun = input.split(' ').slice(2).join(' ');
                    if (!isNaN(seconds) && seconds > 0 && commandToRun && this.scriptManager) {
                        const id = this.scriptManager.addIntervalScript(seconds, commandToRun);
                        Logger.system(`Script "${id}" started: "${commandToRun}" every ${seconds}s`);
                    } else Logger.error('Usage: !repeat <seconds> <command>');
                } else Logger.error('Usage: !repeat <seconds> <command>');
                break;

            case 'script': case 'scripts': await this._handleScript(args); break;
            case 'trigger': await this._handleTrigger(args, input); break;
            case 'list':
                if (this.scriptManager) {
                    const scripts = this.scriptManager.listScripts();
                    if (!scripts.length) Logger.info('No scripts loaded.');
                    else { Logger.system('=== Scripts ==='); scripts.forEach(s => Logger.info(`[${s.enabled?'✓':'✗'}] ${s.id} - ${s.name} (${s.type})`)); }
                }
                break;
            case 'stop': case 'unloop':
                if (args[1] && this.scriptManager) {
                    if (this.scriptManager.disableScript(args[1])) Logger.system(`Script "${args[1]}" disabled.`);
                    else Logger.error(`Script "${args[1]}" not found.`);
                } else Logger.error('Usage: !stop <id>');
                break;

            case 'eat':
                if (this.bot?.autoEat) this.bot.autoEat.eat().catch(err => Logger.error(`Could not eat: ${err.message}`));
                break;
            case 'autoeat':
                if (args[1] === 'on') { this.bot.autoEat.enableAuto(); Logger.system('Auto-eat ENABLED'); }
                else if (args[1] === 'off') { this.bot.autoEat.disableAuto(); Logger.system('Auto-eat DISABLED'); }
                else Logger.error('Usage: !autoeat on/off');
                break;
            case 'stats':
                if (this.bot) {
                    Logger.system('=== Bot Stats ===');
                    Logger.info(`HP: ${Math.round(this.bot.health)}/20 | Food: ${Math.round(this.bot.food)}/20`);
                    Logger.info(`Pos: ${this.bot.entity.position.floored()}`);
                    Logger.info(`Inv: ${this.bot.inventory.items().length} items`);
                }
                break;
            case 'module':
            case 'modules': await this._handleModule(args); break;
            case 'drop': await this._handleDrop(args); break;
            case 'look': await this._handleLook(args); break;
            case 'profile': await this._handleProfile(args); break;
            case 'tpkill': await this._handleTpkill(args, input); break;
            case 'mine': await this._handleMine(args, input); break;
            case 'follow': await this._handleFollow(args); break;
            case 'unfollow': case 'stopfollow':
                this.follower?.unfollow();
                break;
            case 'goto': case 'walkto': await this._handleGoto(args); break;
            case 'setgo': case 'setgoto':
                this.goTo?.setSpot();
                break;
            case 'stopgoto': case 'stopwalk':
                this.goTo?.stop();
                break;
            case 'fight':
                if (args[1] === 'off' || args[1] === 'stop') { this.fight?.stop(); }
                else if (args[1] === 'status') { this.fight?.showStatus(); }
                else if (args[1]) { this._wakeForMovement(); this.fight?.start(args[1]); }
                else Logger.error('Usage: !fight <player> | off | status');
                break;
            case 'stopfight':
                this.fight?.stop();
                break;
            case 'proxy': await this._handleProxy(args); break;
            case 'boxpvp':
            case 'boxpvpminer':
                if (args[1] === 'off') this.boxPvpMiner?.stop();
                else if (args[1] && args[1] !== 'on') { this._wakeForMovement(); this.boxPvpMiner?.start(args.slice(1).join('_')); }
                else if (args[1] === 'on' && args[2]) { this._wakeForMovement(); this.boxPvpMiner?.start(args.slice(2).join('_')); }
                else if (args[1] === 'on' && this.activeModules.boxPvpBlock) { this._wakeForMovement(); this.boxPvpMiner?.start(this.activeModules.boxPvpBlock); }
                else Logger.error('Usage: !boxpvp <block> or !boxpvp off');
                break;
            case 'invclean': case 'invcheck':
                // The flag drives resume-after-reconnect, so keep it in step
                // with the explicit on/off the operator just gave.
                if (args[1] === 'on') { this.invCleanerEnabled = true; this.invCleaner?.start(); }
                else if (args[1] === 'off') { this.invCleanerEnabled = false; this.invCleaner?.stop(); }
                else Logger.error('Usage: !invclean on/off');
                break;
            case 'pvdrop':
            case 'pvcandledropper':
                if (args[1] === 'on') {
                    this.pvCandleDropper?.start();
                } else if (args[1] === 'off') {
                    this.pvCandleDropper?.stop();
                } else if (args[1] === 'pvs') {
                    const pvs = args.slice(2).map(n => parseInt(n)).filter(n => !isNaN(n));
                    if (pvs.length === 0) {
                        Logger.error('Usage: !pvdrop pvs <num1> <num2> ...');
                        break;
                    }
                    if (!this.config.pvCandleDropper) this.config.pvCandleDropper = {};
                    this.config.pvCandleDropper.pvs = pvs;
                    if (this.pvCandleDropper) this.pvCandleDropper.pvs = pvs;
                    Logger.system(`🕯️ PV Candle Dropper PV list set to: [${pvs.join(', ')}]`);
                    this._emitConfigUpdate();
                } else {
                    Logger.error('Usage: !pvdrop on/off OR !pvdrop pvs <num1> <num2> ...');
                }
                break;
            case 'setlogin': {
                const newPass = input.split(' ').slice(1).join(' ');
                if (!newPass) { Logger.error('Usage: !setlogin <password>'); break; }
                this.loginPassword = newPass;
                this.systemData.update(this.config.username, { loginPassword: newPass });
                Logger.system(`🔑 Login password saved for "${this.config.username}"`);
                break;
            }
            case 'autologin':
                if (args[1] === 'on') {
                    if (!this.loginPassword) { Logger.error('No password set. Use !setlogin first.'); break; }
                    this.autoLoginEnabled = true;
                    this.systemData.update(this.config.username, { autoLogin: true });
                    Logger.system('🔓 Auto-login ENABLED.');
                } else if (args[1] === 'off') {
                    this.autoLoginEnabled = false;
                    this.systemData.update(this.config.username, { autoLogin: false });
                    Logger.system('🔓 Auto-login DISABLED.');
                } else Logger.error('Usage: !autologin on/off');
                break;

            case 'autoregister':
                if (args[1] === 'on') {
                    if (!this.loginPassword) { Logger.error('No password set. Use !setlogin first.'); break; }
                    this.autoRegisterEnabled = true;
                    this.systemData.update(this.config.username, { autoRegister: true });
                    Logger.system('📝 Auto-register ENABLED.');
                } else if (args[1] === 'off') {
                    this.autoRegisterEnabled = false;
                    this.systemData.update(this.config.username, { autoRegister: false });
                    Logger.system('📝 Auto-register DISABLED.');
                } else Logger.error('Usage: !autoregister on/off');
                break;

            case 'linkdc': await this._handleLinkDc(args, input); break;

            case 'pv': await this._handlePv(args); break;

            case 'shard': case 'shards':
                await this._handleShard();
                break;

            case 'reward': case 'rewardcheck':
                this._handleRewardCheck(args, input);
                break;

            case 'hubchecker': case 'hudchecker': case 'hubcheck':
                this._handleHubChecker(args, input);
                break;

            case 'chatgames': case 'cg':
                if (args[1] === 'on') this.chatGames?.start();
                else if (args[1] === 'off') this.chatGames?.stop();
                else if (args[1] === 'status') this.chatGames?.status();
                else if (args[1] === 'wins') this.chatGames?.printWins();
                else if (args[1] === 'reset') this.chatGames?.resetWins();
                else Logger.error('Usage: !chatgames on/off/status/wins/reset');
                break;

            case 'wins':
                this.chatGames?.printWins();
                break;

            default:
                Logger.error(`Unknown command: ${cmd}. Type !help`);
        }
    }

    async _handleLinkDc(args, input) {
        if (!this.payoutStore) this.payoutStore = new PayoutStore();
        const sub = args[1];

        if (sub === 'stop' || sub === 'off') {
            if (this.payoutBridge) { await this.payoutBridge.stop(); this.payoutBridge = null; }
            this.payoutStore.update({ discord: { ...this.payoutStore.get().discord, enabled: false } });
            Logger.system('🔌 LinkDC stopped. Discord bot offline & web panel closed.');
            return;
        }
        if (sub === 'status') {
            const s = this.payoutStore.get();
            Logger.system('=== LinkDC Status ===');
            Logger.info(`Running: ${!!this.payoutBridge}`);
            Logger.info(`Enabled: ${s.discord.enabled}`);
            Logger.info(`Guild ID: ${s.discord.guildId || '(none)'}`);
            Logger.info(`Web port: ${s.web.port}`);
            Logger.info(`Payout: ${s.payoutAmount}`);
            Logger.info(`Balance: ${s.balance.toLocaleString()}`);
            Logger.info(`Paid: ${s.totalPaid.toLocaleString()} (${s.claims.length} claims)`);
            return;
        }
        if (sub === 'balance') {
            const n = parseInt(args[2]);
            if (isNaN(n) || n < 0) { Logger.error('Usage: !linkdc balance <raw-number>'); return; }
            this.payoutStore.update({ balance: n });
            Logger.system(`💰 Balance set to ${n.toLocaleString()}`);
            return;
        }
        if (sub === 'amount') {
            const v = input.split(' ')[2];
            if (!v) { Logger.error('Usage: !linkdc amount <50M|1.5B|1000000>'); return; }
            const { parseAmount } = require('./utils/PayoutStore.js');
            if (!parseAmount(v)) { Logger.error('Invalid amount format.'); return; }
            this.payoutStore.update({ payoutAmount: v });
            Logger.system(`💵 Per-user payout set to ${v}`);
            return;
        }

        Logger.system('🔗 LinkDC Setup — Discord payout bot + web panel');
        Logger.info('Press ENTER to keep current value shown in parentheses.');
        const cur = this.payoutStore.get();
        const token = await this._ask('Discord bot token', cur.discord.token ? '(kept secret — enter new to change)' : '');
        const finalToken = token && !token.startsWith('(kept') ? token : cur.discord.token;
        if (!finalToken) { Logger.error('Token required.'); return; }
        const guildId = await this._ask('Guild (server) ID', cur.discord.guildId);
        if (!guildId) { Logger.error('Guild ID required.'); return; }
        const channelId = await this._ask('Default channel ID (optional)', cur.discord.channelId);
        const webPort = await this._ask('Web panel port', String(cur.web.port || 3000));
        const amount = await this._ask('Payout per user (e.g. 50M)', cur.payoutAmount);
        const balance = await this._ask('Initial pool balance (raw number)', String(cur.balance || 0));
        const { parseAmount } = require('./utils/PayoutStore.js');
        if (!parseAmount(amount)) { Logger.error('Invalid payout amount.'); return; }
        this.payoutStore.update({
            discord: { token: finalToken, guildId, channelId, enabled: true },
            web: { port: parseInt(webPort) || 3000 },
            payoutAmount: amount,
            balance: parseInt(balance) || 0
        });
        if (this.payoutBridge) { await this.payoutBridge.stop(); this.payoutBridge = null; }
        this.payoutBridge = new PayoutBridge(this.payoutStore, (u, a) => this._executePayout(u, a));
        try {
            await this.payoutBridge.start();
            Logger.system('✅ Discord payout bot is ONLINE!');
            Logger.system(`   → Run /setup-panel in your Discord server to send the claim panel.`);
            Logger.system(`   → Admin web panel: http://localhost:${webPort}`);
        } catch (e) {
            Logger.error(`Failed to start: ${e.message}`);
            this.payoutBridge = null;
            this.payoutStore.update({ discord: { ...this.payoutStore.get().discord, enabled: false } });
        }
    }

    async _handlePv(args) {
    if (!this.bot || !this.bot.entity) { Logger.error('Bot not connected.'); return; }
    const pvNum = args[1] || '1';
    Logger.system(`📦 Opening /pv ${pvNum}...`);
    this.bot.chat(`/pv ${pvNum}`);

    const CANDLE_NAMES = ['pink_candle', 'magenta_candle'];
    const CANDLE_DISPLAY = ['pink candle', 'magenta candle'];

    const onWindow = (window) => {
        clearTimeout(timeout);

        let total = 0;
        const breakdown = {};

        window.slots.forEach((slot) => {
            if (!slot) return;
            const name = (slot.name || '').toLowerCase();
            const display = (slot.displayName || slot.name || '').toLowerCase();
            const isCandle = CANDLE_NAMES.some(c => name.includes(c)) ||
                             CANDLE_DISPLAY.some(c => display.includes(c));
            if (isCandle) {
                const label = slot.displayName || slot.name;
                breakdown[label] = (breakdown[label] || 0) + slot.count;
                total += slot.count;
            }
        });

        if (total === 0) {
            Logger.system(`🕯️  PV ${pvNum}: No pink or magenta candles found.`);
        } else {
            Logger.system(`🕯️  PV ${pvNum} — Pink/Magenta Candle Count:`);
            Object.entries(breakdown).forEach(([name, count]) =>
                Logger.info(`  ${name}: ${count.toLocaleString()}`)
            );
            Logger.system(`  ► Total: ${total.toLocaleString()}`);
        }

        setTimeout(() => {
            if (this.bot.currentWindow) this.bot.closeWindow(this.bot.currentWindow);
        }, 300);
    };

    const timeout = setTimeout(() => {
        this.bot.removeListener('windowOpen', onWindow);
        Logger.error('PV window did not open within 5s.');
    }, 5000);

    this.bot.once('windowOpen', onWindow);
}

    _handleRewardCheck(args, input) {
        const sub = args[1];
        if (sub === 'on') {
            this.rewardCheckerEnabled = true;
            this.startRewardChecker();
            return;
        }
        if (sub === 'off') {
            this.rewardCheckerEnabled = false;
            this.stopRewardChecker();
            return;
        }
        if (sub === 'server') {
            const cmd = input.split(' ').slice(2).join(' ').trim();
            if (!cmd) { Logger.error('Usage: !reward server /server boxpvp'); return; }
            this.config.rewardServerCmd = cmd;
            this.systemData.update(this.config.username, { rewardServerCmd: cmd });
            this._emitConfigUpdate();
            Logger.system(`🎁 Server command set to: ${cmd}`);
            // Restart timer to apply immediately
            if (this.rewardCheckerTimer) this.startRewardChecker();
            return;
        }
        if (sub === 'warp') {
            const cmd = input.split(' ').slice(2).join(' ').trim();
            if (!cmd) { Logger.error('Usage: !reward warp /warp afk'); return; }
            this.config.rewardWarpCmd = cmd;
            this.systemData.update(this.config.username, { rewardWarpCmd: cmd });
            this._emitConfigUpdate();
            Logger.system(`🎁 Warp command set to: ${cmd}`);
            if (this.rewardCheckerTimer) this.startRewardChecker();
            return;
        }
        if (sub === 'time' || sub === 'interval') {
            const sec = parseInt(args[2]);
            if (isNaN(sec) || sec < 10) { Logger.error('Usage: !reward time <seconds> (min 10)'); return; }
            this.config.rewardInterval = sec;
            this.systemData.update(this.config.username, { rewardInterval: sec });
            this._emitConfigUpdate();
            Logger.system(`🎁 Interval set to: ${sec}s`);
            if (this.rewardCheckerTimer) this.startRewardChecker();
            return;
        }
        // Status
        const intervalSec = this.config.rewardInterval || 60;
        const serverCmd = this.config.rewardServerCmd || '/server boxpvp';
        const warpCmd   = this.config.rewardWarpCmd   || '/warp afk';
        Logger.system('=== Reward Checker Status ===');
        Logger.info(`Enabled: ${this.rewardCheckerEnabled ? 'YES' : 'NO'}`);
        Logger.info(`Active: ${this.rewardCheckerTimer ? 'YES' : 'NO'}`);
        Logger.info(`Server cmd: ${serverCmd}`);
        Logger.info(`Warp cmd: ${warpCmd}`);
        Logger.info(`Interval: ${intervalSec}s`);
    }

    // ─── Hub Checker ───────────────────────────────────────────────────
    // Lightweight standalone checker: only runs /server <target> when the
    // hotbar shows 3 items (hub layout). No warp step, no reward-checker
    // interaction. Survives reconnects via activeModules.hubChecker.

    _getHotbarItemCount() {
        if (!this.bot?.inventory?.slots) return null;
        let count = 0;
        for (let slot = 36; slot <= 44; slot++) {
            if (this.bot.inventory.slots[slot]) count++;
        }
        return count;
    }
    _handleHubChecker(args, input) {
        const sub = args[1];
        if (!sub || sub === 'status') {
            const hotbarCount = this._getHotbarItemCount();
            Logger.system('=== Hub Checker Status ===');
            Logger.info(`Running: ${this.hubCheckerTimer ? 'YES' : 'NO'}`);
            Logger.info(`Target server: ${this.hubCheckerTarget || '(none)'}`);
            Logger.info(`Hotbar items: ${hotbarCount ?? 'UNKNOWN'}`);
            Logger.info(`In hub now: ${hotbarCount === 3 ? 'YES ✓' : 'NO ✗'}`);
            return;
        }
        if (sub === 'off' || sub === 'stop') {
            this._stopHubChecker();
            return;
        }
        // everything after the command name is the server target
        const target = input.split(' ').slice(1).join(' ').trim();
        if (!target) {
            Logger.error('Usage: !hubchecker <server> | off | status');
            return;
        }
        this._startHubChecker(target);
    }

    _startHubChecker(target) {
        this._stopHubChecker();
        this.hubCheckerTarget = target;
        Logger.system(`🔍 Hub Checker started — will run /server ${target} when hub detected (3 hotbar items)`);
        this.hubCheckerTimer = setInterval(() => {
            if (!this.bot || !this.bot.entity) return;
            if (this._getHotbarItemCount() === 3) {
                Logger.system(`🔍 Hub detected — running /server ${this.hubCheckerTarget}...`);
                this.bot.chat(`/server ${this.hubCheckerTarget}`);
            }
        }, 10000);
    }

    _stopHubChecker() {
        if (this.hubCheckerTimer) {
            clearInterval(this.hubCheckerTimer);
            this.hubCheckerTimer = null;
            Logger.system('🔍 Hub Checker stopped.');
        }
        this.hubCheckerTarget = null;
    }

    _getShards() {
    if (!this.bot) return null;

    // Strip all Minecraft/ANSI color codes and control chars
    const strip = (s) =>
        String(s || '')
            .replace(/\u00a7./g, '')   // §x color codes
            .replace(/\u001b\[[0-9;]*m/g, '') // ANSI escapes
            .replace(/[^\x20-\x7E]/g, '') // non-printable
            .trim();

    // Parse numbers like "1,234", "1.5M", "2K", "3B"
    const parseNum = (text) => {
        const m = text.replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)([kKmMbBtT])?/);
        if (!m) return null;
        let n = parseFloat(m[1]);
        const suf = (m[2] || '').toLowerCase();
        if (suf === 'k') n *= 1e3;
        else if (suf === 'm') n *= 1e6;
        else if (suf === 'b') n *= 1e9;
        else if (suf === 't') n *= 1e12;
        return isNaN(n) ? null : Math.round(n);
    };

    // Build a full rendered line from a scoreboard item, including team prefix/suffix
    const renderItem = (item) => {
        const parts = [];
        try {
            const teams = this.bot.teams || {};
            for (const team of Object.values(teams)) {
                if (Array.isArray(team.members) && team.members.includes(item.name)) {
                    if (team.prefix) parts.push(strip(team.prefix.toString()));
                    if (team.suffix) parts.push(strip(team.suffix.toString()));
                    break;
                }
            }
        } catch (_) {}
        try { if (item.displayName) parts.push(strip(item.displayName.toString())); } catch (_) {}
        if (item.name) parts.push(strip(String(item.name)));
        return parts.join('');
    };

    // Scan a single board's items for a shard line
    const scanBoard = (board) => {
        if (!board) return null;
        const items = Array.isArray(board.items) && board.items.length
            ? board.items
            : Object.values(board.itemsMap || {});

        for (const item of items) {
            const line = renderItem(item);
            if (!/shard/i.test(line)) continue;

            // Try to find a number that comes after "shard" label
            const afterColon = line.match(/shard[^:]*:\s*([\d,.\s]+[kKmMbBtT]?)/i);
            const n = parseNum(afterColon ? afterColon[1] : line);
            if (n !== null) return n;

            // item.value as last resort (only meaningful if > 15, which is
            // above the max scoreboard position count)
            if (typeof item.value === 'number' && item.value > 15) return item.value;
        }
        return null;
    };

    // 1. Sidebar (most reliable — this is what the player sees)
    const sb = this.bot.scoreboard;
    if (sb?.sidebar) {
        const r = scanBoard(sb.sidebar);
        if (r !== null) return r;
    }

    // 2. Walk every named scoreboard
    const allBoards = this.bot.scoreboards || sb || {};
    for (const board of Object.values(allBoards)) {
        if (board && typeof board === 'object' && 'items' in board || 'itemsMap' in board) {
            const r = scanBoard(board);
            if (r !== null) return r;
        }
    }

    // 3. Direct itemsMap title-match fallback
    try {
        for (const board of Object.values(this.bot.scoreboards || {})) {
            if (/shard/i.test(strip(board.title || ''))) {
                const items = Object.values(board.itemsMap || {});
                for (const item of items) {
                    const line = renderItem(item);
                    const n = parseNum(line);
                    if (n !== null) return n;
                }
            }
        }
    } catch (_) {}

    return null;
}

    async _handleShard() {
        const shards = this._getShards();
        if (shards === null) {
            Logger.system('=== Shards ===');
            Logger.info('Could not find shards on scoreboard.');
        } else {
            Logger.system('=== Shards ===');
            Logger.info(`You have ${shards.toLocaleString()} shards.`);
        }
    }

    async _handleAlias(args, input) {
        if (!this.aliasManager) return;
        const a = args[1];
        if (!a || a === 'list') {
            const list = this.aliasManager.list();
            if (!list.length) Logger.info('No aliases.');
            else { Logger.system('=== Aliases ==='); list.forEach(x => Logger.info(`${x.shortcut} → ${x.command}`)); }
        } else if (a === 'add') {
            const p = input.split(' ');
            if (p.length < 4) return Logger.error('Usage: !alias add <shortcut> <command>');
            this.aliasManager.add(p[2], p.slice(3).join(' '));
        } else if (a === 'delete' || a === 'remove') {
            if (!args[2]) return Logger.error('Usage: !alias delete <shortcut>');
            if (!this.aliasManager.remove(args[2])) Logger.error(`Alias "${args[2]}" not found.`);
        } else if (a === 'reload') this.aliasManager.reload();
        else Logger.error('Usage: !alias <list|add|delete|reload>');
    }

    async _handleScript(args) {
        if (!this.scriptManager) return;
        const a = args[1], id = args[2];
        if (!a || a === 'list') {
            const ss = this.scriptManager.listScripts();
            if (!ss.length) Logger.info('No scripts.');
            else { Logger.system('=== Scripts ==='); ss.forEach(s => Logger.info(`[${s.enabled?'✓':'✗'}] ${s.id} - ${s.name} (${s.type})`)); }
        } else if (a === 'enable') id && (this.scriptManager.enableScript(id) ? Logger.system(`Enabled ${id}`) : Logger.error('Not found.'));
        else if (a === 'disable') id && (this.scriptManager.disableScript(id) ? Logger.system(`Disabled ${id}`) : Logger.error('Not found.'));
        else if (a === 'delete') id && (this.scriptManager.deleteScript(id) ? Logger.system(`Deleted ${id}`) : Logger.error('Not found.'));
        else if (a === 'reload') this.scriptManager.reload();
        else Logger.error('Usage: !script <list|enable|disable|delete|reload>');
    }

    async _handleTrigger(args, input) {
        if (!this.scriptManager) return;
        const a = args[1];
        if (!a || a === 'list') {
            const ss = this.scriptManager.listScripts().filter(s => s.type === 'message-trigger');
            if (!ss.length) Logger.info('No triggers.');
            else { Logger.system('=== Triggers ==='); ss.forEach(s => Logger.info(`[${s.enabled?'✓':'✗'}] ${s.id} - ${s.name}`)); }
        } else if (a === 'add') {
            const p = input.split(' ');
            if (p.length < 4) return Logger.error('Usage: !trigger add <pattern> <action>');
            const id = this.scriptManager.addQuickTrigger(p[2], p.slice(3).join(' '));
            Logger.system(`Trigger "${id}" created.`);
        } else if (a === 'delete') {
            if (!args[2]) return Logger.error('Usage: !trigger delete <id>');
            this.scriptManager.deleteScript(args[2]) ? Logger.system(`Deleted ${args[2]}`) : Logger.error('Not found.');
        } else Logger.error('Usage: !trigger <list|add|delete>');
    }

    async _handleDrop(args) {
        if (!this.bot || !this.bot.entity) { Logger.error('Bot not connected.'); return; }
        const mode = args[1] || 'all';

        // tossStack fails while a container/GUI window is open — close it first.
        if (this.bot.currentWindow) {
            try { this.bot.closeWindow(this.bot.currentWindow); await new Promise(r => setTimeout(r, 300)); } catch (_) {}
        }

        // Toss a single stack with one retry; never throws.
        const tossOne = async (item) => {
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    await this.bot.tossStack(item);
                    return true;
                } catch (e) {
                    if (attempt === 0) { await new Promise(r => setTimeout(r, 250)); continue; }
                    Logger.error(`Drop failed for ${item.name}: ${e.message}`);
                    return false;
                }
            }
            return false;
        };

        // Build the target list up front (snapshot) so mutation during tossing
        // doesn't skip items.
        let targets;
        if (mode === 'all') {
            targets = this.bot.inventory.items();
        } else if (mode === 'held') {
            const held = this.bot.inventory.slots[this.bot.getEquipmentDestSlot('hand')];
            targets = held ? [held] : [];
        } else {
            // Drop EVERY matching stack, not just the first.
            targets = this.bot.inventory.items().filter(i =>
                i.name.toLowerCase().includes(mode) ||
                (i.displayName || '').toLowerCase().includes(mode));
        }

        if (!targets.length) {
            Logger.error(mode === 'all' ? 'Inventory is empty.'
                       : mode === 'held' ? 'Nothing in hand.'
                       : `No items matching "${mode}".`);
            return;
        }

        let dropped = 0;
        for (const it of targets) {
            if (!this.bot || !this.bot.entity) { Logger.error('Disconnected mid-drop.'); break; }
            if (await tossOne(it)) dropped++;
            await new Promise(r => setTimeout(r, 200));
        }

        if (dropped === targets.length) Logger.system(`Done dropping (${dropped} stack${dropped === 1 ? '' : 's'}).`);
        else Logger.error(`Dropped ${dropped}/${targets.length} stack(s) — some failed.`);
    }

    async _handleLook(args) {
        if (!this.bot) return;
        if (args.length === 2) {
            const p = this.bot.players[args[1]];
            if (p?.entity) this.bot.lookAt(p.entity.position.offset(0, 1.6, 0));
            else Logger.error('Player not found.');
        } else if (args.length === 4) {
            const x = parseFloat(args[1]), y = parseFloat(args[2]), z = parseFloat(args[3]);
            this.bot.lookAt(new Vec3(x, y, z));
        } else Logger.error('Usage: !look <player> OR !look <x y z>');
    }

    async _handleProfile(args) {
        if (!this.profileManager) return;
        const a = args[1], n = args[2];
        if (a === 'list') { const ps = this.profileManager.listProfiles(); Logger.system('=== Profiles ==='); ps.forEach(x => Logger.info(`- ${x}`)); }
        else if (a === 'save' && n) {
            this.profileManager.saveProfile(n, { config: { spawnerPos: this.config.boneCollector?.spawnerPos, chestPos: this.config.boneCollector?.chestPos, collectSlot: this.config.boneCollector?.collectSlot } });
        } else if (a === 'load' && n) {
            const p = this.profileManager.getProfile(n);
            if (p?.config) { this.config.boneCollector = { ...this.config.boneCollector, ...p.config }; if (this.boneCollector) this.boneCollector.config = this.config.boneCollector; Logger.system(`Loaded "${n}"`); this._emitConfigUpdate(); }
            else Logger.error('Profile not found.');
        } else if (a === 'delete' && n) {
            this.profileManager.deleteProfile(n) ? Logger.system(`Deleted "${n}"`) : Logger.error('Not found.');
        } else Logger.error('Usage: !profile <list|save|load|delete> [name]');
    }

    async _handleTpkill(args, input) {
        if (!this.tpKiller) return;
        const a = args[1], t = input.split(' ')[2];
        if (a === 'main') { this._wakeForMovement(); this.tpKiller.startMain(); }
        else if (a === 'send' && t) { this._wakeForMovement(); this.tpKiller.startSend(t); }
        else if (a === 'off' || a === 'stop') this.tpKiller.stop();
        else if (a === 'status') Logger.system(this.tpKiller.getStatus());
        else Logger.error('Usage: !tpkill main | !tpkill send <player> | !tpkill off | !tpkill status');
    }

    async _handleMine(args, input) {
        if (!this.mineAndSell) return;
        const a = args[1];
        if (!a) return Logger.error('Usage: !mine <block> | off | status | radius <n>');
        if (a === 'off' || a === 'stop') this.mineAndSell.stop();
        else if (a === 'status') this.mineAndSell.showStatus();
        else if (a === 'radius') {
            const r = parseInt(args[2]);
            if (!isNaN(r) && r > 0 && r <= 256) { this.mineAndSell.searchRadius = r; Logger.system(`Radius: ${r}`); }
            else Logger.error('Usage: !mine radius <1-256>');
        } else {
            const blockName = input.split(' ').slice(1).join('_');
            this._wakeForMovement();
            this.mineAndSell.start(blockName);
        }
    }

    async _handleFollow(args) {
        if (!this.follower) return;
        const sub = args[1];
        if (!sub) return Logger.error('Usage: !follow <player> [range] | off | status');
        if (sub === 'off' || sub === 'stop') { this.follower.unfollow(); return; }
        if (sub === 'status') { this.follower.showStatus(); return; }
        const range = parseInt(args[2]);
        this._wakeForMovement();
        this.follower.follow(sub, range);
    }

    async _handleGoto(args) {
        if (!this.goTo) return;
        const sub = args[1];
        if (!sub) {
            // Bare !goto walks back to the spot saved via !setgo.
            this._wakeForMovement();
            this.goTo.gotoSaved();
            return;
        }
        if (sub === 'off' || sub === 'stop') { this.goTo.stop(); return; }
        if (sub === 'status') { this.goTo.showStatus(); return; }
        const x = parseFloat(args[1]);
        const y = parseFloat(args[2]);
        const z = parseFloat(args[3]);
        const range = args[4] != null ? parseFloat(args[4]) : undefined;
        this._wakeForMovement();
        this.goTo.goto(x, y, z, range);
    }

    /**
     * Attach / detach a SOCKS5 proxy to this bot (player), then reconnect so it
     * takes effect.
     *   !proxy                         - show current proxy
     *   !proxy set <socks5://u:p@h:port>  - attach a proxy and reconnect
     *   !proxy off                     - remove the proxy and reconnect
     */
    async _handleProxy(args) {
        const sub = (args[1] || '').toLowerCase();

        if (!sub || sub === 'status') {
            Logger.system(`🛡️  Proxy: ${describeProxy(this.config.proxy)}${this.config.proxy ? '' : ' (direct connection)'}`);
            return;
        }

        if (sub === 'off' || sub === 'none' || sub === 'remove' || sub === 'clear') {
            if (!this.config.proxy) { Logger.system('No proxy attached.'); return; }
            this.config.proxy = null;
            this._persistConfig();
            Logger.system('🛡️  Proxy removed.');
            this._reconnectForProxy();
            return;
        }

        if (sub === 'set' || sub === 'add') {
            const value = args.slice(2).join(' ').trim();
            if (!value) { Logger.error('Usage: !proxy set socks5://user:pass@host:port'); return; }
            const parsed = parseProxy(value);
            if (!parsed) { Logger.error('Invalid proxy. Expected socks5://[user:pass@]host:port'); return; }
            this.config.proxy = parsed;
            this._persistConfig();
            Logger.verbose(`🛡️  Proxy attached: ${describeProxy(this.config.proxy)}`);
            this._reconnectForProxy();
            return;
        }

        // Allow a bare `!proxy socks5://...` as shorthand for `set`.
        const parsed = parseProxy(args.slice(1).join(' ').trim());
        if (parsed) {
            this.config.proxy = parsed;
            this._persistConfig();
            Logger.verbose(`🛡️  Proxy attached: ${describeProxy(this.config.proxy)}`);
            this._reconnectForProxy();
            return;
        }

        Logger.error('Usage: !proxy [status] | set <socks5://user:pass@host:port> | off');
    }

    // Best-effort persistence so the proxy survives reconnects/restarts. Under
    // the panel, MultiBotServer owns per-bot config; standalone writes config.json.
    _persistConfig() {
        try {
            if (!IS_CHILD) {
                const { saveConfig } = require('./utils/config.js');
                saveConfig(this.config);
            }
        } catch (e) { Logger.error(`Could not persist proxy: ${e.message}`); }
    }

    _reconnectForProxy() {
        Logger.system('🔄 Reconnecting to apply proxy change...');
        if (!this.bot) { this.connect(); return; }
        // If auto-reconnect is off, schedule one manual reconnect on close.
        if (!this.config.autoReconnect) {
            this.bot.once('end', () => setTimeout(() => this.connect(), 1500));
        }
        try { this.bot.quit('proxy change'); }
        catch (e) { try { this.bot.end(); } catch (_) { } }
    }
}

// ─── Child-mode stdin handler ──────────────────────────────────────────
// When running as a spawned panel child, there is no readline interface
// (it caused ERR_USE_AFTER_CLOSE). We still need to accept panel→bot
// commands, so we read raw newline-delimited stdin here.
if (IS_CHILD) {
    let _buf = '';
    process.stdin.on('data', (chunk) => {
        _buf += chunk.toString();
        let i;
        while ((i = _buf.indexOf('\n')) !== -1) {
            const line = _buf.slice(0, i);
            _buf = _buf.slice(i + 1);
            const instance = BananaBot._activeInstance;
            if (instance) instance._processInputLine(line);
        }
    });
    process.stdin.on('error', () => {});
}

// Track the latest instance so the stdin handler can reach it.
const _origInit = BananaBot.prototype.init;
BananaBot.prototype.init = async function (...a) {
    BananaBot._activeInstance = this;
    return _origInit.apply(this, a);
};

module.exports = { BananaBot };
