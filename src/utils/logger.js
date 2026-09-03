/**
 * 🍌 BananaMoney Lite Logger
 * Fixed to not interrupt console input AND to survive readline close
 * (no more ERR_USE_AFTER_CLOSE after !quit / uncaughtException).
 */

const chalk = require('chalk');
const figlet = require('figlet');
const readline = require('readline');

const bananaColor = chalk.hex('#FFD700');
const infoColor = chalk.cyan;
const errorColor = chalk.red;
const mutedColor = chalk.gray;
const warnColor = chalk.yellow;

// Quiet by default. Startup chatter, SRV lookups, proxy details and freeze
// bookkeeping are hidden unless you explicitly ask for them.
// Run with BOT_LOG_LEVEL=verbose to get everything back.
const VERBOSE = process.env.BOT_LOG_LEVEL === 'verbose';

class Logger {
  constructor() {
    this.rl = null;
    this._rlClosed = false;
    this.onLog = null; // Callback for log forwarding (Discord)
  }

  setReadline(rl) {
    this.rl = rl;
    this._rlClosed = false;
    if (rl && typeof rl.on === 'function') {
      rl.on('close', () => { this._rlClosed = true; });
    }
  }

  setLogCallback(callback) {
    this.onLog = callback;
  }

  print(text) {
    // Forward to callback if set (for Discord etc.)
    if (this.onLog) {
      try {
        const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
        this.onLog(clean);
      } catch (_) { /* ignore */ }
    }

    // If readline is closed or stdout is not a TTY (panel child mode),
    // just write the line plainly — do NOT attempt to re-prompt.
    if (this._rlClosed || !this.rl || !process.stdout.isTTY) {
      try { console.log(text); } catch (_) { /* ignore */ }
      return;
    }

    try {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(text);
      if (!this._rlClosed && this.rl && this.rl.output && !this.rl.closed) {
        this.rl.prompt(true);
      }
    } catch (_) {
      // rl could have just closed; fall back silently.
      try { console.log(text); } catch (_) { /* ignore */ }
    }
  }

  showBanner() {
    // Banner is just noise for the panel. Skip when running under the panel.
    if (process.env.BOT_CHILD === '1') return;
    try { console.clear(); } catch (_) { /* ignore */ }
    console.log(bananaColor(figlet.textSync('BananaMoney', { horizontalLayout: 'full' })));
    console.log(bananaColor('=================================================='));
    console.log(bananaColor('  🍌  Lite Edition - Pure & Simple'));
    console.log(bananaColor('=================================================='));
    console.log('');
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] [${type}]`;

    let coloredPrefix;
    switch (type) {
      case 'INFO': coloredPrefix = infoColor(prefix); break;
      case 'ERROR': coloredPrefix = errorColor(prefix); break;
      case 'WARN': coloredPrefix = warnColor(prefix); break;
      case 'CHAT': coloredPrefix = bananaColor(prefix); break;
      default: coloredPrefix = mutedColor(prefix);
    }

    this.print(`${coloredPrefix} ${message}`);
  }

  info(msg) { this.log(msg, 'INFO'); }
  error(msg) { this.log(msg, 'ERROR'); }
  chat(sender, msg) { this.print(`${bananaColor(`[CHAT] <${sender}>`)} ${msg}`); }
  system(msg) { this.print(`${bananaColor('[🍌]')} ${msg}`); }

  // limboFreeze.js called Logger.warn() in two places, but this method never
  // existed — those calls threw a TypeError instead of logging anything.
  warn(msg) { this.log(msg, 'WARN'); }

  // Verbose internal chatter: proxy details, SRV lookups, client profile,
  // freeze bookkeeping. Hidden unless BOT_LOG_LEVEL=verbose.
  verbose(msg) {
    if (!VERBOSE) return;
    this.print(`${mutedColor('[🍌]')} ${msg}`);
  }

  // Debug log that is silenced when running under the panel (BOT_CHILD=1)
  // Used for verbose internal storage stuff that users don't care about.
  debug(msg) {
    if (process.env.BOT_CHILD === '1') return;
    this.print(`${mutedColor('[debug]')} ${msg}`);
  }
}

module.exports = new Logger();
