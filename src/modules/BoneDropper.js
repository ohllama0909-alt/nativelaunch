/**
 * 🍌 BananaMoney Lite - Bone Dropper Module
 * Clicks the dropper button in the spawner GUI, closes, waits 2s, repeats.
 */

const { pathfinder, Movements } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
const Logger = require('../utils/logger.js');

class BoneDropper {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config.boneDropper || {};
        this.running = false;
        this.initialized = false;
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
            Logger.system('Bone Dropper: Ready');
        } catch (err) {
            Logger.error(`Init failed: ${err.message}`);
        }
    }

    async start() {
        if (this.running) return;

        if (!this.initialized) await this.init();

        this.running = true;
        Logger.system('🦴 Bone Dropper: STARTED');

        while (this.running) {
            try {
                await this.dropCycle();
                if (this.running) {
                    Logger.system(`Waiting 2s...`);
                    await this.sleep(2000);
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
        if (was) Logger.system('🦴 Bone Dropper: STOPPED');
    }

    stopMovement() {
        try { this.bot.pathfinder.stop(); } catch (e) { }
        this.bot.setControlState('forward', false);
        this.bot.setControlState('sprint', false);
        this.bot.setControlState('jump', false);
    }

    async dropCycle() {
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

        // Click chest slot (13)
        const chestSlot = 13;
        Logger.system(`→ Clicking chest slot ${chestSlot}...`);
        try { await this.bot.clickWindow(chestSlot, 0, 0); } catch (e) { }
        await this.sleep(800);

        // Click dropper slot (52)
        const slot = 52;
        Logger.system(`→ Clicking dropper slot ${slot}...`);
        try { await this.bot.clickWindow(slot, 0, 0); } catch (e) { }
        await this.sleep(500);

        this.closeCurrentWindow();
        await this.sleep(500);
    }

    /**
     * Manual walking - look at target and walk forward
     */
    async walkToManual(pos) {
        if (!pos) return;

        const targetVec = new Vec3(pos.x, pos.y, pos.z);
        const startTime = Date.now();
        const timeout = 20000;

        if (this.bot.entity.position.distanceTo(targetVec) < 3.5) {
            return;
        }

        while (this.running && (Date.now() - startTime) < timeout) {
            const botPos = this.bot.entity.position;
            const dist = botPos.distanceTo(targetVec);

            if (dist < 3.5) {
                this.stopMovement();
                return;
            }

            await this.bot.lookAt(new Vec3(pos.x, pos.y, pos.z));
            this.bot.setControlState('forward', true);

            if (dist > 3 && this.bot.entity.onGround) {
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

            await this.sleep(50);
        }

        this.stopMovement();
    }

    async interactWithBlock(pos) {
        let block = this.bot.blockAt(new Vec3(pos.x, pos.y, pos.z));

        if (!block || block.name === 'air') {
            for (let dx = -2; dx <= 2; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dz = -2; dz <= 2; dz++) {
                        const checkBlock = this.bot.blockAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz));
                        if (checkBlock && checkBlock.name !== 'air' &&
                            (checkBlock.name.includes('spawner') || checkBlock.name.includes('skull') || checkBlock.name.includes('head'))) {
                            block = checkBlock;
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

        await this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
        await this.sleep(300);

        try {
            await this.bot.activateBlock(block);
        } catch (e) {
            Logger.error(`Activate error: ${e.message}`);
        }
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

module.exports = { BoneDropper };
