/**
 * 🍌 BananaMoney Lite - GUI Manager
 * Handle window/GUI interactions via console commands
 */

const Logger = require('../utils/logger.js');

class GuiManager {
    constructor(bot) {
        this.bot = bot;
    }

    /**
     * Show current window info
     */
    showWindow() {
        const window = this.bot.currentWindow;
        if (!window) {
            Logger.system('No window open.');
            return;
        }

        Logger.system(`=== Window: ${window.title || 'Unknown'} ===`);
        Logger.system(`Type: ${window.type} | Slots: ${window.slots.length}`);

        // Show non-empty slots
        const items = [];
        window.slots.forEach((slot, index) => {
            if (slot) {
                items.push(`[${index}] ${slot.name} x${slot.count}`);
            }
        });

        if (items.length > 0) {
            Logger.system('Items:');
            items.forEach(item => Logger.log(item, 'INFO'));
        } else {
            Logger.system('Window is empty.');
        }
    }

    /**
     * Click a slot in current window
     */
    async clickSlot(slot, button = 0) {
        const window = this.bot.currentWindow;
        if (!window) {
            Logger.error('No window open!');
            return;
        }

        const slotNum = parseInt(slot);
        if (isNaN(slotNum) || slotNum < 0 || slotNum >= window.slots.length) {
            Logger.error(`Invalid slot: ${slot}. Range: 0-${window.slots.length - 1}`);
            return;
        }

        try {
            await this.bot.clickWindow(slotNum, button, 0);
            const item = window.slots[slotNum];
            Logger.system(`Clicked slot ${slotNum}${item ? ` (${item.name})` : ''}`);
        } catch (err) {
            Logger.error(`Click failed: ${err.message}`);
        }
    }

    /**
     * Close current window
     */
    closeWindow() {
        const window = this.bot.currentWindow;
        if (!window) {
            Logger.system('No window to close.');
            return;
        }

        this.bot.closeWindow(window);
        Logger.system('Window closed.');
    }

    /**
     * Shift-click a slot (quick move)
     */
    async shiftClick(slot) {
        const window = this.bot.currentWindow;
        if (!window) {
            Logger.error('No window open!');
            return;
        }

        const slotNum = parseInt(slot);
        if (isNaN(slotNum)) {
            Logger.error(`Invalid slot: ${slot}`);
            return;
        }

        try {
            await this.bot.clickWindow(slotNum, 0, 1); // mode 1 = shift-click
            Logger.system(`Shift-clicked slot ${slotNum}`);
        } catch (err) {
            Logger.error(`Shift-click failed: ${err.message}`);
        }
    }

    /**
     * Click an item by name
     * @param {string} namePart - Part of the item name
     */
    async clickItem(namePart) {
        const window = this.bot.currentWindow;
        if (!window) return;

        const item = window.slots.find(s => s && s.name && s.name.toLowerCase().includes(namePart.toLowerCase()));
        if (!item) {
            Logger.error(`Item containing "${namePart}" not found.`);
            return;
        }

        Logger.system(`Clicking ${item.name} at slot ${item.slot}`);
        await this.clickSlot(item.slot);
    }
}

module.exports = { GuiManager };
