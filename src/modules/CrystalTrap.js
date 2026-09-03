/**
 * 🍌 BananaMoney Lite - Crystal Trap Module
 * Keeps an end crystal placed on a configured obsidian block, and detonates
 * it (punches the crystal) when enough players are detected nearby.
 * Re-places the crystal after every detonation while running.
 *
 * Safety loops while running:
 *  - Health gate: below minHealth (default 14 HP = 7 hearts) it eats and
 *    waits for regen instead of crystalling.
 *  - Trash sell: when the inventory holds anything that isn't food, end
 *    crystals or a totem, it opens /sell, deposits the trash, then resumes.
 */

const Logger = require('../utils/logger.js');
const Vec3 = require('vec3');

// Fallback food matcher for when bot.registry food data isn't available
const FOOD_NAMES = [
    'apple', 'bread', 'carrot', 'potato', 'beef', 'porkchop', 'chicken',
    'mutton', 'rabbit', 'cod', 'salmon', 'melon_slice', 'cookie', 'stew',
    'soup', 'pie', 'berries', 'chorus_fruit', 'dried_kelp', 'honey_bottle'
];

class CrystalTrap {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
        this.running = false;
        this.busy = false; // Prevent overlapping place/detonate/eat/sell actions
        this.interval = null;

        // Defaults, overridable via config.crystal / !crystal commands
        this.pos = null;             // { x, y, z } of the obsidian block
        this.playerThreshold = 10;   // detonate at this many players nearby
        this.radius = 6;             // "nearby" = within this many blocks of the crystal
        this.minHealth = 14;         // 7 hearts — below this, eat instead of crystalling
        this.tickInterval = 500;
        this.rearmDelay = 1500;      // pause after a detonation before re-placing
        this.sellCooldown = 30000;   // min gap between /sell cycles

        this.stats = { placed: 0, detonations: 0, sellCycles: 0 };
        this._lastPlaceAttempt = 0;
        this._lastSell = 0;
        this._lastErrorLog = 0;
        this._lastHealLog = 0;

        this.loadConfig();
    }

    loadConfig() {
        const o = this.config.crystal;
        if (!o) return;
        if (o.pos && typeof o.pos.x === 'number') this.pos = { x: o.pos.x, y: o.pos.y, z: o.pos.z };
        if (typeof o.playerThreshold === 'number') this.playerThreshold = o.playerThreshold;
        if (typeof o.radius === 'number') this.radius = o.radius;
        if (typeof o.minHealth === 'number') this.minHealth = o.minHealth;
        if (typeof o.rearmDelay === 'number') this.rearmDelay = o.rearmDelay;
        if (typeof o.sellCooldown === 'number') this.sellCooldown = o.sellCooldown;
    }

    start() {
        if (this.running) {
            Logger.system('Crystal Trap is already running.');
            return;
        }
        if (!this.pos) {
            Logger.error('💥 Crystal Trap: No obsidian position set. Use !crystal pos <x> <y> <z> first.');
            return;
        }

        this.running = true;
        Logger.system(`💥 Crystal Trap: STARTED (obsidian at ${this.pos.x},${this.pos.y},${this.pos.z} — detonate at ${this.playerThreshold} players within ${this.radius} blocks, min ${this.minHealth / 2} hearts)`);

        this.interval = setInterval(() => {
            this.tick().catch(err => Logger.error(`💥 Crystal Trap error: ${err.message}`));
        }, this.tickInterval);
    }

    stop() {
        const was = this.running;
        this.running = false;
        this.busy = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        if (was) Logger.system('💥 Crystal Trap: STOPPED');
    }

    showStatus() {
        if (!this.pos) {
            Logger.system('💥 Crystal Trap: no position set (!crystal pos <x> <y> <z>)');
            return;
        }
        const crystal = this.findCrystal();
        const nearby = this.countNearbyPlayers();
        const trash = this.getTrashItems().length;
        Logger.system(`💥 Crystal Trap: ${this.running ? 'RUNNING' : 'stopped'}`);
        Logger.info(`   Obsidian: ${this.pos.x},${this.pos.y},${this.pos.z} | crystal placed: ${crystal ? 'yes' : 'no'}`);
        Logger.info(`   Players nearby: ${nearby}/${this.playerThreshold} (radius ${this.radius})`);
        Logger.info(`   HP: ${this.bot?.health !== undefined ? Math.round(this.bot.health) : '?'}/20 (min to crystal: ${this.minHealth}) | trash stacks: ${trash}`);
        Logger.info(`   Placed: ${this.stats.placed} | Detonations: ${this.stats.detonations} | Sell cycles: ${this.stats.sellCycles}`);
    }

    // Center of the space the crystal occupies (block above the obsidian)
    crystalCenter() {
        return new Vec3(this.pos.x + 0.5, this.pos.y + 1, this.pos.z + 0.5);
    }

    findCrystal() {
        if (!this.bot || !this.bot.entities || !this.pos) return null;
        const center = this.crystalCenter();
        for (const e of Object.values(this.bot.entities)) {
            const name = (e.name || '').toLowerCase();
            if (name !== 'end_crystal' && name !== 'ender_crystal') continue;
            if (e.position && e.position.distanceTo(center) <= 1.5) return e;
        }
        return null;
    }

    countNearbyPlayers() {
        if (!this.bot || !this.bot.entities || !this.pos) return 0;
        const center = this.crystalCenter();
        let count = 0;
        for (const e of Object.values(this.bot.entities)) {
            if (e.type !== 'player') continue;
            if (e.username && e.username === this.bot.username) continue;
            if (e.position && e.position.distanceTo(center) <= this.radius) count++;
        }
        return count;
    }

    // ─── Item classification ────────────────────────────────────────────

    isFood(item) {
        if (!item) return false;
        // Registry knows exactly which items are edible
        const foods = this.bot.registry && this.bot.registry.foods;
        if (foods && foods[item.type]) return true;
        const name = (item.name || '').toLowerCase();
        if (name.includes('golden_apple')) return true;
        return FOOD_NAMES.some(f => name === f || name === `cooked_${f}` || name.includes(f));
    }

    isKeepItem(item) {
        if (!item) return true;
        const name = (item.name || '').toLowerCase();
        if (name === 'end_crystal') return true;
        if (name === 'totem_of_undying') return true; // never sell totems
        return this.isFood(item);
    }

    getTrashItems() {
        if (!this.bot || !this.bot.inventory) return [];
        return this.bot.inventory.items().filter(i => !this.isKeepItem(i));
    }

    // ─── Main loop ───────────────────────────────────────────────────────

    async tick() {
        if (!this.running || this.busy) return;
        if (!this.bot || !this.bot.entity) return;

        this.busy = true;
        try {
            const crystal = this.findCrystal();
            const nearby = this.countNearbyPlayers();
            const health = this.bot.health !== undefined ? this.bot.health : 20;

            // 1. Trigger condition met — but never crystal below minHealth: eat first
            if (crystal && nearby >= this.playerThreshold) {
                if (health >= this.minHealth) {
                    Logger.system(`💥 ${nearby} players detected — detonating crystal!`);
                    await this.detonate(crystal);
                } else {
                    await this.healUp(health, true);
                }
                return;
            }

            // 2. Low health while idle: heal up before anything else
            if (health < this.minHealth) {
                await this.healUp(health, false);
                return;
            }

            // 3. Trash in inventory: pause, /sell it, then resume crystalling
            if (!this.bot.currentWindow && this.getTrashItems().length > 0 &&
                Date.now() - this._lastSell >= this.sellCooldown) {
                await this.sellTrash();
                return;
            }

            // 4. Keep the trap armed
            if (!crystal) await this.placeCrystal();
        } finally {
            this.busy = false;
        }
    }

    // ─── Health gate ─────────────────────────────────────────────────────

    async healUp(health, wantedToDetonate) {
        const now = Date.now();
        if (now - this._lastHealLog > 5000) {
            this._lastHealLog = now;
            Logger.system(`💥 HP ${Math.round(health)}/20 < ${this.minHealth} — eating${wantedToDetonate ? ' before detonating' : ''}...`);
        }

        // Full hunger = can't eat, but natural regen is already healing us
        if (this.bot.food !== undefined && this.bot.food >= 20) return;

        const foodItem = this.bot.inventory.items().find(i => this.isFood(i));
        if (!foodItem) {
            this._logThrottled('💥 Low HP but no food in inventory!');
            return;
        }

        try {
            if (this.bot.autoEat && typeof this.bot.autoEat.eat === 'function') {
                await this.bot.autoEat.eat();
            } else {
                await this.bot.equip(foodItem, 'hand');
                await this.bot.consume();
            }
        } catch (e) {
            // "Food is full" and similar are expected noise while regenerating
            this._logThrottled(`💥 Eat failed: ${e.message}`);
        }
    }

    // ─── Trash selling ───────────────────────────────────────────────────

    async sellTrash() {
        this._lastSell = Date.now();
        const trashCount = this.getTrashItems().length;
        Logger.system(`💰 ${trashCount} trash stack(s) in inventory — opening /sell...`);
        this.bot.chat('/sell');

        const window = await this.waitForWindow(5000);
        if (!window) {
            Logger.error('💰 /sell did not open in time');
            return;
        }

        await this.sleep(500);
        const currentWindow = this.bot.currentWindow;
        if (!currentWindow) return;

        // Player inventory slots start after the container slots
        const containerSlotCount = currentWindow.inventoryStart || 54;

        let deposited = 0;
        for (let i = containerSlotCount; i < currentWindow.slots.length && this.running; i++) {
            const slot = currentWindow.slots[i];
            if (!slot || !slot.name) continue;
            if (this.isKeepItem(slot)) continue; // keep food, crystals, totems

            try {
                await this.bot.clickWindow(i, 0, 1); // Shift-click into sell GUI
                deposited++;
                await this.sleep(150);
            } catch (e) {
                Logger.error(`💰 Failed to move ${slot.name} to /sell: ${e.message}`);
            }
        }

        this.stats.sellCycles++;
        Logger.system(`💰 Put ${deposited} stack(s) into /sell. Closing & resuming crystalling...`);

        await this.sleep(300);
        this.closeWindow();
        await this.sleep(500);
    }

    // ─── Crystal actions ─────────────────────────────────────────────────

    async placeCrystal() {
        // Don't spam placement attempts every tick
        const now = Date.now();
        if (now - this._lastPlaceAttempt < this.rearmDelay) return;
        this._lastPlaceAttempt = now;

        // Never place through an open GUI
        if (this.bot.currentWindow) return;

        const block = this.bot.blockAt(new Vec3(this.pos.x, this.pos.y, this.pos.z));
        if (!block) return; // Chunk not loaded (too far away / just respawned)

        const bname = (block.name || '').toLowerCase();
        if (!bname.includes('obsidian') && !bname.includes('bedrock')) {
            this._logThrottled(`💥 Block at ${this.pos.x},${this.pos.y},${this.pos.z} is "${block.name}", not obsidian — cannot place crystal.`);
            return;
        }

        if (this.bot.entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5)) > 4.5) {
            this._logThrottled('💥 Obsidian is out of reach — move the bot closer.');
            return;
        }

        const item = this.bot.inventory.items().find(i => (i.name || '').toLowerCase() === 'end_crystal');
        if (!item) {
            this._logThrottled('💥 No end crystals in inventory!');
            return;
        }

        try {
            if (this.bot.heldItem?.name !== 'end_crystal') await this.bot.equip(item, 'hand');
            await this.bot.lookAt(block.position.offset(0.5, 1, 0.5), true);
            await this.bot.activateBlock(block);
            this.stats.placed++;
            Logger.system(`💥 Crystal placed on obsidian (${this.pos.x},${this.pos.y},${this.pos.z}). Armed — waiting for ${this.playerThreshold} players.`);
        } catch (e) {
            this._logThrottled(`💥 Failed to place crystal: ${e.message}`);
        }
    }

    async detonate(crystal) {
        try {
            await this.bot.lookAt(crystal.position, true);
            this.bot.attack(crystal);
            this.stats.detonations++;
            Logger.system(`💥 BOOM! Detonation #${this.stats.detonations}. Re-arming in ${this.rearmDelay / 1000}s...`);
            this._lastPlaceAttempt = Date.now(); // rearmDelay applies before re-place
        } catch (e) {
            Logger.error(`💥 Failed to hit crystal: ${e.message}`);
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    waitForWindow(timeout) {
        return new Promise((resolve) => {
            if (this.bot.currentWindow) {
                resolve(this.bot.currentWindow);
                return;
            }

            const timer = setTimeout(() => {
                this.bot.removeListener('windowOpen', onOpen);
                resolve(null);
            }, timeout);

            const onOpen = (window) => {
                clearTimeout(timer);
                resolve(window);
            };

            this.bot.once('windowOpen', onOpen);
        });
    }

    closeWindow() {
        try {
            if (this.bot.currentWindow) this.bot.closeWindow(this.bot.currentWindow);
        } catch (e) { }
    }

    _logThrottled(msg) {
        const now = Date.now();
        if (now - this._lastErrorLog < 10000) return;
        this._lastErrorLog = now;
        Logger.error(msg);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { CrystalTrap };
