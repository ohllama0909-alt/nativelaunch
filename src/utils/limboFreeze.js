/**
 * 🍌 limboFreeze — stay still during anti-bot verification.
 *
 * Plugins like GUARD/AtomGuard/LimboFilter/Sonar often spawn the player in a
 * limbo first, then verify them. That limbo spawn is NOT the real server spawn,
 * so we must NOT resume on it. We resume only when:
 *   - the server explicitly says verification succeeded/failed/timed out,
 *   - the bot is kicked or disconnected,
 *   - the configured freeze duration elapses.
 *
 * During verification we clear all movement input and, for GUARD-style "do not
 * move" checks, disable physics so no position packets are generated.
 */

const Logger = require('./logger.js');

// Patterns that mean "an anti-bot is currently checking this connection".
const START_PATTERNS = [
    /being verified/i,
    /do not move/i,
    /don't move/i,
    /please wait/i,
    /automatic process/i,
    /bot verification/i,
    /bot.filter/i,
    /limbofilter/i,
    /limbo filter/i,
    /sonar/i,
    /gravity check/i,
    /captcha/i,
    /guard/i,
    /atomguard/i,
    /checking/i
];

// Patterns that mean "the check is over, one way or another".
const END_PATTERNS = [
    /verified successfully/i,
    /successfully passed/i,
    /passed the/i,
    /you are verified/i,
    /verification complete/i,
    /verification completed/i,
    /verification passed/i,
    /failed the/i,
    /verification failed/i,
    /have failed/i,
    /timed out/i,
    /timeout/i,
    /please wait a few seconds before trying/i
];

const DEFAULTS = {
    enabled: true,
    // 'auto'  -> disable physics only when the message says "do not move" / "don't move"
    // 'fall'  -> always keep physics ON (LimboFilter/Sonar gravity check)
    // 'freeze'-> always disable physics during verification (GUARD-style stillness)
    physicsMode: 'auto',
    // NEVER end on spawn: GUARD/LimboFilter spawn you in limbo first.
    endOnSpawn: false,
    endOnKick: true,
    // Hard safety cap.
    maxFreezeMs: 30000,
    // Auto-resume after this many ms if no explicit end message arrives.
    // GUARD checks are usually <2s; LimboFilter falling checks need 6-7s.
    freezeDurationMs: 8000
};

function resolveConfig(config) {
    const lf = (config && config.limboFreeze) || {};
    return { ...DEFAULTS, ...lf };
}

class LimboFreeze {
    constructor(bot, config) {
        this.bot = bot;
        this.config = resolveConfig(config);
        this.frozen = false;
        this._timer = null;
        this._handlers = [];
        this._resumeReason = null;
    }

    start() {
        if (!this.config.enabled) return;

        const onChat = (msg) => this._handleText(String(msg || ''));
        const onTitle = (jsonMsg) => {
            try { this._handleText(JSON.stringify(jsonMsg || {})); } catch (_) {}
        };
        const onSpawn = () => {
            if (this.frozen && this.config.endOnSpawn) {
                this._resumeReason = 'spawn';
                Logger.verbose('🧊 LimboFreeze: spawn detected, ending verification freeze.');
                this._unfreeze();
            }
        };
        const onEnd = () => {
            if (this.frozen) {
                this._resumeReason = 'disconnect';
                this._unfreeze();
            }
        };
        const onKicked = (reason) => {
            if (this.frozen) {
                this._resumeReason = 'kicked';
                this._unfreeze();
            }
        };

        this.bot.on('messagestr', onChat);
        this.bot.on('title', onTitle);
        this.bot.on('spawn', onSpawn);
        this.bot.on('end', onEnd);
        this.bot.on('kicked', onKicked);

        this._handlers = [
            { event: 'messagestr', fn: onChat },
            { event: 'title', fn: onTitle },
            { event: 'spawn', fn: onSpawn },
            { event: 'end', fn: onEnd },
            { event: 'kicked', fn: onKicked }
        ];
    }

    stop() {
        this._unfreeze();
        for (const { event, fn } of this._handlers) {
            try { this.bot.removeListener(event, fn); } catch (_) {}
        }
        this._handlers = [];
    }

    _handleText(text) {
        if (!text) return;
        if (this.frozen) {
            if (END_PATTERNS.some(p => p.test(text))) {
                this._resumeReason = 'end-message';
                Logger.verbose(`🧊 LimboFreeze: verification ended (${text.slice(0, 80)}), resuming.`);
                this._unfreeze();
            }
            return;
        }
        if (START_PATTERNS.some(p => p.test(text))) {
            const freezePhysics = this.config.physicsMode === 'freeze' ||
                (this.config.physicsMode === 'auto' && /do not move|don't move/i.test(text));
            this._freeze(freezePhysics, text);
        }
    }

    _freeze(disablePhysics, triggerText) {
        if (this.frozen) return;
        this.frozen = true;
        this._resumeReason = null;

        try {
            // Cancel any pathfinder goal so we don't walk.
            if (this.bot.pathfinder) {
                try { this.bot.pathfinder.setGoal(null); } catch (_) {}
                try { this.bot.pathfinder.stop(); } catch (_) {}
            }
            // Clear all movement control states.
            const controls = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];
            for (const c of controls) {
                try { this.bot.setControlState(c, false); } catch (_) {}
            }

            // Remember physics state and optionally disable physics so no
            // position packets are generated during a "do not move" check.
            this._physicsWas = this.bot.physicsEnabled;
            if (disablePhysics) {
                this.bot.physicsEnabled = false;
            }

            // Stop autoEat if it's trying to eat during verification.
            if (this.bot.autoEat) {
                try { this.bot.autoEat.disableAuto(); } catch (_) {}
            }

            Logger.verbose(`🧊 LimboFreeze: verification detected (${triggerText.slice(0, 60)}) — controls cleared, physics ${this.bot.physicsEnabled ? 'ON' : 'OFF'}.`);
        } catch (e) {
            Logger.error(`LimboFreeze freeze error: ${e.message}`);
        }

        // Normal auto-resume if the server never sends an explicit end message.
        const duration = Math.min(this.config.freezeDurationMs, this.config.maxFreezeMs);
        this._timer = setTimeout(() => {
            this._resumeReason = 'duration';
            Logger.warn(`🧊 LimboFreeze: ${duration}ms freeze duration reached, resuming.`);
            this._unfreeze();
        }, duration);
        if (this._timer.unref) this._timer.unref();

        // Hard safety cap.
        if (duration < this.config.maxFreezeMs) {
            this._maxTimer = setTimeout(() => {
                this._resumeReason = 'max-timeout';
                Logger.warn('🧊 LimboFreeze: max freeze time reached, forcing resume.');
                this._unfreeze();
            }, this.config.maxFreezeMs);
            if (this._maxTimer.unref) this._maxTimer.unref();
        }
    }

    _unfreeze() {
        if (!this.frozen) return;
        this.frozen = false;

        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }

        try {
            if (this._physicsWas !== undefined && this.bot) {
                this.bot.physicsEnabled = this._physicsWas;
            }
            Logger.verbose(`🧊 LimboFreeze: resumed (reason: ${this._resumeReason || 'unknown'}).`);
        } catch (e) {
            Logger.error(`LimboFreeze unfreeze error: ${e.message}`);
        }
    }
}

module.exports = { LimboFreeze, resolveConfig };
