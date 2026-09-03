/**
 * 🍌 BananaMoney Lite - Inventory Cleaner Module
 * Checks inventory every 5 seconds.
 * Put all trash items into /trash.
 * Put candles of every colour into /pv 1 — a candle is never trashed.
 * Clocks are left alone entirely.
 */

const Logger = require('../utils/logger.js');

class InventoryCleaner {
    constructor(bot, config, shardsGate = null) {
        this.bot = bot;
        this.config = config;
        this.running = false;
        this.interval = null;
        this.cleaning = false; // Prevent overlapping cleans
        this.lastCleanFinishedAt = 0; // Timestamp of last completed clean (cmd-cooldown guard)
        // Optional predicate — when provided, cleaning only runs while it
        // returns true (e.g. shards are visible on the scoreboard).
        this.shardsGate = typeof shardsGate === 'function' ? shardsGate : null;
    }

    /**
     * Start the inventory cleaner (checks every 5 seconds)
     */
    start() {
        if (this.running) {
            Logger.system('Inventory Cleaner is already running.');
            return;
        }

        this.running = true;
        Logger.system('🧹 Inventory Cleaner: STARTED (checking every 5s)');

        // Run immediately once, then every 5 seconds
        this.checkAndClean();
        this.interval = setInterval(() => {
            this.checkAndClean();
        }, 5000);
    }

    /**
     * Stop the inventory cleaner
     */
    stop() {
        const was = this.running;
        this.running = false;
        this.cleaning = false;

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        if (was) Logger.system('🧹 Inventory Cleaner: STOPPED');
    }

    /**
     * Helper to check if an item is a candle — any colour, including plain
     * candles and server-renamed ones. Matching the item id keeps this working
     * when a candle carries a custom display name, and matching the display
     * name covers the reverse. Candles are never trash: a false positive here
     * only means an item is kept, while a false negative destroys it.
     */
    isCandle(item) {
        if (!item) return false;
        const name = (item.name || '').toLowerCase();
        const displayName = (item.displayName || '').toLowerCase();
        return name.includes('candle') || displayName.includes('candle');
    }

    /**
     * Helper to check if an item is a clock — clocks are left untouched.
     */
    isClock(item) {
        if (!item) return false;
        const name = (item.name || '').toLowerCase();
        const displayName = (item.displayName || '').toLowerCase();
        return name.includes('clock') || displayName.includes('clock');
    }

    /**
     * Get candle items from inventory
     */
    getCandleItems() {
        return this.bot.inventory.items().filter(item => this.isCandle(item));
    }

    /**
     * Get trash items (everything that is not a candle)
     */
    getTrashItems() {
        return this.bot.inventory.items().filter(item => !this.isCandle(item) && !this.isClock(item));
    }

    /**
     * Check inventory and clean if needed
     */
    async checkAndClean() {
        if (!this.running || this.cleaning) return;
        if (!this.bot || !this.bot.entity) return;

        // Don't interfere if a window is already open
        if (this.bot.currentWindow) return;

        // Only clean when the scoreboard is showing shards. If the gate says
        // no, the bot isn't on the right server yet — skip silently.
        if (this.shardsGate && !this.shardsGate()) return;

        try {
            const candleItems = this.getCandleItems();
            const trashItems = this.getTrashItems();

            if (candleItems.length === 0 && trashItems.length === 0) {
                return; // Nothing to clean
            }

            this.cleaning = true;

            // Handle candles first
            if (candleItems.length > 0) {
                await this.depositToPV();
            }

            // Handle trash second
            if (this.running) {
                // Fetch trash items again in case inventory state changed during PV deposit
                const currentTrashItems = this.getTrashItems();
                if (currentTrashItems.length > 0) {
                    await this.sleep(800);
                    if (!this.bot.currentWindow && this.running) {
                        await this.depositToTrash();
                    }
                }
            }
        } catch (err) {
            Logger.error(`Inventory Cleaner error: ${err.message}`);
        } finally {
            if (this.cleaning) this.lastCleanFinishedAt = Date.now();
            this.cleaning = false;
        }
    }

    /**
     * Open /pv 1 and deposit all candle items
     */
    async depositToPV() {
        // Send /pv 1 command
        this.bot.chat('/pv 1');
        Logger.system('🧹 Opening /pv 1...');

        // Wait for the window to open (up to 5 seconds)
        const window = await this.waitForWindow(5000);

        if (!window) {
            Logger.error('🧹 /pv 1 did not open in time');
            return;
        }

        await this.sleep(500);
        Logger.system(`🧹 PV window opened: ${window.title || window.type}`);

        let deposited = 0;
        const currentWindow = this.bot.currentWindow;
        if (!currentWindow) return;

        // Player inventory slots start after the container slots
        const containerSlotCount = currentWindow.inventoryStart || this.guessContainerSlots(currentWindow);

        for (let i = containerSlotCount; i < currentWindow.slots.length && this.running; i++) {
            const slot = currentWindow.slots[i];
            if (!slot || !slot.name) continue;

            if (!this.isCandle(slot)) continue; // Only deposit candles

            try {
                await this.bot.clickWindow(i, 0, 1); // Shift-click
                deposited++;
                await this.sleep(150);
            } catch (e) {
                Logger.error(`🧹 Failed to move ${slot.name} to PV: ${e.message}`);
            }
        }

        Logger.system(`🧹 Deposited ${deposited} candle(s) into PV 1`);

        // Close the window
        await this.sleep(300);
        this.closeWindow();
    }

    /**
     * Open /trash and deposit all non-candle items
     */
    async depositToTrash() {
        // Send /trash command
        this.bot.chat('/trash');
        Logger.system('🗑️ Opening /trash...');

        // Wait for the window to open (up to 5 seconds)
        const window = await this.waitForWindow(5000);

        if (!window) {
            Logger.error('🗑️ /trash did not open in time');
            return;
        }

        await this.sleep(500);
        Logger.system(`🗑️ Trash window opened: ${window.title || window.type}`);

        let deposited = 0;
        const currentWindow = this.bot.currentWindow;
        if (!currentWindow) return;

        // Player inventory slots start after the container slots
        const containerSlotCount = currentWindow.inventoryStart || this.guessContainerSlots(currentWindow);

        for (let i = containerSlotCount; i < currentWindow.slots.length && this.running; i++) {
            const slot = currentWindow.slots[i];
            if (!slot || !slot.name) continue;

            if (this.isCandle(slot)) continue; // Keep candles
            if (this.isClock(slot)) continue; // Leave clocks untouched

            try {
                await this.bot.clickWindow(i, 0, 1); // Shift-click
                deposited++;
                await this.sleep(150);
            } catch (e) {
                Logger.error(`🗑️ Failed to move ${slot.name} to Trash: ${e.message}`);
            }
        }

        Logger.system(`🗑️ Deposited ${deposited} trash item(s) into Trash`);

        // Close the window
        await this.sleep(300);
        this.closeWindow();
    }

    /**
     * Guess container slot count based on window type
     */
    guessContainerSlots(window) {
        const type = window.type;
        if (type === 'minecraft:generic_9x6') return 54;
        if (type === 'minecraft:generic_9x5') return 45;
        if (type === 'minecraft:generic_9x4') return 36;
        if (type === 'minecraft:generic_9x3') return 27;
        if (type === 'minecraft:generic_9x2') return 18;
        if (type === 'minecraft:generic_9x1') return 9;
        return 54;
    }

    /**
     * Wait for a window to open
     */
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

    /**
     * Close the current window
     */
    closeWindow() {
        try {
            if (this.bot.currentWindow) {
                this.bot.closeWindow(this.bot.currentWindow);
                Logger.system('🧹 GUI window closed');
            }
        } catch (e) { }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { InventoryCleaner };
