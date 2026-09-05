'use client';

/**
 * BroadcastModal - the broadcast composer.
 *
 * A clean centered modal for sending one command to many bots: pick a
 * command (with alias shortcuts + history), choose targets (everyone /
 * categories / roster selection / hand-picked bots), optionally skip
 * categories or bots, set a stagger, and send. Toggle it from anywhere on
 * the page with Cmd/Ctrl+K. The component stays mounted while the page is
 * open, so a half-written broadcast survives closing the modal.
 *
 * Props:
 *   bots         full visible roster (for categories + running counts)
 *   activeJob    latest mass-command job, for the inline progress strip
 *   selectedIds  ids checked in the roster (powers the "Selected" mode)
 *   preset       { key, botIds?, includeCategories?, useSelected? } - when
 *                `key` changes the modal adopts the preset and opens. Used
 *                by "broadcast to category" and "broadcast to selected".
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Check,
  ChevronDown,
  History,
  Layers,
  ListChecks,
  Radio,
  Search,
  Send,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { useToast } from '@/components/providers';
import { Button, Modal } from '@/components/ui';
import { useResource } from '@/lib/hooks';
import { api, cn } from '@/lib/api';

const UNCATEGORIZED = 'Uncategorized';
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
    /* private mode - the composer still works, it just forgets */
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

function SectionLabel({ children, action }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">{children}</p>
      {action}
    </div>
  );
}

export function BroadcastModal({ bots = [], activeJob = null, selectedIds = [], preset = null }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
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
  const inputRef = useRef(null);
  const aliases = useResource('/custom-cmds', (result) => result.cmds || []);

  const reset = () => {
    setCmd('');
    setMode('all');
    setIncludeCats([]);
    setExcludeCats([]);
    setIncludeBots([]);
    setExcludeBots([]);
    setBotQuery('');
    setExclQuery('');
  };

  // Roster shortcuts ("broadcast to this category", "broadcast to selected")
  // arrive as presets: adopt them and open.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  // Cmd/Ctrl+K toggles from anywhere on the page.
  useEffect(() => {
    const onKey = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const matchBot = (bot, term) => {
    if (!term) return true;
    return [bot.id, bot.config && bot.config.username, catOf(bot)]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(term));
  };
  const filteredBots = useMemo(
    () => running.filter((bot) => matchBot(bot, botQuery.trim().toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, botQuery]
  );
  const filteredExclBots = useMemo(
    () => running.filter((bot) => matchBot(bot, exclQuery.trim().toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, exclQuery]
  );

  const aliasList = Array.isArray(aliases.data) ? aliases.data : [];
  const aliasChips = aliasList.slice(0, 4);
  const historyChips = !cmd.trim() ? history.slice(0, 3) : [];

  const jobRunning = activeJob && activeJob.status === 'running';
  const jobPct = jobRunning && activeJob.total
    ? Math.min(100, Math.round(((activeJob.done || 0) / activeJob.total) * 100))
    : 0;

  const footerSummary = targets.length === 0
    ? 'No running bots match'
    : `${targets.length} target${targets.length === 1 ? '' : 's'}${etaSec > 0 ? ` · ≈${etaSec.toFixed(1)}s run` : ''}`;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Broadcast"
      description={`${running.length} bot${running.length === 1 ? '' : 's'} online — only running bots receive commands.`}
      footer={
        <>
          <p className="tnum mr-auto self-center text-xs text-white/50">{footerSummary}</p>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={send}
            loading={sending}
            disabled={!canSend}
            title={!cmd.trim() ? 'Type a command first' : targets.length === 0 ? 'No running bots match these targets' : 'Queue broadcast'}
          >
            <Send className="h-3.5 w-3.5" />
            {targets.length ? `Send to ${targets.length}` : 'Send'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="space-y-5"
      >
        {jobRunning ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-[11px] text-white/50">
              <span>Sending previous broadcast…</span>
              <span className="tnum">
                {activeJob.done || 0}/{activeJob.total}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${jobPct}%` }} />
            </div>
          </div>
        ) : null}

        {/* Command */}
        <div>
          <div className="relative flex items-center">
            <Terminal className="pointer-events-none absolute left-3.5 h-4 w-4 text-white/30" />
            <input
              ref={inputRef}
              value={cmd}
              onChange={(event) => setCmd(event.target.value)}
              placeholder="!stats — chat text or /command, Enter to send"
              aria-label="Broadcast command"
              data-testid="broadcast-input"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-2xl border border-white/[0.10] bg-white/[0.03] pl-10 pr-10 font-mono text-[13px] text-white placeholder:font-sans placeholder:text-white/30 focus:border-white/30 focus:outline-none"
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
          {aliasChips.length > 0 || historyChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {aliasChips.map((alias) => (
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
              {aliasChips.length > 0 && historyChips.length > 0 ? (
                <span className="mx-0.5 h-3 w-px bg-white/10" />
              ) : null}
              {historyChips.length > 0 ? <History className="h-3 w-3 text-white/25" /> : null}
              {historyChips.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCmd(item)}
                  className="max-w-[150px] truncate rounded-lg border border-transparent px-1.5 py-1 font-mono text-[11px] text-white/35 transition hover:border-white/15 hover:text-white/75"
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Targets */}
        <div className="space-y-2.5">
          <SectionLabel
            action={(
              <button
                type="button"
                onClick={reset}
                className="text-[11px] font-normal normal-case tracking-normal text-white/35 transition hover:text-white"
              >
                Reset
              </button>
            )}
          >
            Targets
          </SectionLabel>
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
                    'flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition',
                    active ? 'bg-white text-black' : 'text-white/45 hover:bg-white/[0.05] hover:text-white/85'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="leading-none">{item.label}</span>
                  <span className={cn('tnum text-[10px] leading-none', active ? 'text-black/55' : 'text-white/30')}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {mode === 'categories' ? (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-3">
              {categories.length === 0 ? (
                <p className="py-1 text-center text-xs text-white/35">No categories yet.</p>
              ) : (
                <div className="console-scrollbar flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                  {categories.map((cat) => {
                    const active = includeCats.includes(cat.name);
                    return (
                      <button
                        key={cat.name}
                        type="button"
                        onClick={() => toggleIn(includeCats, setIncludeCats, cat.name)}
                        aria-pressed={active}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition',
                          active
                            ? 'border-white bg-white text-black'
                            : 'border-white/[0.10] bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white'
                        )}
                      >
                        {active ? <Check className="h-3 w-3" /> : null}
                        <span className="max-w-[110px] truncate">{cat.name}</span>
                        <span className={cn('tnum text-[10px]', active ? 'text-black/55' : 'text-white/30')}>
                          {cat.running}/{cat.total}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[10px] text-white/30">Only running bots in checked categories.</p>
                <span className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIncludeCats(categories.map((c) => c.name))}
                    className="text-[11px] text-white/40 transition hover:text-white"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncludeCats([])}
                    className="text-[11px] text-white/40 transition hover:text-white"
                  >
                    None
                  </button>
                </span>
              </div>
            </div>
          ) : null}

          {mode === 'selected' ? (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.015] px-3.5 py-3 text-xs">
              {selectedIds.length === 0 ? (
                <p className="text-white/40">
                  Nothing checked in the roster. <span className="text-white/30">Hit “Select” in the roster to pick bots.</span>
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
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-3">
              <div className="relative mb-2 flex items-center">
                <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-white/30" />
                <input
                  value={botQuery}
                  onChange={(event) => setBotQuery(event.target.value)}
                  placeholder="Filter running bots…"
                  aria-label="Filter running bots"
                  className="h-8 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-8 pr-2 text-xs text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
                />
              </div>
              <div className="console-scrollbar max-h-40 space-y-0.5 overflow-y-auto pr-0.5">
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
                          'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition',
                          checked ? 'bg-white/[0.07] text-white' : 'text-white/55 hover:bg-white/[0.04] hover:text-white'
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
              <div className="mt-2 flex items-center justify-between">
                <p className="tnum text-[10px] text-white/30">{includeBots.length} picked</p>
                <span className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIncludeBots(filteredBots.map((b) => b.id))}
                    className="text-[11px] text-white/40 transition hover:text-white"
                  >
                    All visible
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncludeBots([])}
                    className="text-[11px] text-white/40 transition hover:text-white"
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
          <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setShowExclusions((value) => !value)}
              aria-expanded={showExclusions}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs text-white/55 transition hover:text-white"
            >
              <Ban className="h-3.5 w-3.5 text-white/35" />
              <span className="flex-1 font-medium">
                Except
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
              <div className="space-y-3 border-t border-white/[0.07] p-3.5">
                <div className="console-scrollbar flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                  {categories.map((cat) => {
                    const active = excludeCats.includes(cat.name);
                    const locked = mode === 'categories' && includeCats.includes(cat.name);
                    return (
                      <button
                        key={cat.name}
                        type="button"
                        onClick={() => toggleIn(excludeCats, setExcludeCats, cat.name)}
                        aria-pressed={active}
                        disabled={locked}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition',
                          active
                            ? 'border-white/50 bg-white/[0.12] text-white'
                            : 'border-white/[0.10] text-white/50 hover:border-white/25 hover:text-white',
                          locked && 'cursor-not-allowed opacity-30'
                        )}
                      >
                        <span className="max-w-[100px] truncate">{cat.name}</span>
                        <span className="tnum text-[10px] opacity-60">{cat.running}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-2.5 h-3 w-3 text-white/30" />
                  <input
                    value={exclQuery}
                    onChange={(event) => setExclQuery(event.target.value)}
                    placeholder="Filter running bots to skip…"
                    aria-label="Filter bots to skip"
                    className="h-8 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-8 pr-2 text-xs text-white placeholder:text-white/25 focus:border-white/25 focus:outline-none"
                  />
                </div>
                <div className="console-scrollbar max-h-32 space-y-0.5 overflow-y-auto pr-0.5">
                  {filteredExclBots.slice(0, 30).map((bot) => {
                    const skipped = excludeBots.includes(bot.id);
                    return (
                      <button
                        key={bot.id}
                        type="button"
                        onClick={() => toggleIn(excludeBots, setExcludeBots, bot.id)}
                        aria-pressed={skipped}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[11px] transition',
                          skipped ? 'bg-white/[0.07] text-white' : 'text-white/50 hover:bg-white/[0.04] hover:text-white'
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition',
                            skipped ? 'border-white bg-white' : 'border-white/25'
                          )}
                        >
                          {skipped ? <Check className="h-2.5 w-2.5 text-black" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {(bot.config && bot.config.username) || bot.id}
                        </span>
                        <span className="shrink-0 text-[10px] opacity-50">{catOf(bot)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-white/30">Checked categories and bots are skipped.</p>
                  {exclusionCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setExcludeCats([]);
                        setExcludeBots([]);
                      }}
                      className="text-[11px] text-white/40 transition hover:text-white"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Stagger */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">
            Stagger
          </span>
          <div className="flex flex-1 flex-wrap gap-1">
            {STAGGER_PRESETS.map((presetOpt) => (
              <button
                key={presetOpt.value}
                type="button"
                onClick={() => setStaggerSec(presetOpt.value)}
                className={cn(
                  'tnum rounded-lg border px-2.5 py-1.5 text-[11px] transition',
                  staggerSec === presetOpt.value
                    ? 'border-white/40 bg-white/[0.10] text-white'
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
            aria-label="Custom stagger in seconds"
            className={cn(
              'tnum h-8 w-16 shrink-0 rounded-lg border bg-white/[0.03] px-2 text-center text-[11px] text-white focus:outline-none',
              staggerValid ? 'border-white/[0.08] focus:border-white/25' : 'border-white/40'
            )}
          />
        </div>
      </form>
    </Modal>
  );
}
