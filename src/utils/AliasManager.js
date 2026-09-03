/**
 * 🍌 BananaMoney - Alias Manager
 * Handles command and chat aliases with file persistence
 */
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join, dirname } = require('path');
const Logger = require('./logger.js');

class AliasManager {
    constructor(config) {
        this.config = config;
        this.aliasesFile = process.env.BOT_DATA_DIR
            ? join(process.env.BOT_DATA_DIR, 'aliases.json')
            : join(__dirname, '../../config/aliases.json');
        this.aliases = this.loadAliases();
    }

    /**
     * Load aliases from file, fallback to config
     * @returns {Object}
     */
    loadAliases() {
        try {
            if (existsSync(this.aliasesFile)) {
                const content = readFileSync(this.aliasesFile, 'utf-8');
                return JSON.parse(content);
            }
        } catch (e) {
            Logger.error(`Failed to load aliases: ${e.message}`);
        }

        // Fallback to config aliases (for migration)
        const configAliases = this.config?.aliases || {};

        // Save to file for future use
        if (Object.keys(configAliases).length > 0) {
            this.saveAliases(configAliases);
        }

        return configAliases;
    }

    /**
     * Save aliases to file
     * @param {Object} aliases
     * @returns {boolean}
     */
    saveAliases(aliases = this.aliases) {
        try {
            const dir = dirname(this.aliasesFile);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            writeFileSync(this.aliasesFile, JSON.stringify(aliases, null, 2));
            return true;
        } catch (e) {
            Logger.error(`Failed to save aliases: ${e.message}`);
            return false;
        }
    }

    /**
     * Resolve input string against aliases
     * @param {string} input - Raw console input
     * @returns {string} - Resolved input
     */
    resolve(input) {
        if (!input) return input;

        const parts = input.trim().split(' ');
        const key = parts[0];

        if (this.aliases[key]) {
            const aliasValue = this.aliases[key];
            const args = parts.slice(1).join(' ');

            if (args.length > 0) {
                return `${aliasValue} ${args}`;
            }
            return aliasValue;
        }

        return input;
    }

    /**
     * Add a new alias
     * @param {string} shortcut - Alias shortcut (e.g., "!c")
     * @param {string} command - Full command/text
     * @returns {boolean}
     */
    add(shortcut, command) {
        if (!shortcut || !command) return false;

        this.aliases[shortcut] = command;
        if (this.saveAliases()) {
            Logger.system(`Alias "${shortcut}" → "${command}" added.`);
            return true;
        }
        return false;
    }

    /**
     * Remove an alias
     * @param {string} shortcut
     * @returns {boolean}
     */
    remove(shortcut) {
        if (!this.aliases[shortcut]) return false;

        delete this.aliases[shortcut];
        if (this.saveAliases()) {
            Logger.system(`Alias "${shortcut}" removed.`);
            return true;
        }
        return false;
    }

    /**
     * List all aliases
     * @returns {Array}
     */
    list() {
        return Object.entries(this.aliases).map(([key, value]) => ({
            shortcut: key,
            command: value
        }));
    }

    /**
     * Reload aliases from file
     */
    reload() {
        this.aliases = this.loadAliases();
        Logger.system(`Reloaded ${Object.keys(this.aliases).length} aliases.`);
    }
}

module.exports = { AliasManager };
