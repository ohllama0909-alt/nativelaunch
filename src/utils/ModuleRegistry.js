'use strict';

const Logger = require('./logger.js');

/**
 * ModuleRegistry — one place that knows what every bot module is doing.
 *
 * The old panel guessed at module state by keeping its own copy in the server
 * process, which drifted the moment a module was toggled from the console. This
 * registry instead reads state straight off the live module objects and pushes
 * a snapshot to the parent process whenever it actually changes.
 *
 * Modules are described, not subclassed — see utils/botModules.js. That keeps
 * every module file free of registry imports and means a module that gains or
 * loses a lifecycle method only needs its descriptor updated.
 */

const GROUP_ORDER = ['Economy', 'Combat', 'Movement', 'Maintenance', 'Integration', 'Other'];

/**
 * Writes a marker line the parent MultiBotServer parses out of stdout.
 * Kept local so the registry has no dependency on the bot instance.
 */
function emitMarker(tag, payload) {
    process.stdout.write('\n[' + tag + ']' + JSON.stringify(payload) + '\n');
}

class ModuleRegistry {
    constructor(opts = {}) {
        this.modules = new Map();
        this._emitDelayMs = opts.emitDelayMs != null ? opts.emitDelayMs : 60;
        this._pollMs = opts.pollMs != null ? opts.pollMs : 2000;
        this._lastSignature = null;
        this._emitTimer = null;
        this._pollTimer = null;
    }

    /**
     * Registers one module descriptor.
     *
     * isRunning is mandatory. A descriptor that cannot report its own state is
     * worse than no descriptor at all, because the panel would render a switch
     * that silently lies.
     */
    register(desc) {
        if (!desc || !desc.key) throw new Error('ModuleRegistry.register: key is required');
        if (typeof desc.isRunning !== 'function') {
            throw new Error('ModuleRegistry.register: ' + desc.key + ' must provide isRunning()');
        }
        this.modules.set(desc.key, {
            key: desc.key,
            label: desc.label || desc.key,
            group: desc.group || 'Other',
            describe: desc.describe || '',
            readOnly: !!desc.readOnly,
            unavailable: desc.unavailable || null,
            isRunning: desc.isRunning,
            start: desc.start || null,
            stop: desc.stop || null,
            detail: desc.detail || null,
            fields: Array.isArray(desc.fields) ? desc.fields : null,
        });
        return this;
    }

    has(key) { return this.modules.has(key); }
    get(key) { return this.modules.get(key); }

    /**
     * Runs a descriptor callback without ever letting a module fault take the
     * bot down. A module that throws reports an error row instead.
     */
    _safe(mod, fn, fallback) {
        try { return fn(); }
        catch (err) {
            Logger.error('[modules] ' + mod.key + ': ' + err.message);
            return fallback;
        }
    }

    async start(key, opts) {
        const mod = this.modules.get(key);
        if (!mod) return { ok: false, error: 'Unknown module: ' + key };
        if (mod.unavailable) return { ok: false, error: mod.unavailable };
        if (mod.readOnly || !mod.start) return { ok: false, error: mod.label + ' cannot be started from the panel' };
        if (this._safe(mod, () => mod.isRunning(), false)) return { ok: true, running: true, noop: true };
        try {
            await mod.start(opts || null);
            this.scheduleEmit();
            return { ok: true, running: this._safe(mod, () => mod.isRunning(), true) };
        } catch (err) {
            Logger.error('[modules] start ' + key + ': ' + err.message);
            this.scheduleEmit();
            return { ok: false, error: err.message };
        }
    }

    async stop(key) {
        const mod = this.modules.get(key);
        if (!mod) return { ok: false, error: 'Unknown module: ' + key };
        if (mod.unavailable) return { ok: false, error: mod.unavailable };
        if (mod.readOnly || !mod.stop) return { ok: false, error: mod.label + ' cannot be stopped from the panel' };
        if (!this._safe(mod, () => mod.isRunning(), false)) return { ok: true, running: false, noop: true };
        try {
            await mod.stop();
            this.scheduleEmit();
            return { ok: true, running: this._safe(mod, () => mod.isRunning(), false) };
        } catch (err) {
            Logger.error('[modules] stop ' + key + ': ' + err.message);
            this.scheduleEmit();
            return { ok: false, error: err.message };
        }
    }

    async toggle(key) {
        const mod = this.modules.get(key);
        if (!mod) return { ok: false, error: 'Unknown module: ' + key };
        return this._safe(mod, () => mod.isRunning(), false) ? this.stop(key) : this.start(key);
    }

    /** Best-effort stop of everything, used on quit and on disconnect. */
    async stopAll() {
        for (const mod of this.modules.values()) {
            if (mod.readOnly || mod.unavailable || !mod.stop) continue;
            if (!this._safe(mod, () => mod.isRunning(), false)) continue;
            try { await mod.stop(); }
            catch (err) { Logger.error('[modules] stopAll ' + mod.key + ': ' + err.message); }
        }
        this.scheduleEmit();
    }

    /** The exact shape the panel renders. */
    snapshot() {
        const rows = [];
        for (const mod of this.modules.values()) {
            const running = mod.unavailable ? false : this._safe(mod, () => !!mod.isRunning(), false);
            let detail = null;
            if (mod.detail && !mod.unavailable) {
                const d = this._safe(mod, () => mod.detail(), null);
                if (d != null && d !== '') detail = String(d);
            }
            rows.push({
                key: mod.key,
                label: mod.label,
                group: mod.group,
                describe: mod.describe,
                running,
                canStart: !!mod.start && !mod.readOnly && !mod.unavailable,
                canStop: !!mod.stop && !mod.readOnly && !mod.unavailable,
                readOnly: mod.readOnly,
                unavailable: mod.unavailable,
                detail,
                fields: mod.fields && mod.fields.length ? mod.fields : null,
                editable: !!(mod.fields && mod.fields.length),
            });
        }
        rows.sort((a, b) => {
            const ga = GROUP_ORDER.indexOf(a.group), gb = GROUP_ORDER.indexOf(b.group);
            if (ga !== gb) return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
            return a.label.localeCompare(b.label);
        });
        return rows;
    }

    _signature(rows) {
        return rows.map((r) => r.key + ':' + (r.running ? 1 : 0) + ':' + (r.detail || '')).join('|');
    }

    /** Coalesces bursts of toggles into a single emit. */
    scheduleEmit() {
        if (this._emitTimer) return;
        this._emitTimer = setTimeout(() => { this._emitTimer = null; this.emit(); }, this._emitDelayMs);
    }

    /** Emits only when something actually changed, so idle bots stay quiet. */
    emit(force) {
        const rows = this.snapshot();
        const sig = this._signature(rows);
        if (!force && sig === this._lastSignature) return;
        this._lastSignature = sig;
        emitMarker('MODULES_JSON', { modules: rows, ts: Date.now() });
    }

    /**
     * Modules started from the in-game chat or a script never call the
     * registry, so a slow poll catches those and keeps the panel honest.
     */
    startWatching() {
        if (this._pollTimer) return;
        this.emit(true);
        this._pollTimer = setInterval(() => this.emit(), this._pollMs);
        if (this._pollTimer.unref) this._pollTimer.unref();
    }

    destroy() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
        if (this._emitTimer) { clearTimeout(this._emitTimer); this._emitTimer = null; }
        this.modules.clear();
    }
}

module.exports = { ModuleRegistry, GROUP_ORDER };
