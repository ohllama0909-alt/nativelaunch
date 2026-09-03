/**
 * 🍌 BananaMoney Lite - Payout Store (JSON DB)
 * Stores balance, payout amount, discord link config, admin password,
 * and all claims. Guarantees no same-discord or same-mc-username
 * double claims for the Discord flow. Direct admin payouts bypass dedupe.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Ensure logger.js exists in the same directory
const Logger = require('./logger.js');

const DATA_ROOT = process.env.BOT_DATA_DIR
    || ((process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) ? path.resolve(process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) : path.join(__dirname, '../..'));
const FILE = path.join(DATA_ROOT, 'system_data/payouts.json');

const DEFAULTS = {
    discord: { token: '', guildId: '', channelId: '', enabled: false },
    web: { port: 3000 },
    payoutAmount: '50M',
    balance: 0,
    totalPaid: 0,
    adminPassword: '', // empty = not yet configured; first /api/login sets it
    adminPasswordHash: '',
    claims: [] // { discordId?, discordTag?, mcUsername, amount, amountRaw, timestamp, status, source: 'discord'|'admin' }
};

/**
 * Parse amounts like "50M", "1.5B", "2500k", "1000" → raw integer
 */
function parseAmount(input) {
    if (input === null || input === undefined) return null;
    const m = String(input).trim().match(/^([\d,.]+)\s*([kKmMbB])?$/);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(n) || n < 0) return null;
    const suf = (m[2] || '').toLowerCase();
    if (suf === 'k') n *= 1e3;
    else if (suf === 'm') n *= 1e6;
    else if (suf === 'b') n *= 1e9;
    return Math.floor(n);
}

/**
 * Format raw number back to nice short string
 */
function formatAmount(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2).replace(/\.00$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2).replace(/\.00$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 2).replace(/\.00$/, '') + 'K';
    return String(n);
}

class PayoutStore {
    constructor() {
        this.listeners = new Set();
        this.data = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(FILE)) {
                const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
                return {
                    ...DEFAULTS,
                    ...raw,
                    discord: { ...DEFAULTS.discord, ...(raw.discord || {}) },
                    web: { ...DEFAULTS.web, ...(raw.web || {}) }
                };
            }
        } catch (e) {
            Logger.error(`PayoutStore load error: ${e.message}`);
        }
        try {
            const dir = path.dirname(FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        } catch (_) { }
        return JSON.parse(JSON.stringify(DEFAULTS));
    }

    _save() {
        try {
            fs.writeFileSync(FILE, JSON.stringify(this.data, null, 2));
        } catch (e) {
            Logger.error(`PayoutStore save error: ${e.message}`);
        }
    }

    get() { return this.data; }

    onChange(fn) { this.listeners.add(fn); }
    offChange(fn) { this.listeners.delete(fn); }
    _emit() { this.listeners.forEach(fn => { try { fn(this.data); } catch (_) { } }); }

    update(partial) {
        if (partial.discord) partial.discord = { ...this.data.discord, ...partial.discord };
        if (partial.web) partial.web = { ...this.data.web, ...partial.web };
        Object.assign(this.data, partial);
        this._save();
        this._emit();
    }

    setAdminPassword(pwd) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(String(pwd || ''), salt, 120000, 32, 'sha256').toString('hex');
        this.data.adminPassword = '';
        this.data.adminPasswordHash = `pbkdf2:sha256:120000$${salt}$${hash}`;
        this._save();
        this._emit();
    }

    checkAdminPassword(pwd) {
        const stored = String(this.data.adminPasswordHash || '');
        if (stored) {
            const parts = stored.split('$');
            if (parts.length !== 3 || parts[0] !== 'pbkdf2:sha256:120000') return false;
            const derived = crypto.pbkdf2Sync(String(pwd || ''), parts[1], 120000, 32, 'sha256').toString('hex');
            return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(parts[2], 'hex'));
        }
        const a = String(this.data.adminPassword || '');
        const b = String(pwd || '');
        if (a.length === 0 || b.length === 0) return false;
        if (a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
    }

    isAdminPasswordUnset() {
        return !(this.data.adminPasswordHash || this.data.adminPassword);
    }

    tryClaim({ discordId, discordTag, mcUsername }) {
        if (!discordId || !mcUsername) return { ok: false, reason: 'Invalid claim data.' };
        if (!/^[a-zA-Z0-9_]{3,16}$/.test(mcUsername)) {
            return { ok: false, reason: 'Invalid Minecraft username (3-16 chars, letters/numbers/underscore).' };
        }

        if (this.data.claims.some(c => c.discordId && c.discordId === discordId)) {
            return { ok: false, reason: 'You have already claimed your payout with this Discord account.' };
        }
        if (this.data.claims.some(c => c.mcUsername.toLowerCase() === mcUsername.toLowerCase() && c.source !== 'admin')) {
            return { ok: false, reason: `The Minecraft username \`${mcUsername}\` has already claimed.` };
        }

        const amountRaw = parseAmount(this.data.payoutAmount);
        if (!amountRaw || amountRaw <= 0) {
            return { ok: false, reason: 'Payout amount is not configured.' };
        }
        if (this.data.balance < amountRaw) {
            return { ok: false, reason: 'The payout pool is currently empty. Try again later.' };
        }

        const claim = {
            discordId,
            discordTag: discordTag || 'unknown',
            mcUsername,
            amount: this.data.payoutAmount,
            amountRaw,
            timestamp: new Date().toISOString(),
            status: 'paid',
            source: 'discord'
        };
        this.data.claims.push(claim);
        this.data.totalPaid += amountRaw;
        this.data.balance = Math.max(0, this.data.balance - amountRaw);
        this._save();
        this._emit();
        return { ok: true, claim };
    }

    directPay({ mcUsername, amount }) {
        if (!mcUsername) return { ok: false, reason: 'Minecraft username required.' };
        if (!/^[a-zA-Z0-9_]{3,16}$/.test(mcUsername)) {
            return { ok: false, reason: 'Invalid Minecraft username (3-16 chars, letters/numbers/underscore).' };
        }
        const amountRaw = parseAmount(amount);
        if (!amountRaw || amountRaw <= 0) {
            return { ok: false, reason: 'Invalid amount. Use e.g. 50M, 1.5B, 1000000.' };
        }
        if (this.data.balance < amountRaw) {
            return { ok: false, reason: `Insufficient pool balance (have ${this.data.balance.toLocaleString()}, need ${amountRaw.toLocaleString()}).` };
        }

        const claim = {
            discordId: null,
            discordTag: 'admin-panel',
            mcUsername,
            amount: String(amount),
            amountRaw,
            timestamp: new Date().toISOString(),
            status: 'paid',
            source: 'admin'
        };
        this.data.claims.push(claim);
        this.data.totalPaid += amountRaw;
        this.data.balance = Math.max(0, this.data.balance - amountRaw);
        this._save();
        this._emit();
        return { ok: true, claim };
    }

    revertClaim(claim) {
        const idx = this.data.claims.findIndex(c =>
            c.mcUsername === claim.mcUsername &&
            c.timestamp === claim.timestamp &&
            (c.discordId || null) === (claim.discordId || null)
        );
        if (idx === -1) return false;
        this.data.claims.splice(idx, 1);
        this.data.totalPaid = Math.max(0, this.data.totalPaid - claim.amountRaw);
        this.data.balance += claim.amountRaw;
        this._save();
        this._emit();
        return true;
    }
}

module.exports = { PayoutStore, parseAmount, formatAmount };
