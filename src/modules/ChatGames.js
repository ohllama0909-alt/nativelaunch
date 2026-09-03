/**
 * 🍌 ChatGames — auto-solve the server's CHATGAMES.
 *
 * Rounds look like (blank [CHAT] lines and a repeated " CHATGAMES" banner
 * before the result line are normal and ignored):
 *     [CHAT]  CHATGAMES
 *     [CHAT] The first to <verb> wins!
 *     [CHAT] ▶ <payload>
 *     ...
 *     [CHAT]  CHATGAMES
 *     [CHAT] <player> <result-verb> ... in <secs> seconds!
 *
 * Handled game types (verb in the descriptor line → action on the ▶ payload):
 *   - "unreverse the letters"   → reverse the string  (metI → Item)
 *   - "solve the math equation" → safe arithmetic eval (12 * 5 - 10 → 50)
 *   - "unscramble the letters"  → anagram lookup vs a Minecraft item/block
 *                                 dictionary (crBih iSng → Birch Sign)
 *   - "type the letters"        → echo the payload verbatim
 *   - "answer the question"     → trivia: keyword match vs a built-in Q&A bank
 *   - "guess the number"        → RANGE game: spam each number in the shown
 *                                 range, 1s apart, until someone wins
 *
 * Timing (human-like / anti-ban):
 *   - Math, word AND trivia games share ONE cycling delay. It starts at ~4.1s
 *     and climbs +0.3s every solved round (plus sub-0.1s jitter so the time is
 *     4.19 not 4.10); once it passes 6s it snaps back to 4.1 and repeats.
 *   - A WORD answer (reverse/unscramble/type) longer than 10 letters gets +1s.
 *   - The RANGE game ignores the cycle: it waits 1s, then fires one guess per
 *     second across the range so it never floods chat, and stops the instant a
 *     win line shows up (us or anyone else).
 *
 * Win tracking: every result line naming THIS bot is counted per game type and
 * persisted via SystemData, so `!chatgames wins` survives reconnects/restarts.
 */

const Logger = require('../utils/logger.js');

// Common non-item words that appear in word games but aren't in the Minecraft
// registry. The bulk of the anagram dictionary is built live from bot.registry.
const EXTRA_WORDS = [
    'Power', 'Click', 'Client', 'Banner', 'Fireball', 'Sword', 'Helmet',
    'Trapdoor', 'Mossy', 'Cobblestone', 'Stairs', 'Mangrove', 'Fence',
    'Shulker', 'Obsidian', 'Netherite', 'Birch', 'Sign', 'Brown', 'Bed',
];

// Built-in Minecraft trivia. Each entry matches when enough of its keywords
// appear in the question; the best-scoring entry wins. Not exhaustive — extend
// freely. (kw = lowercase keywords that must co-occur, a = answer to type.)
const TRIVIA = [
    { kw: ['blocks', 'high', 'nether', 'build'], a: '128' },
    { kw: ['maximum', 'sharpness'], a: '5' },
    { kw: ['mob', 'drops', 'shulker', 'shells'], a: 'Shulker' },
    { kw: ['ore', 'upgrade', 'netherite'], a: 'Ancient Debris' },
    { kw: ['obsidian', 'minimum', 'nether', 'portal'], a: '10' },
    { kw: ['item', 'cure', 'zombie', 'villager'], a: 'Golden Apple' },
    { kw: ['stack', 'ender', 'pearl'], a: '16' },
    { kw: ['types', 'villager', 'profession'], a: '15' },
    { kw: ['advancement', 'potions', 'activated'], a: 'How Did We Get Here?' },
    { kw: ['build', 'limit', 'overworld'], a: '320' },
    { kw: ['hits', 'break', 'obsidian', 'fist'], a: '250' },
    { kw: ['maximum', 'efficiency'], a: '5' },
    { kw: ['maximum', 'protection'], a: '4' },
    { kw: ['maximum', 'fortune'], a: '3' },
    { kw: ['maximum', 'looting'], a: '3' },
    { kw: ['maximum', 'unbreaking'], a: '3' },
    { kw: ['maximum', 'power', 'bow'], a: '5' },
    { kw: ['maximum', 'depth', 'strider'], a: '3' },
    { kw: ['maximum', 'thorns'], a: '3' },
    { kw: ['hearts', 'player', 'have'], a: '10' },
    { kw: ['how', 'many', 'hunger'], a: '10' },
    { kw: ['diamonds', 'enchanting', 'table'], a: '2' },
    { kw: ['hostile', 'light', 'level'], a: '0' },
    { kw: ['creeper', 'afraid', 'of'], a: 'Cat' },
    { kw: ['drops', 'when', 'creeper', 'killed', 'skeleton'], a: 'Music Disc' },
    { kw: ['eat', 'wolf', 'breed'], a: 'Meat' },
    { kw: ['nether', 'wart', 'grow', 'on'], a: 'Soul Sand' },
    { kw: ['tool', 'mine', 'obsidian'], a: 'Diamond Pickaxe' },
    { kw: ['color', 'is', 'creeper'], a: 'Green' },
    { kw: ['mob', 'sells', 'enchanted', 'books'], a: 'Librarian' },
    { kw: ['what', 'do', 'endermen', 'pick', 'up'], a: 'Blocks' },
    { kw: ['blaze', 'rods', 'used', 'brewing'], a: 'Blaze Powder' },
    { kw: ['how', 'many', 'eyes', 'ender', 'activate', 'portal'], a: '12' },
    { kw: ['wither', 'soul', 'sand', 'skulls'], a: '4' },
    { kw: ['gravity', 'affected', 'blocks', 'sand'], a: 'Gravel' },
    { kw: ['villager', 'profession', 'lectern'], a: 'Librarian' },
];

// Generic words that must never drive a trivia match on their own.
const TRIVIA_STOPWORDS = new Set([
    'how', 'many', 'much', 'what', 'which', 'is', 'are', 'the', 'a', 'an', 'to',
    'do', 'does', 'you', 'your', 'of', 'in', 'it', 'have', 'there', 'for',
    'with', 'can', 'that', 'this', 'at', 'on', 'and', 'or', 'be', 'when',
]);

const RESULT_VERBS = [
    { re: /unreversed the word/i, type: 'reverse' },
    { re: /solved the equation/i, type: 'math' },
    { re: /unscrambled the word/i, type: 'unscramble' },
    { re: /typed the word/i, type: 'type' },
    { re: /answered the question correctly/i, type: 'question' },
    { re: /guessed the number/i, type: 'number' },
];

class ChatGames {
    constructor(bot, config, systemData = null) {
        this.bot = bot;
        this.config = config;
        this.systemData = systemData;
        this.username = config && config.username;
        this.running = false;

        const cg = (config && config.chatGames) || {};
        this.opts = {
            startSec:         cg.startSec         ?? 4.1,
            stepSec:          cg.stepSec          ?? 0.3,
            maxSec:           cg.maxSec           ?? 6,
            jitterSec:        cg.jitterSec        ?? 0.09,
            longWordLetters:  cg.longWordLetters  ?? 10,
            longWordBonusSec: cg.longWordBonusSec ?? 1,
            spamStartDelayMs: cg.spamStartDelayMs ?? 1000,
            spamGapMs:        cg.spamGapMs        ?? 1000,
        };

        // Shared cycling delay (seconds) for math + word + trivia games.
        this._cycleSec = this.opts.startSec;

        // Per-round state
        this._pendingType = null;
        this._answered = false;

        // Range-game spammer state
        this._spamTimer = null;
        this._spamActive = false;

        // Anagram dictionary (built lazily from bot.registry)
        this._dict = null;

        // Win counters (persisted)
        this.wins = this._loadWins();

        this._onMessage = this._onMessage.bind(this);
    }

    start() {
        if (this.running) { Logger.error('ChatGames already running!'); return; }
        this.running = true;
        this._cycleSec = this.opts.startSec;
        this._pendingType = null;
        this._answered = false;
        this._buildDict();
        this.bot.on('messagestr', this._onMessage);
        Logger.system('🎮 ChatGames solver ENABLED.');
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        this._stopSpam();
        try { this.bot.removeListener('messagestr', this._onMessage); } catch (_) {}
        Logger.system('🎮 ChatGames solver DISABLED.');
    }

    status() {
        Logger.system('=== ChatGames ===');
        Logger.info(`Running       : ${this.running ? 'yes' : 'no'}`);
        Logger.info(`Cycle delay   : ${this._cycleSec.toFixed(2)}s (next math/word/trivia answer)`);
        Logger.info(`Dictionary    : ${this._dict ? this._dict.size : 0} entries`);
        Logger.info(`Range spammer : ${this._spamActive ? 'active' : 'idle'}`);
        this.printWins();
    }

    printWins() {
        const w = this.wins;
        Logger.system(`=== ChatGames Wins (${this.username || 'bot'}) ===`);
        Logger.info(`Total       : ${w.total}`);
        Logger.info(`Unreverse   : ${w.reverse}`);
        Logger.info(`Math        : ${w.math}`);
        Logger.info(`Unscramble  : ${w.unscramble}`);
        Logger.info(`Type        : ${w.type}`);
        Logger.info(`Trivia      : ${w.question}`);
        Logger.info(`Number      : ${w.number}`);
    }

    resetWins() {
        this.wins = { total: 0, reverse: 0, math: 0, unscramble: 0, type: 0, question: 0, number: 0 };
        this._saveWins();
        Logger.system('🎮 ChatGames win counters reset.');
    }

    // ─── Chat parsing ──────────────────────────────────────────────────
    _onMessage(message) {
        if (!this.running) return;
        const text = String(message || '');

        // Result line: "<player> <result-verb> ... in <secs> seconds!"
        const rType = this._matchResultType(text);
        if (rType) {
            this._stopSpam();                 // round is over — stop guessing
            this._recordWinIfMine(text, rType);
            return;
        }

        // New round banner (also appears before the result, handled above).
        if (/\bCHATGAMES\b/.test(text)) {
            this._pendingType = null;
            this._answered = false;
            this._stopSpam();
            return;
        }

        // Descriptor line tells us which game this round is.
        const type = this._detectType(text);
        if (type) { this._pendingType = type; return; }

        // Challenge line carries the payload after the ▶ marker.
        const idx = text.indexOf('▶');
        if (idx !== -1 && this._pendingType) {
            const payload = text.slice(idx + 1).trim();
            if (payload) this._handle(this._pendingType, payload);
        }
    }

    _detectType(text) {
        const t = text.toLowerCase();
        if (t.includes('unreverse the letters')) return 'reverse';
        if (t.includes('solve the math equation')) return 'math';
        if (t.includes('unscramble the letters')) return 'unscramble';
        if (t.includes('type the letters')) return 'type';
        if (t.includes('answer the question')) return 'question';
        if (t.includes('guess the number')) return 'number';
        return null;
    }

    _matchResultType(text) {
        for (const r of RESULT_VERBS) if (r.re.test(text)) return r.type;
        return null;
    }

    _recordWinIfMine(text, type) {
        const me = (this.bot && this.bot.username) || this.username;
        if (!me) return;
        const winner = text.trim().split(/\s+/)[0];
        if (winner && winner.toLowerCase() === String(me).toLowerCase()) {
            this.wins.total++;
            this.wins[type] = (this.wins[type] || 0) + 1;
            this._saveWins();
            Logger.system(`🏆 Won ${type} game! Total wins: ${this.wins.total}`);
        }
    }

    // ─── Dispatch ──────────────────────────────────────────────────────
    _handle(type, payload) {
        if (type === 'number') { this._startRangeSpam(payload); return; }
        if (this._answered) return; // one answer per round for the timed games

        let answer = null;
        switch (type) {
            case 'reverse':    answer = [...payload].reverse().join(''); break;
            case 'type':       answer = payload; break;
            case 'unscramble': answer = this._lookupAnagram(payload); break;
            case 'math':       { const v = evalMath(payload); answer = v == null ? null : String(v); } break;
            case 'question':   answer = this._solveTrivia(payload); break;
        }

        if (answer == null || answer === '') {
            Logger.error(`🎮 No answer for ${type}: "${payload}"`);
            return;
        }

        this._answered = true;
        // Long-word bonus only applies to the literal word games.
        const isWord = (type === 'reverse' || type === 'unscramble' || type === 'type');
        const delayMs = this._nextCycleDelay(answer, isWord);
        Logger.system(`🎮 ${type} "${payload}" → "${answer}" in ${(delayMs / 1000).toFixed(2)}s`);
        setTimeout(() => {
            if (this.running && this.bot && this.bot.entity) this.bot.chat(answer);
        }, delayMs);
    }

    // Shared cycling delay: start → +step each round → wrap at maxSec.
    _nextCycleDelay(answer, isWordGame) {
        const jitter = Math.random() * this.opts.jitterSec;
        let sec = this._cycleSec + jitter;

        if (isWordGame) {
            const letters = String(answer).replace(/[^a-zA-Z]/g, '').length;
            if (letters > this.opts.longWordLetters) sec += this.opts.longWordBonusSec;
        }

        this._cycleSec += this.opts.stepSec;
        if (this._cycleSec > this.opts.maxSec) this._cycleSec = this.opts.startSec;

        return Math.round(sec * 1000);
    }

    // ─── Range (guess the number) spammer ──────────────────────────────
    _startRangeSpam(payload) {
        const m = payload.match(/(-?\d+)\s*-\s*(-?\d+)/);
        if (!m) { Logger.error(`🎮 Could not parse range: "${payload}"`); return; }
        let lo = parseInt(m[1], 10);
        let hi = parseInt(m[2], 10);
        if (isNaN(lo) || isNaN(hi)) return;
        if (lo > hi) { const t = lo; lo = hi; hi = t; }

        this._stopSpam();
        this._spamActive = true;
        Logger.system(`🎮 Range game ${lo}-${hi} → spamming guesses (1s apart) in 1s...`);

        let n = lo;
        const tick = () => {
            if (!this.running || !this._spamActive) return;
            if (!this.bot || !this.bot.entity) return;
            if (n > hi) { this._spamActive = false; this._spamTimer = null; return; }
            this.bot.chat(String(n));
            n++;
            this._spamTimer = setTimeout(tick, this.opts.spamGapMs);
        };
        this._spamTimer = setTimeout(tick, this.opts.spamStartDelayMs);
    }

    _stopSpam() {
        if (this._spamTimer) { clearTimeout(this._spamTimer); this._spamTimer = null; }
        this._spamActive = false;
    }

    // ─── Trivia ────────────────────────────────────────────────────────
    _solveTrivia(question) {
        const q = question.toLowerCase();
        let best = null, bestScore = 0;
        for (const entry of TRIVIA) {
            // Only distinctive keywords count — generic words ("how", "many",
            // "what"...) would otherwise let any question match loosely.
            const keys = entry.kw.filter(k => !TRIVIA_STOPWORDS.has(k));
            if (!keys.length) continue;
            let hits = 0;
            for (const k of keys) if (q.includes(k)) hits++;
            const score = hits / keys.length;
            if (keys.length === 1) {
                if (hits === 1 && score > bestScore) { best = entry; bestScore = score; }
            } else if (hits >= 2 && score >= 0.6 && score > bestScore) {
                best = entry; bestScore = score;
            }
        }
        return best ? best.a : null;
    }

    // ─── Anagram dictionary ────────────────────────────────────────────
    _buildDict() {
        if (this._dict) return;
        this._dict = new Map();
        const add = (name) => {
            const sig = sigOf(name);
            if (sig && !this._dict.has(sig)) this._dict.set(sig, name);
        };
        try {
            const reg = this.bot && this.bot.registry;
            if (reg) {
                for (const arr of [reg.blocksArray, reg.itemsArray]) {
                    if (Array.isArray(arr)) for (const e of arr) if (e && e.displayName) add(e.displayName);
                }
            }
        } catch (_) { /* registry not ready — EXTRA_WORDS still covers basics */ }
        for (const w of EXTRA_WORDS) add(w);
    }

    _lookupAnagram(payload) {
        this._buildDict();
        return this._dict.get(sigOf(payload)) || null;
    }

    // ─── Win persistence ───────────────────────────────────────────────
    _loadWins() {
        const zero = { total: 0, reverse: 0, math: 0, unscramble: 0, type: 0, question: 0, number: 0 };
        try {
            if (this.systemData && this.username) {
                const data = this.systemData.load(this.username);
                if (data && data.chatGameWins) return { ...zero, ...data.chatGameWins };
            }
        } catch (_) {}
        return zero;
    }

    _saveWins() {
        try {
            if (this.systemData && this.username) {
                this.systemData.update(this.username, { chatGameWins: this.wins });
            }
        } catch (_) {}
    }
}

// Anagram signature: lowercase letters only, sorted. Spaces/case ignored so
// multi-word phrases ("Mossy Cobblestone Stairs") match regardless of order.
function sigOf(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '').split('').sort().join('');
}

// ─── Safe arithmetic evaluator (no eval/Function) ──────────────────────
// Grammar: expr = term (('+'|'-') term)* ; term = factor (('*'|'/') factor)* ;
//          factor = number | '(' expr ')' | ('+'|'-') factor
function evalMath(input) {
    if (!/^[\d\s+\-*/().]+$/.test(input)) return null; // reject anything but math
    const tokens = input.match(/\d+\.?\d*|[+\-*/()]/g);
    if (!tokens || !tokens.length) return null;

    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    function parseExpr() {
        let v = parseTerm();
        if (v == null) return null;
        while (peek() === '+' || peek() === '-') {
            const op = next();
            const r = parseTerm();
            if (r == null) return null;
            v = op === '+' ? v + r : v - r;
        }
        return v;
    }
    function parseTerm() {
        let v = parseFactor();
        if (v == null) return null;
        while (peek() === '*' || peek() === '/') {
            const op = next();
            const r = parseFactor();
            if (r == null) return null;
            v = op === '*' ? v * r : v / r;
        }
        return v;
    }
    function parseFactor() {
        const tok = peek();
        if (tok === '+' || tok === '-') { next(); const f = parseFactor(); return f == null ? null : (tok === '-' ? -f : f); }
        if (tok === '(') {
            next();
            const v = parseExpr();
            if (peek() !== ')') return null;
            next();
            return v;
        }
        if (tok != null && /^\d/.test(tok)) return parseFloat(next());
        return null;
    }

    const result = parseExpr();
    if (result == null || pos !== tokens.length || !isFinite(result)) return null;
    const rounded = Math.round(result);
    return Math.abs(result - rounded) < 1e-9 ? rounded : result;
}

module.exports = { ChatGames };
