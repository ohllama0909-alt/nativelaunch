/**
 * 🍌 BananaMoney Lite - Auto Home Module
 * On start: runs /home and clicks the light blue bed in the homes GUI.
 * On death: waits, then re-homes the same way once respawned.
 */

const Logger = require('../utils/logger.js');

class AutoHome {
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
        this.running = false;
        this.busy = false; // Prevent overlapping /home cycles

        // Defaults, overridable via config.autoHome
        this.homeCommand = '/home';
        this.bedName = 'light_blue_bed';
        this.deathDelay = 3000;
        this.windowTimeout = 5000;

        this.loadConfig();

        this._onDeath = this._onDeath.bind(this);
    }

    loadConfig() {
        const o = this.config.autoHome;
        if (!o) return;
        if (typeof o.homeCommand === 'string') this.homeCommand = o.homeCommand;
        if (typeof o.bedName === 'string') this.bedName = o.bedName;
        if (typeof o.deathDelay === 'number') this.deathDelay = o.deathDelay;
    }

    start() {
        if (this.running) {
            Logger.system('Auto Home is already running.');
            return;
        }

        this.running = true;
        this.bot.on('death', this._onDeath);
        Logger.system(`🏠 Auto Home: STARTED (${this.homeCommand} → ${this.bedName}, re-home ${this.deathDelay / 1000}s after death)`);

        this.goHome();
    }

    stop() {
        const was = this.running;
        this.running = false;
        this.busy = false;
        try { this.bot.removeListener('death', this._onDeath); } catch (_) { }
        if (was) Logger.system('🏠 Auto Home: STOPPED');
    }

    showStatus() {
        Logger.system(`🏠 Auto Home: ${this.running ? 'RUNNING' : 'stopped'}${this.busy ? ' (homing now)' : ''}`);
    }

    _onDeath() {
        if (!this.running) return;
        Logger.system(`🏠 Auto Home: Died — re-homing in ${this.deathDelay / 1000}s...`);
        setTimeout(() => this.goHome(), this.deathDelay);
    }

    isHomeBed(item) {
        if (!item) return false;
        const name = (item.name || '').toLowerCase();
        const displayName = (item.displayName || '').toLowerCase();
        const target = this.bedName.toLowerCase();
        return name.includes(target) || displayName.includes(target.replace(/_/g, ' '));
    }

    async goHome() {
        if (!this.running || this.busy) return;
        if (!this.bot || !this.bot.entity) {
            Logger.error('🏠 Auto Home: Bot not spawned yet, skipping.');
            return;
        }

        this.busy = true;
        try {
            // A leftover window would swallow our windowOpen wait
            if (this.bot.currentWindow) this.closeWindow();

            Logger.system(`🏠 Running ${this.homeCommand}...`);
            this.bot.chat(this.homeCommand);

            const window = await this.waitForWindow(this.windowTimeout);
            if (!window) {
                Logger.error(`🏠 ${this.homeCommand} GUI did not open in time`);
                return;
            }

            await this.sleep(500);
            const currentWindow = this.bot.currentWindow;
            if (!currentWindow) return; // Server closed it (e.g. teleported directly)

            const containerSlotCount = currentWindow.inventoryStart || 54;
            let bedSlot = -1;
            for (let i = 0; i < containerSlotCount; i++) {
                if (this.isHomeBed(currentWindow.slots[i])) { bedSlot = i; break; }
            }

            if (bedSlot === -1) {
                Logger.error(`🏠 No ${this.bedName} found in the homes GUI`);
                this.closeWindow();
                return;
            }

            await this.bot.clickWindow(bedSlot, 0, 0);
            Logger.system(`🏠 Clicked ${this.bedName} (slot ${bedSlot}) — teleporting home.`);

            // Server usually closes the GUI on teleport; clean up if it didn't
            await this.sleep(1000);
            if (this.bot.currentWindow) this.closeWindow();
        } catch (err) {
            Logger.error(`🏠 Auto Home error: ${err.message}`);
        } finally {
            this.busy = false;
        }
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
            if (this.bot.currentWindow) this.bot.closeWindow(this.bot.currentWindow);
        } catch (e) { }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { AutoHome };
