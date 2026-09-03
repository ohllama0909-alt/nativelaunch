/**
 * 🍌 BananaMoney - Script Manager
 * Per-bot scripts folder via BOT_DATA_DIR env var.
 */

const { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } = require('fs');
const { join } = require('path');
const Logger = require('./logger.js');
const { MessageTrigger } = require('./MessageTrigger.js');

const SCRIPTS_DIR = process.env.BOT_DATA_DIR
    ? join(process.env.BOT_DATA_DIR, 'scripts')
    : join(__dirname, '../../scripts');

class ScriptManager {
    constructor(bot, config, commandHandler) {
        this.bot = bot;
        this.config = config;
        this.commandHandler = commandHandler;

        this.scripts = new Map();
        this.triggers = new Map();
        this.intervals = new Map();

        this.scriptIdCounter = 1;
        this.triggerIdCounter = 1;

        this.scriptsDir = SCRIPTS_DIR;
        this.ensureScriptsDir();
    }

    init() {
        this.loadAllScripts();
        this.setupMessageListener();
        Logger.system(`Script Manager initialized. ${this.scripts.size} scripts loaded.`);
    }

    ensureScriptsDir() {
        if (!existsSync(this.scriptsDir)) {
            mkdirSync(this.scriptsDir, { recursive: true });
            Logger.system(`Created scripts dir: ${this.scriptsDir}`);
        }
    }

    loadAllScripts() {
        try {
            const files = readdirSync(this.scriptsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const filePath = join(this.scriptsDir, file);
                    const content = readFileSync(filePath, 'utf-8');
                    const script = JSON.parse(content);
                    this.registerScript(script, false);
                } catch (e) {
                    Logger.error(`Failed to load script ${file}: ${e.message}`);
                }
            }
        } catch (e) {
            Logger.error(`Failed to read scripts directory: ${e.message}`);
        }
    }

    setupMessageListener() {
        this.bot.on('messagestr', (message, position) => {
            if (position === 'game_info') return;
            const source = position === 'system' ? 'system' : 'chat';
            let player = null;
            const chatMatch = message.match(/^<([^>]+)>\s*(.*)$/);
            if (chatMatch) player = chatMatch[1];

            this.triggers.forEach((trigger) => {
                if (trigger.matches(message, source)) {
                    const result = trigger.execute(this.bot, { message, player });
                    if (result && result.type === 'command' && this.commandHandler) {
                        this.commandHandler(result.value);
                    }
                }
            });
        });
    }

    registerScript(script, save = true) {
        const id = script.id || `script_${this.scriptIdCounter++}`;
        script.id = id;

        switch (script.type) {
            case 'message-trigger': {
                const trigger = new MessageTrigger(script);
                this.triggers.set(id, trigger);
                this.scripts.set(id, { ...script, instance: trigger });
                break;
            }
            case 'interval':
                this.scripts.set(id, script);
                if (script.enabled !== false) this.startIntervalScript(script);
                break;
            default:
                this.scripts.set(id, script);
        }

        if (save) this.saveScript(script);
        return id;
    }

    startIntervalScript(script) {
        if (this.intervals.has(script.id)) clearInterval(this.intervals.get(script.id));
        const interval = setInterval(() => {
            if (!this.bot || !this.bot.entity) return;
            try {
                if (script.action?.type === 'command' && this.commandHandler) {
                    this.commandHandler(script.action.value);
                } else if (script.action?.type === 'chat') {
                    this.bot.chat(script.action.value);
                }
            } catch (e) {
                Logger.error(`Interval script "${script.name}" error: ${e.message}`);
            }
        }, script.interval || 5000);
        this.intervals.set(script.id, interval);
    }

    stopIntervalScript(id) {
        if (this.intervals.has(id)) {
            clearInterval(this.intervals.get(id));
            this.intervals.delete(id);
        }
    }

    saveScript(script) {
        try {
            const filename = `${script.id}.json`;
            const filePath = join(this.scriptsDir, filename);
            const saveData = { ...script };
            delete saveData.instance;
            writeFileSync(filePath, JSON.stringify(saveData, null, 2));
            Logger.info(`Script "${script.name}" saved to ${filename}`);
        } catch (e) {
            Logger.error(`Failed to save script: ${e.message}`);
        }
    }

    addQuickTrigger(pattern, action, options = {}) {
        const isCommand = action.startsWith('!');
        const script = {
            id: `trigger_${this.triggerIdCounter++}`,
            name: options.name || `Quick Trigger: ${pattern.substring(0, 20)}`,
            type: 'message-trigger',
            enabled: true,
            trigger: {
                pattern,
                matchType: options.matchType || 'contains',
                ignoreCase: options.ignoreCase !== false,
                source: options.source || 'all'
            },
            action: {
                type: isCommand ? 'command' : 'chat',
                value: isCommand ? action.slice(1) : action
            },
            cooldown: options.cooldown || 3000
        };
        return this.registerScript(script, true);
    }

    addIntervalScript(seconds, command) {
        const isCommand = command.startsWith('!');
        const script = {
            id: `interval_${this.scriptIdCounter++}`,
            name: `Repeat: ${command.substring(0, 20)}`,
            type: 'interval',
            enabled: true,
            interval: seconds * 1000,
            action: {
                type: isCommand ? 'command' : 'chat',
                value: isCommand ? command.slice(1) : command
            }
        };
        return this.registerScript(script, true);
    }

    enableScript(id) {
        const script = this.scripts.get(id);
        if (!script) return false;
        script.enabled = true;
        if (script.type === 'message-trigger' && this.triggers.has(id)) {
            this.triggers.get(id).enabled = true;
        } else if (script.type === 'interval') {
            this.startIntervalScript(script);
        }
        this.saveScript(script);
        return true;
    }

    disableScript(id) {
        const script = this.scripts.get(id);
        if (!script) return false;
        script.enabled = false;
        if (script.type === 'message-trigger' && this.triggers.has(id)) {
            this.triggers.get(id).enabled = false;
        } else if (script.type === 'interval') {
            this.stopIntervalScript(id);
        }
        this.saveScript(script);
        return true;
    }

    deleteScript(id) {
        const script = this.scripts.get(id);
        if (!script) return false;
        if (script.type === 'interval') this.stopIntervalScript(id);
        this.scripts.delete(id);
        this.triggers.delete(id);
        try {
            const filePath = join(this.scriptsDir, `${id}.json`);
            if (existsSync(filePath)) unlinkSync(filePath);
        } catch (e) {
            Logger.error(`Failed to delete script file: ${e.message}`);
        }
        return true;
    }

    listScripts() {
        return Array.from(this.scripts.values()).map(s => ({
            id: s.id,
            name: s.name,
            type: s.type,
            enabled: s.enabled
        }));
    }

    reload() {
        this.intervals.forEach((interval) => clearInterval(interval));
        this.intervals.clear();
        this.triggers.clear();
        this.scripts.clear();
        this.loadAllScripts();
        Logger.system(`Reloaded ${this.scripts.size} scripts`);
    }

    destroy() {
        this.intervals.forEach((interval) => clearInterval(interval));
        this.intervals.clear();
    }
}

module.exports = { ScriptManager };
