/**
 * Profile Manager
 * Handles saving and loading of configuration profiles (chest/spawner positions)
 */

const fs = require('fs');
const path = require('path');
const Logger = require('./logger.js');

const DATA_ROOT = process.env.BOT_DATA_DIR
    || ((process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) ? path.resolve(process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) : path.join(__dirname, '../..'));
const PROFILES_FILE = path.join(DATA_ROOT, 'profiles.json');

class ProfileManager {
    constructor() {
        this.profiles = {};
        this.loadProfiles();
    }

    loadProfiles() {
        try {
            if (fs.existsSync(PROFILES_FILE)) {
                const data = fs.readFileSync(PROFILES_FILE, 'utf8');
                this.profiles = JSON.parse(data);
            }
        } catch (err) {
            Logger.error(`Failed to load profiles: ${err.message}`);
            this.profiles = {};
        }
    }

    saveProfiles() {
        try {
            fs.writeFileSync(PROFILES_FILE, JSON.stringify(this.profiles, null, 2));
            return true;
        } catch (err) {
            Logger.error(`Failed to save profiles: ${err.message}`);
            return false;
        }
    }

    getProfile(name) {
        return this.profiles[name];
    }

    saveProfile(name, data) {
        this.profiles[name] = data;
        if (this.saveProfiles()) {
            Logger.system(`Profile "${name}" saved.`);
            return true;
        }
        return false;
    }

    deleteProfile(name) {
        if (this.profiles[name]) {
            delete this.profiles[name];
            return this.saveProfiles();
        }
        return false;
    }

    listProfiles() {
        return Object.keys(this.profiles);
    }
}

module.exports = { ProfileManager };
