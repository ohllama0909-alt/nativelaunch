/**
 * MineAndSell Module - Automated mining bot
 * Finds nearest target block, mines it, sells when inventory full,
 * deposits balance into bank, then resumes mining.
 */

const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
const Logger = require('../utils/logger.js');

class MineAndSell {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
        this.running = false;
        this.initialized = false;
        this.mcData = null;
        this.targetBlock = null;
        this.searchRadius = 64;
        this.stats = {
            blocksMined: 0,
            sellCycles: 0,
            totalDeposited: 0,
            startTime: null
        };
        // State for balance parsing
        this._awaitingBalance = false;
        this._balanceResolve = null;
        this._sellResolve = null;
        this._awaitingSell = false;
    }

    async init() {
        if (this.initialized) return;

        try {
            this.bot.loadPlugin(pathfinder);
        } catch (e) { /* already loaded */ }

        try {
            const mcDataModule = require('minecraft-data');
            this.mcData = mcDataModule(this.bot.version);

            const { createBestMovements } = require('../utils/movements.js');
            const movements = createBestMovements(this.bot, this.mcData, { canDig: true });

            this.bot.pathfinder.setMovements(movements);
            this.initialized = true;
            Logger.system('MineAndSell: Ready');
        } catch (err) {
            Logger.error(`MineAndSell init failed: ${err.message}`);
        }
    }

    /**
     * Start mining a specific block type
     */
    async start(blockName) {
        if (this.running) {
            Logger.error('Mining already active! Use !mine off first.');
            return;
        }

        if (!this.initialized) await this.init();

        // Resolve block name to ID
        const blockType = this.findBlockType(blockName);
        if (!blockType) {
            Logger.error(`Unknown block: "${blockName}". Try the exact Minecraft block name (e.g., diamond_ore, iron_ore, stone, oak_log).`);
            return;
        }

        this.targetBlock = blockType;
        this.running = true;
        this.stats.blocksMined = 0;
        this.stats.sellCycles = 0;
        this.stats.totalDeposited = 0;
        this.stats.startTime = Date.now();

        Logger.system(`Mining started! Target: ${blockType.name} | Radius: ${this.searchRadius}`);
        Logger.system('Use !mine off to stop | !mine status for stats');

        // Start the mining loop
        this.mineLoop();
    }

    /**
     * Stop mining
     */
    stop() {
        const was = this.running;
        this.running = false;
        this.stopMovement();
        if (was) Logger.system('Mining STOPPED');
        if (was && this.stats.startTime) {
            const elapsed = Math.round((Date.now() - this.stats.startTime) / 1000);
            Logger.system(`Session: ${this.stats.blocksMined} blocks mined | ${this.stats.sellCycles} sell cycles | ${elapsed}s`);
        }
    }

    /**
     * Show mining status
     */
    showStatus() {
        if (!this.running) {
            Logger.info('Mining is not active.');
            return;
        }
        const elapsed = Math.round((Date.now() - this.stats.startTime) / 1000);
        const invItems = this.bot.inventory.items().length;
        const emptySlots = this.bot.inventory.emptySlotCount();

        Logger.system('=== Mining Status ===');
        Logger.info(`Target: ${this.targetBlock?.name || 'none'}`);
        Logger.info(`Blocks mined: ${this.stats.blocksMined}`);
        Logger.info(`Sell cycles: ${this.stats.sellCycles}`);
        Logger.info(`Total deposited: $${this.stats.totalDeposited}`);
        Logger.info(`Inventory: ${invItems} items | ${emptySlots} empty slots`);
        Logger.info(`Uptime: ${elapsed}s`);
        Logger.info(`Search radius: ${this.searchRadius}`);
    }

    /**
     * Find block type from mcData by name (fuzzy match)
     */
    findBlockType(name) {
        if (!this.mcData) return null;
        const lower = name.toLowerCase().replace(/ /g, '_');

        // Direct match
        const direct = this.mcData.blocksByName[lower];
        if (direct) return direct;

        // Fuzzy match
        const allBlocks = Object.values(this.mcData.blocksByName);
        const match = allBlocks.find(b => b.name.includes(lower) || lower.includes(b.name));
        return match || null;
    }

    /**
     * Main mining loop
     */
    async mineLoop() {
        while (this.running) {
            try {
                // Check if inventory is full
                if (this.isInventoryFull()) {
                    Logger.system('Inventory FULL! Starting sell cycle...');
                    await this.sellAndDeposit();
                    if (!this.running) break;
                    continue;
                }

                // Find nearest target block
                const block = this.findNearestBlock();
                if (!block) {
                    Logger.info(`No ${this.targetBlock.name} found within ${this.searchRadius} blocks. Waiting 5s...`);
                    await this.sleep(5000);
                    continue;
                }

                // Navigate to the block
                const reached = await this.goToBlock(block);
                if (!this.running) break;

                if (!reached) {
                    Logger.info('Could not reach block, trying another...');
                    await this.sleep(1000);
                    continue;
                }

                // Mine the block
                await this.mineBlock(block);
                if (!this.running) break;

                this.stats.blocksMined++;

                // Small delay between mines
                await this.sleep(200);
            } catch (err) {
                Logger.error(`Mining error: ${err.message}`);
                this.stopMovement();
                await this.sleep(3000);
            }
        }
    }

    /**
     * Check if inventory is completely full
     */
    isInventoryFull() {
        return this.bot.inventory.emptySlotCount() === 0;
    }

    /**
     * Find the nearest block of target type
     */
    findNearestBlock() {
        if (!this.targetBlock) return null;

        const block = this.bot.findBlock({
            matching: this.targetBlock.id,
            maxDistance: this.searchRadius,
            count: 1
        });

        return block;
    }

    /**
     * Navigate to a block using pathfinder
     */
    async goToBlock(block) {
        if (!block) return false;

        try {
            const goal = new goals.GoalLookAtBlock(block.position, this.bot.world);
            this.bot.pathfinder.setGoal(goal);

            // Wait for the bot to reach the goal or timeout
            return await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    this.bot.pathfinder.stop();
                    resolve(false);
                }, 30000);

                const onGoalReached = () => {
                    clearTimeout(timeout);
                    this.bot.removeListener('goal_reached', onGoalReached);
                    this.bot.removeListener('path_update', onPathStopped);
                    resolve(true);
                };

                const onPathStopped = (r) => {
                    if (r.status === 'noPath' || r.status === 'timeout') {
                        clearTimeout(timeout);
                        this.bot.removeListener('goal_reached', onGoalReached);
                        this.bot.removeListener('path_update', onPathStopped);
                        resolve(false);
                    }
                };

                this.bot.on('goal_reached', onGoalReached);
                this.bot.on('path_update', onPathStopped);

                // Also check if already at goal
                const dist = this.bot.entity.position.distanceTo(block.position);
                if (dist < 4.5) {
                    clearTimeout(timeout);
                    this.bot.removeListener('goal_reached', onGoalReached);
                    this.bot.removeListener('path_update', onPathStopped);
                    this.bot.pathfinder.stop();
                    resolve(true);
                }
            });
        } catch (err) {
            Logger.error(`Pathfinding error: ${err.message}`);
            return false;
        }
    }

    /**
     * Mine a specific block
     */
    async mineBlock(block) {
        try {
            // Re-fetch block at the position (might have changed)
            const currentBlock = this.bot.blockAt(block.position);
            if (!currentBlock || currentBlock.type === 0) {
                return; // Block already gone
            }

            // Equip best tool for the job
            await this.equipBestTool(currentBlock);

            // Look at the block
            await this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
            await this.sleep(100);

            // Dig it
            await this.bot.dig(currentBlock);
        } catch (err) {
            if (err.message !== 'Digging aborted') {
                Logger.error(`Dig error: ${err.message}`);
            }
        }
    }

    /**
     * Equip the best tool for mining a block
     */
    async equipBestTool(block) {
        try {
            const items = this.bot.inventory.items();
            let bestTool = null;
            let bestTime = Infinity;

            for (const item of items) {
                const digTime = block.digTime(item?.type, false, false, false, false, false);
                if (digTime < bestTime) {
                    bestTime = digTime;
                    bestTool = item;
                }
            }

            // Also check bare hand
            const bareHandTime = block.digTime(null, false, false, false, false, false);

            if (bestTool && bestTime < bareHandTime) {
                await this.bot.equip(bestTool, 'hand');
            }
        } catch (err) {
            // Ignore equip errors, mine with whatever is in hand
        }
    }

    /**
     * Sell all items and deposit balance into bank
     */
    async sellAndDeposit() {
        this.stopMovement();
        await this.sleep(500);

        // Execute /sell all
        Logger.system('Executing /sell all...');
        this.bot.chat('/sell all');
        this.stats.sellCycles++;

        // Wait for sell confirmation in chat
        await this.sleep(3000);

        // Check balance
        Logger.system('Checking balance...');
        const balance = await this.getBalance();

        if (balance !== null && balance > 0) {
            Logger.system(`Balance: $${balance} - Depositing to bank...`);
            await this.sleep(1000);
            this.bot.chat(`/bank deposit ${balance}`);
            this.stats.totalDeposited += balance;
            await this.sleep(2000);
            Logger.system(`Deposited $${balance} to bank!`);
        } else {
            Logger.info('Could not parse balance or balance is 0. Trying deposit all...');
            await this.sleep(1000);
            this.bot.chat('/bank deposit all');
            await this.sleep(2000);
        }

        Logger.system('Sell cycle complete! Resuming mining...');
        await this.sleep(1000);
    }

    /**
     * Get balance from /balance command
     * Listens to chat for balance message and parses the amount
     */
    async getBalance() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.bot.removeListener('messagestr', onMessage);
                resolve(null);
            }, 8000);

            const onMessage = (message) => {
                // Common balance message patterns from economy plugins:
                const balancePatterns = [
                    /\$?([\d,]+\.?\d*)/,
                    /balance[:\s]+\$?([\d,]+\.?\d*)/i,
                    /money[:\s]+\$?([\d,]+\.?\d*)/i,
                    /you have \$?([\d,]+\.?\d*)/i,
                ];

                for (const pattern of balancePatterns) {
                    const match = message.match(pattern);
                    if (match) {
                        const amount = parseFloat(match[1].replace(/,/g, ''));
                        if (!isNaN(amount) && amount >= 0) {
                            clearTimeout(timeout);
                            this.bot.removeListener('messagestr', onMessage);
                            resolve(amount);
                            return;
                        }
                    }
                }
            };

            this.bot.on('messagestr', onMessage);
            this.bot.chat('/balance');
        });
    }

    /**
     * Stop all movement
     */
    stopMovement() {
        try { this.bot.pathfinder.stop(); } catch (e) { }
        try {
            this.bot.setControlState('forward', false);
            this.bot.setControlState('sprint', false);
            this.bot.setControlState('jump', false);
            this.bot.setControlState('back', false);
        } catch (e) { }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { MineAndSell };
