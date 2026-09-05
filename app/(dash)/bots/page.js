'use client';

/**
 * Bots - split view.
 *
 * Left rail is the roster grouped by category; the right pane is the full
 * workspace for whichever bot is selected. The workspace itself lives in
 * components/bot-workspace.jsx so that this page and the /bots/[id] deep link
 * render exactly the same thing.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  CheckSquare,
  ChevronDown,
  Gem,
  Play,
  Plus,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth, useToast } from '@/components/providers';
import { Button, Checkbox, EmptyState, Modal, PageHeader, Spinner } from '@/components/ui';
import { BotPicker, ConfirmModal, ErrorNote, Field, Input, LiveDot, Pill, Select } from '@/components/dash-ui';
import { BotWorkspace } from '@/components/bot-workspace';
import { useFleet, useResource } from '@/lib/hooks';
import { api, cn } from '@/lib/api';
import { withLiveProxyUsage } from '@/lib/format';

const UNCATEGORIZED = 'Uncategorized';

// Mirrors buildConfigFromBody on the server. Anything omitted here is still
// editable afterwards in the workspace's Configuration tab.
const BLANK_BOT = {
  id: '',
  username: '',
  category: '',
  host: 'play.bananasmp.net',
  port: '25565',
  version: '1.20.1',
  auth: 'offline',
  proxyId: '',
  autoReconnect: true,
  reconnectDelaySec: '5',
  afkMode: true,
  autoRegister: false,
  autoLogin: false,
  loginPassword: '',
  startOnCreate: true,
  discordEnabled: false,
  discordToken: '',
  discordGuildId: '',
  webhookUrl: '',
  collectSlot: '13',
  cycleDelaySec: '15',
  ownerId: '',
};

const LAST_BOT_CONFIG_KEY = 'nativelaunch:last_bot_config';

function loadLastBotConfig() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_BOT_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLastBotConfig(config, lastId) {
  if (typeof window === 'undefined') return;
  try {
    const toSave = {
      lastId: lastId || config.id || '',
      category: config.category || '',
      host: config.host || 'play.bananasmp.net',
      port: config.port || '25565',
      version: config.version || '1.20.1',
      auth: config.auth || 'offline',
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelaySec: config.reconnectDelaySec || (config.reconnectDelay ? String(Math.round(Number(config.reconnectDelay) / 1000)) : '5'),
      afkMode: config.afkMode ?? true,
      autoRegister: config.autoRegister ?? false,
      autoLogin: config.autoLogin ?? false,
      loginPassword: config.loginPassword || '',
      startOnCreate: config.startOnCreate ?? true,
      discordEnabled: config.discordEnabled ?? false,
      discordToken: config.discordToken || '',
      discordGuildId: config.discordGuildId || '',
      webhookUrl: config.webhookUrl || '',
      collectSlot: config.collectSlot || '13',
      cycleDelaySec: config.cycleDelaySec || (config.cycleDelay ? String(Math.round(Number(config.cycleDelay) / 1000)) : '15'),
      proxyId: config.proxyId || '',
    };
    localStorage.setItem(LAST_BOT_CONFIG_KEY, JSON.stringify(toSave));
  } catch {}
}

function getNextBotId(existingBots = [], lastId = '') {
  const existingIds = new Set((existingBots || []).map((b) => String(b.id).toLowerCase()));

  if (lastId) {
    const match = String(lastId).match(/^(.*?[-_])?(\d+)$/);
    if (match) {
      const prefix = match[1] || 'bot-';
      const numDigits = match[2].length;
      let nextNum = parseInt(match[2], 10) + 1;
      while (existingIds.has(`${prefix}${String(nextNum).padStart(numDigits, '0')}`.toLowerCase())) {
        nextNum++;
      }
      return `${prefix}${String(nextNum).padStart(numDigits, '0')}`;
    }
  }

  let n = 1;
  while (existingIds.has(`bot-${n}`)) {
    n++;
  }
  return `bot-${n}`;
}

const BOT_ID = /^[a-zA-Z0-9_-]{1,24}$/;
const MINECRAFT_USERNAME = /^[A-Za-z0-9_]{3,16}$/;

/**
 * Short egress label for a row.
 *
 * Non-admin accounts get the proxy URI masked, so only host:port is shown and
 * credentials are never reconstructed.
 */
function egressLabel(bot) {
  const config = (bot && bot.config) || {};
  const raw = typeof config.proxy === 'string' ? config.proxy.trim() : '';
  if (raw) {
    let text = raw.replace(/^socks(5h?|4a?)?:\/\//i, '');
    const at = text.lastIndexOf('@');
    if (at !== -1) text = text.slice(at + 1);
    const parts = text.split(':').filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : text;
  }
  return config.proxyId ? 'proxied' : 'direct';
}

function formatShards(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(2).replace(/\.0+$/, '')}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2).replace(/\.0+$/, '')}M`;
  }
  if (num >= 10_000) {
    return `${(num / 1_000).toFixed(1).replace(/\.0+$/, '')}k`;
  }
  return num.toLocaleString();
}

export default function BotsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fleet = useFleet();
  const proxies = useResource('/proxies', (result) => result.proxies || []);
  const isAdmin = user.role === 'admin';
  const atBotLimit = !isAdmin && fleet.bots.length >= 10;
  const owners = useResource(isAdmin ? '/users' : null, (result) => result.users || []);

  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [mobileTab, setMobileTab] = useState('roster');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [groupBusy, setGroupBusy] = useState('');

  const [selectMode, setSelectMode] = useState(false);
  const [checkedBots, setCheckedBots] = useState(() => new Set());
  const [massDeleteOpen, setMassDeleteOpen] = useState(false);
  const [massDeleting, setMassDeleting] = useState(false);
  const [massActionBusy, setMassActionBusy] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(BLANK_BOT);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [generatingName, setGeneratingName] = useState(false);
  const [usernameMeta, setUsernameMeta] = useState(null);

  const [castOpen, setCastOpen] = useState(false);
  const [cast, setCast] = useState({ cmd: '', staggerSec: '0.25', botIds: [] });
  const [casting, setCasting] = useState(false);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return fleet.bots.filter((bot) => {
      const config = bot.config || {};
      if (statusFilter === 'running' && bot.status !== 'running') return false;
      if (statusFilter === 'stopped' && bot.status === 'running') return false;
      if (!term) return true;
      return [bot.id, config.username, config.category, config.host, bot.ownerLabel]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [fleet.bots, search, statusFilter]);

  /** Category buckets, alphabetical, with Uncategorized pinned last. */
  const groups = useMemo(() => {
    const buckets = new Map();
    for (const bot of visible) {
      const name = ((bot.config && bot.config.category) || UNCATEGORIZED).trim() || UNCATEGORIZED;
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(bot);
    }
    return [...buckets.entries()]
      .map(([name, items]) => ({
        name,
        bots: items.sort((a, b) =>
          ((a.config && a.config.username) || a.id).localeCompare((b.config && b.config.username) || b.id)
        ),
        running: items.filter((bot) => bot.status === 'running').length,
      }))
      .sort((a, b) => {
        if (a.name === b.name) return 0;
        if (a.name === UNCATEGORIZED) return 1;
        if (b.name === UNCATEGORIZED) return -1;
        return a.name.localeCompare(b.name);
      });
  }, [visible]);

  // Keep a valid selection: adopt the first visible bot on load, and move on if
  // the selected bot is filtered away or removed by a stream event.
  useEffect(() => {
    if (!visible.length) {
      if (selected) setSelected('');
      return;
    }
    if (!visible.some((bot) => bot.id === selected)) setSelected(visible[0].id);
  }, [visible, selected]);

  const toggleGroup = (name) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  /** Start or stop every bot in one category. */
  const groupLifecycle = async (group, action) => {
    const targets = group.bots.filter((bot) =>
      action === 'start' ? bot.status !== 'running' : bot.status === 'running'
    );
    if (!targets.length) {
      toast(`Nothing to ${action} in ${group.name}`, 'info');
      return;
    }
    setGroupBusy(`${group.name}:${action}`);
    const results = await Promise.allSettled(
      targets.map((bot) => api(`/bots/${encodeURIComponent(bot.id)}/${action}`, { method: 'POST' }))
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    const completed = action === 'stop' ? 'stopped' : 'started';
    setGroupBusy('');
    if (failed) toast(`${targets.length - failed} of ${targets.length} ${completed} in ${group.name}`, 'warning');
    else toast(`${targets.length} ${completed} in ${group.name}`, 'success');
    fleet.reload();
  };

  const toggleBotCheck = (id, force) => {
    setCheckedBots((current) => {
      const next = new Set(current);
      const shouldCheck = typeof force === 'boolean' ? force : !next.has(id);
      if (shouldCheck) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllVisible = (force) => {
    const allChecked = visible.length > 0 && visible.every((b) => checkedBots.has(b.id));
    const shouldCheck = typeof force === 'boolean' ? force : !allChecked;
    setCheckedBots((current) => {
      const next = new Set(current);
      if (shouldCheck) {
        visible.forEach((b) => next.add(b.id));
      } else {
        visible.forEach((b) => next.delete(b.id));
      }
      return next;
    });
  };

  const toggleGroupCheck = (group, force) => {
    const allInGroupChecked = group.bots.length > 0 && group.bots.every((b) => checkedBots.has(b.id));
    const shouldCheck = typeof force === 'boolean' ? force : !allInGroupChecked;
    setCheckedBots((current) => {
      const next = new Set(current);
      if (shouldCheck) {
        group.bots.forEach((b) => next.add(b.id));
      } else {
        group.bots.forEach((b) => next.delete(b.id));
      }
      return next;
    });
  };

  const massDelete = async () => {
    const ids = Array.from(checkedBots);
    if (!ids.length) return;
    setMassDeleting(true);
    try {
      const result = await api('/bots', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });
      const count = result.removed ?? ids.length;
      toast(`Deleted ${count} bot${count === 1 ? '' : 's'}`, 'success');
      setCheckedBots(new Set());
      setMassDeleteOpen(false);
      setSelectMode(false);
      if (ids.includes(selected)) {
        setSelected('');
      }
      fleet.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setMassDeleting(false);
    }
  };

  const massLifecycle = async (action) => {
    const ids = Array.from(checkedBots);
    if (!ids.length) return;
    const targets = fleet.bots.filter(
      (b) => ids.includes(b.id) && (action === 'start' ? b.status !== 'running' : b.status === 'running')
    );
    if (!targets.length) {
      toast(`None of the selected bots need to be ${action}ed`, 'info');
      return;
    }
    setMassActionBusy(action);
    try {
      const results = await Promise.allSettled(
        targets.map((bot) => api(`/bots/${encodeURIComponent(bot.id)}/${action}`, { method: 'POST' }))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      const completed = action === 'stop' ? 'stopped' : 'started';
      if (failed) {
        toast(`${targets.length - failed} of ${targets.length} ${completed}`, 'warning');
      } else {
        toast(`${targets.length} bot${targets.length === 1 ? '' : 's'} ${completed}`, 'success');
      }
      fleet.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setMassActionBusy('');
    }
  };

  const openCreateModal = () => {
    const saved = loadLastBotConfig();
    const nextId = getNextBotId(fleet.bots, saved?.lastId);
    if (saved) {
      setForm({
        ...BLANK_BOT,
        ...saved,
        id: nextId,
        username: '',
      });
    } else {
      setForm({
        ...BLANK_BOT,
        id: nextId,
        username: '',
      });
    }
    setCreateError('');
    setUsernameMeta(null);
    setCreateOpen(true);
  };

  const createBot = async () => {
    if (atBotLimit) {
      setCreateError('Bot limit reached: standard accounts can have a maximum of 10 bots.');
      return;
    }
    const saved = loadLastBotConfig();
    const id = form.id.trim() || getNextBotId(fleet.bots, saved?.lastId);
    if (!BOT_ID.test(id)) {
      setCreateError('Bot ID must be 1-24 characters: letters, numbers, hyphen, or underscore.');
      return;
    }
    const username = form.username.trim() || id;
    if (!MINECRAFT_USERNAME.test(username)) {
      setCreateError('Minecraft username must be 3-16 letters, numbers, or underscores.');
      return;
    }
    const payload = {
      id,
      username,
      category: form.category.trim() || UNCATEGORIZED,
      host: form.host.trim() || 'play.bananasmp.net',
      port: Number(form.port) || 25565,
      version: form.version.trim() || '1.20.1',
      auth: form.auth,
      autoReconnect: form.autoReconnect,
      reconnectDelay: Math.round((Number(form.reconnectDelaySec) || 5) * 1000),
      afkMode: form.afkMode,
      autoRegister: form.autoRegister,
      autoLogin: form.autoLogin,
      webhookUrl: form.webhookUrl.trim(),
      discord: {
        enabled: form.discordEnabled,
        token: form.discordToken.trim(),
        guildId: form.discordGuildId.trim(),
      },
      boneCollector: {
        collectSlot: Number(form.collectSlot) || 13,
        cycleDelay: Math.round((Number(form.cycleDelaySec) || 15) * 1000),
      },
    };
    if (form.proxyId) payload.proxyId = form.proxyId;
    if (form.loginPassword) payload.loginPassword = form.loginPassword;
    if (isAdmin && form.ownerId) payload.ownerId = form.ownerId;

    setCreating(true);
    setCreateError('');
    try {
      const result = await api('/bots', { method: 'POST', body: JSON.stringify(payload) });

      // Save last bot configuration & credentials
      saveLastBotConfig(form, id);

      // If startOnCreate is selected, start the bot immediately
      if (form.startOnCreate) {
        try {
          await api(`/bots/${encodeURIComponent(id)}/start`, { method: 'POST' });
          toast(`${id} created and started`, 'success');
        } catch (startErr) {
          toast(`${id} created, but failed to start: ${startErr.message}`, 'warning');
        }
      } else {
        toast(`${id} created`, 'success');
      }

      setCreateOpen(false);
      fleet.reload();
      if (result && result.bot) setSelected(result.bot.id);
    } catch (reason) {
      setCreateError(reason.message);
    } finally {
      setCreating(false);
    }
  };

  const generateUsername = async () => {
    setGeneratingName(true);
    setCreateError('');
    try {
      const result = await api('/usernames/generate', { method: 'POST' });
      setForm((current) => ({ ...current, username: result.username }));
      setUsernameMeta(result);
      toast(`${result.username} is fresh and reserved for you`, 'success');
    } catch (reason) {
      setCreateError(reason.message);
    } finally {
      setGeneratingName(false);
    }
  };

  const broadcast = async () => {
    const cmd = cast.cmd.trim();
    if (!cmd) return;
    setCasting(true);
    try {
      const staggerSec = Number(cast.staggerSec);
      const staggerMs = Number.isFinite(staggerSec) ? Math.max(0, Math.round(staggerSec * 1000)) : 250;
      const body = { cmd, staggerMs, staggerSec };
      if (cast.botIds.length) body.botIds = cast.botIds;
      const result = await api('/mass-cmd', { method: 'POST', body: JSON.stringify(body) });
      toast(`Queued for ${result.total} bot${result.total === 1 ? '' : 's'}`, 'success');
      setCastOpen(false);
      setCast({ cmd: '', staggerSec: '0.25', botIds: [] });
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setCasting(false);
    }
  };

  const runningTotal = fleet.bots.filter((bot) => bot.status === 'running').length;
  const proxyOptions = useMemo(
    () => withLiveProxyUsage(proxies.data || [], fleet.bots, !fleet.loading),
    [proxies.data, fleet.bots, fleet.loading]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fleet"
        title="Bots"
        description={`${fleet.bots.length}${!isAdmin ? '/10' : ''} bot${fleet.bots.length === 1 ? '' : 's'} across ${
          groups.length || 0
        } categor${groups.length === 1 ? 'y' : 'ies'} · ${runningTotal} running${
          atBotLimit ? ' · (10-bot limit reached)' : ''
        }`}
        actions={
          <>
            <LiveDot live={fleet.live} label="Fleet" />
            {checkedBots.size ? (
              <Button
                variant="danger"
                onClick={() => setMassDeleteOpen(true)}
                className="gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete {checkedBots.size}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setCastOpen(true)} disabled={!runningTotal}>
              <Send className="h-3.5 w-3.5" />
              Broadcast
            </Button>
            <Button
              onClick={openCreateModal}
              disabled={atBotLimit}
              title={atBotLimit ? 'Account limit reached: maximum 10 bots for standard accounts' : 'Create new bot'}
            >
              <Plus className="h-3.5 w-3.5" />
              New bot {!isAdmin ? `(${fleet.bots.length}/10)` : ''}
            </Button>
          </>
        }
      />

      {fleet.error ? <ErrorNote>{fleet.error}</ErrorNote> : null}

      <div className="grid items-start gap-6 md:grid-cols-[19rem_minmax(0,1fr)] lg:grid-cols-[21rem_minmax(0,1fr)] xl:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Mobile switcher: toggle between roster and workspace on small screens */}
        <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1 md:hidden col-span-full">
          <button
            type="button"
            onClick={() => setMobileTab('roster')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition',
              mobileTab === 'roster'
                ? 'bg-white/[0.12] text-white shadow-sm'
                : 'text-white/50 hover:text-white'
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            <span>Roster ({visible.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('workspace')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition',
              mobileTab === 'workspace'
                ? 'bg-white/[0.12] text-white shadow-sm'
                : 'text-white/50 hover:text-white'
            )}
          >
            <span>Workspace</span>
            {selected ? (
              <span className="max-w-[120px] truncate text-white/40">
                · {fleet.bots.find((b) => b.id === selected)?.config?.username || selected}
              </span>
            ) : null}
          </button>
        </div>

        {/* Left in-page sidebar: Bot selector & roster */}
        <aside
          className={cn(
            'panel-surface flex flex-col min-h-0 overflow-hidden rounded-2xl md:sticky md:top-[calc(var(--header-h)+1rem)] md:max-h-[calc(100vh-var(--header-h)-2.5rem)]',
            mobileTab !== 'roster' && 'hidden md:flex'
          )}
        >
          {/* Sidebar Top Header */}
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Roster
              </span>
              <span
                title={!isAdmin ? `${fleet.bots.length} of 10 maximum bots used` : `${fleet.bots.length} bots registered`}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium transition',
                  atBotLimit
                    ? 'border border-amber-500/30 bg-amber-500/15 text-amber-300 font-semibold'
                    : 'bg-white/[0.08] text-white/50'
                )}
              >
                {visible.length}{visible.length !== fleet.bots.length ? ` of ${fleet.bots.length}` : ''}
                {!isAdmin ? ` (max 10)` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (selectMode) {
                    setSelectMode(false);
                    setCheckedBots(new Set());
                  } else {
                    setSelectMode(true);
                  }
                }}
                title={selectMode ? 'Exit selection mode' : 'Select multiple bots'}
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition',
                  selectMode
                    ? 'border-white/30 bg-white/[0.12] text-white shadow-sm'
                    : 'border-white/10 bg-white/[0.05] text-white/70 hover:border-white/20 hover:bg-white/[0.10] hover:text-white'
                )}
              >
                <CheckSquare className="h-3 w-3" />
                <span>{selectMode ? 'Done' : 'Select'}</span>
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                title={atBotLimit ? 'Account limit reached: maximum 10 bots for standard accounts' : 'Create new bot'}
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition',
                  atBotLimit
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
                    : 'border-white/10 bg-white/[0.05] text-white/70 hover:border-white/20 hover:bg-white/[0.10] hover:text-white'
                )}
              >
                <Plus className="h-3 w-3" />
                <span>New bot</span>
              </button>
            </div>
          </div>

          {/* Search & Filter Header */}
          <div className="space-y-2.5 border-b border-white/[0.07] p-3.5">
            {/* Sleek Search Bar */}
            <div className="group relative flex items-center">
              <Search className="pointer-events-none absolute left-3 h-4 w-4 text-white/35 transition-colors group-focus-within:text-white/80" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search roster..."
                aria-label="Search roster"
                className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.035] pl-9 pr-8 text-[13px] text-white placeholder:text-white/30 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.055] focus:border-white/30 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/[0.06]"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 rounded-md p-1 text-white/40 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            {/* Segmented Filter Pills */}
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.07] bg-white/[0.025] p-1">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-all duration-200',
                  statusFilter === 'all'
                    ? 'bg-white/[0.12] text-white shadow-sm'
                    : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
                )}
              >
                <span>All</span>
                <span className="tnum rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/50">
                  {fleet.bots.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('running')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-all duration-200',
                  statusFilter === 'running'
                    ? 'bg-white/[0.12] text-white shadow-sm'
                    : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white anim-pulse" />
                <span>Live</span>
                <span className="tnum rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/50">
                  {runningTotal}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('stopped')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-all duration-200',
                  statusFilter === 'stopped'
                    ? 'bg-white/[0.12] text-white shadow-sm'
                    : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
                )}
              >
                <span>Off</span>
                <span className="tnum rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/50">
                  {fleet.bots.length - runningTotal}
                </span>
              </button>
            </div>
          </div>

          {/* Select Mode Subheader */}
          {selectMode ? (
            <div className="flex items-center justify-between border-b border-white/[0.07] bg-white/[0.025] px-3.5 py-2 text-[11px]">
              <label className="flex cursor-pointer items-center gap-2 select-none text-white/70 hover:text-white">
                <Checkbox
                  checked={visible.length > 0 && visible.every((b) => checkedBots.has(b.id))}
                  onChange={(checked) => selectAllVisible(checked)}
                  disabled={!visible.length}
                />
                <span>Select all visible ({visible.length})</span>
              </label>
              {checkedBots.size ? (
                <button
                  type="button"
                  onClick={() => setCheckedBots(new Set())}
                  className="text-[11px] text-white/40 transition hover:text-white"
                >
                  Clear ({checkedBots.size})
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Scrollable Roster Area */}
          <div className="console-scrollbar flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1.5">
            {fleet.loading && !fleet.bots.length ? (
              <div className="py-10">
                <Spinner label="Loading roster" />
              </div>
            ) : null}

            {!fleet.loading && !visible.length ? (
              <p className="px-3 py-8 text-center text-[13px] text-white/35">
                {fleet.bots.length ? 'No bots match these filters.' : 'No bots yet.'}
              </p>
            ) : null}

            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.name);
              const allInGroupChecked = group.bots.length > 0 && group.bots.every((b) => checkedBots.has(b.id));
              return (
                <section key={group.name} className="mb-1.5">
                  <div className="flex items-center gap-1 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.02]">
                    {selectMode ? (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="mr-1 shrink-0"
                      >
                        <Checkbox
                          checked={allInGroupChecked}
                          onChange={(checked) => toggleGroupCheck(group, checked)}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.name)}
                      aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <ChevronDown
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 text-white/30 transition-transform duration-300',
                          isCollapsed && '-rotate-90'
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                        {group.name}
                      </span>
                      <span className="tnum shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/35">
                        {group.running}/{group.bots.length}
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={`Start all in ${group.name}`}
                        disabled={groupBusy === `${group.name}:start`}
                        onClick={() => groupLifecycle(group, 'start')}
                        className="rounded-md p-1.5 text-white/30 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title={`Stop all in ${group.name}`}
                        disabled={groupBusy === `${group.name}:stop`}
                        onClick={() => groupLifecycle(group, 'stop')}
                        className="rounded-md p-1.5 text-white/30 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
                      >
                        <Square className="h-3 w-3" />
                      </button>
                    </span>
                  </div>

                  {isCollapsed ? null : (
                    <ul className="mt-0.5 space-y-0.5">
                      {group.bots.map((bot) => {
                        const config = bot.config || {};
                        const isActive = bot.id === selected;
                        const isRunning = bot.status === 'running';
                        const isChecked = checkedBots.has(bot.id);
                        return (
                          <li key={bot.id}>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                if (selectMode) {
                                  toggleBotCheck(bot.id);
                                } else {
                                  setSelected(bot.id);
                                  setMobileTab('workspace');
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  if (selectMode) {
                                    toggleBotCheck(bot.id);
                                  } else {
                                    setSelected(bot.id);
                                    setMobileTab('workspace');
                                  }
                                }
                              }}
                              aria-current={isActive ? 'true' : undefined}
                              className={cn(
                                'group flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-all duration-150 select-none',
                                isActive
                                  ? 'border border-white/[0.14] bg-white/[0.10] text-white shadow-sm ring-1 ring-white/10'
                                  : isChecked
                                    ? 'border border-white/[0.12] bg-white/[0.06] text-white'
                                    : 'border border-transparent text-white/60 hover:border-white/10 hover:bg-white/[0.045] hover:text-white'
                              )}
                            >
                              {selectMode ? (
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleBotCheck(bot.id);
                                  }}
                                  className="shrink-0"
                                >
                                  <Checkbox
                                    checked={isChecked}
                                    onChange={(checked) => toggleBotCheck(bot.id, checked)}
                                  />
                                </div>
                              ) : null}

                              <span
                                title={bot.status || 'stopped'}
                                className={cn(
                                  'h-2 w-2 shrink-0 rounded-full transition',
                                  isRunning
                                    ? 'bg-emerald-400 anim-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                                    : 'bg-white/20'
                                )}
                              />

                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium leading-tight text-white/90 group-hover:text-white">
                                  {config.username || bot.id}
                                </span>
                                <span className="mt-0.5 block truncate font-mono text-[10px] text-white/35">
                                  {egressLabel(bot)}
                                </span>
                              </div>

                              {bot.shards !== null && bot.shards !== undefined ? (
                                <span
                                  title={`${Number(bot.shards).toLocaleString()} shards`}
                                  className="tnum inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.12)]"
                                >
                                  <Gem className="h-2.5 w-2.5 text-amber-400" />
                                  <span>{formatShards(bot.shards)}</span>
                                </span>
                              ) : isRunning ? (
                                <span
                                  title="Waiting for shards update..."
                                  className="tnum inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/30"
                                >
                                  <Gem className="h-2.5 w-2.5 opacity-40" />
                                  <span>--</span>
                                </span>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>

          {/* Sidebar Footer or Mass Action Bar */}
          {checkedBots.size > 0 ? (
            <div className="border-t border-white/[0.12] bg-white/[0.05] p-3 backdrop-blur-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-white">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black">
                    {checkedBots.size}
                  </span>
                  <span>selected</span>
                </span>
                <button
                  type="button"
                  onClick={() => setCheckedBots(new Set())}
                  className="text-[11px] text-white/40 transition hover:text-white"
                >
                  Deselect all
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={massActionBusy === 'start'}
                  onClick={() => massLifecycle('start')}
                  title="Start selected bots"
                  className="flex-1 text-xs"
                >
                  <Play className="h-3 w-3" />
                  Start
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={massActionBusy === 'stop'}
                  onClick={() => massLifecycle('stop')}
                  title="Stop selected bots"
                  className="flex-1 text-xs"
                >
                  <Square className="h-3 w-3" />
                  Stop
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setMassDeleteOpen(true)}
                  title="Delete selected bots"
                  className="flex-1 text-xs"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-white/40">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white anim-pulse" />
                <span className="tnum font-medium text-white/70">{runningTotal}</span> of {fleet.bots.length} live
              </span>
              <button
                type="button"
                onClick={() => setCastOpen(true)}
                disabled={!runningTotal}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/50 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-30 disabled:pointer-events-none"
              >
                <Send className="h-3 w-3" />
                <span>Broadcast</span>
              </button>
            </div>
          )}
        </aside>

        {/* Workspace for the selected bot */}
        <div className={cn('min-w-0', mobileTab !== 'workspace' && 'hidden md:block')}>
          {selected ? (
            <BotWorkspace
              key={selected}
              botId={selected}
              fleetBots={fleet.bots}
              fleetLoading={fleet.loading}
              onDeleted={() => {
                setSelected('');
                fleet.reload();
              }}
            />
          ) : (
            <div className="panel-surface rounded-2xl px-6 py-16">
              <EmptyState
                icon={<Bot className="h-5 w-5" />}
                title={fleet.bots.length ? 'Select a bot' : 'No bots yet'}
                description={
                  fleet.bots.length
                    ? 'Pick a bot from the roster to open its console, configuration, inventory, modules, and scripts.'
                    : 'Create your first bot to get a console, inventory view, and module controls.'
                }
                action={
                  fleet.bots.length ? null : (
                    <Button onClick={openCreateModal} disabled={atBotLimit}>
                      <Plus className="h-3.5 w-3.5" />
                      New bot
                    </Button>
                  )
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Mass Delete Confirmation Modal */}
      <ConfirmModal
        open={massDeleteOpen}
        onClose={() => setMassDeleteOpen(false)}
        onConfirm={massDelete}
        loading={massDeleting}
        title={`Delete ${checkedBots.size} bot${checkedBots.size === 1 ? '' : 's'}`}
        confirmLabel={`Delete ${checkedBots.size} bot${checkedBots.size === 1 ? '' : 's'}`}
        description={`Are you sure you want to permanently delete ${checkedBots.size} bot${
          checkedBots.size === 1 ? '' : 's'
        }? They will be stopped, removed from the roster, and their data directories deleted. This cannot be undone.`}
      />

      {/* Create bot */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New bot"
        description="Everything here can be changed later in the bot's Configuration tab."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button loading={creating} disabled={atBotLimit} onClick={createBot}>
              Create bot
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {atBotLimit ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <span>
                <strong>Account Limit Reached:</strong> Standard accounts can register a maximum of 10 bots ({fleet.bots.length}/10 used). Delete an existing bot to create a new one.
              </span>
            </div>
          ) : null}

          {createError ? <ErrorNote>{createError}</ErrorNote> : null}

          {loadLastBotConfig() ? (
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs">
              <span className="text-white/60">
                Restored credentials &amp; settings from your last created bot.
              </span>
              <button
                type="button"
                onClick={() => {
                  try { localStorage.removeItem(LAST_BOT_CONFIG_KEY); } catch {}
                  setForm({ ...BLANK_BOT, id: getNextBotId(fleet.bots) });
                  toast('Form reset to default settings', 'info');
                }}
                className="ml-2 shrink-0 text-white/40 underline transition hover:text-white"
              >
                Reset to defaults
              </button>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bot ID" hint="Auto-generated unique process identifier. Editable if needed.">
              <Input
                value={form.id}
                onChange={(event) => setForm({ ...form, id: event.target.value })}
                placeholder="bot-1"
                aria-label="Bot ID"
                className="font-mono text-xs"
              />
            </Field>
            <Field
              label="Minecraft username"
              hint={usernameMeta
                ? `Inspired by verified profile ${usernameMeta.inspiredBy}; confirmed unregistered and reserved.`
                : 'Generate a verified, human-style name or enter your own.'}
            >
              <div className="flex gap-2">
                <Input
                  value={form.username}
                  onChange={(event) => {
                    setForm({ ...form, username: event.target.value });
                    setUsernameMeta(null);
                  }}
                  maxLength={16}
                  pattern="[A-Za-z0-9_]{3,16}"
                  placeholder="miner_01"
                  aria-label="Minecraft username"
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={generateUsername}
                  loading={generatingName}
                  disabled={creating}
                  title="Generate and reserve an unregistered Minecraft username"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate
                </Button>
              </div>
            </Field>
            <Field label="Category" hint="Groups the bot in the roster and in permissions.">
              <Input
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                placeholder={UNCATEGORIZED}
              />
            </Field>
            <Field label="Server host">
              <Input value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} />
            </Field>
            <Field label="Port">
              <Input
                type="number"
                value={form.port}
                onChange={(event) => setForm({ ...form, port: event.target.value })}
              />
            </Field>
            <Field label="Version">
              <Input value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} />
            </Field>
            <Field label="Auth">
              <Select value={form.auth} onChange={(event) => setForm({ ...form, auth: event.target.value })}>
                <option value="offline">Offline</option>
                <option value="microsoft">Microsoft</option>
              </Select>
            </Field>
            <Field label="Proxy endpoint" hint="Leave unassigned to connect directly.">
              <Select value={form.proxyId} onChange={(event) => setForm({ ...form, proxyId: event.target.value })}>
                <option value="">Direct connection</option>
                {proxyOptions.map((proxy) => (
                  <option key={proxy.id} value={proxy.id} disabled={proxy.freeSlots <= 0}>
                    {proxy.label}
                    {` · ${(proxy.assignedTo || []).length + (Number(proxy.hiddenAssignments) || 0)}/${proxy.capacity} used`}
                    {proxy.freeSlots <= 0 ? ' · full' : ` · ${proxy.freeSlots} left`}
                    {(proxy.assignedTo || []).length
                      ? ` · ${(proxy.assignedTo || []).slice(0, 2).map((entry) => entry.username || entry.id).join(', ')}`
                      : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reconnect delay (seconds)" hint="Delay before reconnecting after a disconnect.">
              <Input
                type="number"
                min="0.5"
                step="0.5"
                value={form.reconnectDelaySec}
                onChange={(event) => setForm({ ...form, reconnectDelaySec: event.target.value })}
                placeholder="5"
              />
            </Field>
            {isAdmin ? (
              <Field label="Owner" hint="Register this bot directly into another account.">
                <Select value={form.ownerId} onChange={(event) => setForm({ ...form, ownerId: event.target.value })}>
                  <option value="">Me ({user.email})</option>
                  {(owners.data || []).map((account) => (
                    <option key={account.id} value={account.id}>{account.email}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Checkbox
              checked={form.autoReconnect}
              onChange={(checked) => setForm({ ...form, autoReconnect: checked })}
              label="Auto reconnect"
              description="Rejoin after a disconnect."
            />
            <Checkbox
              checked={form.afkMode}
              onChange={(checked) => setForm({ ...form, afkMode: checked })}
              label="AFK mode"
              description="Keep the session alive while idle."
            />
            <Checkbox
              checked={form.autoRegister}
              onChange={(checked) => setForm({ ...form, autoRegister: checked })}
              label="Auto register"
              description="Send /register on first join."
            />
            <Checkbox
              checked={form.autoLogin}
              onChange={(checked) => setForm({ ...form, autoLogin: checked })}
              label="Auto login"
              description="Send /login with the password below."
            />
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
            <Checkbox
              checked={form.startOnCreate}
              onChange={(checked) => setForm({ ...form, startOnCreate: checked })}
              label="Start bot immediately after creation"
              description="Launch the bot process right after it is created."
            />
          </div>

          {form.autoRegister || form.autoLogin ? (
            <Field label="Login password" hint="Server password for /register and /login. Stored server-side and saved for your next bots.">
              <Input
                type="password"
                autoComplete="new-password"
                value={form.loginPassword}
                onChange={(event) => setForm({ ...form, loginPassword: event.target.value })}
                placeholder="Enter password..."
              />
            </Field>
          ) : null}

          <Checkbox
            checked={form.discordEnabled}
            onChange={(checked) => setForm({ ...form, discordEnabled: checked })}
            label="Discord alerts"
            description="Relay this bot's events to a Discord bot."
          />

          {form.discordEnabled ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Discord token">
                <Input
                  type="password"
                  autoComplete="off"
                  value={form.discordToken}
                  onChange={(event) => setForm({ ...form, discordToken: event.target.value })}
                />
              </Field>
              <Field label="Guild ID">
                <Input
                  value={form.discordGuildId}
                  onChange={(event) => setForm({ ...form, discordGuildId: event.target.value })}
                />
              </Field>
            </div>
          ) : null}

          <Field label="Webhook URL" hint="Optional. Receives status and reward events.">
            <Input
              value={form.webhookUrl}
              onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })}
              placeholder="https://"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bone collector slot">
              <Input
                type="number"
                value={form.collectSlot}
                onChange={(event) => setForm({ ...form, collectSlot: event.target.value })}
              />
            </Field>
            <Field label="Collector cycle (seconds)" hint="Seconds between bone collection cycles.">
              <Input
                type="number"
                min="1"
                step="1"
                value={form.cycleDelaySec}
                onChange={(event) => setForm({ ...form, cycleDelaySec: event.target.value })}
                placeholder="15"
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* Broadcast */}
      <Modal
        open={castOpen}
        onClose={() => setCastOpen(false)}
        title="Broadcast command"
        description="Sent to running bots only. Alias names are expanded server-side."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCastOpen(false)}>
              Cancel
            </Button>
            <Button loading={casting} disabled={!cast.cmd.trim()} onClick={broadcast}>
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Command" hint="Chat text or a slash command, exactly as a player would type it.">
            <Input
              value={cast.cmd}
              onChange={(event) => setCast({ ...cast, cmd: event.target.value })}
              placeholder="!stats"
              className="font-mono"
            />
          </Field>
          <Field label="Stagger (seconds)" hint="Delay in seconds between bots (e.g. 0.25s or 1s) to avoid server rate limits.">
            <Input
              type="number"
              min="0"
              max="300"
              step="0.05"
              value={cast.staggerSec}
              onChange={(event) => setCast({ ...cast, staggerSec: event.target.value })}
              placeholder="0.25"
            />
          </Field>
          <div>
            <span className="field-label">Targets</span>
            <p className="mb-2 text-[11px] text-white/30">Leave empty to hit every running bot you can see.</p>
            <BotPicker
              bots={fleet.bots.filter((bot) => bot.status === 'running')}
              value={cast.botIds}
              onChange={(botIds) => setCast({ ...cast, botIds })}
              emptyLabel="No bots are running right now."
            />
          </div>
          {cast.botIds.length ? (
            <Pill tone="strong">
              {cast.botIds.length} target{cast.botIds.length === 1 ? '' : 's'}
            </Pill>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
