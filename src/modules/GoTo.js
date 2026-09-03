/**
 * 🍌 GoTo — set a position and walk to it, then stop.
 *
 * A one-shot navigator: give it x/y/z and it paths there using pathfinder,
 * stops cleanly on arrival, and can be cancelled mid-walk at any time. Unlike
 * Follower (which tracks a moving entity), GoTo locks a fixed destination.
 */

const { pathfinder, goals } = require('mineflayer-pathfinder');
const { createBestMovements } = require('../utils/movements.js');
const Logger = require('../utils/logger.js');

class GoTo {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
        this.initialized = false;

        this.running = false;
        this.target = null;     // { x, y, z }
        this.range = 1;         // how close to the target counts as "arrived"
        this.savedSpot = null;  // { x, y, z } captured via setSpot()

        this._onGoalReached = this._onGoalReached.bind(this);
    }

    init() {
        if (this.initialized) return;
        try {
            this.bot.loadPlugin(pathfinder);
        } catch (e) { /* already loaded */ }

        try {
            // Don't tear up terrain just to reach a spot — keep digging off so
            // we don't grief the world or trip anti-cheat.
            const movements = createBestMovements(this.bot, null, { canDig: false });
            this.bot.pathfinder.setMovements(movements);
            this.initialized = true;
            Logger.system('GoTo: Ready');
        } catch (err) {
            Logger.error(`GoTo init failed: ${err.message}`);
        }
    }

    /**
     * Start walking to a fixed position.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} [range] how close (blocks) before stopping. Default 1.
     */
    goto(x, y, z, range) {
        if ([x, y, z].some(n => isNaN(n))) {
            Logger.error('Usage: !goto <x> <y> <z> [range]');
            return;
        }
        if (!this.initialized) this.init();
        if (!this.initialized) return;

        if (range != null && !isNaN(range) && range >= 0) this.range = Math.min(range, 64);

        this.target = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
        this.running = true;

        // Pathfinder shares one movements config across modules — re-assert ours
        // in case a mining/collecting module left digging enabled.
        this.bot.pathfinder.setMovements(createBestMovements(this.bot, null, { canDig: false }));

        // Re-arm the arrival listener (once: fires a single time per walk).
        this.bot.removeListener('goal_reached', this._onGoalReached);
        this.bot.once('goal_reached', this._onGoalReached);

        const goal = this.range > 0
            ? new goals.GoalNear(this.target.x, this.target.y, this.target.z, this.range)
            : new goals.GoalBlock(this.target.x, this.target.y, this.target.z);

        try {
            this.bot.pathfinder.setGoal(goal);
            Logger.system(`🚶 Walking to ${this.target.x}, ${this.target.y}, ${this.target.z} (range ${this.range}).`);
        } catch (err) {
            this.running = false;
            Logger.error(`GoTo failed to set goal: ${err.message}`);
        }
    }

    /**
     * Remember the bot's current position as the saved "go" spot, so a later
     * bare `!goto` walks back here.
     */
    setSpot() {
        const p = this.bot.entity?.position;
        if (!p) { Logger.error('GoTo: my position is unknown right now.'); return; }
        this.savedSpot = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
        Logger.system(`📍 Saved go-spot at ${this.savedSpot.x}, ${this.savedSpot.y}, ${this.savedSpot.z}. Use !goto to walk back here.`);
    }

    /** Walk to the saved spot, if one has been set. */
    gotoSaved(range) {
        if (!this.savedSpot) {
            Logger.error('No go-spot saved yet. Stand where you want and run !setgo first.');
            return;
        }
        this.goto(this.savedSpot.x, this.savedSpot.y, this.savedSpot.z, range);
    }

    stop() {
        if (!this.running) { Logger.system('GoTo: not walking anywhere.'); return; }
        const t = this.target;
        this.running = false;
        this.target = null;

        this.bot.removeListener('goal_reached', this._onGoalReached);
        try { this.bot.pathfinder.setGoal(null); } catch (e) { }
        try { this.bot.pathfinder.stop(); } catch (e) { }
        this.bot.clearControlStates?.();
        Logger.system(`🛑 Stopped walking${t ? ` to ${t.x}, ${t.y}, ${t.z}` : ''}.`);
    }

    showStatus() {
        if (this.running && this.target) {
            const p = this.bot.entity?.position;
            const dist = p
                ? Math.round(Math.hypot(p.x - this.target.x, p.y - this.target.y, p.z - this.target.z))
                : '?';
            Logger.system(`GoTo: walking to ${this.target.x}, ${this.target.y}, ${this.target.z} (range ${this.range}) — ~${dist} blocks away.`);
        } else {
            const saved = this.savedSpot
                ? ` — saved go-spot: ${this.savedSpot.x}, ${this.savedSpot.y}, ${this.savedSpot.z}`
                : ' — no go-spot saved';
            Logger.system(`GoTo: idle${saved}`);
        }
    }

    // ── internals ───────────────────────────────────────────────────────

    _onGoalReached() {
        if (!this.running) return;
        const t = this.target;
        this.running = false;
        this.target = null;
        this.bot.clearControlStates?.();
        Logger.system(`✅ Arrived${t ? ` at ${t.x}, ${t.y}, ${t.z}` : ''}.`);
    }
}

module.exports = { GoTo };
