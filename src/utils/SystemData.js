/**
 * 🍌 BananaMoney Lite - System Data Manager
 *
 * Per-username configuration storage.
 * Honours the BOT_DATA_DIR env var so each bot spawned by the
 * MultiBotServer stores its own system_data/ folder in isolation.
 *
 * Loaded/Saved messages are now debug-only so they don't spam the
 * multibot panel.
 */

const fs = require('fs');
const path = require('path');
const Logger = require('./logger.js');

const SYSTEM_DATA_DIR = process.env.BOT_DATA_DIR
  ? path.join(process.env.BOT_DATA_DIR, 'system_data')
  : path.join(__dirname, '../../system_data');

class SystemData {
    constructor() {
        if (!fs.existsSync(SYSTEM_DATA_DIR)) {
            fs.mkdirSync(SYSTEM_DATA_DIR, { recursive: true });
        }
    }

    getFilePath(username) {
        const safe = username.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(SYSTEM_DATA_DIR, `${safe}.json`);
    }

    load(username) {
        const filePath = this.getFilePath(username);
        const defaults = {
            spawnerPos: null,
            chestPos: null,
            collectSlot: 13,
            cycleDelay: 15000,
            loginPassword: null,
            autoLogin: false,
            scriptsEnabled: {}
            // rewardEnabled / invCleanerEnabled used to live here and defaulted
            // to true, which auto-started both features on every bot launch.
            // They are session-scoped now and no longer stored.
        };

        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(raw);
                Logger.debug(`Loaded system data for "${username}"`);
                return { ...defaults, ...data };
            }
        } catch (err) {
            Logger.error(`Failed to load system data for "${username}": ${err.message}`);
        }
        return defaults;
    }

    save(username, data) {
        const filePath = this.getFilePath(username);
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
            Logger.debug(`Saved system data for "${username}"`);
            return true;
        } catch (err) {
            Logger.error(`Failed to save system data for "${username}": ${err.message}`);
            return false;
        }
    }

    update(username, partial) {
        const existing = this.load(username);
        const merged = { ...existing, ...partial };
        return this.save(username, merged);
    }

    listUsers() {
        try {
            return fs.readdirSync(SYSTEM_DATA_DIR)
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace('.json', ''));
        } catch (err) {
            return [];
        }
    }

    exists(username) {
        return fs.existsSync(this.getFilePath(username));
    }
}

module.exports = { SystemData };
