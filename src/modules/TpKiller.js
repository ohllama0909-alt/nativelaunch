/**
 * 🍌 BananaMoney - TP Kill System
 * Two modes:
 *   MAIN (killer) - Auto-accepts ANY TPA request, kills whoever teleports to you
 *   SEND (sender) - Sends /tpa <target> every 5 seconds
 *
 * Commands:
 *   !tpkill main               - Start killer mode (accepts TPA from anyone)
 *   !tpkill send <mainBotName> - Start sender mode, send /tpa to <mainBotName>
 *   !tpkill off                - Stop TP kill system
 *   !tpkill status             - Show current status
 */

const Logger = require('../utils/logger.js');

// Sword tiers ordered best to worst for selection
const SWORD_TIERS = [
    'netherite_sword',
    'diamond_sword',
    'iron_sword',
    'stone_sword',
    'golden_sword',
    'wooden_sword'
];

// Single-line TPA patterns — capture sender name
const TPA_PATTERNS = [
    /(\w+) has requested to teleport to you/i,
    /(\w+) wants to teleport to you/i,
    /teleport request from (\w+)/i,
    /(\w+) has sent you a teleport request/i,
    /(\w+) would like to teleport to you/i,
    /(\w+) is requesting to teleport to you/i,
    /the player (\w+) wants/i,
];

// Multi-line trigger keywords — if buffer contains these, it's a TPA
const TP_BUFFER_KEYWORDS = ['teleport', 'tp request', 'tpa'];
const TP_BUFFER_INTENT   = ['wants', 'requested', 'would like', 'is requesting', 'has sent'];

// TPA accept command
const TPA_ACCEPT_COMMAND = '/tpaccept';

// Attack cooldown for 1.9 PVP — base 625ms, jittered ±100ms to look human
const SWORD_COOLDOWN_BASE = 625;
const SWORD_COOLDOWN_JITTER = 100;

// How long after TP acceptance to wait before starting to attack (ms)
// Simulates reaction time — looks more legit
const ATTACK_START_DELAY_MIN = 300;
const ATTACK_START_DELAY_MAX = 700;

class TpKiller {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;

        // State
        this.mode = null;           // 'main' or 'send' or null
        this.targetPlayer = null;   // Only used in send mode
        this.running = false;

        // Sender interval
        this.sendInterval = null;

        // Attack loop
        this.attackTimeout = null;
        this.isAttacking = false;
        this.currentVictim = null;  // Who we're currently killing

        // Bound message listener
        this._onMessage = null;

        // Rolling buffer of recent chat lines for multi-line TPA detection
        this._msgBuffer = [];
        this._msgBufferTimer = null;

        // Cooldown guard: don't accept two TPs within 3 seconds
        this._lastAcceptTime = 0;

        // Queued TPA sender to retry after combat ends
        this._pendingTpaSender = null;

        // GUI window handler for lime shulker box click
        this._pendingWindowHandler = null;
        this._pendingWindowTimeout = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Public API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Start killer mode — accepts TPA from anyone, kills nearest player after TP.
     */
    startMain() {
        this.stop();

        this.mode = 'main';
        this.targetPlayer = null;
        this.running = true;

        Logger.system(`=== TP KILL: MAIN MODE ===`);
        Logger.system(`Accepting TPA from ANYONE. Will kill nearest player after teleport.`);

        this.equipBestSword();

        this._onMessage = (message, position) => {
            if (position === 'game_info') return;
            this.handleMainMessage(message);
        };
        this.bot.on('messagestr', this._onMessage);
    }

    /**
     * Start sender mode — sends /tpa <mainBotName> every 5 seconds.
     */
    startSend(mainBotName) {
        this.stop();

        this.mode = 'send';
        this.targetPlayer = mainBotName;
        this.running = true;

        Logger.system(`=== TP KILL: SEND MODE ===`);
        Logger.system(`Sending /tpa to "${mainBotName}" every 5 seconds...`);

        this.sendTpa();
        this.sendInterval = setInterval(() => {
            if (!this.running) return;
            this.sendTpa();
        }, 5000);
    }

    /**
     * Stop everything.
     */
    stop() {
        this.running = false;

        if (this.sendInterval)    { clearInterval(this.sendInterval);  this.sendInterval = null; }
        if (this.attackTimeout)   { clearTimeout(this.attackTimeout);  this.attackTimeout = null; }

        if (this._onMessage) {
            this.bot.removeListener('messagestr', this._onMessage);
            this._onMessage = null;
        }

        this._msgBuffer = [];
        if (this._msgBufferTimer) { clearTimeout(this._msgBufferTimer); this._msgBufferTimer = null; }

        if (this._pendingWindowHandler) {
            this.bot.removeListener('windowOpen', this._pendingWindowHandler);
            this._pendingWindowHandler = null;
        }
        if (this._pendingWindowTimeout) { clearTimeout(this._pendingWindowTimeout); this._pendingWindowTimeout = null; }

        if (this.mode) Logger.system('TP Kill system: STOPPED');

        this.mode = null;
        this.targetPlayer = null;
        this.isAttacking = false;
        this.currentVictim = null;
        this._pendingTpaSender = null;
    }

    getStatus() {
        if (!this.mode) return 'TP Kill: OFF';
        if (this.mode === 'main') return `TP Kill: MAIN mode | ${this.isAttacking ? `Attacking ${this.currentVictim}` : 'Waiting for TPA...'}`;
        if (this.mode === 'send') return `TP Kill: SEND mode | Sending /tpa to: ${this.targetPlayer}`;
        return 'TP Kill: Unknown state';
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  TPA Detection
    // ─────────────────────────────────────────────────────────────────────────

    handleMainMessage(message) {
        if (!this.running || this.mode !== 'main') return;

        // ── Combat ended — retry any queued TPA ───────────────────────────────
        if (/no longer in combat/i.test(message)) {
            if (this._pendingTpaSender) {
                const queued = this._pendingTpaSender;
                this._pendingTpaSender = null;
                Logger.system(`Combat ended — retrying queued TPA from ${queued}`);
                this.acceptTpa(queued);
            }
            return;
        }

        // ── Detect combat-denied on tpaccept — keep the queue alive ──────────
        if (/command denied.*combat/i.test(message) || /combat.*command denied/i.test(message)) {
            if (this._pendingTpaSender) {
                Logger.system(`TPA accept blocked by combat — waiting for combat to end (queued: ${this._pendingTpaSender})`);
            }
            return;
        }

        // Buffer last 6 lines, cleared after 2s of silence
        this._msgBuffer.push(message);
        if (this._msgBuffer.length > 6) this._msgBuffer.shift();
        if (this._msgBufferTimer) clearTimeout(this._msgBufferTimer);
        this._msgBufferTimer = setTimeout(() => {
            this._msgBuffer = [];
            this._msgBufferTimer = null;
        }, 2000);

        const combined     = this._msgBuffer.join(' ');
        const combinedLow  = combined.toLowerCase();

        // ── Single-line match (capture player name) ───────────────────────────
        for (const pattern of TPA_PATTERNS) {
            const match = message.match(pattern);
            if (match) {
                const sender = match[1];
                Logger.system(`TPA detected from ${sender}!`);
                this._msgBuffer = [];
                this.acceptTpa(sender);
                return;
            }
        }

        // ── Multi-line match (server splits message across lines) ─────────────
        const hasKeyword = TP_BUFFER_KEYWORDS.some(k => combinedLow.includes(k));
        const hasIntent  = TP_BUFFER_INTENT.some(k => combinedLow.includes(k));

        if (hasKeyword && hasIntent) {
            // Try to extract the player name from the buffer
            // "The player <name> wants" → grab word after "player"
            const nameMatch = combined.match(/the player (\w+)/i) ||
                              combined.match(/from (\w+)/i);
            const sender = nameMatch ? nameMatch[1] : 'unknown';
            Logger.system(`TPA detected (multi-line) from ${sender}!`);
            this._msgBuffer = [];
            this.acceptTpa(sender);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Accept & Attack
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Accept TPA and prepare to kill whoever shows up.
     * @param {string} sender - Name of the player who sent TPA (used for targeting after TP)
     */
    acceptTpa(sender) {
        if (!this.bot || !this.bot.entity) return;

        // Cooldown: don't double-accept within 3s (unless this is a combat retry)
        const now = Date.now();
        if (now - this._lastAcceptTime < 3000) {
            // Queue sender so we retry once combat ends
            if (sender && sender !== 'unknown') {
                Logger.system(`TPA from ${sender} queued (cooldown active — likely in combat)`);
                this._pendingTpaSender = sender;
            }
            return;
        }
        this._lastAcceptTime = now;

        Logger.system(`Accepting TPA from ${sender}...`);
        this.bot.chat(TPA_ACCEPT_COMMAND);
        this._clickLimeShulkerOnNextWindow();

        // After the GUI click + TP lands, start attacking
        // We use a slight delay to simulate reaction time after TP
        const delay = ATTACK_START_DELAY_MIN + Math.random() * (ATTACK_START_DELAY_MAX - ATTACK_START_DELAY_MIN);
        this.equipBestSword();

        if (this.attackTimeout) clearTimeout(this.attackTimeout);
        this.attackTimeout = setTimeout(() => {
            if (!this.running) return;
            this.currentVictim = sender !== 'unknown' ? sender : null;
            this.isAttacking = true;
            Logger.system(`Starting attack loop...`);
            this._attackLoop();
        }, delay);
    }

    /**
     * Main attack loop — finds the closest player and attacks with human-like timing.
     * Stops when no players are in range for 3 seconds.
     */
    _attackLoop() {
        if (!this.running || !this.isAttacking) return;

        const victim = this._findTarget();

        if (!victim || !victim.entity) {
            // Nobody in range — wait briefly and retry, give up after timeout
            if (!this._noTargetSince) this._noTargetSince = Date.now();

            if (Date.now() - this._noTargetSince > 3000) {
                Logger.system('No target found for 3s, stopping attack loop.');
                this.isAttacking = false;
                this.currentVictim = null;
                this._noTargetSince = null;
                return;
            }

            // Retry in 200ms
            this.attackTimeout = setTimeout(() => this._attackLoop(), 200);
            return;
        }

        this._noTargetSince = null;
        this.currentVictim = victim.username;

        const pos = victim.entity.position;
        const distance = this.bot.entity.position.distanceTo(pos);

        if (distance <= 3.5) {
            // Look slightly above head (aim at neck/chest level — more natural)
            const aimY = 1.2 + Math.random() * 0.6; // between 1.2 and 1.8
            this.bot.lookAt(pos.offset(
                (Math.random() - 0.5) * 0.2,  // tiny horizontal jitter
                aimY,
                (Math.random() - 0.5) * 0.2
            ), true).then(() => {
                if (victim.entity) {
                    this.bot.attack(victim.entity);
                    Logger.info(`[Attack] Hit ${victim.username} (${distance.toFixed(1)}m)`);
                }
            }).catch(() => {});
        }

        // Schedule next attack with jittered cooldown (looks human)
        const jitter = (Math.random() * 2 - 1) * SWORD_COOLDOWN_JITTER;
        const nextSwing = SWORD_COOLDOWN_BASE + jitter;

        this.attackTimeout = setTimeout(() => this._attackLoop(), nextSwing);
    }

    /**
     * Find the best target to attack:
     * 1. The player who sent TPA (currentVictim) if they're nearby
     * 2. Otherwise the closest visible player within 5 blocks
     */
    _findTarget() {
        if (!this.bot || !this.bot.entity) return null;

        const players = Object.values(this.bot.players).filter(p =>
            p.entity &&
            p.username !== this.bot.username
        );

        if (players.length === 0) return null;

        // Prefer the known victim first
        if (this.currentVictim) {
            const known = players.find(p => p.username === this.currentVictim);
            if (known && known.entity) {
                const d = this.bot.entity.position.distanceTo(known.entity.position);
                if (d <= 5) return known;
            }
        }

        // Fall back to closest player within 5 blocks
        let closest = null;
        let closestDist = 5;
        for (const p of players) {
            const d = this.bot.entity.position.distanceTo(p.entity.position);
            if (d < closestDist) { closestDist = d; closest = p; }
        }
        return closest;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Send mode
    // ─────────────────────────────────────────────────────────────────────────

    sendTpa() {
        if (!this.bot || !this.bot.entity) return;
        const cmd = `/tpa ${this.targetPlayer}`;
        Logger.info(`[TP Send] ${cmd}`);
        this.bot.chat(cmd);
        this._clickLimeShulkerOnNextWindow();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  GUI: click lime shulker box
    // ─────────────────────────────────────────────────────────────────────────

    _clickLimeShulkerOnNextWindow() {
        if (!this.bot) return;

        // Avoid stacking duplicate listeners
        if (this._pendingWindowHandler) {
            this.bot.removeListener('windowOpen', this._pendingWindowHandler);
            this._pendingWindowHandler = null;
        }
        if (this._pendingWindowTimeout) {
            clearTimeout(this._pendingWindowTimeout);
            this._pendingWindowTimeout = null;
        }

        const onWindow = async (window) => {
            clearTimeout(this._pendingWindowTimeout);
            this._pendingWindowTimeout = null;
            this._pendingWindowHandler = null;

            Logger.system(`[TP GUI] Window opened: ${window.title || window.type}`);

            // Find lime shulker box
            let targetSlot = null;
            for (let i = 0; i < window.slots.length; i++) {
                const slot = window.slots[i];
                if (!slot) continue;
                const name        = (slot.name        || '').toLowerCase();
                const displayName = (slot.displayName || '').toLowerCase();
                if (name.includes('lime_shulker_box') || displayName.includes('lime shulker box')) {
                    targetSlot = i;
                    break;
                }
            }

            if (targetSlot === null) {
                Logger.error('[TP GUI] Lime shulker box not found!');
                window.slots.forEach((slot, i) => {
                    if (slot) Logger.info(`[TP GUI]   Slot ${i}: ${slot.name} (${slot.displayName})`);
                });
                try { this.bot.closeWindow(window); } catch (_) {}
                return;
            }

            Logger.system(`[TP GUI] Clicking lime shulker box at slot ${targetSlot}`);
            try {
                await this.bot.clickWindow(targetSlot, 0, 0);
                Logger.system(`[TP GUI] Clicked! TP confirmed.`);
            } catch (err) {
                Logger.error(`[TP GUI] Click failed: ${err.message}`);
            }
        };

        this._pendingWindowHandler = onWindow;
        this.bot.once('windowOpen', onWindow);

        this._pendingWindowTimeout = setTimeout(() => {
            if (this._pendingWindowHandler) {
                this.bot.removeListener('windowOpen', this._pendingWindowHandler);
                this._pendingWindowHandler = null;
            }
            this._pendingWindowTimeout = null;
        }, 5000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Sword
    // ─────────────────────────────────────────────────────────────────────────

    equipBestSword() {
        if (!this.bot) return null;
        const items = this.bot.inventory.items();

        for (const tier of SWORD_TIERS) {
            const sword = items.find(item => item.name === tier);
            if (sword) {
                this.bot.equip(sword, 'hand').then(() => {
                    Logger.system(`Equipped: ${sword.displayName || sword.name}`);
                }).catch(() => {});
                return sword;
            }
        }

        const anySword = items.find(item => item.name.includes('sword'));
        if (anySword) {
            this.bot.equip(anySword, 'hand').then(() => {
                Logger.system(`Equipped (modded): ${anySword.displayName || anySword.name}`);
            }).catch(() => {});
            return anySword;
        }

        Logger.error('No sword found in inventory!');
        return null;
    }
}

module.exports = { TpKiller };
