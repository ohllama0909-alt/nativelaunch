/**
 * 🍌 BananaMoney Lite - Payout Bridge
 * - Discord bot with /setup-panel slash command
 * - Beautiful panel with Verify button → modal (asks MC username)
 * - On submit: atomic claim (anti-duplicate) → MC bot runs `/pay <amount> <username>`
 * - Built-in HTTP admin panel + Server-Sent Events for real-time updates
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    Client, GatewayIntentBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    PermissionFlagsBits, SlashCommandBuilder, REST, Routes
} = require('discord.js');
const Logger = require('../utils/logger.js');
const { parseAmount, formatAmount } = require('../utils/PayoutStore.js');

// Custom emojis (user-supplied)
const E = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    loading: '⏳',
    queue: '👥',
    ticket: '🎫',
    tier: '🏆',
    points: '💰',
    region: '🌍',
    user: '👤',
    time: '🕒',
    close: '🛑',
    open: '🟢',
    next: '➡️',
    info: 'ℹ️',
    bullet: '🔹',
    divider: '━━━━━━━━━━━━━━━━━━━━━━━━━━'
};



const PANEL_HTML_PATH = path.join(__dirname, '../web/panel.html');

class PayoutBridge {
    /**
     * @param {PayoutStore} store
     * @param {(username: string, amount: string) => boolean} payExecutor - returns true on success
     */
    constructor(store, payExecutor) {
        this.store = store;
        this.payExecutor = payExecutor;
        this.client = null;
        this.httpServer = null;
        this.sseClients = new Set();
        this.webSessions = new Map();
        this._onStoreChange = () => this._broadcastSSE();
    }

    async start() {
        const s = this.store.get();
        if (!s.discord.token) throw new Error('Discord token not configured');
        if (!s.discord.guildId) throw new Error('Discord guildId not configured');

        await this._startDiscord();
        this._startWeb(s.web.port || 3000);
        this.store.onChange(this._onStoreChange);
        this.running = true;
    }

    async stop() {
        try { this.store.offChange(this._onStoreChange); } catch (_) {}
        this.running = false;
        if (this.httpServer) { try { this.httpServer.close(); } catch (_) {} this.httpServer = null; }
        this.sseClients.forEach(r => { try { r.end(); } catch (_) {} });
        this.sseClients.clear();
        if (this.client) { try { await this.client.destroy(); } catch (_) {} this.client = null; }
        Logger.system('PayoutBridge stopped.');
    }

    // ─── Discord ───────────────────────────────────────────────────────
    async _startDiscord() {
        this.client = new Client({ intents: [GatewayIntentBits.Guilds] });

        this.client.on('error', (err) => Logger.error(`Discord error: ${err.message}`));
        this.client.on('interactionCreate', (i) => this._handleInteraction(i).catch(err => {
            Logger.error(`Interaction error: ${err.message}`);
            try {
                if (i.isRepliable() && !i.replied) i.reply({ content: `${E.error} Something went wrong.`, ephemeral: true }).catch(() => {});
            } catch (_) {}
        }));

        this.client.once('ready', async () => {
            Logger.system(`🤖 Discord payout bot online as ${this.client.user.tag}`);
            await this._registerSlashCommands();
        });

        await this.client.login(this.store.get().discord.token);
    }

    async _registerSlashCommands() {
        const { guildId, token } = this.store.get().discord;
        const cmd = new SlashCommandBuilder()
            .setName('setup-panel')
            .setDescription('Send the BananaMoney payout claim panel to this channel')
            .setDefaultMemberPermissions(String(PermissionFlagsBits.Administrator));

        try {
            const rest = new REST({ version: '10' }).setToken(token);
            await rest.put(
                Routes.applicationGuildCommands(this.client.user.id, guildId),
                { body: [cmd.toJSON()] }
            );
            Logger.system(`✅ Registered /setup-panel in guild ${guildId}`);
        } catch (e) {
            Logger.error(`Slash command register failed: ${e.message}`);
        }
    }

    async _handleInteraction(i) {
        if (i.isChatInputCommand() && i.commandName === 'setup-panel') {
            if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                return i.reply({ content: `${E.error} You need the **Administrator** permission to use this.`, ephemeral: true });
            }
            const embed = this._buildPanelEmbed();
            const btn = new ButtonBuilder()
                .setCustomId('banana_verify')
                .setLabel('Verify & Claim')
                .setStyle(ButtonStyle.Success)
                .setEmoji(E.open);
            const row = new ActionRowBuilder().addComponents(btn);
            await i.channel.send({ embeds: [embed], components: [row] });
            return i.reply({ content: `${E.success} Panel sent successfully.`, ephemeral: true });
        }

        if (i.isButton() && i.customId === 'banana_verify') {
            const s = this.store.get();
            const amtRaw = parseAmount(s.payoutAmount) || 0;
            if (amtRaw <= 0) {
                return i.reply({ content: `${E.error} Payout is not configured. Please ask an admin.`, ephemeral: true });
            }
            if (s.balance < amtRaw) {
                return i.reply({ content: `${E.warning} The payout pool is currently empty. Please try again later.`, ephemeral: true });
            }
            if (s.claims.some(c => c.discordId === i.user.id)) {
                return i.reply({ content: `${E.error} You have already claimed your payout with this Discord account.`, ephemeral: true });
            }

            const modal = new ModalBuilder()
                .setCustomId('banana_claim_modal')
                .setTitle('BananaSMP Payout Claim');
            const input = new TextInputBuilder()
                .setCustomId('mc_username')
                .setLabel('Your in-game Minecraft username')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. YourMCName')
                .setMinLength(3)
                .setMaxLength(16)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return i.showModal(modal);
        }

        if (i.isModalSubmit() && i.customId === 'banana_claim_modal') {
            const mcUsername = i.fields.getTextInputValue('mc_username').trim();
            return this._processClaim(i, mcUsername);
        }
    }

    async _processClaim(i, mcUsername) {
        await i.deferReply({ ephemeral: true });

        const result = this.store.tryClaim({
            discordId: i.user.id,
            discordTag: i.user.tag || i.user.username,
            mcUsername
        });

        if (!result.ok) {
            return i.editReply({ content: `${E.error} ${result.reason}` });
        }

        let paid = false;
        try {
            paid = !!this.payExecutor(result.claim.mcUsername, result.claim.amount);
        } catch (e) {
            Logger.error(`Payout exec error: ${e.message}`);
            paid = false;
        }

        if (!paid) {
            this.store.revertClaim(result.claim);
            return i.editReply({ content: `${E.error} The Minecraft bot is offline. Your claim was **not** registered. Please try again in a moment.` });
        }

        Logger.system(`💰 Paid ${result.claim.amount} → ${result.claim.mcUsername} (Discord: ${result.claim.discordTag})`);

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setAuthor({ name: 'BananaMoney Payout' })
            .setTitle(`${E.success} Claim Successful`)
            .setDescription([
                `${E.divider}`,
                `${E.next} Your payout has been sent in-game!`,
                '',
                `${E.user}  **Minecraft** · \`${result.claim.mcUsername}\``,
                `${E.points}  **Amount** · \`${result.claim.amount}\``,
                `${E.time}  **When** · <t:${Math.floor(Date.now() / 1000)}:R>`,
                `${E.region}  **Server** · \`play.bananasmp.net\``,
                '',
                `${E.info} If you don't see the money, make sure you're online on BananaSMP and check \`/bal\`.`
            ].join('\n'))
            .setFooter({ text: '🍌 BananaMoney · One claim per account' })
            .setTimestamp();

        return i.editReply({ embeds: [embed] });
    }

    _buildPanelEmbed() {
        const s = this.store.get();
        const amtRaw = parseAmount(s.payoutAmount) || 0;
        const remaining = amtRaw > 0 ? Math.floor(s.balance / amtRaw) : 0;
        return new EmbedBuilder()
            .setColor(0xFFD700)
            .setAuthor({ name: 'BananaMoney · Payout Center' })
            .setTitle(`${E.tier}  FREE PAYOUT GIVEAWAY`)
            .setDescription([
                `${E.divider}`,
                '**Claim your free in-game cash on BananaSMP**',
                '',
                `${E.next}  Press **Verify & Claim** below`,
                `${E.next}  Enter your in-game Minecraft username`,
                `${E.next}  Get paid instantly on \`play.bananasmp.net\``,
                '',
                `${E.warning}  **Rules**`,
                `${E.bullet}  One claim per Discord account`,
                `${E.bullet}  One claim per Minecraft username`,
                `${E.bullet}  You must be joined to the server to receive it`,
            ].join('\n'))
            .addFields(
                { name: `${E.points} Per-User Payout`, value: `\`${s.payoutAmount}\``, inline: true },
                { name: `${E.queue} Remaining Slots`, value: `\`${remaining.toLocaleString()}\``, inline: true },
                { name: `${E.open} Status`, value: remaining > 0 ? '`Available`' : '`Depleted`', inline: true },
            )
            .setFooter({ text: '🍌 BananaMoney · Powered by BananaBot' })
            .setTimestamp();
    }

    // ─── HTTP / SSE ────────────────────────────────────────────────────
    _startWeb(port) {
        this.httpServer = http.createServer((req, res) => this._handleHttp(req, res));
        this.httpServer.on('error', (e) => Logger.error(`Web server error: ${e.message}`));
        const host = process.env.NATIVELAUNCH_PAYOUT_HOST || process.env.BOTHIVE_PAYOUT_HOST || '127.0.0.1';
        this.httpServer.listen(port, host, () => Logger.system(`🌐 Admin panel: http://${host}:${port}`));
    }

    async _handleHttp(req, res) {
        try {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const json = (code, body, headers = {}) => {
                res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
                res.end(JSON.stringify(body));
            };
            const token = this._sessionToken(req);
            const authenticated = this._isWebAuthenticated(token);
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('Referrer-Policy', 'same-origin');

            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
                if (fs.existsSync(PANEL_HTML_PATH)) {
                    const html = fs.readFileSync(PANEL_HTML_PATH, 'utf8');
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    return res.end(html);
                }
                return json(200, { ok: true, name: 'PayoutBridge API', status: 'online' });
            }

            if (req.method === 'GET' && url.pathname === '/api/me') {
                return json(200, { authenticated, bootstrap: this.store.isAdminPasswordUnset() });
            }

            if (req.method === 'POST' && url.pathname === '/api/login') {
                const body = await this._readJson(req);
                const password = String(body.password || '');
                if (password.length < 6) return json(400, { ok: false, error: 'Password must be at least 6 characters.' });
                const bootstrap = this.store.isAdminPasswordUnset();
                if (bootstrap) this.store.setAdminPassword(password);
                else if (!this.store.checkAdminPassword(password)) return json(401, { ok: false, error: 'Invalid password.' });
                const session = crypto.randomBytes(32).toString('hex');
                this.webSessions.set(session, Date.now() + 12 * 60 * 60 * 1000);
                const secure = (process.env.NATIVELAUNCH_COOKIE_SECURE === '1' || process.env.BOTHIVE_COOKIE_SECURE === '1') ? '; Secure' : '';
                return json(200, { ok: true, bootstrap }, { 'Set-Cookie': `payout_session=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}` });
            }

            if (req.method === 'POST' && url.pathname === '/api/logout') {
                if (token) this.webSessions.delete(token);
                return json(200, { ok: true }, { 'Set-Cookie': 'payout_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict' });
            }

            if (req.method === 'POST' && url.pathname === '/api/change-password') {
                if (!authenticated) return json(401, { ok: false, error: 'Unauthorized' });
                const body = await this._readJson(req);
                if (!this.store.checkAdminPassword(body.currentPassword)) return json(403, { ok: false, error: 'Current password is incorrect.' });
                if (String(body.newPassword || '').length < 6) return json(400, { ok: false, error: 'New password must be at least 6 characters.' });
                this.store.setAdminPassword(body.newPassword);
                this.webSessions.clear();
                return json(200, { ok: true });
            }

            if (url.pathname.startsWith('/api/') && !authenticated) {
                return json(401, { ok: false, error: 'Unauthorized' });
            }

            if (req.method === 'GET' && url.pathname === '/api/data') {
                return json(200, this._publicState());
            }

            if (req.method === 'POST' && url.pathname === '/api/update') {
                const body = await this._readJson(req);
                const updates = {};
                if (body.balance !== undefined && body.balance !== null && body.balance !== '') {
                    const n = Number(body.balance);
                    if (isNaN(n) || n < 0) { res.writeHead(400); return res.end('Invalid balance'); }
                    updates.balance = Math.floor(n);
                }
                if (body.payoutAmount !== undefined && body.payoutAmount !== '') {
                    if (!parseAmount(body.payoutAmount)) { res.writeHead(400); return res.end('Invalid payout amount'); }
                    updates.payoutAmount = String(body.payoutAmount);
                }
                this.store.update(updates);
                Logger.system(`🛠  Admin updated pool: ${JSON.stringify(updates)}`);
                return json(200, { ok: true, data: this._publicState() });
            }

            if (req.method === 'POST' && url.pathname === '/api/pay-direct') {
                const body = await this._readJson(req);
                const result = this.store.directPay({ mcUsername: body.mcUsername, amount: body.amount });
                if (!result.ok) return json(400, { ok: false, error: result.reason });
                let paid = false;
                try { paid = !!this.payExecutor(result.claim.mcUsername, result.claim.amount); } catch (_) { paid = false; }
                if (!paid) {
                    this.store.revertClaim(result.claim);
                    return json(409, { ok: false, error: 'Minecraft bot is offline; payment was not recorded.' });
                }
                return json(200, { ok: true, data: this._publicState() });
            }

            if (req.method === 'GET' && url.pathname === '/api/events') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no'
                });
                res.write(`data: ${JSON.stringify(this._publicState())}\n\n`);
                this.sseClients.add(res);
                const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
                req.on('close', () => { clearInterval(ping); this.sseClients.delete(res); });
                return;
            }

            res.writeHead(404);
            res.end('Not found');
        } catch (e) {
            Logger.error(`HTTP error: ${e.message}`);
            try { res.writeHead(500); res.end('Server error'); } catch (_) {}
        }
    }

    _publicState() {
        const s = this.store.get();
        return {
            payoutAmount: s.payoutAmount,
            balance: s.balance,
            totalPaid: s.totalPaid,
            claims: s.claims
        };
    }

    _sessionToken(req) {
        const match = String(req.headers.cookie || '').match(/(?:^|;\s*)payout_session=([^;]+)/);
        return match ? match[1] : null;
    }

    _isWebAuthenticated(token) {
        if (!token) return false;
        const expiry = this.webSessions.get(token);
        if (!expiry || expiry < Date.now()) {
            this.webSessions.delete(token);
            return false;
        }
        return true;
    }

    _readJson(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', c => {
                body += c;
                if (body.length > 1e5) { reject(new Error('body too large')); req.destroy(); }
            });
            req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
            req.on('error', reject);
        });
    }

    _broadcastSSE() {
        const payload = `data: ${JSON.stringify(this._publicState())}\n\n`;
        this.sseClients.forEach(r => { try { r.write(payload); } catch (_) {} });
    }
}

module.exports = { PayoutBridge };
