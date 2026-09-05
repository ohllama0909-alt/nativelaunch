'use client';

/**
 * FleetDock — the always-on floating command deck.
 *
 * One floating capsule lives in the corner of every dashboard page. It is a
 * live fleet pulse, a broadcast job progress bar, and a full command
 * composer: category-wise targeting, exclusions, running/all modes, stagger,
 * quick presets, and recent commands — no modal, no popup, no page lock.
 *
 * Any page can summon it preconfigured via useFleetDock().openBroadcast().
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import {
  Ban,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Gem,
  LoaderCircle,
  Megaphone,
  Radio,
  Search,
  Send,
  SlidersHorizontal,
  Star,
  Tag,
  X,
  Zap,
} from 'lucide-react';
import { useToast } from '@/components/providers';
import { useFleet } from '@/lib/hooks';
import { api, cn } from '@/lib/api';

const UNCATEGORIZED = 'Uncategorized';
const RECENT_KEY = 'nativelaunch:recent_broadcasts';
const PRESET_KEY = 'nativelaunch:broadcast_presets';
const STAGGER_OPTIONS = [0, 0.25, 0.5, 1, 2, 5];

function loadLocal(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}
function saveLocal(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function fmtShards(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return num.toLocaleString();
}

function staggerLabel(ms) {
  if (!ms) return 'instant';
  const sec = ms / 1000;
  return `${sec % 1 === 0 ? sec : sec.toFixed(2)}s`;
}

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

const FleetDockContext = createContext(null);

export function useFleetDock() {
  return useContext(FleetDockContext);
}

export function FleetDockProvider({ children }) {
  const fleet = useFleet();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);

  /** openBroadcast({ cmd?, staggerSec?, scope?: { target?, includeCategories?,
   *  excludeCategories?, includeIds?, excludeIds? } }) */
  const openBroadcast = useCallback((opts = {}) => {
    setDraft(opts);
    setOpen(true);
  }, []);

  return (
    <FleetDockContext.Provider value={{ open, setOpen, openBroadcast, fleet }}>
      {children}
      <FleetDock fleet={fleet} open={open} setOpen={setOpen} draft={draft} onDraftConsumed={() => setDraft(null)} />
    </FleetDockContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Composer                                                             */
/* ------------------------------------------------------------------ */

function useCategories(bots) {
  return useMemo(() => {
    const map = new Map();
    for (const bot of bots) {
      const name = String((bot.config && bot.config.category) || UNCATEGORIZED).trim() || UNCATEGORIZED;
      const entry = map.get(name) || { name, total: 0, running: 0, ids: [] };
      entry.total += 1;
      if (bot.status === 'running') entry.running += 1;
      entry.ids.push(bot.id);
      map.set(name, entry);
    }
    return [...map.values()].sort((a, b) => {
      if (a.name === b.name) return 0;
      if (a.name === UNCATEGORIZED) return 1;
      if (b.name === UNCATEGORIZED) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [bots]);
}

function CategoryChip({ name, entry, state, onCycle, disabled }) {
  const tones = {
    neutral:
      'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:bg-white/[0.07] hover:text-white',
    include:
      'border-white bg-white text-black shadow-[0_0_18px_rgba(255,255,255,0.22)]',
    exclude:
      'border-white/10 bg-transparent text-white/30 line-through decoration-white/40 hover:border-white/20',
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onCycle}
      title={
        state === 'neutral'
          ? 'Tap to include this category'
          : state === 'include'
            ? 'Tap again to exclude instead'
            : 'Tap to clear exclusion'
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 [transition-timing-function:var(--ease-ios)]',
        tones[state],
        disabled && 'cursor-not-allowed opacity-35'
      )}
    >
      {state === 'include' ? <CheckCircle2 className="h-3 w-3" /> : state === 'exclude' ? <Ban className="h-3 w-3" /> : <Tag className="h-3 w-3 opacity-50" />}
      <span className="max-w-[9rem] truncate">{name}</span>
      <span className={cn('tnum rounded-md px-1 py-px text-[9px] font-semibold', state === 'include' ? 'bg-black/15 text-black/70' : 'bg-white/[0.08] text-white/40')}>
        {entry.running}/{entry.total}
      </span>
    </button>
  );
}

export function FleetDock({ fleet, open, setOpen, draft, onDraftConsumed }) {
  const { toast } = useToast();
  const { bots, activeJob } = fleet;

  const [tab, setTab] = useState('broadcast');
  const [cmd, setCmd] = useState('');
  const [mode, setMode] = useState('running');
  const [includeCats, setIncludeCats] = useState(() => new Set());
  const [excludeCats, setExcludeCats] = useState(() => new Set());
  const [includeIds, setIncludeIds] = useState(() => new Set());
  const [excludeIds, setExcludeIds] = useState(() => new Set());
  const [staggerSec, setStaggerSec] = useState('0.25');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState([]);
  const [presets, setPresets] = useState([]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [botSearch, setBotSearch] = useState('');
  const [showBots, setShowBots] = useState(false);

  const categories = useCategories(bots);
  const runningBots = useMemo(() => bots.filter((b) => b.status === 'running'), [bots]);
  const runningTotal = runningBots.length;
  const hasRunning = runningTotal > 0;

  useEffect(() => {
    setRecent(loadLocal(RECENT_KEY));
    setPresets(loadLocal(PRESET_KEY));
  }, []);

  // Apply an externally summoned draft (category broadcast, selected bots...).
  useEffect(() => {
    if (!open || !draft) return;
    if (draft.cmd !== undefined) setCmd(draft.cmd);
    if (draft.staggerSec !== undefined) setStaggerSec(String(draft.staggerSec));
    const s = draft.scope || {};
    if (s.target === 'all' || s.target === 'running') setMode(s.target);
    if (Array.isArray(s.includeCategories)) setIncludeCats(new Set(s.includeCategories));
    if (Array.isArray(s.excludeCategories)) setExcludeCats(new Set(s.excludeCategories));
    if (Array.isArray(s.includeIds)) setIncludeIds(new Set(s.includeIds));
    if (Array.isArray(s.excludeIds)) setExcludeIds(new Set(s.excludeIds));
    setTab(draft.tab || 'broadcast');
    setError('');
    onDraftConsumed?.();
  }, [open, draft, onDraftConsumed]);

  // Escape closes; Ctrl/⌘+K summons the deck from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setTab('broadcast');
        setOpen(true);
        return;
      }
      if (open && e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const preview = useMemo(() => {
    let match = 0;
    let running = 0;
    let offline = 0;
    for (const bot of bots) {
      const cat = String((bot.config && bot.config.category) || UNCATEGORIZED);
      const catOk = !includeCats.size || includeCats.has(cat);
      const catSkip = excludeCats.has(cat);
      const idOk = !includeIds.size || includeIds.has(bot.id);
      const idSkip = excludeIds.has(bot.id);
      if (catOk && !catSkip && idOk && !idSkip) {
        match += 1;
        if (bot.status === 'running') running += 1;
        else offline += 1;
      }
    }
    return { match, running, offline };
  }, [bots, includeCats, excludeCats, includeIds, excludeIds]);

  const cycleCategory = (name) => {
    const nextInc = new Set(includeCats);
    const nextExc = new Set(excludeCats);
    if (nextInc.has(name)) {
      nextInc.delete(name);
      nextExc.add(name);
    } else {
      nextInc.add(name);
      nextExc.delete(name);
    }
    setIncludeCats(nextInc);
    setExcludeCats(nextExc);
  };

  const toggleExcludeBot = (id, force) => {
    setExcludeIds((cur) => {
      const next = new Set(cur);
      const on = typeof force === 'boolean' ? force : !next.has(id);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const resetScope = () => {
    setMode('running');
    setIncludeCats(new Set());
    setExcludeCats(new Set());
    setIncludeIds(new Set());
    setExcludeIds(new Set());
    setStaggerSec('0.25');
    setError('');
  };

  const rememberRecent = (command) => {
    setRecent((cur) => {
      const next = [command, ...cur.filter((c) => c !== command)].slice(0, 8);
      saveLocal(RECENT_KEY, next);
      return next;
    });
  };

  const savePreset = () => {
    const name = presetName.trim() || cmd.trim().slice(0, 24) || 'Broadcast';
    if (!cmd.trim()) return;
    const preset = {
      name,
      cmd: cmd.trim(),
      staggerSec: Number(staggerSec) || 0,
      scope: {
        target: mode,
        includeCategories: [...includeCats],
        excludeCategories: [...excludeCats],
        includeIds: [...includeIds],
        excludeIds: [...excludeIds],
      },
    };
    setPresets((cur) => {
      const next = [preset, ...cur.filter((p) => p.name !== name)].slice(0, 12);
      saveLocal(PRESET_KEY, next);
      return next;
    });
    setPresetName('');
    setSavingPreset(false);
    toast(`Preset "${name}" saved`, 'success');
  };

  const loadPreset = (preset) => {
    setCmd(preset.cmd);
    setStaggerSec(String(preset.staggerSec ?? 0.25));
    const s = preset.scope || {};
    setMode(s.target === 'all' ? 'all' : 'running');
    setIncludeCats(new Set(s.includeCategories || []));
    setExcludeCats(new Set(s.excludeCategories || []));
    setIncludeIds(new Set(s.includeIds || []));
    setExcludeIds(new Set(s.excludeIds || []));
    setError('');
    setSavingPreset(false);
  };

  const removePreset = (name) => {
    setPresets((cur) => {
      const next = cur.filter((p) => p.name !== name);
      saveLocal(PRESET_KEY, next);
      return next;
    });
  };

  const send = async () => {
    const command = cmd.trim();
    if (!command) return;
    setSending(true);
    setError('');
    try {
      const body = {
        cmd: command,
        target: mode,
        staggerSec: Number(staggerSec) || 0,
        includeCategories: [...includeCats],
        excludeCategories: [...excludeCats],
        includeIds: [...includeIds],
        excludeIds: [...excludeIds],
      };
      const result = await api('/mass-cmd', { method: 'POST', body: JSON.stringify(body) });
      rememberRecent(command);
      toast(`Broadcast queued → ${result.total} bot${result.total === 1 ? '' : 's'}`, 'success');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSending(false);
    }
  };

  const scopedBots = useMemo(() => {
    const term = botSearch.trim().toLowerCase();
    return bots.filter((bot) => {
      const cat = String((bot.config && bot.config.category) || UNCATEGORIZED);
      const inScope =
        (!includeCats.size || includeCats.has(cat)) &&
        !excludeCats.has(cat) &&
        (!includeIds.size || includeIds.has(bot.id)) &&
        !excludeIds.has(bot.id);
      if (!inScope) return false;
      if (!term) return true;
      return [bot.id, bot.config?.username, cat].filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    });
  }, [bots, includeCats, excludeCats, includeIds, botSearch]);

  const jobRunning = activeJob && activeJob.status === 'running';
  const jobPct = jobRunning && activeJob.total
    ? Math.min(100, Math.round((activeJob.done / activeJob.total) * 100))
    : 0;

  const toggleOpen = () => {
    if (!open && !hasRunning && !jobRunning) {
      setTab('broadcast');
    }
    setOpen(!open);
  };

  /* ---------------- Panel ---------------- */
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-5 sm:right-5">
      {open ? (
        <div
          role="dialog"
          aria-label="Command deck"
          className="dock-panel anim-scale flex w-[min(24.5rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[26px] border border-white/12 bg-[#0b0b0c]/92 shadow-[0_-10px_80px_rgba(0,0,0,.9),0_0_0_1px_rgba(255,255,255,.04)_inset,0_1px_0_rgba(255,255,255,.1)_inset] backdrop-blur-2xl"
        >
          {/* Live job banner */}
          {jobRunning ? (
            <div className="border-b border-white/[0.08] bg-white/[0.045] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">
                  <Radio className="h-3.5 w-3.5 shrink-0 text-white anim-pulse" />
                  <span className="truncate font-mono normal-case tracking-normal text-white/90">{activeJob.cmd}</span>
                </span>
                <span className="tnum shrink-0 text-[11px] text-white/50">
                  {activeJob.done}/{activeJob.total}
                </span>
              </div>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)] transition-all duration-500 [transition-timing-function:var(--ease-ios)]"
                  style={{ width: `${jobPct}%` }}
                />
              </div>
              <p className="mt-1.5 flex items-center justify-between text-[10px] text-white/35">
                <span>{staggerLabel(activeJob.staggerMs)} between bots</span>
                <span>{jobPct}% · {activeJob.skipped || 0} skipped</span>
              </p>
            </div>
          ) : null}

          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-white/15 bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12)]">
                <Zap className="h-3.5 w-3.5" />
              </span>
              <div>
                <p className="text-[12px] font-semibold leading-none tracking-[-0.01em] text-white">Command deck</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/30">
                  {jobRunning ? 'Broadcast in flight' : 'Fleet at a glance'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTab('broadcast')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-all duration-200',
                  tab === 'broadcast' ? 'bg-white text-black shadow-sm' : 'text-white/40 hover:bg-white/[0.07] hover:text-white'
                )}
              >
                <Megaphone className="h-3 w-3" />
                Broadcast
              </button>
              <button
                type="button"
                onClick={() => setTab('fleet')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-all duration-200',
                  tab === 'fleet' ? 'bg-white text-black shadow-sm' : 'text-white/40 hover:bg-white/[0.07] hover:text-white'
                )}
              >
                <Bot className="h-3 w-3" />
                Fleet
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close command deck"
                className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/[0.08] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ---------- Fleet tab ---------- */}
          {tab === 'fleet' ? (
            <div className="console-scrollbar max-h-[min(30rem,calc(100dvh-16rem))] overflow-y-auto p-3">
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: 'Live', value: runningTotal },
                  { label: 'Total', value: bots.length },
                  { label: 'Offline', value: bots.length - runningTotal },
                  { label: 'Shards', value: fmtShards(bots.reduce((s, b) => s + (Number(b.shards) || 0), 0)) ?? 0 },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-2">
                    <p className="text-[9px] uppercase tracking-[0.12em] text-white/30">{stat.label}</p>
                    <p className="tnum mt-1 text-[15px] font-semibold leading-none text-white">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between px-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/35">Online bots</span>
                <Link href="/bots" onClick={() => setOpen(false)} className="text-[11px] text-white/45 transition hover:text-white">
                  Manage fleet →
                </Link>
              </div>

              {runningBots.length === 0 ? (
                <p className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-6 text-center text-[12px] text-white/30">
                  No bots are online right now.
                </p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {runningBots.map((bot) => (
                    <li key={bot.id}>
                      <Link
                        href={`/bots/${encodeURIComponent(bot.id)}`}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 transition hover:border-white/[0.08] hover:bg-white/[0.04]"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,.9)] anim-pulse" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-white/85">{bot.config?.username || bot.id}</span>
                          <span className="block truncate text-[10px] text-white/30">
                            {String((bot.config && bot.config.category) || UNCATEGORIZED)} · {bot.id}
                          </span>
                        </span>
                        {bot.shards !== null && bot.shards !== undefined ? (
                          <span className="tnum inline-flex shrink-0 items-center gap-1 rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-white/70">
                            <Gem className="h-2.5 w-2.5" />
                            {fmtShards(bot.shards)}
                          </span>
                        ) : null}
                        <ChevronDown className="h-3 w-3 -rotate-90 text-white/25" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            /* ---------- Broadcast tab ---------- */
            <div className="console-scrollbar max-h-[min(30rem,calc(100dvh-16rem))] overflow-y-auto">
              {/* presets */}
              {presets.length ? (
                <div className="border-b border-white/[0.06] px-4 py-2.5">
                  <div className="flex items-center gap-1.5 overflow-x-auto" role="toolbar" aria-label="Saved broadcast presets">
                    <span className="flex shrink-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.13em] text-white/30">
                      <Star className="h-2.5 w-2.5" /> Presets
                    </span>
                    {presets.map((preset) => (
                      <span key={preset.name} className="group relative shrink-0">
                        <button
                          type="button"
                          onClick={() => loadPreset(preset)}
                          title={`${preset.cmd} · ${preset.scope?.includeCategories?.length ? preset.scope.includeCategories.join(', ') : 'all bots'}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-white/60 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                        >
                          <Zap className="h-2.5 w-2.5" />
                          {preset.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => removePreset(preset.name)}
                          aria-label={`Delete preset ${preset.name}`}
                          className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full border border-white/20 bg-black text-white/50 group-hover:flex hover:text-white"
                        >
                          <X className="h-2 w-2" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-4 p-4">
                {/* Command */}
                <div>
                  <label className="field-label" htmlFor="dock-cmd">Command</label>
                  <div className="relative">
                    <input
                      id="dock-cmd"
                      value={cmd}
                      onChange={(e) => setCmd(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      placeholder="!stats — or any chat message"
                      autoFocus
                      className="field-control pr-9 font-mono text-[13px]"
                    />
                    {cmd ? (
                      <button
                        type="button"
                        onClick={() => setCmd('')}
                        aria-label="Clear command"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/30 transition hover:bg-white/[0.08] hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  {recent.length ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/25">Recent</span>
                      {recent.slice(0, 4).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCmd(c)}
                          className="max-w-[10rem] truncate rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-1 font-mono text-[10px] text-white/40 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Mode */}
                <div>
                  <span className="field-label">Deliver to</span>
                  <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-1">
                    <button
                      type="button"
                      onClick={() => setMode('running')}
                      className={cn(
                        'flex items-center justify-center gap-2 rounded-xl py-2 text-[11px] font-medium transition-all duration-200',
                        mode === 'running' ? 'bg-white text-black shadow-sm' : 'text-white/45 hover:text-white'
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', mode === 'running' ? 'bg-black' : 'bg-white/40')} />
                      Running only
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('all')}
                      className={cn(
                        'flex items-center justify-center gap-2 rounded-xl py-2 text-[11px] font-medium transition-all duration-200',
                        mode === 'all' ? 'bg-white text-black shadow-sm' : 'text-white/45 hover:text-white'
                      )}
                    >
                      <Bot className="h-3 w-3" />
                      All bots
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-white/30">
                    {mode === 'running' ? 'Only live bots are targeted.' : 'Whole roster is targeted; offline bots are counted as skipped.'}
                  </p>
                </div>

                {/* Categories */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="field-label mb-0">Categories</span>
                    <button
                      type="button"
                      onClick={resetScope}
                      className="text-[10px] text-white/35 transition hover:text-white"
                    >
                      Reset targeting
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/25">
                    Tap a category to include it, tap again to <em>exclude</em> it. Empty = every category.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {categories.map((entry) => {
                      const state = includeCats.has(entry.name)
                        ? 'include'
                        : excludeCats.has(entry.name)
                          ? 'exclude'
                          : 'neutral';
                      return (
                        <CategoryChip
                          key={entry.name}
                          name={entry.name}
                          entry={entry}
                          state={state}
                          onCycle={() => cycleCategory(entry.name)}
                          disabled={includeIds.size > 0}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Specific bots */}
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <button
                    type="button"
                    onClick={() => setShowBots((v) => !v)}
                    className="flex w-full items-center justify-between gap-2"
                  >
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
                      <SlidersHorizontal className="h-3 w-3" />
                      Exclude specific bots
                      {excludeIds.size ? (
                        <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-black">{excludeIds.size}</span>
                      ) : null}
                    </span>
                    <ChevronDown className={cn('h-3.5 w-3.5 text-white/30 transition-transform duration-300', showBots && 'rotate-180')} />
                  </button>
                  {showBots ? (
                    <div className="mt-3">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/25" />
                        <input
                          value={botSearch}
                          onChange={(e) => setBotSearch(e.target.value)}
                          placeholder="Filter in-scope bots…"
                          className="field-control h-9 py-0 pl-8 text-[12px]"
                        />
                      </div>
                      <div className="console-scrollbar mt-2 max-h-44 space-y-0.5 overflow-y-auto pr-1">
                        {scopedBots.length === 0 ? (
                          <p className="px-2 py-4 text-center text-[11px] text-white/25">No bots match the current scope.</p>
                        ) : (
                          scopedBots.map((bot) => {
                            const off = excludeIds.has(bot.id);
                            return (
                              <button
                                key={bot.id}
                                type="button"
                                onClick={() => toggleExcludeBot(bot.id)}
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition',
                                  off ? 'text-white/25 line-through decoration-white/40' : 'text-white/65 hover:bg-white/[0.05] hover:text-white'
                                )}
                              >
                                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', bot.status === 'running' ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,.8)]' : 'bg-white/20')} />
                                <span className="min-w-0 flex-1 truncate font-medium">{bot.config?.username || bot.id}</span>
                                <span className="font-mono text-[9px] text-white/25">{bot.id}</span>
                                {off ? <Ban className="h-3 w-3 shrink-0 text-white/30" /> : <MinusGlyph />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Stagger + preview */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="field-label mb-1.5">Stagger</span>
                    <div className="flex gap-1 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1">
                      {STAGGER_OPTIONS.map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setStaggerSec(String(sec))}
                          className={cn(
                            'rounded-lg px-2 py-1 text-[11px] font-medium transition-all duration-200 tnum',
                            Number(staggerSec) === sec ? 'bg-white text-black shadow-sm' : 'text-white/40 hover:text-white'
                          )}
                        >
                          {sec === 0 ? '0s' : `${sec}s`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/30">Target preview</p>
                    <p className="mt-1 text-[13px] font-semibold text-white tnum">
                      {preview.match} <span className="text-white/40">bots</span>
                      <span className="mx-1.5 text-white/15">·</span>
                      <span className="text-white/80">{preview.running} live</span>
                      {mode === 'all' ? (
                        <>
                          <span className="mx-1.5 text-white/15">·</span>
                          <span className="text-white/40">{preview.offline} skipped</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>

                {error ? (
                  <p className="rounded-xl border border-white/25 bg-white/[0.06] px-3 py-2 text-[12px] leading-relaxed text-white">{error}</p>
                ) : null}

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (savingPreset) {
                        savePreset();
                        return;
                      }
                      setSavingPreset(true);
                      setPresetName('');
                    }}
                    disabled={!cmd.trim()}
                    title="Save current command + targeting as a preset"
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.05] px-3 text-[11px] font-medium text-white/60 transition hover:border-white/25 hover:bg-white/[0.09] hover:text-white disabled:opacity-35"
                  >
                    <Star className={cn('h-3.5 w-3.5', savingPreset && 'text-white')} />
                    {savingPreset ? 'Name…' : 'Preset'}
                  </button>
                  {savingPreset ? (
                    <input
                      autoFocus
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') savePreset();
                        if (e.key === 'Escape') setSavingPreset(false);
                      }}
                      placeholder="Preset name"
                      className="field-control h-10 min-w-0 flex-1 py-2 text-[12px]"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={send}
                    disabled={!cmd.trim() || sending}
                    className="btn-primary flex h-10 min-w-[7.5rem] flex-1 items-center justify-center gap-2 rounded-xl border border-white bg-white px-4 text-[12px] font-semibold tracking-[-0.01em] text-black shadow-[0_8px_30px_-8px_rgba(255,255,255,.4)] transition-all duration-300 [transition-timing-function:var(--ease-ios)] hover:bg-white/90 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {sending ? <LoaderCircle className="h-4 w-4 anim-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {sending ? 'Queuing…' : `Send · ${preview.match}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ---------- Floating capsule ---------- */}
      <div
        className={cn(
          'group flex items-center gap-2 rounded-[18px] border px-2.5 py-2 shadow-[0_20px_60px_-12px_rgba(0,0,0,.95),0_0_0_1px_rgba(255,255,255,.05)_inset,0_1px_0_rgba(255,255,255,.12)_inset] backdrop-blur-2xl transition-all duration-300 [transition-timing-function:var(--ease-ios)]',
          open
            ? 'border-white/25 bg-[#0c0c0d] shadow-[0_0_40px_-6px_rgba(255,255,255,.18)]'
            : 'border-white/14 bg-[#0c0c0d]/85 hover:border-white/30 hover:bg-[#0c0c0d]'
        )}
      >
        {/* Broadcast launch */}
        <button
          type="button"
          onClick={() => {
            setTab('broadcast');
            setOpen(true);
          }}
          title="Open command deck — broadcast to categories with exclusions"
          className="flex h-8 items-center gap-1.5 rounded-xl bg-white px-2.5 text-black shadow-[0_0_16px_rgba(255,255,255,.25)] transition-all duration-300 hover:brightness-95 active:scale-95"
        >
          <Megaphone className="h-3.5 w-3.5" />
          <span className="hidden text-[10px] font-bold uppercase tracking-[0.08em] sm:inline">Cast</span>
        </button>

        {/* Fleet pulse */}
        <button
          type="button"
          onClick={toggleOpen}
          title="Fleet status"
          className="flex items-center gap-2 px-1 text-left transition hover:opacity-85"
        >
          <span className="relative flex h-2.5 w-2.5">
            {hasRunning ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-50" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_9px_rgba(255,255,255,.95)]" />
              </>
            ) : (
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-white/20" />
            )}
          </span>
          <span className="tnum text-[12px] font-semibold text-white">
            {runningTotal}
            <span className="font-normal text-white/35">/{bots.length}</span>
          </span>
          <span className="hidden items-center gap-1 border-l border-white/10 pl-2 text-[10px] text-white/35 md:inline-flex">
            <Gem className="h-2.5 w-2.5" />
            <span className="tnum">{fmtShards(bots.reduce((s, b) => s + (Number(b.shards) || 0), 0)) ?? '--'}</span>
          </span>
        </button>

        {/* Job progress / chevron */}
        {jobRunning ? (
          <div className="relative flex w-16 items-center sm:w-24">
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.1]">
              <div
                className="h-full rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,.6)] transition-all duration-500"
                style={{ width: `${jobPct}%` }}
              />
            </div>
            <span className="tnum ml-2 hidden text-[9px] font-semibold text-white/60 sm:inline">{jobPct}%</span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={toggleOpen}
          aria-label={open ? 'Collapse command deck' : 'Expand command deck'}
          className="rounded-lg p-1 text-white/35 transition hover:bg-white/[0.08] hover:text-white"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function MinusGlyph() {
  return <span className="h-3 w-3 shrink-0 rounded-full border border-white/20 text-[9px] leading-[10px] text-white/30">−</span>;
}
