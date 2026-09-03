/**
 * 🍌 BananaMoney — Proxy Pool Store (JSON DB)
 *
 * The panel used to carry its SOCKS5 list as a hardcoded `PROXY_LIST` array
 * inside multibot.html, which meant rotating providers required editing the
 * markup. The pool now lives here, in system_data/proxies.json, so it can be
 * managed from the Proxies page at runtime.
 *
 * Each entry:
 *   {
 *     id:        "px_ab12cd34",
 *     host:      "1.2.3.4",
 *     port:      1080,
 *     username:  "user"    | null,
 *     password:  "pass"    | null,
 *     note:      ""                  — free-text label from the user
 *     owner:     "<userId>" | null   — the account whose pool this belongs to
 *     addedAt:   ISO timestamp,
 *     lastCheck: { ok, ms, ip, at, reason } | null
 *   }
 *
 * Entries are keyed by host:port — importing the same endpoint twice updates
 * the existing row instead of creating a duplicate, because a duplicated proxy
 * would let two bots share one exit IP without the UI being able to warn about
 * it.
 *
 * Ownership: each entry belongs to one account, so a regular user's Proxies
 * page shows only their own endpoints and never another tenant's credentials.
 * `owner: null` means unclaimed — visible to admins only, which is what legacy
 * rows seeded from config/proxies.txt look like until they're assigned.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = (process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) ? path.resolve(process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) : path.join(__dirname, '../..');
const FILE = path.join(DATA_ROOT, 'system_data/proxies.json');

const DEFAULTS = { proxies: [] };

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function newId() {
    return 'px_' + crypto.randomBytes(4).toString('hex');
}

/**
 * Parse one user-supplied line into a proxy record.
 *
 * Accepts the shapes people actually paste from proxy providers:
 *   host:port
 *   host:port:user:pass
 *   user:pass@host:port
 *   socks5://user:pass@host:port
 *   socks5://host:port
 * Separators may be ':' or '|', and surrounding whitespace/quotes are ignored.
 *
 * @returns {{host:string,port:number,username:string|null,password:string|null}|null}
 */
function parseLine(line) {
    if (!line || typeof line !== 'string') return null;
    let s = line.trim().replace(/^["']|["']$/g, '').trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) return null;

    // Drop an optional scheme; the pool is SOCKS5-only (that's what
    // utils/proxy.js dials), so we don't retain it.
    s = s.replace(/^socks(5h?|4a?)?:\/\//i, '');
    s = s.replace(/\|/g, ':');

    let username = null;
    let password = null;

    // Credentials-before-@ form.
    const at = s.lastIndexOf('@');
    if (at !== -1) {
        const creds = s.slice(0, at);
        s = s.slice(at + 1);
        const ci = creds.indexOf(':');
        if (ci !== -1) {
            username = creds.slice(0, ci);
            password = creds.slice(ci + 1);
        } else if (creds) {
            username = creds;
        }
    }

    const parts = s.split(':').map(x => x.trim()).filter(x => x !== '');
    if (parts.length < 2) return null;

    const host = parts[0];
    const port = parseInt(parts[1], 10);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;

    // host:port:user:pass form (only when creds weren't already given via '@').
    if (username === null && parts.length >= 3) {
        username = parts[2] || null;
        password = parts.length >= 4 ? parts.slice(3).join(':') : null;
    }

    return {
        host,
        port,
        username: username || null,
        password: password || null
    };
}

/** Canonical socks5 URI for a record — this is what a bot config stores. */
function toUri(p) {
    if (!p || !p.host || !p.port) return '';
    const auth = p.username
        ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || '')}@`
        : '';
    return `socks5://${auth}${p.host}:${p.port}`;
}

/** Display label that never includes the password. */
function toLabel(p) {
    if (!p || !p.host) return '';
    return `${p.host}:${p.port}`;
}

function keyOf(p) {
    return `${String(p.host).toLowerCase()}:${p.port}`;
}

class ProxyStore {
    constructor() {
        this.data = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(FILE)) {
                const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
                return { proxies: Array.isArray(parsed.proxies) ? parsed.proxies : [] };
            }
        } catch (_) {
            // A corrupt pool file must not stop the panel from booting; an empty
            // pool is recoverable from the UI, an unbootable panel is not.
        }
        return JSON.parse(JSON.stringify(DEFAULTS));
    }

    _save() {
        try {
            ensureDir(path.dirname(FILE));
            fs.writeFileSync(FILE, JSON.stringify(this.data, null, 2) + '\n');
            // Credentials: keep the file owner-only.
            try { fs.chmodSync(FILE, 0o600); } catch (_) { }
            return true;
        } catch (_) {
            return false;
        }
    }

    list() {
        return this.data.proxies.slice();
    }

    /**
     * Pool visible to one account. Admins see everything (including unclaimed
     * legacy rows); everyone else sees only what they own, so one tenant can
     * never read another's proxy credentials.
     */
    listFor(user) {
        if (!user) return [];
        if (user.role === 'admin') return this.list();
        return this.data.proxies.filter(p => p.owner === user.id);
    }

    /** May this account see/mutate this entry? */
    canAccess(user, rec) {
        if (!user || !rec) return false;
        if (user.role === 'admin') return true;
        return rec.owner === user.id;
    }

    get(id) {
        return this.data.proxies.find(p => p.id === id) || null;
    }

    /** Find a record by its host:port, whatever input shape is given. */
    findByUri(input) {
        const parsed = parseLine(String(input || ''));
        if (!parsed) return null;
        const k = keyOf(parsed);
        return this.data.proxies.find(p => keyOf(p) === k) || null;
    }

    /**
     * Bulk import from pasted text (one proxy per line).
     * @returns {{added:number, updated:number, invalid:string[], ids:string[]}}
     */
    importText(text, owner = null, { takeover = false } = {}) {
        const lines = String(text || '').split(/[\r\n,]+/);
        const result = { added: 0, updated: 0, invalid: [], conflicts: [], ids: [] };

        for (const raw of lines) {
            const trimmed = raw.trim();
            // Blank lines and comments are formatting, not bad input — reporting
            // them as "unreadable" would make a tidy pasted list look broken.
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
            const parsed = parseLine(raw);
            if (!parsed) {
                result.invalid.push(trimmed);
                continue;
            }
            const k = keyOf(parsed);
            const existing = this.data.proxies.find(p => keyOf(p) === k);
            if (existing) {
                // Never let one account rewrite an endpoint another account owns
                // — that would hand them a working credential by way of an
                // "update". Report it instead of silently taking it over.
                if (!takeover && existing.owner && owner && existing.owner !== owner) {
                    result.conflicts.push(trimmed);
                    continue;
                }
                existing.username = parsed.username;
                existing.password = parsed.password;
                if (owner && !existing.owner) existing.owner = owner;
                result.updated++;
                result.ids.push(existing.id);
            } else {
                const rec = {
                    id: newId(),
                    host: parsed.host,
                    port: parsed.port,
                    username: parsed.username,
                    password: parsed.password,
                    note: '',
                    owner: owner || null,
                    addedAt: new Date().toISOString(),
                    lastCheck: null
                };
                this.data.proxies.push(rec);
                result.added++;
                result.ids.push(rec.id);
            }
        }

        this._save();
        return result;
    }

    /**
     * Replace a pool with the given text.
     *
     * Scoped to one owner when `owner` is given, so a tenant pressing "replace"
     * clears their own endpoints and leaves everyone else's pool intact. Only an
     * admin replacing with no owner wipes the whole table.
     */
    replaceAllFromText(text, owner = null, opts = {}) {
        this.data.proxies = owner
            ? this.data.proxies.filter(p => p.owner !== owner)
            : [];
        return this.importText(text, owner, opts);
    }

    update(id, patch) {
        const p = this.get(id);
        if (!p) return null;
        if (typeof patch.note === 'string') p.note = patch.note.slice(0, 200);
        if (patch.owner !== undefined) p.owner = patch.owner || null;
        this._save();
        return p;
    }

    remove(id) {
        const i = this.data.proxies.findIndex(p => p.id === id);
        if (i === -1) return false;
        this.data.proxies.splice(i, 1);
        this._save();
        return true;
    }

    /**
     * Delete by id. When `user` is given, only entries that account may touch
     * are removed — ids belonging to someone else are left alone rather than
     * failing the whole batch.
     */
    removeMany(ids, user = null) {
        const set = new Set(ids || []);
        const before = this.data.proxies.length;
        this.data.proxies = this.data.proxies.filter(p => {
            if (!set.has(p.id)) return true;
            return user ? !this.canAccess(user, p) : false;
        });
        this._save();
        return before - this.data.proxies.length;
    }

    /** Empty the pool, or just one account's slice of it. */
    clear(owner = null) {
        const before = this.data.proxies.length;
        this.data.proxies = owner
            ? this.data.proxies.filter(p => p.owner !== owner)
            : [];
        this._save();
        return before - this.data.proxies.length;
    }

    recordCheck(id, check) {
        const p = this.get(id);
        if (!p) return null;
        p.lastCheck = {
            ok: !!check.ok,
            ms: Number(check.ms) || 0,
            ip: check.ip || null,
            reason: check.ok ? null : (check.reason || 'failed'),
            at: new Date().toISOString()
        };
        this._save();
        return p;
    }

    /** Seed the pool once from a legacy list, only if it's still empty. */
    seedIfEmpty(text) {
        if (this.data.proxies.length) return null;
        return this.importText(text);
    }
}

module.exports = { ProxyStore, parseLine, toUri, toLabel };
