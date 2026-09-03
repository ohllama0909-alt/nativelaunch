/**
 * Premium-profile-inspired Minecraft username generator.
 *
 * A real Java profile is selected and verified through Mojang, then a small,
 * human-style suffix/prefix is added. The candidate is accepted only when
 * Mojang reports that no profile currently owns it. Accepted names are
 * reserved on disk immediately so concurrent users and later restarts never
 * receive the same suggestion.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const DATA_ROOT = (process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR)
    ? path.resolve(process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR)
    : path.join(__dirname, '../..');
const DEFAULT_FILE = path.join(DATA_ROOT, 'system_data', 'generated-usernames.json');

// Short, established Java profile names make good seeds while leaving enough
// room for a subtle suffix inside Minecraft's 16-character limit.
const PREMIUM_SEEDS = [
    'Grian', 'Mumbo', 'Dream', 'Sapnap', 'Skeppy', 'TapL', 'Purpled', 'Punz',
    'Quig', 'Tubbo', 'Ranboo', 'Antfrost', 'EthosLab', 'Illumina', 'Krtzyy',
    'JeromeASF', 'Vikkstar123', 'DanTDM', 'PrestonPlayz', 'CaptainPuffy',
    'Fruitberries', 'Smallishbeans', 'xisumavoid', 'Solidarity', 'SB737'
];

function randomInt(max) {
    return crypto.randomInt(0, max);
}

function shuffled(values) {
    const copy = values.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function lookupMojangProfile(username, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const request = https.get({
            hostname: 'api.mojang.com',
            path: `/users/profiles/minecraft/${encodeURIComponent(username)}`,
            headers: { Accept: 'application/json', 'User-Agent': 'NativeLaunch/4 username-generator' }
        }, response => {
            let raw = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                if (raw.length < 16_384) raw += chunk;
            });
            response.on('end', () => {
                if (response.statusCode === 200) {
                    try {
                        const profile = JSON.parse(raw);
                        if (profile && profile.id && profile.name) {
                            return resolve({ exists: true, profile });
                        }
                    } catch (_) { }
                    const error = new Error('Mojang returned an invalid profile response');
                    error.code = 'UPSTREAM_INVALID';
                    return reject(error);
                }
                if (response.statusCode === 204 || response.statusCode === 404) {
                    return resolve({ exists: false, profile: null });
                }
                const error = new Error(
                    response.statusCode === 429
                        ? 'Mojang is rate-limiting username checks. Try again in a moment.'
                        : 'Mojang username checks are temporarily unavailable.'
                );
                error.code = response.statusCode === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_UNAVAILABLE';
                reject(error);
            });
        });
        request.setTimeout(timeoutMs, () => request.destroy(new Error('Mojang username check timed out')));
        request.on('error', error => {
            if (!error.code) error.code = 'UPSTREAM_UNAVAILABLE';
            reject(error);
        });
    });
}

function humanVariation(source, attempt = 0) {
    const clean = String(source || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 14) || 'Player';
    const digit = () => String(randomInt(10));
    const number = (length) => Array.from({ length }, digit).join('');
    const letter = () => 'xyzqvkr'.charAt(randomInt(7));
    const patterns = [
        () => `${clean}${number(2)}`,
        () => `${clean}_${digit()}`,
        () => `${clean}${letter()}`,
        () => `${letter()}${clean}${digit()}`,
        () => `${clean}${number(3)}`,
        () => `${clean}_${letter()}`,
        () => `${clean}${letter()}${digit()}`,
    ];
    const candidate = patterns[(attempt + randomInt(patterns.length)) % patterns.length]();
    return candidate.slice(0, 16).replace(/_+$/g, `${digit()}`);
}

class UsernameGenerator {
    constructor(options = {}) {
        this.file = options.file || DEFAULT_FILE;
        this.lookup = options.lookup || lookupMojangProfile;
        this.seedCache = new Map();
        this.history = this._load();
        this.queue = Promise.resolve();
    }

    _load() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            return { used: Array.isArray(parsed.used) ? parsed.used : [] };
        } catch (_) {
            return { used: [] };
        }
    }

    _save() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const temp = `${this.file}.tmp-${process.pid}`;
        fs.writeFileSync(temp, JSON.stringify(this.history, null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(temp, this.file);
        try { fs.chmodSync(this.file, 0o600); } catch (_) { }
    }

    reserve(username, ownerId = null, details = {}) {
        const value = String(username || '').trim();
        if (!/^[A-Za-z0-9_]{3,16}$/.test(value)) return false;
        if (this.history.used.some(row => String(row.username).toLowerCase() === value.toLowerCase())) return false;
        this.history.used.push({
            username: value,
            ownerId: ownerId || null,
            source: details.source || null,
            generatedAt: new Date().toISOString()
        });
        // This is a uniqueness ledger, but cap pathological growth while keeping
        // years of ordinary use. The newest reservation always wins the trim.
        if (this.history.used.length > 25_000) this.history.used = this.history.used.slice(-25_000);
        this._save();
        return true;
    }

    async _verifiedSeed() {
        const now = Date.now();
        for (const seed of shuffled(PREMIUM_SEEDS)) {
            const cached = this.seedCache.get(seed.toLowerCase());
            if (cached && now - cached.checkedAt < 24 * 60 * 60 * 1000) return cached.name;
            const result = await this.lookup(seed);
            if (result.exists && result.profile && result.profile.name) {
                const value = { name: result.profile.name, checkedAt: now };
                this.seedCache.set(seed.toLowerCase(), value);
                return value.name;
            }
        }
        const error = new Error('Could not find a verified Minecraft profile seed');
        error.code = 'NO_SEED';
        throw error;
    }

    generate({ excluded = [], ownerId = null } = {}) {
        const task = this.queue.then(async () => {
            const blocked = new Set([
                ...this.history.used.map(row => row.username),
                ...excluded
            ].filter(Boolean).map(value => String(value).toLowerCase()));
            const seed = await this._verifiedSeed();

            for (let attempt = 0; attempt < 12; attempt++) {
                const candidate = humanVariation(seed, attempt);
                if (!/^[A-Za-z0-9_]{3,16}$/.test(candidate) || blocked.has(candidate.toLowerCase())) continue;
                const status = await this.lookup(candidate);
                if (status.exists) continue;
                this.reserve(candidate, ownerId, { source: seed });
                return {
                    username: candidate,
                    inspiredBy: seed,
                    checkedAt: new Date().toISOString(),
                    availability: 'unregistered'
                };
            }
            const error = new Error('Could not find a fresh username. Try generating again.');
            error.code = 'NO_CANDIDATE';
            throw error;
        });
        this.queue = task.catch(() => undefined);
        return task;
    }
}

module.exports = { UsernameGenerator, lookupMojangProfile, humanVariation };
