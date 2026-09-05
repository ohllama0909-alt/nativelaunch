'use client';

/**
 * Bots - fleet command.
 *
 * Left rail is the roster grouped by category; the right pane is the full
 * workspace for whichever bot is selected. The workspace itself lives in
 * components/bot-workspace.jsx so that this page and the /bots/[id] deep link
 * render exactly the same thing.
 *
 * Broadcasts are composed in the BroadcastModal (⌘K): everyone, whole
 * categories, the checked roster selection, or hand-picked bots - with
 * category + bot exclusions and stagger control.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckSquare,
  ChevronDown,
  Dices,
  FolderInput,
  Gem,
  Layers,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth, useToast } from '@/components/providers';
import { Button, Checkbox, EmptyState, Modal, Spinner } from '@/components/ui';
import { ConfirmModal, ErrorNote, Field, Input, LiveDot, Select } from '@/components/dash-ui';
import { BotWorkspace } from '@/components/bot-workspace';
import { BroadcastModal } from '@/components/broadcast-modal';
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
  proxyId: 'auto',
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

function catOf(bot) {
  const raw = (bot && bot.config && bot.config.category) || UNCATEGORIZED;
  return String(raw).trim() || UNCATEGORIZED;
}

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

function sortCategories(a, b) {
  if (a.name === b.name) return 0;
  if (a.name === UNCATEGORIZED) return 1;
  if (b.name === UNCATEGORIZED) return -1;
  return a.name.localeCompare(b.name);
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
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [mobileTab, setMobileTab] = useState('roster');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [groupBusy, setGroupBusy] = useState('');

  const [selectMode, setSelectMode] = useState(false);
  const [checkedBots, setCheckedBots] = useState(() => new Set());
  const [massDeleteOpen, setMassDeleteOpen] = useState(false);
  const [massDeleting, setMassDeleting] = useState(false);
  const [massActionBusy, setMassActionBusy] = useState('');

  // Bulk re-categorize: recatIds overrides the checked selection when moving
  // a whole category from its group header.
  const [recatOpen, setRecatOpen] = useState(false);
  const [recatValue, setRecatValue] = useState('');
  const [recatBusy, setRecatBusy] = useState(false);
  const [recatIds, setRecatIds] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(BLANK_BOT);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [generatingName, setGeneratingName] = useState(false);
  const [usernameMeta, setUsernameMeta] = useState(null);

  // Bulk creation: roll N names, then create N bots at once with the shared
  // settings below. Rows are { key, username, inspiredBy }.
  const [createMode, setCreateMode] = useState('single');
  const [bulkCount, setBulkCount] = useState(5);
  const [bulkNames, setBulkNames] = useState([]);
  const [rolling, setRolling] = useState(false);
  const [rerolling, setRerolling] = useState('');
  const [bulkCreating, setBulkCreating] = useState(false);
  const newBulkRow = (username = '', inspiredBy = '') => ({
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    inspiredBy,
  });

  // Fired into the BroadcastModal: { key, botIds?, includeCategories?, useSelected? }
  const [castPreset, setCastPreset] = useState({ key: 0 });
  const firePreset = (patch = {}) => setCastPreset({ key: Date.now(), ...patch });

  const checkedIds = useMemo(() => Array.from(checkedBots), [checkedBots]);
  const runningTotal = fleet.bots.filter((bot) => bot.status === 'running').length;
  const totalShards = fleet.bots.reduce((sum, bot) => sum + (Number(bot.shards) || 0), 0);

  /** Every category in the fleet, for the strip + suggestions. */
  const allCategories = useMemo(() => {
    const buckets = new Map();
    for (const bot of fleet.bots) {
      const name = catOf(bot);
      if (!buckets.has(name)) buckets.set(name, { name, total: 0, running: 0 });
      const row = buckets.get(name);
      row.total += 1;
      if (bot.status === 'running') row.running += 1;
    }
    return [...buckets.values()].sort(sortCategories);
  }, [fleet.bots]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return fleet.bots.filter((bot) => {
      const config = bot.config || {};
      if (statusFilter === 'running' && bot.status !== 'running') return false;
      if (statusFilter === 'stopped' && bot.status === 'running') return false;
      if (categoryFilter !== 'all' && catOf(bot) !== categoryFilter) return false;
      if (!term) return true;
      return [bot.id, config.username, config.category, config.host, bot.ownerLabel]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [fleet.bots, search, statusFilter, categoryFilter]);

  /** Category buckets, alphabetical, with Uncategorized pinned last. */
  const groups = useMemo(() => {
    const buckets = new Map();
    for (const bot of visible) {
      const name = catOf(bot);
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
      .sort(sortCategories);
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

  const pastTense = (action) => (action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'restarting');

  const reportLifecycle = (action, result, scope) => {
    const ok = result.okCount ?? 0;
    const skipped = result.skippedCount ?? 0;
    const failed = result.failedCount ?? 0;
    const where = scope ? ` in ${scope}` : '';
    if (failed) toast(`${ok} ${pastTense(action)}${where} · ${failed} failed`, 'warning');
    else if (!ok && skipped) toast(`Nothing to ${action}${where} — already ${action === 'stop' ? 'stopped' : 'running'}`, 'info');
    else toast(`${ok} ${pastTense(action)}${where}`, 'success');
  };

  /** Start, stop, or restart every bot in one category via one request. */
  const groupLifecycle = async (group, action) => {
    const ids = group.bots.map((bot) => bot.id);
    if (!ids.length) return;
    setGroupBusy(`${group.name}:${action}`);
    try {
      const result = await api('/bots/lifecycle', { method: 'POST', body: JSON.stringify({ ids, action }) });
      reportLifecycle(action, result, group.name);
      fleet.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setGroupBusy('');
    }
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
    setMassActionBusy(action);
    try {
      const result = await api('/bots/lifecycle', { method: 'POST', body: JSON.stringify({ ids, action }) });
      reportLifecycle(action, result, '');
      fleet.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setMassActionBusy('');
    }
  };

  const openRecat = (ids = null, initial = '') => {
    setRecatIds(ids);
    setRecatValue(initial);
    setRecatOpen(true);
  };

  /** Move the checked bots (or an explicit id list) into a new category. */
  const massRecategorize = async () => {
    const ids = recatIds || Array.from(checkedBots);
    if (!ids.length) return;
    const category = recatValue.trim() || UNCATEGORIZED;
    setRecatBusy(true);
    try {
      const result = await api('/bots', { method: 'PATCH', body: JSON.stringify({ ids, category }) });
      toast(`${result.updated} bot${result.updated === 1 ? '' : 's'} moved to “${result.category}”`, 'success');
      setRecatOpen(false);
      setRecatIds(null);
      setRecatValue('');
      setCheckedBots(new Set());
      fleet.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setRecatBusy(false);
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
        // Legacy saves predate auto-assign; an explicitly stored '' still
        // means the operator chose a direct connection last time.
        proxyId: saved.proxyId ?? 'auto',
      });
    } else {
      setForm({
        ...BLANK_BOT,
        id: nextId,
        username: '',
      });
    }
    setCreateMode('single');
    const slots = isAdmin ? 10 : Math.max(0, 10 - fleet.bots.length);
    const initial = Math.max(1, Math.min(5, Math.min(10, slots) || 1));
    setBulkCount(initial);
    setBulkNames([]);
    setRolling(false);
    setRerolling('');
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
    if (form.proxyId === 'auto') payload.autoProxy = true;
    else if (form.proxyId) payload.proxyId = form.proxyId;
    if (form.loginPassword) payload.loginPassword = form.loginPassword;
    if (isAdmin && form.ownerId) payload.ownerId = form.ownerId;

    setCreating(true);
    setCreateError('');
    try {
      const result = await api('/bots', { method: 'POST', body: JSON.stringify(payload) });

      // Save last bot configuration & credentials
      saveLastBotConfig(form, id);

      // If startOnCreate is selected, start the bot immediately
      const via = result?.assignedProxy ? ` on ${result.assignedProxy.label}` : '';
      if (form.startOnCreate) {
        try {
          await api(`/bots/${encodeURIComponent(id)}/start`, { method: 'POST' });
          toast(`${id} created and started${via}`, 'success');
        } catch (startErr) {
          toast(`${id} created${via}, but failed to start: ${startErr.message}`, 'warning');
        }
      } else {
        toast(`${id} created${via || (result?.proxyNote ? ' (direct — pool full)' : '')}`, 'success');
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

  const switchCreateMode = (mode) => {
    setCreateMode(mode);
    setCreateError('');
    if (mode === 'bulk') {
      setBulkNames((current) => (current.length
        ? current
        : Array.from({ length: bulkCount }, () => newBulkRow())));
    }
  };

  const syncBulkRows = (count) => {
    const n = Math.max(1, Math.min(maxBulk, count));
    setBulkCount(n);
    setBulkNames((current) => {
      if (current.length === n) return current;
      if (current.length > n) return current.slice(0, n);
      return [...current, ...Array.from({ length: n - current.length }, () => newBulkRow())];
    });
  };

  /** Roll `count` fresh, reserved names and replace the name rows with them. */
  const rollNames = async (count) => {
    setRolling(true);
    setCreateError('');
    try {
      const result = await api('/usernames/generate-batch', {
        method: 'POST',
        body: JSON.stringify({ count }),
      });
      setBulkNames((result.usernames || []).map((entry) => newBulkRow(entry.username, entry.inspiredBy || '')));
      if (result.partial) {
        toast(`Rolled ${result.usernames.length} of ${count} — Mojang throttled the rest, roll the remainder again`, 'warning');
      } else {
        toast(`Rolled ${result.usernames.length} fresh, reserved names`, 'success');
      }
    } catch (reason) {
      setCreateError(reason.message);
    } finally {
      setRolling(false);
    }
  };

  const rerollOne = async (key) => {
    setRerolling(key);
    try {
      const result = await api('/usernames/generate', { method: 'POST' });
      setBulkNames((current) => current.map((row) => (row.key === key
        ? { ...row, username: result.username, inspiredBy: result.inspiredBy || '' }
        : row)));
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setRerolling('');
    }
  };

  /** Shared settings payload used by bulk creation (single mode builds its own). */
  const buildBulkDefaults = () => {
    const defaults = {
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
      startOnCreate: form.startOnCreate,
    };
    if (form.proxyId === 'auto') defaults.autoProxy = true;
    else if (form.proxyId) defaults.proxyId = form.proxyId;
    if (form.loginPassword) defaults.loginPassword = form.loginPassword;
    if (isAdmin && form.ownerId) defaults.ownerId = form.ownerId;
    return defaults;
  };

  const createBulk = async () => {
    if (!bulkValid || bulkCreating || atBotLimit) return;
    setBulkCreating(true);
    setCreateError('');
    try {
      const result = await api('/bots/batch', {
        method: 'POST',
        body: JSON.stringify({
          defaults: buildBulkDefaults(),
          bots: bulkNames.map((row) => ({ username: row.username.trim() })),
        }),
      });
      const made = result.created || [];
      const fails = result.failed || [];
      if (made.length) saveLastBotConfig(form, made[made.length - 1].id);
      if (fails.length) {
        toast(`${made.length} created · ${fails.length} failed (${fails[0].username}: ${fails[0].reason})`, 'warning');
      } else {
        toast(`${made.length} bots created${form.startOnCreate ? ' and starting' : ''}`, 'success');
      }
      setCreateOpen(false);
      fleet.reload();
      if (made[0]) setSelected(made[0].id);
    } catch (reason) {
      setCreateError(reason.message);
    } finally {
      setBulkCreating(false);
    }
  };

  const proxyOptions = useMemo(
    () => withLiveProxyUsage(proxies.data || [], fleet.bots, !fleet.loading),
    [proxies.data, fleet.bots, fleet.loading]
  );

  /** Live pool totals shown next to the proxy picker. */
  const poolSummary = useMemo(() => {
    const rows = proxyOptions || [];
    const free = rows.reduce((sum, proxy) => sum + (Number(proxy.freeSlots) || 0), 0);
    return { total: rows.length, free };
  }, [proxyOptions]);

  /** Bulk creation is capped by batch size (10) and the account quota. */
  const maxBulk = isAdmin ? 10 : Math.max(1, Math.min(10, 10 - fleet.bots.length));
  const bulkAllowed = !atBotLimit && maxBulk > 1;

  /** Per-row validation: format, fleet collisions, and in-batch duplicates. */
  const bulkValidation = useMemo(() => {
    const fleetNames = new Set(
      (fleet.bots || []).map((bot) => String(bot.config?.username || '').toLowerCase())
    );
    const seen = new Set();
    return bulkNames.map((row) => {
      const name = row.username.trim();
      if (!name) return 'Empty — roll a name or type one in';
      if (!MINECRAFT_USERNAME.test(name)) return 'Use 3-16 letters, numbers, or underscores';
      const lower = name.toLowerCase();
      if (fleetNames.has(lower)) return 'Already used by another bot';
      if (seen.has(lower)) return 'Duplicate name in this batch';
      seen.add(lower);
      return '';
    });
  }, [bulkNames, fleet.bots]);
  const bulkValid = bulkNames.length > 0 && bulkNames.length <= maxBulk && bulkValidation.every((issue) => !issue);

  const recatCount = (recatIds || checkedIds).length;

  return (
    <div className="space-y-6">
      {/* ---------- Modern fleet header ---------- */}
      <header className="anim-rise relative overflow-hidden rounded-[26px] border border-white/[0.09] bg-white/[0.02] p-6 backdrop-blur-xl sm:p-8">
        <div className="spotlight pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-white/[0.05] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-16 h-56 w-56 rounded-full bg-white/[0.03] blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="eyebrow mb-3 flex items-center gap-2">
              <span className={cn('h-1.5 w-1.5 rounded-full', fleet.live ? 'bg-white anim-pulse' : 'bg-white/25')} />
              Fleet command
            </p>
            <h1 className="display text-gradient text-[34px] sm:text-[44px]">Bot fleet</h1>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-white/45">
              {fleet.bots.length}
              {!isAdmin ? '/10' : ''} bot{fleet.bots.length === 1 ? '' : 's'} across {allCategories.length || 0}{' '}
              categor{allCategories.length === 1 ? 'y' : 'ies'} · {runningTotal} running
              {atBotLimit ? ' · quota reached' : ''}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/65">
                <span className={cn('h-1.5 w-1.5 rounded-full', runningTotal ? 'bg-white anim-pulse' : 'bg-white/25')} />
                <span className="tnum font-semibold text-white">{runningTotal}</span> live
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/65">
                <Layers className="h-3 w-3 text-white/40" />
                <span className="tnum font-semibold text-white">{allCategories.length}</span> categories
              </span>
              {totalShards > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/65">
                  <Gem className="h-3 w-3 text-white/40" />
                  <span className="tnum font-semibold text-white">{formatShards(totalShards)}</span> shards
                </span>
              ) : null}
              <LiveDot live={fleet.live} label="Streaming" />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            {checkedBots.size ? (
              <Button variant="danger" onClick={() => setMassDeleteOpen(true)} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                Delete {checkedBots.size}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => firePreset({})} disabled={!runningTotal} title="Open broadcast (Ctrl/⌘+K)">
              <Send className="h-3.5 w-3.5" />
              Broadcast
              {fleet.activeJob?.status === 'running' && fleet.activeJob.total ? (
                <span className="tnum text-[11px] text-white/55">
                  {fleet.activeJob.done || 0}/{fleet.activeJob.total}
                </span>
              ) : (
                <kbd className="kbd hidden sm:inline-block">⌘K</kbd>
              )}
            </Button>
            <Button
              variant="primary"
              onClick={openCreateModal}
              disabled={atBotLimit}
              title={atBotLimit ? 'Account limit reached: maximum 10 bots for standard accounts' : 'Create new bot'}
            >
              <Plus className="h-3.5 w-3.5" />
              New bot {!isAdmin ? `(${fleet.bots.length}/10)` : ''}
            </Button>
          </div>
        </div>
      </header>

      {fleet.error ? <ErrorNote>{fleet.error}</ErrorNote> : null}

      {/* ---------- Category strip: filter + one-click category actions ---------- */}
      {allCategories.length > 0 ? (
        <div className="anim-rise flex gap-2 overflow-x-auto pb-1 no-scrollbar" style={{ animationDelay: '60ms' }}>
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            aria-pressed={categoryFilter === 'all'}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-2xl border px-3.5 py-2 text-xs font-medium transition-all duration-200',
              categoryFilter === 'all'
                ? 'border-white bg-white text-black shadow-[0_8px_24px_rgba(0,0,0,.5)]'
                : 'border-white/[0.09] bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white'
            )}
          >
            All
            <span className={cn('tnum rounded-full px-1.5 py-0.5 text-[10px]', categoryFilter === 'all' ? 'bg-black/10 text-black/70' : 'bg-white/[0.06] text-white/45')}>
              {fleet.bots.length}
            </span>
          </button>
          {allCategories.map((cat) => {
            const active = categoryFilter === cat.name;
            return (
              <div
                key={cat.name}
                className={cn(
                  'group inline-flex shrink-0 items-center gap-1 rounded-2xl border transition-all duration-200',
                  active
                    ? 'border-white bg-white text-black shadow-[0_8px_24px_rgba(0,0,0,.5)]'
                    : 'border-white/[0.09] bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white'
                )}
              >
                <button
                  type="button"
                  onClick={() => setCategoryFilter(active ? 'all' : cat.name)}
                  aria-pressed={active}
                  title={active ? 'Show all categories' : `Filter to ${cat.name}`}
                  className="flex min-w-0 items-center gap-2 py-2 pl-3.5 pr-1 text-xs font-medium"
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cat.running ? (active ? 'bg-black anim-pulse' : 'bg-white anim-pulse') : active ? 'bg-black/30' : 'bg-white/20')} />
                  <span className="max-w-[140px] truncate">{cat.name}</span>
                  <span className={cn('tnum rounded-full px-1.5 py-0.5 text-[10px]', active ? 'bg-black/10 text-black/70' : 'bg-white/[0.06] text-white/45')}>
                    {cat.running}/{cat.total}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => firePreset({ includeCategories: [cat.name] })}
                  disabled={!cat.running}
                  title={`Broadcast to ${cat.name}`}
                  aria-label={`Broadcast to ${cat.name}`}
                  className={cn(
                    'mr-1 rounded-lg p-1.5 transition disabled:opacity-25',
                    active ? 'text-black/50 hover:bg-black/10 hover:text-black' : 'text-white/30 hover:bg-white/[0.08] hover:text-white'
                  )}
                >
                  <Send className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

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
            'panel-surface flex flex-col min-h-0 overflow-hidden !rounded-[22px] md:sticky md:top-[calc(var(--header-h)+1rem)] md:max-h-[calc(100vh-var(--header-h)-2.5rem)]',
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
                    ? 'border border-white/25 bg-white/[0.08] text-white font-semibold'
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
                    ? 'border-white/20 bg-white/[0.08] text-white hover:bg-white/[0.12]'
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

            {categoryFilter !== 'all' ? (
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className="flex w-full items-center justify-between rounded-xl border border-white/[0.12] bg-white/[0.05] px-3 py-1.5 text-[11px] text-white/70 transition hover:border-white/25 hover:text-white"
              >
                <span className="truncate">
                  Filtered to <span className="font-semibold text-white">{categoryFilter}</span>
                </span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            ) : null}
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
                  <div className="group flex items-center gap-1 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.02]">
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
                        title={`Broadcast to ${group.name}`}
                        disabled={!group.running}
                        onClick={() => firePreset({ includeCategories: [group.name] })}
                        className="rounded-md p-1.5 text-white/30 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-25"
                      >
                        <Send className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title={`Move all in ${group.name} to another category`}
                        onClick={() => openRecat(group.bots.map((bot) => bot.id))}
                        className="rounded-md p-1.5 text-white/30 transition hover:bg-white/[0.08] hover:text-white"
                      >
                        <FolderInput className="h-3 w-3" />
                      </button>
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
                                    ? 'bg-white anim-pulse shadow-[0_0_8px_rgba(255,255,255,0.8)]'
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
                                  className="tnum inline-flex shrink-0 items-center gap-1 rounded-md border border-white/20 bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-[0_0_8px_rgba(255,255,255,0.12)]"
                                >
                                  <Gem className="h-2.5 w-2.5 text-white/70" />
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
              <div className="grid grid-cols-3 gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={massActionBusy === 'start'}
                  onClick={() => massLifecycle('start')}
                  title="Start selected bots"
                  className="text-xs"
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
                  className="text-xs"
                >
                  <Square className="h-3 w-3" />
                  Stop
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={massActionBusy === 'restart'}
                  onClick={() => massLifecycle('restart')}
                  title="Restart selected bots"
                  className="text-xs"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restart
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openRecat()}
                  title="Move selected bots to another category"
                  className="text-xs"
                >
                  <FolderInput className="h-3 w-3" />
                  Category
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => firePreset({ useSelected: true })}
                  title="Broadcast to the selected bots"
                  className="text-xs"
                >
                  <Send className="h-3 w-3" />
                  Cast
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setMassDeleteOpen(true)}
                  title="Delete selected bots"
                  className="text-xs"
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
                onClick={() => firePreset({})}
                disabled={!runningTotal}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/50 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-30 disabled:pointer-events-none"
              >
                <Send className="h-3 w-3" />
                <span>Broadcast</span>
                <kbd className="kbd hidden sm:inline-block">⌘K</kbd>
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
                    <Button variant="primary" onClick={openCreateModal} disabled={atBotLimit}>
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

      {/* Broadcast composer (stays mounted so drafts survive closing) */}
      <BroadcastModal
        bots={fleet.bots}
        activeJob={fleet.activeJob}
        selectedIds={checkedIds}
        preset={castPreset}
      />

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

      {/* Bulk re-categorize */}
      <Modal
        open={recatOpen}
        onClose={() => setRecatOpen(false)}
        title={`Move ${recatCount} bot${recatCount === 1 ? '' : 's'}`}
        description="Pick an existing category or type a new one. The roster regroups instantly."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRecatOpen(false)}>
              Cancel
            </Button>
            <Button loading={recatBusy} disabled={!recatCount} onClick={massRecategorize}>
              <FolderInput className="h-3.5 w-3.5" />
              Move {recatCount ? `(${recatCount})` : ''}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Category" hint="Leave blank for Uncategorized. 48 characters max.">
            <Input
              value={recatValue}
              onChange={(event) => setRecatValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  massRecategorize();
                }
              }}
              placeholder={UNCATEGORIZED}
              maxLength={48}
              list="nativelaunch-category-options"
              autoFocus
            />
            <datalist id="nativelaunch-category-options">
              {allCategories.map((cat) => (
                <option key={cat.name} value={cat.name} />
              ))}
            </datalist>
          </Field>
          {allCategories.length > 0 ? (
            <div>
              <span className="field-label">Existing categories</span>
              <div className="flex flex-wrap gap-1.5">
                {allCategories.map((cat) => (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => setRecatValue(cat.name)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition',
                      recatValue === cat.name
                        ? 'border-white/50 bg-white text-black'
                        : 'border-white/[0.10] bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white'
                    )}
                  >
                    <span className="max-w-[140px] truncate">{cat.name}</span>
                    <span className={cn('tnum text-[10px]', recatValue === cat.name ? 'text-black/55' : 'text-white/30')}>
                      {cat.total}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Create bot */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={createMode === 'bulk' ? `New bots · ${bulkNames.length}` : 'New bot'}
        description={createMode === 'bulk'
          ? 'One shared configuration, one name per bot, proxies spread automatically.'
          : "Everything here can be changed later in the bot's Configuration tab."}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            {createMode === 'bulk' ? (
              <Button variant="primary" loading={bulkCreating} disabled={atBotLimit || !bulkValid} onClick={createBulk}>
                {bulkCreating ? 'Creating…' : `Create ${bulkNames.length} bot${bulkNames.length === 1 ? '' : 's'}`}
              </Button>
            ) : (
              <Button variant="primary" loading={creating} disabled={atBotLimit} onClick={createBot}>
                Create bot
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {atBotLimit ? (
            <div className="flex items-center gap-2 rounded-xl border border-white/25 bg-white/[0.06] p-3 text-xs text-white/85">
              <span>
                <strong>Account Limit Reached:</strong> Standard accounts can register a maximum of 10 bots ({fleet.bots.length}/10 used). Delete an existing bot to create a new one.
              </span>
            </div>
          ) : null}

          {createError ? <ErrorNote>{createError}</ErrorNote> : null}

          {bulkAllowed ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
                <button
                  type="button"
                  onClick={() => switchCreateMode('single')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition',
                    createMode === 'single' ? 'bg-white text-black' : 'text-white/50 hover:text-white'
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Single bot
                </button>
                <button
                  type="button"
                  onClick={() => switchCreateMode('bulk')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition',
                    createMode === 'bulk' ? 'bg-white text-black' : 'text-white/50 hover:text-white'
                  )}
                >
                  <Dices className="h-3.5 w-3.5" />
                  Bulk · up to {maxBulk}
                </button>
              </div>
              {createMode === 'bulk' && !isAdmin ? (
                <span className="text-[11px] text-white/35">
                  {10 - fleet.bots.length} of 10 account slots left
                </span>
              ) : null}
            </div>
          ) : null}

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
            {createMode === 'single' ? (
              <>
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
              </>
            ) : (
              <div className="space-y-3 sm:col-span-2">
                <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/40 p-0.5">
                    <button
                      type="button"
                      onClick={() => syncBulkRows(bulkCount - 1)}
                      disabled={bulkCount <= 1 || rolling || bulkCreating}
                      aria-label="Fewer bots"
                      className="rounded-md p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="tnum min-w-[4.5rem] text-center text-xs font-bold text-white">
                      {bulkCount} bot{bulkCount === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={() => syncBulkRows(bulkCount + 1)}
                      disabled={bulkCount >= maxBulk || rolling || bulkCreating}
                      aria-label="More bots"
                      className="rounded-md p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => rollNames(bulkCount)}
                    loading={rolling}
                    disabled={bulkCreating}
                    title="Roll fresh, verified-unregistered names for every row"
                  >
                    <Dices className="h-3.5 w-3.5" />
                    Roll {bulkCount} name{bulkCount === 1 ? '' : 's'}
                  </Button>
                  <span className="text-[11px] text-white/35">
                    Verified unregistered &amp; reserved as you roll · bot IDs auto-assigned
                  </span>
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {bulkNames.map((row, index) => {
                    const issue = bulkValidation[index] || '';
                    const busy = rerolling === row.key;
                    return (
                      <div key={row.key}>
                        <div className="flex items-center gap-2">
                          <span className="tnum w-6 shrink-0 text-right text-[11px] text-white/30">
                            {index + 1}
                          </span>
                          <Input
                            value={row.username}
                            maxLength={16}
                            placeholder="miner_01"
                            aria-label={`Bot ${index + 1} username`}
                            disabled={rolling || bulkCreating}
                            onChange={(event) => {
                              const value = event.target.value;
                              setBulkNames((current) => current.map((entry) => (entry.key === row.key
                                ? { ...entry, username: value, inspiredBy: '' }
                                : entry)));
                            }}
                            className={cn('min-w-0 flex-1 font-mono', issue && 'border-white/40 bg-white/[0.05]')}
                          />
                          <button
                            type="button"
                            onClick={() => rerollOne(row.key)}
                            disabled={busy || rolling || bulkCreating}
                            title="Re-roll this name"
                            className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-white/50 transition hover:border-white/30 hover:text-white disabled:opacity-40"
                          >
                            <Dices className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
                          </button>
                        </div>
                        {issue ? (
                          <p className="mt-1 pl-8 text-[11px] text-white/55">{issue}</p>
                        ) : row.inspiredBy ? (
                          <p className="mt-1 pl-8 text-[11px] text-white/30">
                            Reserved · inspired by {row.inspiredBy}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <Field label="Category" hint="Groups the bot in the roster and in permissions.">
              <Input
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                placeholder={UNCATEGORIZED}
                list="nativelaunch-category-options"
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
            <Field
              label="Proxy endpoint"
              hint={form.proxyId === 'auto'
                ? (poolSummary.total
                  ? `Smart spread across ${poolSummary.total} ${poolSummary.total === 1 ? 'proxy' : 'proxies'} · ${poolSummary.free} free slots · falls back to direct when full.`
                  : 'Pool is empty — creates with a direct connection for now.')
                : form.proxyId
                  ? 'Pinned to this endpoint.'
                  : 'No proxy — connects straight from the panel host.'}
            >
              <Select value={form.proxyId} onChange={(event) => setForm({ ...form, proxyId: event.target.value })}>
                <option value="auto">Auto — least-loaded endpoint (recommended)</option>
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
    </div>
  );
}
