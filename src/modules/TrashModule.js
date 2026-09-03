/**
 * 🍌 BananaMoney Lite - Trash Module
 * Checks inventory every 26 seconds. If any non-pink candle items are found,
 * opens /trash and deposits them there, then closes the GUI.
 */

const Logger = require('../utils/logger.js');

class TrashModule {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
        this.running = false;
        this.interval = null;
        this.cleaning = false; // Prevent overlapping cleans
    }

    /**
     * Start the trash cleaner (checks every 26 seconds)
     */
    start() {
        if (this.running) {
            Logger.system('Trash Module is already running.');
            return;
        }

        this.running = true;
        Logger.system('🗑️ Trash Module: STARTED (checking every 26s)');

        // Run immediately once, then every 26 seconds
        this.checkAndClean();
        this.interval = setInterval(() => {
            this.checkAndClean();
        }, 26000);
    }

    /**
     * Stop the trash cleaner
     */
    stop() {
        const was = this.running;
        this.running = false;
        this.cleaning = false;

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        if (was) Logger.system('🗑️ Trash Module: STOPPED');
    }

    /**
     * Check inventory and clean if needed
     */
    async checkAndClean() {
        if (!this.running || this.cleaning) return;
        if (!this.bot || !this.bot.entity) return;

        // Don't interfere if a window is already open
        if (this.bot.currentWindow) return;

        try {
            const nonPinkCandles = this.getTrashItems();

            if (nonPinkCandles.length === 0) {
                return; // All good, only pink candles (or empty inv)
            }

            Logger.system(`🗑️ Found ${nonPinkCandles.length} trash item(s), cleaning...`);
            this.cleaning = true;

            await this.depositToTrash(nonPinkCandles);
        } catch (err) {
            Logger.error(`Trash Module error: ${err.message}`);
        } finally {
            this.cleaning = false;
        }
    }

    /**
     * Get all items in the player's inventory to trash
     */
    getTrashItems() {
        const items = this.bot.inventory.items();
        return items.filter(item => {
            const name = item.name.toLowerCase();
            const displayName = (item.displayName || '').toLowerCase();
            // Keep pink candles, ignore everything else
            return !name.includes('pink_candle') && !displayName.includes('pink candle');
        });
    }

    /**
     * Open /trash and deposit all trash items
     */
    async depositToTrash(items) {
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

        // Shift-click all trash items from player inventory into the Trash
        let deposited = 0;
        const currentWindow = this.bot.currentWindow;
        if (!currentWindow) return;

        // Player inventory slots start after the container slots
        const containerSlotCount = currentWindow.inventoryStart || this.guessContainerSlots(currentWindow);

        for (let i = containerSlotCount; i < currentWindow.slots.length && this.running; i++) {
            const slot = currentWindow.slots[i];
            if (!slot || !slot.name) continue;

            const name = slot.name.toLowerCase();
            const displayName = (slot.displayName || '').toLowerCase();
            if (name.includes('pink_candle') || displayName.includes('pink candle')) continue; // Keep pink candles

            try {
                await this.bot.clickWindow(i, 0, 1); // Shift-click
                deposited++;
                await this.sleep(150);
            } catch (e) {
                Logger.error(`🗑️ Failed to move ${slot.name}: ${e.message}`);
            }
        }

        Logger.system(`🗑️ Deposited ${deposited} item(s) into Trash`);

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
        // Default: assume double chest
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
                Logger.system('🗑️ Trash window closed');
            }
        } catch (e) { }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { TrashModule };
