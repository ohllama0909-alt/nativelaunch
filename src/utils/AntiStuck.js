/**
 * 🍌 AntiStuck — keep the pathfinder from ever staying stuck.
 *
 * mineflayer-pathfinder usually finds a route, but bots still get physically
 * wedged: caught on a block edge, bumped by a mob, a path that goes stale when
 * the world changes, or a `noPath`/`timeout` plan. This watchdog watches for
 * "the pathfinder thinks it's moving but the body isn't" and runs an escalating
 * recovery (jump → nudge → jitter → full replan) until progress resumes.
 *
 * It is GLOBAL: attach one instance to the bot and it covers every module that
 * uses pathfinder (GoTo, Follower, miners, collectors). It self-gates on
 * `pathfinder.isMoving()`, so it does nothing while the bot is idle.
 */

const { goals } = require('mineflayer-pathfinder');
const Logger = require('./logger.js');

class AntiStuck {
    /**
     * @param {import('mineflayer').Bot} bot
     * @param {object} [opts]
     * @param {number} [opts.checkInterval=500]  how often to sample position (ms)
     * @param {number} [opts.stuckTime=2500]     no-progress time before recovering (ms)
     * @param {number} [opts.minProgress=0.45]   blocks of movement that counts as progress
     * @param {boolean}[opts.digEscape=false]    allow breaking blocks as a last resort
     */
    constructor(bot, opts = {}) {
        this.bot = bot;
        this.checkInterval = opts.checkInterval ?? 500;
        this.stuckTime = opts.stuckTime ?? 2500;
        this.minProgress = opts.minProgress ?? 0.45;
        this.digEscape = opts.digEscape ?? false;

        this.enabled = false;
        this._timer = null;
        this._lastPos = null;
        this._stuckSince = 0;
        this._recoveries = 0;       // consecutive recovery attempts w/o progress
        this._recovering = false;
        this._noPathRetries = 0;

        this._onPathUpdate = this._onPathUpdate.bind(this);
        this._onGoalReached = this._onGoalReached.bind(this);
        this._onGoalUpdated = this._onGoalUpdated.bind(this);
    }

    start() {
        if (this.enabled) return;
        this.enabled = true;
        this._lastPos = this.bot.entity?.position?.clone?.() ?? null;
        this._stuckSince = 0;
        this._recoveries = 0;

        this.bot.on('path_update', this._onPathUpdate);
        this.bot.on('goal_reached', this._onGoalReached);
        this.bot.on('goal_updated', this._onGoalUpdated);

        this._timer = setInterval(() => this._tick(), this.checkInterval);
        if (this._timer.unref) this._timer.unref();
        Logger.system('🧭 AntiStuck: watching pathfinder.');
    }

    stop() {
        if (!this.enabled) return;
        this.enabled = false;
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this.bot.removeListener('path_update', this._onPathUpdate);
        this.bot.removeListener('goal_reached', this._onGoalReached);
        this.bot.removeListener('goal_updated', this._onGoalUpdated);
    }

    // ── monitoring ──────────────────────────────────────────────────────

    _tick() {
        const pf = this.bot.pathfinder;
        if (!pf || !this.bot.entity) return;

        // Only judge "stuck" while the pathfinder is actively trying to move.
        // Mining/placing legitimately holds position, so don't fight those.
        if (!pf.isMoving() || pf.isMining?.() || pf.isBuilding?.()) {
            this._resetProgress();
            return;
        }

        const pos = this.bot.entity.position;
        if (!this._lastPos) { this._lastPos = pos.clone(); return; }

        const moved = pos.distanceTo(this._lastPos);
        const now = Date.now();

        if (moved >= this.minProgress) {
            // Real progress — clear the stuck state and de-escalate.
            this._lastPos = pos.clone();
            this._stuckSince = 0;
            if (this._recoveries) Logger.system('🧭 AntiStuck: movement resumed.');
            this._recoveries = 0;
            this._noPathRetries = 0;
            this._restoreDig();
            return;
        }

        // Barely moved. Start (or continue) the stuck clock.
        if (!this._stuckSince) { this._stuckSince = now; return; }
        if (now - this._stuckSince >= this.stuckTime && !this._recovering) {
            this._recover();
        }
    }

    _resetProgress() {
        this._lastPos = this.bot.entity?.position?.clone?.() ?? this._lastPos;
        this._stuckSince = 0;
    }

    // ── recovery ────────────────────────────────────────────────────────

    async _recover() {
        const pf = this.bot.pathfinder;
        const goal = pf?.goal;
        if (!goal) { this._stuckSince = 0; return; }

        this._recovering = true;
        const level = this._recoveries;
        this._recoveries++;
        Logger.system(`🧭 AntiStuck: stuck — recovery #${this._recoveries} (level ${level}).`);

        try {
            const dynamic = goal instanceof goals.GoalFollow;

            if (level === 0) {
                // Smallest nudge: hop and recompute. Clears most edge snags.
                await this._jump(300);
                this._replan(goal, dynamic);
            } else if (level === 1) {
                // Clear stale controls, sprint-hop forward, recompute.
                this.bot.clearControlStates?.();
                await this._nudge('forward', 450, true);
                this._replan(goal, dynamic);
            } else if (level === 2) {
                // Jitter sideways to slip past whatever we're caught on.
                const dir = Math.random() < 0.5 ? 'left' : 'right';
                await this._nudge(dir, 450, false);
                await this._jump(250);
                this._replan(goal, dynamic);
            } else if (level === 3 && this.digEscape) {
                // Last resort: let it break out of an enclosure, then recompute.
                this._enableDig();
                this._replan(goal, dynamic);
            } else {
                // Full reset: drop the path, settle, then re-issue from scratch.
                this.bot.clearControlStates?.();
                try { pf.setGoal(null); } catch (e) { }
                await this._sleep(500);
                this._replan(goal, dynamic);
                // Keep escalation bounded so it doesn't grow forever; cycle the
                // reset behaviour instead of giving up.
                if (this._recoveries > 6) this._recoveries = (this.digEscape ? 3 : 2);
            }
        } catch (err) {
            Logger.error(`AntiStuck recovery error: ${err.message}`);
        } finally {
            // Reset the stuck clock; the next tick re-evaluates progress.
            this._stuckSince = Date.now();
            this._recovering = false;
        }
    }

    _replan(goal, dynamic) {
        try {
            // Re-setting the goal forces pathfinder to recompute the route.
            this.bot.pathfinder.setGoal(goal, dynamic);
        } catch (e) { /* goal may have been cleared meanwhile */ }
    }

    async _jump(ms) {
        try {
            this.bot.setControlState('jump', true);
            await this._sleep(ms);
            this.bot.setControlState('jump', false);
        } catch (e) { }
    }

    async _nudge(control, ms, sprint) {
        try {
            if (sprint) this.bot.setControlState('sprint', true);
            this.bot.setControlState(control, true);
            this.bot.setControlState('jump', true);
            await this._sleep(ms);
            this.bot.setControlState(control, false);
            this.bot.setControlState('jump', false);
            if (sprint) this.bot.setControlState('sprint', false);
        } catch (e) { }
    }

    _enableDig() {
        const m = this.bot.pathfinder?.movements;
        if (m && !m.canDig) {
            this._digWasOff = true;
            m.canDig = true;
            Logger.system('🧭 AntiStuck: temporarily allowing dig to escape.');
        }
    }

    _restoreDig() {
        if (this._digWasOff) {
            const m = this.bot.pathfinder?.movements;
            if (m) m.canDig = false;
            this._digWasOff = false;
        }
    }

    // ── events ──────────────────────────────────────────────────────────

    _onPathUpdate(results) {
        if (!results) return;
        if (results.status === 'noPath') {
            // No route found. Retry a few times (the world/chunks may still be
            // loading), then leave it — escalation/replan keeps trying anyway.
            const goal = this.bot.pathfinder?.goal;
            if (!goal) return;
            if (this._noPathRetries < 4) {
                this._noPathRetries++;
                const dynamic = goal instanceof goals.GoalFollow;
                setTimeout(() => this._replan(goal, dynamic), 800);
            } else {
                Logger.system('🧭 AntiStuck: no path after retries — will keep watching.');
            }
        } else if (results.status === 'success') {
            this._noPathRetries = 0;
        }
    }

    _onGoalReached() {
        this._stuckSince = 0;
        this._recoveries = 0;
        this._noPathRetries = 0;
        this._restoreDig();
    }

    _onGoalUpdated() {
        // New goal: reset the stuck tracking against the fresh destination.
        this._lastPos = this.bot.entity?.position?.clone?.() ?? null;
        this._stuckSince = 0;
        this._recoveries = 0;
        this._noPathRetries = 0;
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = { AntiStuck };
