/**
 * 🍌 BananaMoney Lite - PV Candle Dropper Module
 * Periodically checks configured PVs, pulls all candles, and drops them.
 */

const Logger = require('../utils/logger.js');

class PvCandleDropper {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
        this.running = false;
        this.interval = null;
        this.cleaning = false; // Prevent overlapping cycles
        
        // Defaults to checking PV 1, checking every 15 seconds
        this.pvs = [1];
        this.checkInterval = 15000;
        
        this.loadConfig();
    }

    loadConfig() {
        if (this.config.pvCandleDropper) {
            if (Array.isArray(this.config.pvCandleDropper.pvs)) {
                this.pvs = this.config.pvCandleDropper.pvs;
            }
            if (typeof this.config.pvCandleDropper.interval === 'number') {
                this.checkInterval = this.config.pvCandleDropper.interval;
            }
        }
    }

    start() {
        if (this.running) {
            Logger.system('PV Candle Dropper is already running.');
            return;
        }

        this.running = true;
        Logger.system(`🕯️ PV Candle Dropper: STARTED (checking PVs: [${this.pvs.join(', ')}] every ${this.checkInterval / 1000}s)`);

        this.checkAndDrop();
        this.interval = setInterval(() => {
            this.checkAndDrop();
        }, this.checkInterval);
    }

    stop() {
        const was = this.running;
        this.running = false;
        this.cleaning = false;

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        if (was) Logger.system('🕯️ PV Candle Dropper: STOPPED');
    }

    isCandle(item) {
        if (!item) return false;
        const name = item.name.toLowerCase();
        const displayName = (item.displayName || '').toLowerCase();
        return name.includes('pink_candle') || displayName.includes('pink candle') ||
               name.includes('magenta_candle') || displayName.includes('magenta candle') ||
               name.includes('purple_candle') || displayName.includes('purple candle');
    }

    async checkAndDrop() {
        if (!this.running || this.cleaning) return;
        if (!this.bot || !this.bot.entity) return;

        // Don't interfere if a window is already open
        if (this.bot.currentWindow) return;

        this.cleaning = true;

        try {
            for (const pvNum of this.pvs) {
                if (!this.running) break;
                await this.processPV(pvNum);
                await this.sleep(1000); // Small pause between PVs
            }
        } catch (err) {
            Logger.error(`PV Candle Dropper error: ${err.message}`);
        } finally {
            this.cleaning = false;
        }
    }

    async processPV(pvNum) {
        Logger.system(`🕯️ Checking /pv ${pvNum}...`);
        this.bot.chat(`/pv ${pvNum}`);

        const window = await this.waitForWindow(5000);
        if (!window) {
            Logger.error(`🕯️ /pv ${pvNum} did not open in time`);
            return;
        }

        await this.sleep(500);
        const currentWindow = this.bot.currentWindow;
        if (!currentWindow) return;

        const containerSlotCount = currentWindow.inventoryStart || this.guessContainerSlots(currentWindow);

        // Scan the container slots for candles
        let candlesInPV = 0;
        for (let i = 0; i < containerSlotCount; i++) {
            const slot = currentWindow.slots[i];
            if (this.isCandle(slot)) {
                candlesInPV += slot.count;
            }
        }

        if (candlesInPV === 0) {
            Logger.system(`🕯️ PV ${pvNum}: No candles found.`);
            this.closeWindow();
            return;
        }

        Logger.system(`🕯️ PV ${pvNum}: Found ${candlesInPV} candle(s). Transferring to inventory...`);

        let transferred = 0;
        // Shift-click candles into player inventory
        for (let i = 0; i < containerSlotCount && this.running; i++) {
            const slot = currentWindow.slots[i];
            if (!this.isCandle(slot)) continue;

            try {
                await this.bot.clickWindow(i, 0, 1); // Shift-click
                transferred += slot.count;
                await this.sleep(150);
            } catch (e) {
                Logger.error(`🕯️ Failed to retrieve candle from slot ${i}: ${e.message}`);
            }
        }

        Logger.system(`🕯️ Retrieved ${transferred} candle(s) from PV ${pvNum}`);

        // Close the window
        await this.sleep(300);
        this.closeWindow();
        await this.sleep(500);

        // Now drop all candles in player inventory
        await this.dropAllInventoryCandles();
    }

    async dropAllInventoryCandles() {
        if (!this.running) return;
        
        const items = this.bot.inventory.items();
        const candles = items.filter(item => this.isCandle(item));
        if (candles.length === 0) return;

        Logger.system(`🕯️ Dropping ${candles.length} candle stack(s) from inventory...`);
        for (const item of candles) {
            if (!this.running) break;
            try {
                await this.bot.tossStack(item);
                await this.sleep(200);
            } catch (e) {
                Logger.error(`🕯️ Failed to drop ${item.name}: ${e.message}`);
            }
        }
        Logger.system('🕯️ Finished dropping candles.');
    }

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
            if (this.bot.currentWindow) {
                this.bot.closeWindow(this.bot.currentWindow);
                Logger.system('🕯️ GUI window closed');
            }
        } catch (e) { }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { PvCandleDropper };
