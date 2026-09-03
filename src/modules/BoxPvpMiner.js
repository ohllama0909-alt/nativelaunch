const Vec3 = require('vec3');
const Logger = require('../utils/logger.js');

class BoxPvpMiner {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
        this.running = false;
        this.targetBlock = null;
        this.cycleCount = 0;
    }

    async start(blockName) {
        if (this.running) {
            Logger.error('BoxPVP Miner already active!');
            return;
        }

        if (!blockName) {
            Logger.error('You must specify a block to duplicate (e.g., !boxpvp diamond_block)');
            return;
        }

        this.targetBlock = blockName.toLowerCase();
        this.running = true;
        this.cycleCount = 0;
        Logger.system(`⛏️ BoxPVP Miner Started! Target: ${this.targetBlock}`);

        this.mineLoop();
    }

    stop() {
        const was = this.running;
        this.running = false;
        if (was) Logger.system('⛏️ BoxPVP Miner STOPPED');
    }

    async mineLoop() {
        while (this.running) {
            try {
                // 1. Check if inventory is full
                if (this.bot.inventory.emptySlotCount() === 0) {
                    Logger.system('Inventory FULL! Depositing to /pv 1...');
                    await this.depositToPV();
                    if (!this.running) break;
                    continue;
                }

                // 2. Ensure block is in off-hand
                const offHandItem = this.bot.inventory.slots[45];
                if (!offHandItem || offHandItem.name !== this.targetBlock) {
                    const blockItem = this.bot.inventory.items().find(i => i.name === this.targetBlock);
                    if (!blockItem) {
                        Logger.error(`Out of ${this.targetBlock}! Stopping...`);
                        this.stop();
                        break;
                    }
                    Logger.system(`Equipping ${this.targetBlock} to off-hand...`);
                    await this.bot.equip(blockItem, 'off-hand');
                    await this.sleep(500);
                }

                // 3. Ensure pickaxe is in main hand
                const heldItem = this.bot.inventory.slots[this.bot.getEquipmentDestSlot('hand')];
                if (!heldItem || !heldItem.name.includes('pickaxe')) {
                    const pickaxe = this.bot.inventory.items().find(i => i.name.includes('pickaxe'));
                    if (pickaxe) {
                        await this.bot.equip(pickaxe, 'hand');
                        await this.sleep(300);
                    } else {
                        Logger.error('No pickaxe found in inventory!');
                        this.stop();
                        break;
                    }
                }

                // 4. Place the block in front
                const pos = this.bot.entity.position;
                const yaw = this.bot.entity.yaw;
                
                // Calculate position 1 block in front
                const dx = -Math.sin(yaw);
                const dz = -Math.cos(yaw);
                
                // Determine target position for block placement (at feet level)
                const targetPos = new Vec3(pos.x + dx, pos.y, pos.z + dz).floored();
                
                // The block below the target position
                const referencePos = targetPos.offset(0, -1, 0);
                const referenceBlock = this.bot.blockAt(referencePos);

                const currentBlockAtTarget = this.bot.blockAt(targetPos);
                
                if (currentBlockAtTarget && currentBlockAtTarget.name === 'air') {
                    // Try to place it
                    try {
                        await this.bot.lookAt(referencePos.offset(0.5, 1, 0.5), false);
                        // Using Vec3(0, 1, 0) to place on top of the block below
                        await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
                    } catch (e) {
                        // Sometimes placeBlock fails if looking wrong or something is in the way
                    }
                }

                // 5. Mine the block
                const blockToMine = this.bot.blockAt(targetPos);
                if (blockToMine && blockToMine.name !== 'air') {
                    try {
                        await this.bot.lookAt(blockToMine.position.offset(0.5, 0.5, 0.5), false);
                        await this.bot.dig(blockToMine);
                        this.cycleCount++;
                        
                        // Output status every 50 blocks
                        if (this.cycleCount % 50 === 0) {
                            Logger.system(`Mined ${this.cycleCount} ${this.targetBlock}s...`);
                        }
                    } catch (e) {
                        if (e.message !== 'Digging aborted') {
                            Logger.error(`Dig error: ${e.message}`);
                        }
                    }
                } else {
                    // If no block is placed, look slightly down to make sure we place correctly next time
                    await this.bot.look(yaw, -0.5, false);
                    await this.sleep(200);
                }

                // Small delay to prevent rate limits
                await this.sleep(100);

            } catch (err) {
                Logger.error(`BoxPVP Error: ${err.message}`);
                await this.sleep(2000);
            }
        }
    }

    async depositToPV() {
        this.bot.chat('/pv 1');
        
        // Wait for PV to open
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.bot.removeListener('windowOpen', onWindowOpen);
                resolve();
            }, 5000);

            const onWindowOpen = (window) => {
                clearTimeout(timeout);
                this.bot.removeListener('windowOpen', onWindowOpen);
                resolve(window);
            };

            this.bot.on('windowOpen', onWindowOpen);
        });

        const window = this.bot.currentWindow;
        if (!window) {
            Logger.error('Failed to open /pv 1');
            return;
        }

        await this.sleep(1000);

        // Find how many blocks we have in total
        let totalBlocks = 0;
        const chestSlots = window.inventoryStart; // Usually 27 or 54 for chest

        for (let i = chestSlots; i < window.slots.length; i++) {
            const item = window.slots[i];
            if (item && item.name === this.targetBlock) {
                totalBlocks += item.count;
            }
        }

        // We want to keep exactly 64 (1 stack). Calculate how much to deposit.
        let toDeposit = totalBlocks - 64;
        
        Logger.system(`Depositing ${toDeposit} ${this.targetBlock}s to PV...`);

        let deposited = 0;
        for (let i = chestSlots; i < window.slots.length && this.running; i++) {
            const item = window.slots[i];
            if (!item || item.name !== this.targetBlock) continue;

            if (toDeposit <= 0) break;

            try {
                // Shift click
                await this.bot.clickWindow(i, 0, 1);
                toDeposit -= item.count;
                deposited++;
                await this.sleep(200);
            } catch (e) {
                // Ignore click errors
            }
        }

        Logger.system(`Deposited blocks in ${deposited} stacks.`);

        if (this.bot.currentWindow) {
            this.bot.closeWindow(window);
        }
        await this.sleep(500);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { BoxPvpMiner };
