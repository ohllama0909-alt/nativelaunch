'use client';

/**
 * BroadcastDock - the always-on floating broadcast composer.
 *
 * A draggable pill pinned near the bottom of the Bots page that expands into
 * a full targeting composer: everyone / categories / roster selection /
 * hand-picked bots, plus category + bot exclusions, stagger control, alias
 * shortcuts and recent-command history. Toggle it from anywhere on the page
 * with Cmd/Ctrl+K. It never unmounts, so a half-written broadcast survives
 * tab switches inside the page.
 *
 * Props:
 *   bots         full visible roster (for categories + running counts)
 *   activeJob    latest mass-command job, for the inline progress bar
 *   selectedIds  ids checked in the roster (powers the "Selected" mode)
 *   preset       { key, botIds?, includeCategories?, useSelected? } - when
 *                `key` changes the dock adopts the preset and expands. Used
 *                by "broadcast to category" and "broadcast to selected".
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Check,
  ChevronDown,
  GripVertical,
  History,
  Layers,
  ListChecks,
  Radio,
  Search,
  Send,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useToast } from '@/components/providers';
import { useResource } from '@/lib/hooks';
import { api, cn } from '@/lib/api';

const UNCATEGORIZED = 'Uncategorized';
const OPEN_KEY = 'nativelaunch:dock:open';
const POS_KEY = 'nativelaunch:dock:pos';
const HIST_KEY = 'nativelaunch:broadcast:history';

function catOf(bot) {
  const raw = (bot && bot.config && bot.config.category) || UNCATEGORIZED;
  return String(raw).trim() || UNCATEGORIZED;
}

function readJSON(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode - the dock still works, it just forgets */
  }
}

const MODES = [
  { value: 'all', label: 'Everyone', icon: Radio },
  { value: 'categories', label: 'Categories', icon: Layers },
  { value: 'selected', label: 'Selected', icon: ListChecks },
  { value: 'bots', label: 'Pick bots', icon: Users },
];

const STAGGER_PRESETS = [
  { label: 'Instant', value: '0' },
  { label: '0.25s', value: '0.25' },
  { label: '0.5s', value: '0.5' },
  { label: '1s', value: '1' },
];

export function BroadcastDock({ bots = [], activeJob = null, selectedIds = [], preset = null }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(() => readJSON(OPEN_KEY, false));
  const [pos, setPos] = useState(() => readJSON(POS_KEY, { x: 0, y: 0 }));
  const [cmd, setCmd] = useState('');
  const [mode, setMode] = useState('all');
  const [includeCats, setIncludeCats] = useState([]);
  const [excludeCats, setExcludeCats] = useState([]);
  const [includeBots, setIncludeBots] = useState([]);
  const [excludeBots, setExcludeBots] = useState([]);
  const [showExclusions, setShowExclusions] = useState(false);
  const [botQuery, setBotQuery] = useState('');
  const [exclQuery, setExclQuery] = useState('');
  const [staggerSec, setStaggerSec] = useState('0.25');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(() => readJSON(HIST_KEY, []));
  const [lastSent, setLastSent] = useState(null);
  const inputRef = useRef(null);
  const aliases = useResource('/custom-cmds', (result) => result.cmds || []);

  useEffect(() => {
    writeJSON(OPEN_KEY, open);
  }, [open]);
  useEffect(() => {
    writeJSON(POS_KEY, pos);
  }, [pos]);

  // Roster shortcuts ("broadcast to this category", "broadcast to selected")
  // arrive as presets: adopt them and pop open.
  const presetKey = (preset && preset.key) || 0;
  useEffect(() => {
    if (!presetKey || !preset) return;
    if (Array.isArray(preset.botIds) && preset.botIds.length) {
      setMode('bots');
      setIncludeBots(preset.botIds);
    } else if (Array.isArray(preset.includeCategories) && preset.includeCategories.length) {
      setMode('categories');
      setIncludeCats(preset.includeCategories);
    } else if (preset.useSelected) {
      setMode('selected');
    }
    setOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  // Cmd/Ctrl+K toggles from anywhere on the page; Esc collapses.
  useEffect(() => {
    const onKey = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open ]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 90);
  }, [open]);

  const running = useMemo(() => bots.filter((bot) => bot.status === 'running'), [bots]);

  const categories = useMemo(() => {
    const map = new Map();
    for (const bot of bots) {
      const name = catOf(bot);
      if (!map.has(name)) map.set(name, { name, total: 0, running: 0 });
      const row = map.get(name);
      row.total += 1;
      if (bot.status === 'running') row.running += 1;
    }
    return [...map.values()].sort((a, b) => {
      if (a.name === b.name) return 0;
      if (a.name === UNCATEGORIZED) return 1;
      if (b.name === UNCATEGORIZED) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [bots]);

  const toggleIn = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  // Mirrors the server filter in POST /api/mass-cmd so the preview count is
  // exactly what /mass-cmd will queue for.
  const targets = useMemo(() => {
    const exclBots = new Set(excludeBots);
    const exclCats = new Set(excludeCats);
    return running.filter((bot) => {
      if (mode === 'bots') return includeBots.includes(bot.id);
      if (mode === 'selected') {
        if (!selectedIds.includes(bot.id)) return false;
      } else if (mode === 'categories') {
        if (!includeCats.length || !includeCats.includes(catOf(bot))) return false;
      }
      if (exclBots.has(bot.id)) return false;
      if (exclCats.has(catOf(bot))) return false;
      return true;
    });
  }, [running, mode, includeBots, selectedIds, includeCats, excludeBots, excludeCats]);

  const exclusionCount = excludeCats.length + excludeBots.length;
  const canSend = cmd.trim().length > 0 && targets.length > 0 && !sending;
  const sendHint = !cmd.trim()
    ? 'Type a command first'
    : targets.length === 0
      ? 'No running bots match these targets'
      : null;

  const staggerNum = Number(staggerSec);
  const staggerValid = Number.isFinite(staggerNum) && staggerNum >= 0 && staggerNum <= 300;
  const etaSec = targets.length > 1 && staggerValid ? (targets.length - 1) * staggerNum : 0;

  const send = async () => {
    const text = cmd.trim();
    if (!text || !targets.length || sending) return;
    setSending(true);
    try {
      const sec = staggerValid ? staggerNum : 0.25;
      const body = { cmd: text, staggerSec: sec, staggerMs: Math.round(sec * 1000) };
      if (mode === 'bots') body.botIds = [...includeBots];
      else if (mode === 'selected') body.botIds = [...selectedIds];
      else if (mode === 'categories') body.includeCategories = [...includeCats];
      if (mode !== 'bots') {
        if (excludeCats.length) body.excludeCategories = [...excludeCats];
        if (excludeBots.length) body.excludeBotIds = [...excludeBots];
      }
      const result = await api('/mass-cmd', { method: 'POST', body: JSON.stringify(body) });
      setLastSent({ cmd: text, total: result.total, at: Date.now() });
      setHistory((current) => {
        const next = [text, ...current.filter((item) => item !== text)].slice(0, 8);
        writeJSON(HIST_KEY, next);
        return next;
      });
      toast(`Broadcast queued for ${result.total} bot${result.total === 1 ? '' : 's'}`, 'success');
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setSending(false);
    }
  };

  // Drag the expanded panel by its header (persisted across visits).
  const onDragStart = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button, input, textarea, a')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...pos };
    const move = (pointer) => {
      const next = { x: origin.x + (pointer.clientX - startX), y: origin.y + (pointer.clientY - startY) };
      next.x = Math.max(-window.innerWidth / 2 + 140, Math.min(window.innerWidth / 2 - 140, next.x));
      next.y = Math.max(-window.innerHeight + 180, Math.min(0, next.y));
      setPos(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const jobRunning = activeJob && activeJob.status === 'running';
  const jobPct = jobRunning && activeJob.total
    ? Math.min(100, Math.round((activeJob.done / activeJob.total) * 100))
    : 0;

  const filteredBots = useMemo(() => {
    const term = botQuery.trim().toLowerCase();
    if (!term) return running;
    return running.filter((bot) =>
      [bot.id, bot.config && bot.config.username, catOf(bot)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    );
  }, [running, botQuery]);

  const filteredExclBots = useMemo(() => {
    const term = exclQuery.trim().toLowerCase();
    if (!term) return running;
    return running.filter((bot) =>
      [bot.id, bot.config && bot.config.username, catOf(bot)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term))
    );
  }, [running, exclQuery]);

  const aliasList = Array.isArray(aliases.data) ? aliases.data : [];

  return (
    <div
      className="fixed bottom-20 left-1/2 z-50 sm:bottom-6"
      style={{ transform: `translate(calc(-50% + ${pos.x}px), ${pos.y}px)` }}
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="broadcast-dock-pill"
          title="Open broadcast composer (Ctrl/⌘+K)"
          className="group relative flex items-center gap-2.5 overflow-hidden rounded-2xl border border-white/[0.14] bg-[#0b0b0d]/92 py-2.5 pl-4 pr-3 shadow-[0_24px_80px_rgba(0,0,0,.85)] backdrop-blur-2xl transition-all duration-300 [transition-timing-function:var(--ease-ios)] hover:border-white/30 hover:bg-[#101014]"
        >
          <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          <Send className="h-3.5 w-3.5 text-white/80 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          <span className="text-[13px] font-medium text-white">Broadcast</span>
          <span className="tnum rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/60">
            {running.length} online
          </span>
          {jobRunning ? (
            <span className="tnum text-[10px] text-white/50">
              {activeJob.done}/{activeJob.total}
            </span>
          ) : null}
          <kbd className="kbd hidden sm:inline-block">⌘K</kbd>
          {jobRunning ? (
            <span className="absolute inset-x-0 bottom-0 h-[2px] bg-white/10">
              <span
                className="block h-full bg-white transition-all duration-500"
                style={{ width: `${jobPct}%` }}
              />
            </span>
          ) : null}
        </button>
      ) : (
        <section
          aria-label="Broadcast composer"
          data-testid="broadcast-dock"
          className="anim-dock-in flex max-h-[min(78vh,640px)] w-[min(460px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-white/[0.14] bg-[#0b0b0d]/96 shadow-[0_40px_120px_rgba(0,0,0,.9)] backdrop-blur-2xl"
        >
          {/* Draggable header */}
          <div
            onPointerDown={onDragStart}
            className="flex cursor-grab touch-none select-none items-center gap-2 border-b border-white/[0.08] bg-white/[0.02] px-4 py-3 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4 shrink-0 text-white/25" />
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em] text-white">
              Broadcast
              <span className="ml-2 font-normal text-white/35">
                {targets.length} target{targets.length === 1 ? '' : 's'}
              </span>
            </p>
            {jobRunning ? (
              <span className="tnum hidden shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/60 sm:inline-flex">
                <Radio className="h-3 w-3 animate-pulse" />
                {activeJob.done}/{activeJob.total}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Minimize broadcast composer"
              className="shrink-0 rounded-lg p-1.5 text-white/40 transition hover:bg-white/[0.08] hover:text-white"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {jobRunning ? (
            <div className="h-[2px] shrink-0 bg-white/[0.07]">
              <div className="h-full bg-white transition-all duration-500" style={{ width: `${jobPct}%` }} />
            </div>
          ) : null}

          {/* Body */}
          <div className="console-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
              className="space-y-4"
            >
              {/* Command */}
              <div>
                <div className="group relative flex items-center">
                  <Zap className="pointer-events-none absolute left-3 h-4 w-4 text-white/30 transition-colors group-focus-within:text-white/80" />
                  <input
                    ref={inputRef}
                    value={cmd}
                    onChange={(event) => setCmd(event.target.value)}
                    placeholder="!stats   — chat text or /command, Enter to send"
                    aria-label="Broadcast command"
                    data-testid="broadcast-dock-input"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-11 w-full rounded-2xl border border-white/[0.10] bg-white/[0.04] pl-10 pr-10 font-mono text-[13px] text-white placeholder:font-sans placeholder:text-white/30 transition-all duration-200 hover:border-white/20 focus:border-white/35 focus:bg-white/[0.06] focus:outline-none focus:ring-4 focus:ring-white/[0.06]"
                  />
                  {cmd ? (
                    <button
                      type="button"
                      onClick={() => setCmd('')}
                      aria-label="Clear command"
                      className="absolute right-2.5 rounded-md p-1 text-white/35 transition hover:bg-white/[0.08] hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>

                {/* Alias shortcuts + history */}
                {aliasList.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {aliasList.slice(0, 6).map((alias) => (
                      <button
                        key={alias.id || alias.name}
                        type="button"
                        title={alias.cmd}
                        onClick={() => setCmd(alias.name.startsWith('!') ? alias.name : `!${alias.name}`)}
                        className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-white/55 transition hover:border-white/20 hover:text-white"
                      >
                        {alias.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                {history.length > 0 && !cmd ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <History className="h-3 w-3 text-white/25" />
                    {history.slice(0, 4).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setCmd(item)}
                        className="max-w-[160px] truncate rounded-lg border border-white/[0.06] bg-transparent px-2 py-1 font-mono text-[11px] text-white/40 transition hover:border-white/15 hover:text-white/80"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Target mode */}
              <div>
                <div className="grid grid-cols-4 gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1">
                  {MODES.map((item) => {
                    const Icon = item.icon;
                    const active = mode === item.value;
                    const count = item.value === 'all'
                      ? running.length
                      : item.value === 'categories'
                        ? includeCats.length || categories.length
                        : item.value === 'selected'
                          ? selectedIds.length
                          : includeBots.length;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setMode(item.value)}
                        aria-pressed={active}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium transition-all duration-200',
                          active
                            ? 'bg-white text-black shadow-[0_4px_16px_rgba(0,0,0,.5)]'
                            : 'text-white/45 hover:bg-white/[0.05] hover:text-white/85'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span className="leading-none">{item.label}</span>
                        <span className={cn('tnum text-[9px] leading-none', active ? 'text-black/55' : 'text-white/30')}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Mode panels */}
                {mode === 'categories' ? (
                  <div className="mt-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.015] p-2.5">
                    {categories.length === 0 ? (
                      <p className="px-1 py-2 text-center text-xs text-white/35">No categories yet.</p>
                    ) : (
                      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto console-scrollbar">
                        {categories.map((cat) => {
                          const active = includeCats.includes(cat.name);
                          return (
                            <button
                              key={cat.name}
                              type="button"
                              onClick={() => toggleIn(includeCats, setIncludeCats, cat.name)}
                              aria-pressed={active}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200',
                                active
                                  ? 'border-white/40 bg-white text-black shadow-sm'
                                  : 'border-white/[0.10] bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white'
                              )}
                            >
                              {active ? <Check className="h-3 w-3" /> : null}
                              <span className="max-w-[120px] truncate">{cat.name}</span>
                              <span className={cn('tnum text-[10px]', active ? 'text-black/55' : 'text-white/30')}>
                                {cat.running}/{cat.total}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between px-1">
                      <p className="text-[10px] text-white/30">Only running bots in checked categories.</p>
                      <span className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setIncludeCats(categories.map((c) => c.name))}
                          className="text-[10px] text-white/40 transition hover:text-white"
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => setIncludeCats([])}
                          className="text-[10px] text-white/40 transition hover:text-white"
                        >
                          None
                        </button>
                      </span>
                    </div>
                  </div>
                ) : null}

                {mode === 'selected' ? (
                  <div className="mt-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.015] px-3 py-2.5 text-xs">
                    {selectedIds.length === 0 ? (
                      <p className="text-white/40">
                        Nothing checked in the roster.{' '}
                        <span className="text-white/30">Hit “Select” in the roster to pick bots.</span>
                      </p>
                    ) : (
                      <p className="text-white/60">
                        <span className="tnum font-semibold text-white">{selectedIds.length}</span> checked in the
                        roster · <span className="tnum font-semibold text-white">{targets.length}</span> running and
                        will receive this.
                      </p>
                    )}
                  </div>
                ) : null}

                {mode === 'bots' ? (
                  <div className="mt-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.015] p-2.5">
                    <div className="relative mb-2 flex items-center">
                      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-white/30" />
                      <input
                        value={botQuery}
                        onChange={(event) => setBotQuery(event.target.value)}
                        placeholder="Filter running bots..."
                        aria-label="Filter running bots"
                        className="h-8 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-8 pr-2 text-xs text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
                      />
                    </div>
                    <div className="console-scrollbar max-h-36 space-y-1 overflow-y-auto pr-0.5">
                      {filteredBots.length === 0 ? (
                        <p className="px-1 py-2 text-center text-xs text-white/35">
                          {running.length ? 'No bots match.' : 'No bots are running right now.'}
                        </p>
                      ) : (
                        filteredBots.map((bot) => {
                          const checked = includeBots.includes(bot.id);
                          return (
                            <button
                              key={bot.id}
                              type="button"
                              onClick={() => toggleIn(includeBots, setIncludeBots, bot.id)}
                              aria-pressed={checked}
                              className={cn(
                                'flex w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-xs transition',
                                checked
                                  ? 'border-white/25 bg-white/[0.08] text-white'
                                  : 'border-transparent text-white/55 hover:bg-white/[0.04] hover:text-white'
                              )}
                            >
                              <span
                                className={cn(
                                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition',
                                  checked ? 'border-white bg-white' : 'border-white/25'
                                )}
                              >
                                {checked ? <Check className="h-2.5 w-2.5 text-black" /> : null}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {(bot.config && bot.config.username) || bot.id}
                              </span>
                              <span className="shrink-0 truncate text-[10px] text-white/30">{catOf(bot)}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between px-1">
                      <p className="tnum text-[10px] text-white/30">{includeBots.length} picked</p>
                      <span className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setIncludeBots(filteredBots.map((b) => b.id))}
                          className="text-[10px] text-white/40 transition hover:text-white"
                        >
                          All visible
                        </button>
                        <button
                          type="button"
                          onClick={() => setIncludeBots([])}
                          className="text-[10px] text-white/40 transition hover:text-white"
                        >
                          None
                        </button>
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Exclusions */}
              {mode !== 'bots' ? (
                <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.015]">
                  <button
                    type="button"
                    onClick={() => setShowExclusions((value) => !value)}
                    aria-expanded={showExclusions}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-white/55 transition hover:text-white"
                  >
                    <Ban className="h-3.5 w-3.5 text-white/35" />
                    <span className="flex-1 font-medium">
                      Exclusions
                      {exclusionCount > 0 ? (
                        <span className="tnum ml-1.5 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-black">
                          {exclusionCount}
                        </span>
                      ) : (
                        <span className="ml-1.5 font-normal text-white/30">skip categories or bots</span>
                      )}
                    </span>
                    <ChevronDown
                      className={cn('h-3.5 w-3.5 text-white/30 transition-transform duration-300', showExclusions && 'rotate-180')}
                    />
                  </button>
                  {showExclusions ? (
                    <div className="space-y-2.5 border-t border-white/[0.07] p-3">
                      <div>
                        <p className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/30">
                          Skip categories
                        </p>
                        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto console-scrollbar">
                          {categories.map((cat) => {
                            const active = excludeCats.includes(cat.name);
                            return (
                              <button
                                key={cat.name}
                                type="button"
                                onClick={() => toggleIn(excludeCats, setExcludeCats, cat.name)}
                                aria-pressed={active}
                                disabled={mode === 'categories' && includeCats.includes(cat.name)}
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition',
                                  active
                                    ? 'border-white/50 bg-white/[0.14] text-white line-through'
                                    : 'border-white/[0.10] bg-white/[0.02] text-white/50 hover:border-white/25 hover:text-white',
                                  mode === 'categories' && includeCats.includes(cat.name) && 'cursor-not-allowed opacity-30'
                                )}
                              >
                                <span className="max-w-[100px] truncate">{cat.name}</span>
                                <span className="tnum text-[10px] opacity-60">{cat.running}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/30">Skip bots</p>
                        <div className="relative mb-1.5 flex items-center">
                          <Search className="pointer-events-none absolute left-2.5 h-3 w-3 text-white/30" />
                          <input
                            value={exclQuery}
                            onChange={(event) => setExclQuery(event.target.value)}
                            placeholder="Filter running bots..."
                            aria-label="Filter bots to exclude"
                            className="h-8 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-8 pr-2 text-xs text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
                          />
                        </div>
                        <div className="console-scrollbar max-h-28 space-y-1 overflow-y-auto pr-0.5">
                          {filteredExclBots.slice(0, 30).map((bot) => {
                            const excluded = excludeBots.includes(bot.id);
                            return (
                              <button
                                key={bot.id}
                                type="button"
                                onClick={() => toggleIn(excludeBots, setExcludeBots, bot.id)}
                                aria-pressed={excluded}
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition',
                                  excluded ? 'bg-white/[0.10] text-white line-through' : 'text-white/50 hover:bg-white/[0.04] hover:text-white'
                                )}
                              >
                                <X className={cn('h-3 w-3 shrink-0', excluded ? 'text-white' : 'text-white/25')} />
                                <span className="min-w-0 flex-1 truncate">
                                  {(bot.config && bot.config.username) || bot.id}
                                </span>
                                <span className="shrink-0 text-[10px] opacity-50">{catOf(bot)}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {exclusionCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setExcludeCats([]);
                            setExcludeBots([]);
                          }}
                          className="text-[11px] text-white/40 transition hover:text-white"
                        >
                          Clear all exclusions
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Stagger */}
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-white/30">Stagger</span>
                <div className="flex flex-1 flex-wrap gap-1">
                  {STAGGER_PRESETS.map((presetOpt) => (
                    <button
                      key={presetOpt.value}
                      type="button"
                      onClick={() => setStaggerSec(presetOpt.value)}
                      className={cn(
                        'tnum rounded-lg border px-2 py-1 text-[11px] transition',
                        staggerSec === presetOpt.value
                          ? 'border-white/40 bg-white/[0.12] text-white'
                          : 'border-white/[0.08] text-white/45 hover:border-white/20 hover:text-white'
                      )}
                    >
                      {presetOpt.label}
                    </button>
                  ))}
                </div>
                <input
                  value={staggerSec}
                  onChange={(event) => setStaggerSec(event.target.value)}
                  inputMode="decimal"
                  aria-label="Stagger in seconds"
                  className={cn(
                    'tnum h-8 w-16 shrink-0 rounded-lg border bg-white/[0.03] px-2 text-center text-[11px] text-white focus:outline-none',
                    staggerValid ? 'border-white/[0.08] focus:border-white/25' : 'border-white/40'
                  )}
                />
              </div>

              {/* Live preview */}
              <div className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
                <span className="relative flex h-2 w-2 shrink-0">
                  {targets.length > 0 ? (
                    <>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-50" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                    </>
                  ) : (
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-white/20" />
                  )}
                </span>
                <p className="tnum min-w-0 flex-1 truncate text-xs text-white/60">
                  {targets.length > 0 ? (
                    <>
                      <span className="font-semibold text-white">{targets.length}</span> will receive this
                      <span className="ml-1.5 text-white/30">
                        {targets
                          .slice(0, 3)
                          .map((bot) => (bot.config && bot.config.username) || bot.id)
                          .join(', ')}
                        {targets.length > 3 ? ` +${targets.length - 3}` : ''}
                      </span>
                    </>
                  ) : (
                    'No targets yet'
                  )}
                </p>
                {etaSec > 0 ? (
                  <span className="tnum shrink-0 text-[10px] text-white/30">≈{etaSec.toFixed(1)}s run</span>
                ) : null}
              </div>

              {lastSent && !jobRunning ? (
                <p className="tnum px-1 text-[11px] text-white/35">
                  Last send: <span className="font-mono text-white/60">{lastSent.cmd}</span> → {lastSent.total} bots
                </p>
              ) : null}

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!canSend}
                  title={sendHint || 'Queue broadcast'}
                  data-testid="broadcast-dock-send"
                  className="sheen inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-white bg-white text-[13px] font-semibold text-black transition-all duration-300 [transition-timing-function:var(--ease-ios)] hover:bg-white/90 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
                >
                  {sending ? (
                    <span className="anim-spin inline-block h-4 w-4 rounded-full border-2 border-black/20 border-t-black" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {sending ? 'Queueing…' : `Send to ${targets.length || '—'}`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCmd('');
                    setIncludeCats([]);
                    setExcludeCats([]);
                    setIncludeBots([]);
                    setExcludeBots([]);
                    setMode('all');
                  }}
                  title="Reset composer"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/50 transition hover:border-white/25 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {sendHint && targets.length === 0 && cmd.trim() ? (
                <p className="px-1 text-center text-[11px] text-white/35">{sendHint} — adjust targets above.</p>
              ) : null}
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
