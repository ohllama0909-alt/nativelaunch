/**
 * 🍌 Follower — walk after a player and keep up with them.
 *
 * Uses pathfinder's dynamic GoalFollow so the path is recomputed as the target
 * moves. Survives the target stepping out of render range: it parks, watches
 * for the player to come back, and re-locks on automatically.
 */

const { pathfinder, goals } = require('mineflayer-pathfinder');
const { createBestMovements } = require('../utils/movements.js');
const Logger = require('../utils/logger.js');

class Follower {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
        this.initialized = false;

        this.running = false;
        this.targetName = null;     // canonical username we're following
        this.range = 2;             // how close to trail (blocks)

        this._onEntityGone = this._onEntityGone.bind(this);
        this._onPlayerSpawn = this._onPlayerSpawn.bind(this);
        this._reacquireTimer = null;
    }

    init() {
        if (this.initialized) return;
        try {
            this.bot.loadPlugin(pathfinder);
        } catch (e) { /* already loaded */ }

        try {
            // Following a player shouldn't tear up the world — keep digging off
            // so we don't grief terrain or trip anti-cheat while chasing.
            const movements = createBestMovements(this.bot, null, { canDig: false });
            this.bot.pathfinder.setMovements(movements);
            this.initialized = true;
            Logger.system('Follower: Ready');
        } catch (err) {
            Logger.error(`Follower init failed: ${err.message}`);
        }
    }

    /**
     * Start following a player by (case-insensitive) name.
     * @param {string} name
     * @param {number} [range]
     */
    follow(name, range) {
        if (!name) { Logger.error('Usage: !follow <player>'); return; }
        if (!this.initialized) this.init();
        if (!this.initialized) return;

        if (range && !isNaN(range) && range > 0) this.range = Math.min(range, 16);

        const player = this._resolvePlayer(name);
        const canonical = player ? player.username : name;

        if (player && player.username.toLowerCase() === this.bot.username.toLowerCase()) {
            Logger.error("Can't follow myself.");
            return;
        }

        // Pathfinder shares one movements config across modules — re-assert ours
        // in case a mining/collecting module left digging enabled.
        this.bot.pathfinder.setMovements(createBestMovements(this.bot, null, { canDig: false }));

        this.targetName = canonical;
        this.running = true;

        // Re-acquire hooks: if the target unloads we wait for them to return.
        this.bot.removeListener('entityGone', this._onEntityGone);
        this.bot.removeListener('playerJoined', this._onPlayerSpawn);
        this.bot.on('entityGone', this._onEntityGone);
        this.bot.on('playerJoined', this._onPlayerSpawn);

        if (player && player.entity) {
            this._lockOn(player.entity);
            Logger.system(`🏃 Following ${canonical} (range ${this.range}).`);
        } else {
            // Player is online but not in render distance (or not seen yet).
            Logger.system(`🏃 Following ${canonical} — waiting for them to come into range...`);
            this._startReacquire();
        }
    }

    unfollow() {
        if (!this.running) { Logger.system('Not following anyone.'); return; }
        const who = this.targetName;
        this.running = false;
        this.targetName = null;

        this.bot.removeListener('entityGone', this._onEntityGone);
        this.bot.removeListener('playerJoined', this._onPlayerSpawn);
        this._stopReacquire();

        try { this.bot.pathfinder.setGoal(null); } catch (e) { }
        try { this.bot.pathfinder.stop(); } catch (e) { }
        this.bot.clearControlStates?.();
        Logger.system(`🛑 Stopped following ${who || 'player'}.`);
    }

    showStatus() {
        if (this.running) {
            const ent = this.targetName ? this._resolvePlayer(this.targetName)?.entity : null;
            Logger.system(`Follower: following ${this.targetName} (range ${this.range}) — ${ent ? 'in range' : 'waiting for target'}`);
        } else {
            Logger.system('Follower: idle');
        }
    }

    // ── internals ───────────────────────────────────────────────────────

    _lockOn(entity) {
        // Dynamic goal: pathfinder recomputes as the entity moves.
        const goal = new goals.GoalFollow(entity, this.range);
        this.bot.pathfinder.setGoal(goal, true);
        this._stopReacquire();
    }

    _resolvePlayer(name) {
        const lower = String(name).toLowerCase();
        // Exact (case-insensitive) match first, then prefix as a convenience.
        const players = Object.values(this.bot.players || {});
        return (
            players.find(p => p.username.toLowerCase() === lower) ||
            players.find(p => p.username.toLowerCase().startsWith(lower)) ||
            null
        );
    }

    _onEntityGone(entity) {
        if (!this.running || !entity || entity.type !== 'player') return;
        if (entity.username && entity.username.toLowerCase() === this.targetName.toLowerCase()) {
            Logger.system(`👀 Lost sight of ${this.targetName} — will re-follow when they return.`);
            try { this.bot.pathfinder.setGoal(null); } catch (e) { }
            this._startReacquire();
        }
    }

    _onPlayerSpawn() {
        if (!this.running) return;
        const player = this._resolvePlayer(this.targetName);
        if (player && player.entity) this._lockOn(player.entity);
    }

    // Poll for the target's entity to (re)appear. GoalFollow needs a live
    // entity object; players coming into render distance don't always fire a
    // clean event, so a light poll is the reliable path.
    _startReacquire() {
        if (this._reacquireTimer) return;
        this._reacquireTimer = setInterval(() => {
            if (!this.running) { this._stopReacquire(); return; }
            const player = this._resolvePlayer(this.targetName);
            if (player && player.entity) {
                Logger.system(`🎯 Re-locked on ${this.targetName}.`);
                this._lockOn(player.entity);
            }
        }, 1000);
    }

    _stopReacquire() {
        if (this._reacquireTimer) { clearInterval(this._reacquireTimer); this._reacquireTimer = null; }
    }
}

module.exports = { Follower };
