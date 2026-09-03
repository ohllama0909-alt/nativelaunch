/**
 * 🍌 BananaMoney Lite - Auto Register / Auto Login
 *
 * Cracked (offline-mode) servers gate spawn behind an auth plugin: a brand-new
 * name is told to /register, a known one to /login. This module watches chat and
 * answers whichever prompt arrives.
 *
 * Both halves toggle independently (!autoregister / !autologin) but live in one
 * module on purpose: plenty of servers print "use /login or /register" in a
 * single line, and two separate listeners would both match it and fire twice —
 * which reads as a failed auth attempt and, on some plugins, a kick.
 *
 * The module never decides policy on its own; BananaBot owns the flags and the
 * password, and passes callbacks so the bot can pause its other modules for the
 * duration of the handshake.
 */

const Logger = require('../utils/logger.js');

// A prompt has to name the command AND look like an auth line. Matching a bare
// "/login" would let ordinary player chat trigger a password send.
const REGISTER_HINTS = [
    'not registered',
    'need to register',
    'please register',
    'register using',
    'register with',
    'to register',
    'create an account',
    'create account',
    'register your account',
    '/register <',
    '/register [',
];

const LOGIN_HINTS = [
    'already registered',
    'please login',
    'please log in',
    'login using',
    'login with',
    'log in using',
    'to login',
    'to log in',
    '/login <',
    '/login [',
    'password',
];

// Player chat, e.g. "<Steve> use /login" or "[VIP] Steve: /login <password>".
// Auth prompts come from the server and have no speaker prefix. Without this
// guard any player could bait the bot into broadcasting its password to public
// chat just by typing a convincing prompt.
//
// Bare "Word:" leads must NOT be rejected though: many auth plugins print the
// required command as "Command: /login <password>", which would otherwise look
// like a player name + colon. Only a genuine speaker tag (<name> or
// [rank] name) proves the line is player chat.
const PLAYER_CHAT_RE = /^\s*\[[^\]]{1,24}\]\s*(?:<[^<>]{1,20}>|[A-Za-z0-9_]{1,16}\s*[:»])\s*\S/;
const ANGLE_SPEAKER_RE = /^\s*<[^<>]{1,20}>\s*\S/;

class AutoAuth {
    /**
     * @param {object} bot mineflayer bot
     * @param {object} opts
     * @param {() => boolean} opts.isRegisterEnabled
     * @param {() => boolean} opts.isLoginEnabled
     * @param {() => string|null} opts.getPassword
     * @param {() => void} [opts.onAuthStart] called before the first send
     * @param {() => void} [opts.onAuthDone]  called once the handshake settles
     */
    constructor(bot, opts = {}) {
        this.bot = bot;
        this.isRegisterEnabled = opts.isRegisterEnabled || (() => false);
        this.isLoginEnabled = opts.isLoginEnabled || (() => false);
        this.getPassword = opts.getPassword || (() => null);
        this.onAuthStart = opts.onAuthStart || (() => {});
        this.onAuthDone = opts.onAuthDone || (() => {});

        this.busy = false;          // a send is in flight
        this.lastSentAt = 0;
        this.registered = false;    // we've already sent /register this session
        this.loggedIn = false;      // we've already sent /login this session
        // Servers repeat the prompt every few seconds until you comply; without
        // a floor we'd answer each repeat and trip the plugin's rate limit.
        this.minGapMs = 2500;
    }

    /** Reset per-connection state so a reconnect re-authenticates. */
    reset() {
        this.busy = false;
        this.registered = false;
        this.loggedIn = false;
        this.lastSentAt = 0;
    }

    _matches(lower, hints) {
        return hints.some(h => lower.includes(h));
    }

    /**
     * Classify a chat line as a register prompt, a login prompt, or neither.
     * @returns {'register'|'login'|null}
     */
    classify(message) {
        const raw = String(message || '');
        const lower = raw.toLowerCase();
        const hasRegister = lower.includes('/register');
        const hasLogin = lower.includes('/login');
        if (!hasRegister && !hasLogin) return null;

        // Only reject lines with a real speaker prefix, and only when the line
        // names an auth command. A bait like "<Steve> use /login" is still
        // skipped; "Command: /login <password>" is not.
        if (ANGLE_SPEAKER_RE.test(raw) || PLAYER_CHAT_RE.test(raw)) return null;

        const looksRegister = hasRegister && this._matches(lower, REGISTER_HINTS);
        const looksLogin = hasLogin && this._matches(lower, LOGIN_HINTS);

        // "not registered" wins outright — that's the server telling us this
        // name has no account yet, even if the same line also lists /login.
        if (lower.includes('not registered') || lower.includes('need to register')) {
            return 'register';
        }
        if (looksRegister && looksLogin) {
            // A combined help line. Prefer login: on an account that already
            // exists a stray /register is rejected harmlessly, whereas guessing
            // register first would leave us unauthenticated on the retry.
            return 'login';
        }
        if (looksRegister) return 'register';
        if (looksLogin) return 'login';
        return null;
    }

    /**
     * Feed a chat line in. Returns true when it triggered an auth send.
     */
    handleMessage(message) {
        const password = this.getPassword();
        if (!password) return false;
        if (this.busy) return false;
        if (Date.now() - this.lastSentAt < this.minGapMs) return false;

        const kind = this.classify(message);
        if (!kind) return false;

        if (kind === 'register') {
            if (!this.isRegisterEnabled() || this.registered) return false;
            return this._send('register', `/register ${password} ${password}`);
        }
        if (!this.isLoginEnabled() || this.loggedIn) return false;
        return this._send('login', `/login ${password}`);
    }

    _send(kind, command) {
        this.busy = true;
        this.lastSentAt = Date.now();
        if (kind === 'register') this.registered = true; else this.loggedIn = true;

        Logger.system(kind === 'register'
            ? '📝 Register prompt detected — auto-registering...'
            : '🔓 Login prompt detected — auto-logging in...');

        try { this.onAuthStart(); } catch (_) { /* ignore */ }

        // Small delay: the auth plugin usually isn't ready for input on the very
        // tick it prints the prompt.
        setTimeout(() => {
            try {
                if (this.bot && this.bot.entity) {
                    this.bot.chat(command);
                    Logger.system(kind === 'register'
                        ? '🔑 Sent registration.'
                        : '🔑 Sent login password.');
                }
            } catch (e) {
                Logger.error(`Auto-${kind} failed: ${e.message}`);
            }

            setTimeout(() => {
                this.busy = false;
                // A fresh /register leaves most plugins already authenticated,
                // but the ones that don't will print the login prompt next —
                // clearing loggedIn lets that second step through.
                if (kind === 'register') this.loggedIn = false;
                try { this.onAuthDone(); } catch (_) { /* ignore */ }
            }, 3000);
        }, 800);

        return true;
    }
}

module.exports = { AutoAuth };
