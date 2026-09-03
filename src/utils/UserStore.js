/**
 * 🍌 BananaMoney — User Account Store (JSON DB)
 *
 * Pterodactyl-style account system:
 *   - Users have a role: 'admin' or 'user'.
 *   - Admins manage accounts and see every proxy; bot visibility is scoped by
 *     their own permissions like anyone else, so an operator who only runs one
 *     category isn't shown the other tenants' bots.
 *   - Legacy permissions are stored per user for migration of old rosters.
 *       allBots: boolean        — manage every bot
 *       botIds: string[]        — explicit bot IDs
 *       categories: string[]    — bot categories (case-insensitive)
 *   - Passwords are hashed with PBKDF2-SHA256 (no external deps).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = (process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) ? path.resolve(process.env.NATIVELAUNCH_DATA_DIR || process.env.BOTHIVE_DATA_DIR) : path.join(__dirname, '../..');
const FILE = path.join(DATA_ROOT, 'system_data/users.json');
const SALT_LEN = 16;
const KEY_LEN = 32;
const ITERATIONS = 100000;

const DEFAULTS = {
  users: []
};

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, 'sha256').toString('hex');
  return `pbkdf2:sha256:${ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== `pbkdf2:sha256:${ITERATIONS}`) return false;
  const salt = parts[1];
  const hash = parts[2];
  const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
}

function cleanId(id) {
  return String(id || '').trim().toLowerCase();
}

/**
 * Accept either an email address or a bare login name.
 *
 * The `email` field doubles as the login identifier and the bootstrap admin
 * signs in as plain "admin", so requiring an @ would make existing accounts
 * un-editable and block usernames like "atlas".
 */
function isValidLogin(value) {
  const v = String(value || '').trim();
  if (v.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  return /^[a-z0-9._-]{2,32}$/i.test(v);
}

function cleanList(arr) {
  return Array.isArray(arr) ? arr.map(cleanId).filter(Boolean) : [];
}

class UserStore {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      ensureDir(path.dirname(FILE));
      if (fs.existsSync(FILE)) {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return { ...DEFAULTS, ...raw };
      }
    } catch (e) {
      console.error('UserStore load error:', e.message);
    }
    return JSON.parse(JSON.stringify(DEFAULTS));
  }

  _save() {
    try {
      ensureDir(path.dirname(FILE));
      fs.writeFileSync(FILE, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('UserStore save error:', e.message);
    }
  }

  list() {
    return this.data.users.map(u => this.sanitize(u));
  }

  findByEmail(email) {
    const needle = cleanId(email);
    return this.data.users.find(u => cleanId(u.email) === needle) || null;
  }

  findById(id) {
    return this.data.users.find(u => u.id === id) || null;
  }

  sanitize(u) {
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      permissions: {
        allBots: !!u.permissions?.allBots,
        botIds: cleanList(u.permissions?.botIds),
        categories: cleanList(u.permissions?.categories)
      },
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt || null
    };
  }

  create({ email, password, role = 'user', permissions = {} }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !password) return { ok: false, reason: 'Email and password required.' };
    if (!isValidLogin(cleanEmail)) {
      return { ok: false, reason: 'Use an email address or a 2-32 character username.' };
    }
    if (this.findByEmail(cleanEmail)) return { ok: false, reason: 'User already exists.' };
    if (String(password).length < 6) return { ok: false, reason: 'Password must be at least 6 characters.' };

    const user = {
      id: crypto.randomUUID(),
      email: cleanEmail,
      passwordHash: hashPassword(password),
      role: role === 'admin' ? 'admin' : 'user',
      permissions: {
        allBots: !!permissions?.allBots,
        botIds: cleanList(permissions?.botIds),
        categories: cleanList(permissions?.categories)
      },
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    };
    this.data.users.push(user);
    this._save();
    return { ok: true, user: this.sanitize(user) };
  }

  update(id, { email, password, role, permissions }) {
    const user = this.findById(id);
    if (!user) return { ok: false, reason: 'User not found.' };

    if (email !== undefined) {
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !isValidLogin(cleanEmail)) {
        return { ok: false, reason: 'Use an email address or a 2-32 character username.' };
      }
      const existing = this.findByEmail(cleanEmail);
      if (existing && existing.id !== id) return { ok: false, reason: 'Email already in use.' };
      user.email = cleanEmail;
    }

    if (password !== undefined && password !== null && password !== '') {
      if (String(password).length < 6) return { ok: false, reason: 'Password must be at least 6 characters.' };
      user.passwordHash = hashPassword(password);
    }

    if (role !== undefined) user.role = role === 'admin' ? 'admin' : 'user';

    if (permissions !== undefined) {
      user.permissions = {
        allBots: !!permissions?.allBots,
        botIds: cleanList(permissions?.botIds),
        categories: cleanList(permissions?.categories)
      };
    }

    this._save();
    return { ok: true, user: this.sanitize(user) };
  }

  delete(id) {
    const idx = this.data.users.findIndex(u => u.id === id);
    if (idx === -1) return { ok: false, reason: 'User not found.' };
    this.data.users.splice(idx, 1);
    this._save();
    return { ok: true };
  }

  recordLogin(id) {
    const user = this.findById(id);
    if (user) {
      user.lastLoginAt = new Date().toISOString();
      this._save();
    }
  }

  authenticate(email, password) {
    const user = this.findByEmail(email);
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    this.recordLogin(user.id);
    return this.sanitize(user);
  }

  ensureFirstAdmin(email, password) {
    if (this.data.users.length === 0) {
      return this.create({ email, password, role: 'admin', permissions: { allBots: true } });
    }
    return null;
  }

  /**
   * Tenant bots use `ownerId` as their source of truth. Legacy, owner-less
   * records retain the old grant model so an existing installation does not
   * lose access during the migration. New bot records never inherit category
   * or all-bot permissions from another tenant.
   */
  canManageBot(user, bot) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (bot && bot.ownerId) {
      if (bot.ownerId === user.id) return true;
      return Array.isArray(bot.sharedWith) && bot.sharedWith.includes(user.id);
    }
    const perms = user.permissions || {};
    if (perms.allBots) return true;
    const botId = cleanId(bot.id);
    if (cleanList(perms.botIds).includes(botId)) return true;
    const cat = cleanId(bot.config?.category || 'Uncategorized');
    if (cleanList(perms.categories).includes(cat)) return true;
    return false;
  }

  filterBots(user, bots) {
    if (!user) return [];
    return bots.filter(b => this.canManageBot(user, b));
  }

  isBotOwner(user, bot) {
    return !!(user && bot && (user.role === 'admin' || bot.ownerId === user.id));
  }

  /** Grant a user explicit access to one bot (used when they create it). */
  grantBot(id, botId) {
    const user = this.findById(id);
    if (!user) return false;
    if (!user.permissions) user.permissions = { allBots: false, botIds: [], categories: [] };
    const list = cleanList(user.permissions.botIds);
    const clean = cleanId(botId);
    if (!list.includes(clean)) {
      user.permissions.botIds = list.concat(clean);
      this._save();
    }
    return true;
  }

  /** Drop a bot from every user's explicit grants (used when it's deleted). */
  revokeBotEverywhere(botId) {
    const clean = cleanId(botId);
    let changed = false;
    this.data.users.forEach(u => {
      const list = cleanList(u.permissions?.botIds);
      if (list.includes(clean)) {
        u.permissions.botIds = list.filter(x => x !== clean);
        changed = true;
      }
    });
    if (changed) this._save();
    return changed;
  }
}

module.exports = { UserStore, hashPassword, verifyPassword };
