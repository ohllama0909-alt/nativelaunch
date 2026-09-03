const { pathfinder, goals } = require('mineflayer-pathfinder');
const { createBestMovements } = require('../utils/movements.js');
const Vec3 = require('vec3');
const Logger = require('../utils/logger.js');

const SWORD_TIERS = [
    'netherite_sword',
    'diamond_sword',
    'iron_sword',
    'stone_sword',
    'golden_sword',
    'wooden_sword'
];

class Fight {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
        this.initialized = false;

        this.running = false;
        this.targetName = null;
        this.attackRange = 5;
        this.followRange = 2;

        this._tick = null;
        this._reacquireTimer = null;
        this._lastAttackTime = 0;
        this._cooldownTicks = 10;
        this._cooldownSet = false;
        this._jumpTick = 0;

        this._onEntityGone = this._onEntityGone.bind(this);
        this._onPlayerSpawn = this._onPlayerSpawn.bind(this);
        this._onCooldown = this._onCooldown.bind(this);

        this._client = bot._client;
        this._client.on('set_cooldown', this._onCooldown);
    }

    init() {
        if (this.initialized) return;
        try { this.bot.loadPlugin(pathfinder); } catch (e) {}
        try {
            const movements = createBestMovements(this.bot, null, { canDig: false });
            this.bot.pathfinder.setMovements(movements);
            this.initialized = true;
        } catch (e) {}
    }

    start(name) {
        if (!name) { Logger.error('Usage: !fight <player>'); return; }
        if (!this.initialized) this.init();
        if (!this.initialized) return;

        this.stop();

        const player = this._resolvePlayer(name);
        const canonical = player ? player.username : name;

        if (player && player.username.toLowerCase() === this.bot.username.toLowerCase()) {
            Logger.error("Can't fight myself.");
            return;
        }

        this.bot.pathfinder.setMovements(createBestMovements(this.bot, null, { canDig: false }));

        this.targetName = canonical;
        this.running = true;
        this._cooldownSet = false;

        this.bot.removeListener('entityGone', this._onEntityGone);
        this.bot.removeListener('playerJoined', this._onPlayerSpawn);
        this.bot.on('entityGone', this._onEntityGone);
        this.bot.on('playerJoined', this._onPlayerSpawn);

        this.equipBestSword();

        if (player && player.entity) {
            this._lockFollow(player.entity);
            Logger.system(`KillAura on ${canonical}`);
        } else {
            Logger.system(`Hunting ${canonical}...`);
            this._startReacquire();
        }

        this.bot.setControlState('sprint', true);
        this._tick = setInterval(() => this._tickLoop(), 50);
    }

    stop() {
        if (!this.running) return;
        const who = this.targetName;
        this.running = false;

        if (this._tick) { clearInterval(this._tick); this._tick = null; }

        this.bot.setControlState('sprint', false);
        this.bot.setControlState('jump', false);

        this.bot.removeListener('entityGone', this._onEntityGone);
        this.bot.removeListener('playerJoined', this._onPlayerSpawn);

        try { this.bot.pathfinder.setGoal(null); } catch (e) {}
        try { this.bot.pathfinder.stop(); } catch (e) {}
        this.bot.clearControlStates?.();
        this._stopReacquire();

        Logger.system(`KillAura off (${who || 'player'}).`);
    }

    showStatus() {
        if (this.running) {
            const ent = this.targetName ? this._resolvePlayer(this.targetName)?.entity : null;
            Logger.system(`Fight: KA on ${this.targetName} — ${ent ? 'locked' : 'hunting'}`);
        } else {
            Logger.system('Fight: idle');
        }
    }

    _lockFollow(entity) {
        const goal = new goals.GoalFollow(entity, this.followRange);
        this.bot.pathfinder.setGoal(goal, true);
        this.bot.setControlState('sprint', true);
    }

    _onCooldown(packet) {
        if (!this.running) return;
        const held = this.bot.heldItem;
        if (!held || held.type !== packet.itemID) return;
        this._cooldownTicks = packet.cooldownTicks;
        this._cooldownSet = true;
    }

    _tickLoop() {
        if (!this.running || !this.bot?.entity) return;

        const victim = this._resolvePlayer(this.targetName);
        const ent = victim?.entity;
        if (!ent) return;

        const p = this.bot.entity.position;
        const tp = ent.position;
        const dist = p.distanceTo(tp);

        // snap aim to chest
        this.bot.lookAt(new Vec3(tp.x, tp.y + 1.55, tp.z), true).catch(() => {});

        // jump crits
        if (dist <= 3.2 && this.bot.entity.onGround) {
            this.bot.setControlState('jump', true);
        } else if (dist > 3.5) {
            this.bot.setControlState('jump', false);
        }

        // keep sprint
        this.bot.setControlState('sprint', true);

        // kill-aura: swing the instant cooldown allows
        if (this._canAttack()) {
            this._attack(ent);
        }
    }

    _attack(entity) {
        this.bot.attack(entity);
        this._lastAttackTime = Date.now();
        this._cooldownSet = false;
    }

    _canAttack() {
        if (!this._cooldownSet) return true;
        const ms = this._cooldownTicks * 50;
        return Date.now() - this._lastAttackTime >= ms;
    }

    _findEntity(name) {
        const lower = name.toLowerCase();
        for (const e of Object.values(this.bot.entities || {})) {
            if (e.type === 'player' && e.username && e.username.toLowerCase() === lower) return e;
        }
        return null;
    }

    equipBestSword() {
        if (!this.bot) return null;
        const items = this.bot.inventory.items();

        for (const tier of SWORD_TIERS) {
            const sword = items.find(item => item.name === tier);
            if (sword) {
                this.bot.equip(sword, 'hand').catch(() => {});
                return sword;
            }
        }

        const anySword = items.find(item => item.name.includes('sword'));
        if (anySword) {
            this.bot.equip(anySword, 'hand').catch(() => {});
            return anySword;
        }

        return null;
    }

    _resolvePlayer(name) {
        const lower = String(name).toLowerCase();
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
            try { this.bot.pathfinder.setGoal(null); } catch (e) {}
            this._startReacquire();
        }
    }

    _onPlayerSpawn() {
        if (!this.running) return;
        const player = this._resolvePlayer(this.targetName);
        if (player && player.entity) {
            this._lockFollow(player.entity);
        }
    }

    _startReacquire() {
        if (this._reacquireTimer) return;
        this._reacquireTimer = setInterval(() => {
            if (!this.running) { this._stopReacquire(); return; }
            const player = this._resolvePlayer(this.targetName);
            if (player && player.entity) {
                this._lockFollow(player.entity);
            }
        }, 500);
    }

    _stopReacquire() {
        if (this._reacquireTimer) { clearInterval(this._reacquireTimer); this._reacquireTimer = null; }
    }
}

module.exports = { Fight };
