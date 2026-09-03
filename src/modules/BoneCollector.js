/**
 * 🍌 BananaMoney Lite - Bone Collector Module
 * Using manual walking as fallback when pathfinder doesn't move
 */

const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
const Logger = require('../utils/logger.js');

class BoneCollector {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config.boneCollector || {};
        this.running = false;
        this.initialized = false;
        this.chestFull = false;
        this.mcData = null;
    }

    async init() {
        if (this.initialized) return;

        try {
            this.bot.loadPlugin(pathfinder);
        } catch (e) { }

        try {
            const mcDataModule = require('minecraft-data');
            this.mcData = mcDataModule(this.bot.version);

            const movements = new Movements(this.bot, this.mcData);
            movements.canDig = false;
            movements.allowParkour = false;
            movements.allowSprinting = false;

            this.bot.pathfinder.setMovements(movements);
            this.initialized = true;
            Logger.system('Bone Collector: Ready');
        } catch (err) {
            Logger.error(`Init failed: ${err.message}`);
        }
    }

    async start() {
        if (this.running) return;

        if (!this.initialized) await this.init();

        this.running = true;
        this.chestFull = false;
        Logger.system('🦴 Bone Collector: STARTED');

        while (this.running && !this.chestFull) {
            try {
                await this.collectCycle();
                if (this.running && !this.chestFull) {
                    Logger.system(`Waiting ${(this.config.cycleDelay || 15000) / 1000}s...`);
                    await this.sleep(this.config.cycleDelay || 15000);
                }
            } catch (err) {
                Logger.error(`Error: ${err.message}`);
                this.stopMovement();
                await this.sleep(3000);
            }
        }
    }

    stop() {
        const was = this.running;
        this.running = false;
        this.stopMovement();
        if (was) Logger.system('🦴 Bone Collector: STOPPED');
    }

    stopMovement() {
        try { this.bot.pathfinder.stop(); } catch (e) { }
        this.bot.setControlState('forward', false);
        this.bot.setControlState('sprint', false);
        this.bot.setControlState('jump', false);
    }

    async collectCycle() {
        this.stopMovement();
        await this.sleep(200);

        // Go to spawner
        Logger.system('→ Walking to spawner...');
        await this.walkToManual(this.config.spawnerPos);
        await this.sleep(500);

        // Open spawner
        Logger.system('→ Opening spawner...');
        await this.interactWithBlock(this.config.spawnerPos);
        await this.sleep(800);

        if (!this.bot.currentWindow) {
            Logger.error('Spawner menu failed');
            return;
        }

        // Click loot slot
        const slot = this.config.collectSlot ?? 13;
        Logger.system(`→ Clicking slot ${slot}...`);
        try { await this.bot.clickWindow(slot, 0, 0); } catch (e) { }
        await this.sleep(800);

        // Collect bones ONLY (no arrows)
        Logger.system('→ Collecting bones...');
        const collected = await this.shiftClickAllBones();
        Logger.system(`Got ${collected} stacks`);

        // Click gold ingot to sell all (clears arrows so bones have room next cycle)
        Logger.system('→ Clicking sell all (gold ingot)...');
        await this.clickSellAll();
        await this.sleep(500);

        this.closeCurrentWindow();
        await this.sleep(500);

        // Go to chest
        Logger.system('→ Walking to chest...');
        await this.walkToManual(this.config.chestPos);
        await this.sleep(500);

        // Deposit
        Logger.system('→ Depositing...');
        await this.depositViaShiftClick();

        // Run /sell all command after depositing
        Logger.system('→ Running /sell all command...');
        this.bot.chat('/sell all');
        await this.sleep(1000);
    }

    /**
     * Manual walking - look at target and walk forward
     */
    async walkToManual(pos) {
        if (!pos) return;

        const targetVec = new Vec3(pos.x, pos.y, pos.z);
        const startTime = Date.now();
        const timeout = 20000;

        // Check if we are already close enough before starting
        if (this.bot.entity.position.distanceTo(targetVec) < 3.5) {
            Logger.system('Already at target!');
            return;
        }

        while (this.running && (Date.now() - startTime) < timeout) {
            const botPos = this.bot.entity.position;
            const dist = botPos.distanceTo(targetVec);

            // Increased tolerance to 3.5 to ensure we stop before hitting it or if close enough to interact
            if (dist < 3.5) {
                this.stopMovement();
                Logger.system('Arrived!');
                return;
            }

            // Look at target (slightly down to see block)
            await this.bot.lookAt(new Vec3(pos.x, pos.y, pos.z));

            // Walk forward
            this.bot.setControlState('forward', true);

            // Jump if we might be stuck (simple logic)
            if (dist > 3 && this.bot.entity.onGround) {
                // Check if there's a block in front
                const yaw = this.bot.entity.yaw;
                const frontX = botPos.x - Math.sin(yaw);
                const frontZ = botPos.z - Math.cos(yaw);
                const frontBlock = this.bot.blockAt(new Vec3(frontX, botPos.y, frontZ));

                if (frontBlock && frontBlock.boundingBox !== 'empty' && frontBlock.name !== 'air') {
                    this.bot.setControlState('jump', true);
                    await this.sleep(100);
                    this.bot.setControlState('jump', false);
                }
            }

            await this.sleep(50); // Faster tick rate
        }

        this.stopMovement();
        Logger.system('Walk timeout (might be close enough)');
    }

    async interactWithBlock(pos) {
        // Try the exact block first
        let block = this.bot.blockAt(new Vec3(pos.x, pos.y, pos.z));

        // If not interactable, look for nearby spawner or chest
        if (!block || block.name === 'air') {
            Logger.system(`Block at exact pos: ${block ? block.name : 'null'}, searching nearby...`);

            // Search in a small radius
            for (let dx = -2; dx <= 2; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dz = -2; dz <= 2; dz++) {
                        const checkBlock = this.bot.blockAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz));
                        if (checkBlock && checkBlock.name !== 'air' &&
                            (checkBlock.name.includes('spawner') || checkBlock.name.includes('chest') ||
                                checkBlock.name.includes('skull') || checkBlock.name.includes('head'))) {
                            block = checkBlock;
                            Logger.system(`Found: ${block.name} at offset (${dx},${dy},${dz})`);
                            break;
                        }
                    }
                    if (block && block.name !== 'air') break;
                }
                if (block && block.name !== 'air') break;
            }
        }

        if (!block || block.name === 'air') {
            Logger.error(`No interactable block found near ${pos.x}, ${pos.y}, ${pos.z}`);
            return;
        }

        Logger.system(`Interacting with: ${block.name}`);
        await this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
        await this.sleep(300);

        try {
            await this.bot.activateBlock(block);
        } catch (e) {
            Logger.error(`Activate error: ${e.message}`);
        }
    }

    async shiftClickAllBones() {
        const window = this.bot.currentWindow;
        if (!window) return 0;

        let count = 0;
        for (let i = 0; i < window.slots.length && this.running; i++) {
            const item = window.slots[i];
            if (!item || !item.name) continue;
            // Only collect bones, not arrows
            if (!item.name.includes('bone')) continue;

            if (this.bot.inventory.emptySlotCount() === 0) break;

            try {
                await this.bot.clickWindow(i, 0, 1);
                count++;
                await this.sleep(80);
            } catch (e) { }
        }
        return count;
    }

    async clickSellAll() {
        const window = this.bot.currentWindow;
        if (!window) return;

        // Sell slot = last slot in double chest GUI (slot 53)
        const sellSlot = 53;
        Logger.system(`→ Clicking sell slot ${sellSlot}...`);
        try {
            await this.bot.clickWindow(sellSlot, 0, 0);
            await this.sleep(500);
            Logger.system('✅ Sold all items!');
        } catch (e) {
            Logger.error(`Sell click failed: ${e.message}`);
        }
    }

    async depositViaShiftClick() {
        const chestPos = this.config.chestPos;
        const chestBlock = this.bot.blockAt(new Vec3(chestPos.x, chestPos.y, chestPos.z));

        if (!chestBlock) {
            Logger.error('Chest not found!');
            return;
        }

        await this.bot.lookAt(new Vec3(chestPos.x + 0.5, chestPos.y + 0.5, chestPos.z + 0.5));
        await this.sleep(200);
        await this.bot.activateBlock(chestBlock);
        await this.sleep(800);

        const window = this.bot.currentWindow;
        if (!window) {
            Logger.error('Chest not open!');
            return;
        }

        const chestSlots = window.type === 'minecraft:generic_9x6' ? 54 : 27;
        let deposited = 0;
        let failed = 0;

        for (let i = chestSlots; i < window.slots.length && this.running; i++) {
            const item = window.slots[i];
            if (!item || !item.name) continue;
            if (!item.name.includes('bone')) continue;

            try {
                await this.bot.clickWindow(i, 0, 1);
                deposited++;
                await this.sleep(100);
            } catch (e) {
                failed++;
                if (failed >= 3) {
                    this.chestFull = true;
                    break;
                }
            }
        }

        Logger.system(`Deposited ${deposited} stacks`);
        this.closeCurrentWindow();
    }

    closeCurrentWindow() {
        try {
            if (this.bot.currentWindow) {
                this.bot.closeWindow(this.bot.currentWindow);
            }
        } catch (e) { }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { BoneCollector };
