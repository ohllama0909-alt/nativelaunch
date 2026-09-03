/**
 * 🍌 BananaMoney - Message Trigger System
 * Handles message-based script triggers with pattern matching
 */

const Logger = require('./logger.js');

class MessageTrigger {
    /**
     * @param {Object} config - Trigger configuration
     * @param {string} config.id - Unique trigger ID
     * @param {string} config.name - Trigger name
     * @param {Object} config.trigger - Trigger conditions
     * @param {Object} config.action - Action to perform
     * @param {number} [config.cooldown=0] - Cooldown in ms
     * @param {boolean} [config.enabled=true] - Whether trigger is enabled
     */
    constructor(config) {
        this.id = config.id || Date.now().toString(36);
        this.name = config.name || 'Unnamed Trigger';
        this.trigger = {
            pattern: config.trigger?.pattern || '',
            matchType: config.trigger?.matchType || 'contains', // exact, contains, regex, startsWith
            ignoreCase: config.trigger?.ignoreCase !== false,
            source: config.trigger?.source || 'all' // chat, system, all
        };
        this.action = {
            type: config.action?.type || 'chat', // chat, command
            value: config.action?.value || ''
        };
        this.cooldown = config.cooldown || 0;
        this.enabled = config.enabled !== false;
        this.lastTriggered = 0;

        // Compile regex if needed
        if (this.trigger.matchType === 'regex') {
            try {
                const flags = this.trigger.ignoreCase ? 'i' : '';
                this.compiledRegex = new RegExp(this.trigger.pattern, flags);
            } catch (e) {
                Logger.error(`Invalid regex pattern in trigger "${this.name}": ${e.message}`);
                this.enabled = false;
            }
        }
    }

    /**
     * Check if a message matches this trigger
     * @param {string} message - The message to check
     * @param {string} source - Message source (chat/system)
     * @returns {boolean}
     */
    matches(message, source = 'chat') {
        if (!this.enabled) return false;

        // Check source filter
        if (this.trigger.source !== 'all' && this.trigger.source !== source) {
            return false;
        }

        // Check cooldown
        if (this.cooldown > 0 && Date.now() - this.lastTriggered < this.cooldown) {
            return false;
        }

        const pattern = this.trigger.pattern;
        const testMessage = this.trigger.ignoreCase ? message.toLowerCase() : message;
        const testPattern = this.trigger.ignoreCase ? pattern.toLowerCase() : pattern;

        switch (this.trigger.matchType) {
            case 'exact':
                return testMessage === testPattern;
            case 'contains':
                return testMessage.includes(testPattern);
            case 'startsWith':
                return testMessage.startsWith(testPattern);
            case 'regex':
                return this.compiledRegex?.test(message) || false;
            default:
                return testMessage.includes(testPattern);
        }
    }

    /**
     * Execute the trigger action
     * @param {Object} bot - Mineflayer bot instance
     * @param {Object} context - Execution context
     * @returns {boolean} Success
     */
    execute(bot, context = {}) {
        if (!this.enabled || !bot) return false;

        this.lastTriggered = Date.now();

        try {
            let value = this.action.value;

            // Variable substitution
            if (context.message) value = value.replace(/{message}/g, context.message);
            if (context.player) value = value.replace(/{player}/g, context.player);

            switch (this.action.type) {
                case 'chat':
                    bot.chat(value);
                    Logger.info(`[Trigger] "${this.name}" sent: ${value}`);
                    break;
                case 'command':
                    // Return command for BananaBot to handle
                    return { type: 'command', value };
                default:
                    bot.chat(value);
            }
            return true;
        } catch (e) {
            Logger.error(`Trigger "${this.name}" failed: ${e.message}`);
            return false;
        }
    }

    /**
     * Export trigger to JSON format
     * @returns {Object}
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            trigger: this.trigger,
            action: this.action,
            cooldown: this.cooldown,
            enabled: this.enabled
        };
    }

    /**
     * Create MessageTrigger from JSON
     * @param {Object} json
     * @returns {MessageTrigger}
     */
    static fromJSON(json) {
        return new MessageTrigger(json);
    }
}

module.exports = { MessageTrigger };
