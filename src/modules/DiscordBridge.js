/**
 * 🍌 BananaMoney Lite - Discord Bridge
 * Creates a channel per Minecraft username (banana-<mcusername>)
 */

const { Client, GatewayIntentBits, EmbedBuilder, ChannelType } = require('discord.js');
const Logger = require('../utils/logger.js');
const { writeFileSync } = require('fs');

class DiscordBridge {
    constructor(config, commandHandler) {
        this.config = config;
        this.commandHandler = commandHandler;
        this.client = null;
        this.running = false;
        this.channel = null;
        this.messageQueue = [];
        this.flushInterval = null;
        this.isReady = false;
    }

    /**
     * Initialize Discord bot
     */
    async init() {
        if (!this.config.discord?.enabled || !this.config.discord?.token) {
            return false;
        }

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });

        this.setupEvents();

        try {
            await this.client.login(this.config.discord.token);
            return true;
        } catch (err) {
            Logger.error(`Discord login failed: ${err.message}`);
            return false;
        }
    }

    /**
     * Setup Discord events
     */
    setupEvents() {
        this.client.once('ready', async () => {
            Logger.system(`Discord bot connected as ${this.client.user.tag}`);
            this.running = true;

            // Use the MINECRAFT username for channel naming, NOT the Discord bot name
            const mcUsername = (this.config.username || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '');
            const channelName = `banana-${mcUsername}`;

            if (this.config.discord.guildId) {
                try {
                    const guild = await this.client.guilds.fetch(this.config.discord.guildId);

                    // Fetch all channels (cache may be empty on startup)
                    await guild.channels.fetch();

                    // Check if channel with MC username already exists
                    const existingChannel = guild.channels.cache.find(
                        ch => ch.name === channelName && ch.type === ChannelType.GuildText
                    );

                    if (existingChannel) {
                        this.channel = existingChannel;
                        Logger.system(`Discord using existing channel: #${this.channel.name}`);
                    } else {
                        // Create new channel named after MC username
                        this.channel = await guild.channels.create({
                            name: channelName,
                            type: ChannelType.GuildText,
                            topic: `🍌 BananaMoney Console — MC: ${this.config.username}`
                        });
                        Logger.system(`Discord created new channel: #${this.channel.name}`);

                        // Save channel ID to config for future reference
                        this.config.discord.channelId = this.channel.id;
                        try {
                            writeFileSync('./config/config.json', JSON.stringify(this.config, null, 4));
                        } catch (err) {
                            Logger.error(`Could not save channel ID to config: ${err.message}`);
                        }
                    }

                    if (this.channel) {
                        this.sendToDiscord(`\`\`\`\n🍌 BananaMoney connected!\n   MC: ${this.config.username}\n   Server: ${this.config.host}\n\`\`\``);
                    }
                } catch (err) {
                    Logger.error(`Failed to setup Discord channel: ${err.message}`);
                }
            } else {
                Logger.error('No guild ID provided in config!');
            }

            this.isReady = true;

            // Start message queue flusher (batch messages to avoid rate limits)
            this.flushInterval = setInterval(() => this.flushQueue(), 1000);
        });

        this.client.on('messageCreate', async (message) => {
            // Ignore bot messages and messages from other channels
            if (message.author.bot) return;
            if (!this.channel || message.channel.id !== this.channel.id) return;

            const content = message.content.trim();
            if (!content) return;

            // Check for command prefix
            if (content.startsWith('!')) {
                try {
                    await this.commandHandler(content.slice(1));
                } catch (err) {
                    this.sendToDiscord(`\`\`\`\n❌ Error: ${err.message}\n\`\`\``);
                }
            } else {
                // Regular chat - send to Minecraft
                try {
                    await this.commandHandler(`chat ${content}`);
                } catch (err) {
                    // Ignore chat errors
                }
            }
        });

        this.client.on('error', (err) => {
            Logger.error(`Discord error: ${err.message}`);
        });
    }

    /**
     * Queue a log message for Discord
     */
    queueLog(message) {
        if (!this.isReady || !this.channel) return;

        // Strip ANSI codes
        const clean = message.replace(/\x1b\[[0-9;]*m/g, '');
        this.messageQueue.push(clean);
    }

    /**
     * Flush queued messages to Discord
     */
    async flushQueue() {
        if (!this.channel || this.messageQueue.length === 0) return;

        // Batch messages (max 1900 chars to stay under 2000 limit)
        let batch = '';
        const messages = [];

        while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            if (batch.length + msg.length + 1 > 1900) {
                messages.push(batch);
                batch = msg;
            } else {
                batch += (batch ? '\n' : '') + msg;
            }
        }

        if (batch) messages.push(batch);

        // Send batched messages
        for (const content of messages) {
            try {
                await this.channel.send(`\`\`\`\n${content}\n\`\`\``);
            } catch (err) {
                // Rate limited or other error, re-queue
                if (err.code === 50035) {
                    // Message too long, split it
                    const lines = content.split('\n');
                    this.messageQueue.unshift(...lines);
                }
            }
        }
    }

    /**
     * Send immediate message to Discord
     */
    async sendToDiscord(message) {
        if (!this.channel) return;
        try {
            await this.channel.send(message);
        } catch (err) {
            // Ignore send errors
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.running = false;
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }
        if (this.client) {
            this.client.destroy();
        }
    }
}

module.exports = { DiscordBridge };
