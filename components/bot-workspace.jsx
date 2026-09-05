'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Gem, Play, Plus, RefreshCw, RotateCcw, Send, Square, Trash2 } from 'lucide-react';
import { useToast } from '@/components/providers';
import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
  PageHeader,
  Panel,
  Spinner,
  StatusBadge,
  Tabs,
} from '@/components/ui';
import {
  ConfirmModal,
  ErrorNote,
  Field,
  Input,
  KeyValue,
  LiveDot,
  Pill,
  SectionTitle,
  Select,
} from '@/components/dash-ui';
import { BLANK_SCRIPT, ScriptForm, formToPayload, scriptToForm } from '@/components/script-form';
import { useBotStream, useResource } from '@/lib/hooks';
import { api } from '@/lib/api';
import { fmtClock, fmtDateTime, relTime, withLiveProxyUsage } from '@/lib/format';

const QUICK_COMMANDS = ['!stats', '!bones on', '!bones off', '!invclean on', '!pvdrop on', '!reload'];

const TABS = [
  { value: 'console', label: 'Console' },
  { value: 'config', label: 'Configuration' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'modules', label: 'Modules' },
  { value: 'scripts', label: 'Scripts' },
];

/**
 * The complete single-bot workspace: console, configuration, inventory,
 * modules, and scripts.
 *
 * Rendered both as the right-hand pane of the /bots split view and as the whole
 * of the /bots/[id] deep-link page, so it takes the bot id as a prop rather
 * than reading route params, reports deletion upward instead of navigating on
 * its own, and only shows a back link when one is supplied.
 */
export function BotWorkspace({ botId: botIdProp, onDeleted, backHref, fleetBots, fleetLoading = false }) {
  const { toast } = useToast();
  const botId = decodeURIComponent(String(botIdProp || ''));

  const [tab, setTab] = useState('console');
  const record = useResource(botId ? `/bots/${encodeURIComponent(botId)}` : null, (result) => result.bot);
  const stream = useBotStream(botId);
  const bot = record.data;
  const status = stream.status || (bot && bot.status) || 'stopped';
  const isRunning = status === 'running';

  const [busy, setBusy] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const lifecycle = async (action) => {
    setBusy(action);
    try {
      await api(`/bots/${encodeURIComponent(botId)}/${action}`, { method: 'POST' });
      toast(`${botId} ${action === 'restart' ? 'restarting' : `${action}ed`}`, 'success');
      record.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/bots/${encodeURIComponent(botId)}`, { method: 'DELETE' });
      toast(`${botId} deleted`, 'success');
      onDeleted?.(botId);
    } catch (reason) {
      toast(reason.message, 'error');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (record.loading && !bot) {
    return (
      <div className="py-16">
        <Spinner label={`Loading ${botId}`} />
      </div>
    );
  }

  if (record.error && !bot) {
    return (
      <div className="space-y-5">
        {backHref ? (
          <Link href={backHref} className="inline-flex items-center gap-2 text-[13px] text-white/40 transition hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to bots
          </Link>
        ) : null}
        <ErrorNote>{record.error}</ErrorNote>
      </div>
    );
  }

  const config = (bot && bot.config) || {};
  const effectiveShards = stream.shards !== null && stream.shards !== undefined ? stream.shards : (bot?.shards ?? null);

  return (
    <div className="space-y-7">
      {backHref ? (
        <div>
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-[13px] text-white/40 transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to bots
          </Link>
        </div>
      ) : null}

      <PageHeader
        eyebrow={config.category || 'Uncategorized'}
        title={config.username || botId}
        description={`${config.host || 'unknown host'}:${config.port || 25565} · ${config.version || '?'} · ${
          config.auth === 'microsoft' ? 'Microsoft auth' : 'offline auth'
        }`}
        actions={
          <>
            <StatusBadge status={status} />
            {effectiveShards !== null && effectiveShards !== undefined ? (
              <span
                title={`${Number(effectiveShards).toLocaleString()} shards`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_12px_rgba(255,255,255,0.15)]"
              >
                <Gem className="h-3.5 w-3.5 text-white/70" />
                <span>{Number(effectiveShards).toLocaleString()} shards</span>
              </span>
            ) : null}
            <LiveDot live={stream.live} label="Console" />
            {isRunning ? (
              <Button variant="secondary" loading={busy === 'stop'} onClick={() => lifecycle('stop')}>
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Button variant="secondary" loading={busy === 'start'} onClick={() => lifecycle('start')}>
                <Play className="h-3.5 w-3.5" />
                Start
              </Button>
            )}
            <Button variant="secondary" loading={busy === 'restart'} onClick={() => lifecycle('restart')}>
              <RotateCcw className="h-3.5 w-3.5" />
              Restart
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </>
        }
      />

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'console' ? <ConsoleTab botId={botId} stream={stream} isRunning={isRunning} /> : null}
      {tab === 'config' ? (
        <ConfigTab
          botId={botId}
          bot={bot}
          onSaved={record.reload}
          fleetBots={fleetBots}
          fleetLoading={fleetLoading}
        />
      ) : null}
      {tab === 'inventory' ? <InventoryTab botId={botId} stream={stream} isRunning={isRunning} /> : null}
      {tab === 'modules' ? <ModulesTab botId={botId} stream={stream} isRunning={isRunning} /> : null}
      {tab === 'scripts' ? <ScriptsTab botId={botId} /> : null}

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        loading={deleting}
        title="Delete bot"
        confirmLabel="Delete bot"
        description={`${botId} will be stopped, removed from the roster, and its data directory deleted.`}
      />
    </div>
  );
}

function ConsoleTab({ botId, stream, isRunning }) {
  const { toast } = useToast();
  const [cmd, setCmd] = useState('');
  const [sending, setSending] = useState(false);
  const [pinned, setPinned] = useState(true);
  const scroller = useRef(null);

  useEffect(() => {
    if (!pinned) return;
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [stream.logs, pinned]);

  const send = async (value) => {
    const text = String(value == null ? cmd : value).trim();
    if (!text) return;
    setSending(true);
    try {
      await api(`/bots/${encodeURIComponent(botId)}/cmd`, {
        method: 'POST',
        body: JSON.stringify({ cmd: text }),
      });
      if (value == null) setCmd('');
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel>
        <SectionTitle
          title="Console"
          description="Live stdout from the bot process. The server keeps the last 400 lines."
          actions={
            <Checkbox checked={pinned} onChange={setPinned} label="Follow" />
          }
        />
        <div
          ref={scroller}
          onScroll={(event) => {
            const node = event.currentTarget;
            const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
            if (atBottom !== pinned) setPinned(atBottom);
          }}
          className="console-scrollbar h-[420px] overflow-y-auto bg-black/40 px-5 py-4 font-mono text-[12px] leading-relaxed"
        >
          {stream.logs.length === 0 ? (
            <p className="text-white/25">
              {isRunning ? 'Waiting for output...' : 'This bot is stopped. Start it to stream console output.'}
            </p>
          ) : (
            stream.logs.map((entry, index) => (
              <div key={`${entry.t || index}-${index}`} className="flex gap-3">
                <span className="tnum shrink-0 text-white/20">{fmtClock(entry.t)}</span>
                <span className="whitespace-pre-wrap break-words text-white/65">{entry.line}</span>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-col gap-3 border-t border-white/[0.07] px-5 py-4 sm:flex-row">
          <span className="flex-1">
            <Input
              value={cmd}
              onChange={(event) => setCmd(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={isRunning ? 'Send a command or chat message' : 'Bot must be running'}
              disabled={!isRunning}
              className="font-mono text-[12px]"
            />
          </span>
          <Button onClick={() => send()} loading={sending} disabled={!isRunning || !cmd.trim()}>
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </Panel>

      <Panel>
        <SectionTitle title="Quick actions" description="Common control commands understood by the bot's modules." />
        <div className="flex flex-wrap gap-2 px-5 py-5">
          {QUICK_COMMANDS.map((quick) => (
            <Button key={quick} variant="secondary" size="sm" disabled={!isRunning} onClick={() => send(quick)}>
              <span className="font-mono text-[12px]">{quick}</span>
            </Button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ConfigTab({ botId, bot, onSaved, fleetBots, fleetLoading }) {
  const { toast } = useToast();
  const proxies = useResource('/proxies', (result) => result.proxies || []);
  const config = (bot && bot.config) || {};

  const [form, setForm] = useState(() => ({
    host: config.host || '',
    port: config.port || 25565,
    username: config.username || '',
    version: config.version || '',
    auth: config.auth || 'offline',
    category: config.category || '',
    proxyId: config.proxyId || '',
    autoReconnect: config.autoReconnect !== false,
    reconnectDelaySec: config.reconnectDelay ? String(config.reconnectDelay / 1000) : '5',
    afkMode: config.afkMode !== false,
    autoLogin: !!config.autoLogin,
    autoRegister: !!config.autoRegister,
    loginPassword: '',
    webhookUrl: config.webhookUrl || '',
    discordEnabled: !!(config.discord && config.discord.enabled),
    discordToken: '',
    discordGuildId: (config.discord && config.discord.guildId) || '',
    collectSlot: (config.boneCollector && config.boneCollector.collectSlot) || 13,
    cycleDelaySec: (config.boneCollector && config.boneCollector.cycleDelay) ? String(config.boneCollector.cycleDelay / 1000) : '15',
    rewardServerCmd: config.rewardServerCmd || '',
    rewardWarpCmd: config.rewardWarpCmd || '',
    rewardInterval: config.rewardInterval || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const proxyRows = useMemo(
    () => withLiveProxyUsage(proxies.data || [], fleetBots || [], Array.isArray(fleetBots) && !fleetLoading),
    [proxies.data, fleetBots, fleetLoading]
  );

  const set = (patch) => setForm({ ...form, ...patch });

  const save = async () => {
    setSaving(true);
    setError('');
    const payload = {
      host: form.host,
      port: Number(form.port),
      username: form.username,
      version: form.version,
      auth: form.auth,
      category: form.category,
      proxyId: form.proxyId,
      autoReconnect: form.autoReconnect,
      reconnectDelay: Math.round((Number(form.reconnectDelaySec) || 5) * 1000),
      afkMode: form.afkMode,
      autoLogin: form.autoLogin,
      autoRegister: form.autoRegister,
      webhookUrl: form.webhookUrl,
      discord: { enabled: form.discordEnabled, guildId: form.discordGuildId },
      boneCollector: { collectSlot: Number(form.collectSlot), cycleDelay: Math.round((Number(form.cycleDelaySec) || 15) * 1000) },
      rewardServerCmd: form.rewardServerCmd,
      rewardWarpCmd: form.rewardWarpCmd,
    };
    // Secrets are write-only in this form: an untouched field must not clear
    // the stored value, so only send them when the operator typed something.
    if (form.loginPassword) payload.loginPassword = form.loginPassword;
    if (form.discordToken) payload.discord.token = form.discordToken;
    if (form.rewardInterval !== '') payload.rewardInterval = Number(form.rewardInterval);

    try {
      await api(`/bots/${encodeURIComponent(botId)}/config`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast('Configuration saved. Restart the bot to apply connection changes.', 'success');
      setForm({ ...form, loginPassword: '', discordToken: '' });
      onSaved();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Panel>
        <SectionTitle
          title="Connection"
          description="Host, version, and egress changes take effect on the next restart."
          actions={
            <Button onClick={save} loading={saving}>
              Save changes
            </Button>
          }
        />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Field label="Host">
            <Input value={form.host} onChange={(event) => set({ host: event.target.value })} />
          </Field>
          <Field label="Port">
            <Input type="number" value={form.port} onChange={(event) => set({ port: event.target.value })} />
          </Field>
          <Field label="Username">
            <Input value={form.username} onChange={(event) => set({ username: event.target.value })} />
          </Field>
          <Field label="Version">
            <Input value={form.version} onChange={(event) => set({ version: event.target.value })} />
          </Field>
          <Field label="Auth">
            <Select value={form.auth} onChange={(event) => set({ auth: event.target.value })}>
              <option value="offline">Offline (cracked)</option>
              <option value="microsoft">Microsoft</option>
            </Select>
          </Field>
          <Field label="Category">
            <Input value={form.category} onChange={(event) => set({ category: event.target.value })} />
          </Field>
          <Field label="Egress proxy" hint="Clearing this returns the bot to a direct connection.">
            <Select value={form.proxyId} onChange={(event) => set({ proxyId: event.target.value })}>
              <option value="">Direct connection</option>
              {proxyRows.map((proxy) => (
                <option key={proxy.id} value={proxy.id} disabled={proxy.freeSlots <= 0 && proxy.id !== form.proxyId}>
                  {proxy.label}
                  {` · ${(proxy.assignedTo || []).length + (Number(proxy.hiddenAssignments) || 0)}/${proxy.capacity} used`}
                  {proxy.freeSlots <= 0 ? ' · full' : ` · ${proxy.freeSlots} left`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reconnect delay (seconds)" hint="Seconds to wait before reconnecting after a disconnect.">
            <Input
              type="number"
              min="0.5"
              step="0.5"
              value={form.reconnectDelaySec}
              onChange={(event) => set({ reconnectDelaySec: event.target.value })}
            />
          </Field>
        </div>
      </Panel>

      <Panel>
        <SectionTitle title="Behaviour" />
        <div className="space-y-3 px-5 py-5">
          <Checkbox
            checked={form.autoReconnect}
            onChange={(checked) => set({ autoReconnect: checked })}
            label="Auto reconnect"
          />
          <Checkbox checked={form.afkMode} onChange={(checked) => set({ afkMode: checked })} label="AFK mode" />
          <Checkbox
            checked={form.autoLogin}
            onChange={(checked) => set({ autoLogin: checked })}
            label="Auto login"
          />
          <Checkbox
            checked={form.autoRegister}
            onChange={(checked) => set({ autoRegister: checked })}
            label="Auto register"
          />
          <Field label="Login password" hint="Leave blank to keep the stored password.">
            <Input
              type="password"
              value={form.loginPassword}
              onChange={(event) => set({ loginPassword: event.target.value })}
              placeholder="unchanged"
              autoComplete="new-password"
            />
          </Field>
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          title="Rewards"
          description="These three fields are pushed to a running bot immediately, without a restart."
        />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-3">
          <Field label="Server command">
            <Input
              value={form.rewardServerCmd}
              onChange={(event) => set({ rewardServerCmd: event.target.value })}
              placeholder="/server survival"
            />
          </Field>
          <Field label="Warp command">
            <Input
              value={form.rewardWarpCmd}
              onChange={(event) => set({ rewardWarpCmd: event.target.value })}
              placeholder="/warp rewards"
            />
          </Field>
          <Field label="Interval (ms)">
            <Input
              type="number"
              value={form.rewardInterval}
              onChange={(event) => set({ rewardInterval: event.target.value })}
            />
          </Field>
        </div>
      </Panel>

      <Panel>
        <SectionTitle title="Alerts" description="Kick, disconnect, death, and crash notifications." />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Field label="Discord webhook URL">
            <Input value={form.webhookUrl} onChange={(event) => set({ webhookUrl: event.target.value })} />
          </Field>
          <Field label="Discord guild ID">
            <Input value={form.discordGuildId} onChange={(event) => set({ discordGuildId: event.target.value })} />
          </Field>
          <Field label="Discord bot token" hint="Leave blank to keep the stored token.">
            <Input
              type="password"
              value={form.discordToken}
              onChange={(event) => set({ discordToken: event.target.value })}
              placeholder="unchanged"
              autoComplete="new-password"
            />
          </Field>
          <div className="flex items-end">
            <Checkbox
              checked={form.discordEnabled}
              onChange={(checked) => set({ discordEnabled: checked })}
              label="Enable Discord relay"
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionTitle title="Bone collector" />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Field label="Collect slot">
            <Input
              type="number"
              value={form.collectSlot}
              onChange={(event) => set({ collectSlot: event.target.value })}
            />
          </Field>
          <Field label="Cycle delay (seconds)" hint="Seconds between collection cycles.">
            <Input
              type="number"
              min="1"
              step="1"
              value={form.cycleDelaySec}
              onChange={(event) => set({ cycleDelaySec: event.target.value })}
            />
          </Field>
        </div>
        <div className="flex justify-end border-t border-white/[0.07] px-5 py-4">
          <Button onClick={save} loading={saving}>
            Save changes
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/**
 * The bot emits its inventory as an opaque JSON payload, so this renders the
 * shapes we can recognise and falls back to the raw document rather than
 * guessing at field names.
 */
function InventoryTab({ botId, stream, isRunning }) {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const inventory = stream.inventory;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api(`/bots/${encodeURIComponent(botId)}/inventory/refresh`, { method: 'POST' });
      const result = await api(`/bots/${encodeURIComponent(botId)}/inventory`);
      stream.setInventory(result.inventory);
      toast('Inventory refreshed', 'success');
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const groups = useMemo(() => {
    if (!inventory || typeof inventory !== 'object') return [];
    const found = [];
    ['items', 'hotbar', 'backpack', 'armor', 'equipment'].forEach((key) => {
      const value = inventory[key];
      if (Array.isArray(value) && value.length) found.push({ key, rows: value });
    });
    return found;
  }, [inventory]);

  return (
    <Panel>
      <SectionTitle
        title="Inventory"
        description="Snapshot reported by the bot process. Refresh asks the bot to re-read its slots."
        actions={
          <Button variant="secondary" size="sm" onClick={refresh} loading={refreshing} disabled={!isRunning}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />
      {!inventory ? (
        <div className="px-5 py-8">
          <EmptyState
            title="No inventory snapshot"
            description={
              isRunning
                ? 'Refresh to request one from the bot.'
                : 'Start the bot to collect an inventory snapshot.'
            }
          />
        </div>
      ) : groups.length ? (
        <div className="space-y-6 px-5 py-5">
          {groups.map((group) => (
            <div key={group.key}>
              <p className="eyebrow mb-2">{group.key}</p>
              <div className="flex flex-wrap gap-2">
                {group.rows.map((item, index) => {
                  const label =
                    item && typeof item === 'object'
                      ? item.displayName || item.name || item.type || `slot ${item.slot}`
                      : String(item);
                  const count = item && typeof item === 'object' ? item.count || item.amount : null;
                  return (
                    <span
                      key={`${group.key}-${index}`}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-white/70"
                    >
                      {label}
                      {count ? <span className="tnum ml-1.5 text-white/35">x{count}</span> : null}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <pre className="console-scrollbar max-h-[420px] overflow-auto bg-black/40 px-5 py-4 font-mono text-[12px] text-white/55">
          {JSON.stringify(inventory, null, 2)}
        </pre>
      )}
    </Panel>
  );
}

function ModulesTab({ botId, stream, isRunning }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [drafts, setDrafts] = useState({});
  const modules = stream.modules || [];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/bots/${encodeURIComponent(botId)}/modules`)
      .then((result) => {
        if (cancelled) return;
        stream.setModules(result.modules || []);
        setError('');
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  const act = async (module, action) => {
    setBusyKey(`${module.key}:${action}`);
    const payload = { key: module.key, action };
    if (action === 'apply' || action === 'start') {
      const draft = drafts[module.key];
      if (draft) payload.opts = draft;
    }
    try {
      const result = await api(`/bots/${encodeURIComponent(botId)}/modules`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      stream.setModules(result.modules || []);
      toast(`${module.label}: ${action === 'apply' ? 'settings applied' : action + 'ed'}`, 'success');
    } catch (reason) {
      const data = reason.data || {};
      toast(
        data.requiresSetup ? `${module.label} needs configuration first: ${reason.message}` : reason.message,
        'error'
      );
    } finally {
      setBusyKey('');
    }
  };

  const setDraft = (module, key, value) => {
    const current = drafts[module.key] || { ...(module.savedOpts || {}) };
    setDrafts({ ...drafts, [module.key]: { ...current, [key]: value } });
  };

  const groups = useMemo(() => {
    const map = new Map();
    modules.forEach((module) => {
      const group = module.group || 'General';
      if (!map.has(group)) map.set(group, []);
      map.get(group).push(module);
    });
    return [...map.entries()];
  }, [modules]);

  if (loading) {
    return (
      <Panel>
        <div className="px-5 py-10">
          <Spinner label="Loading modules" />
        </div>
      </Panel>
    );
  }

  if (error) {
    return <ErrorNote>{error}</ErrorNote>;
  }

  if (!modules.length) {
    return (
      <Panel>
        <div className="px-5 py-8">
          <EmptyState
            title="No modules reported"
            description={
              isRunning ? 'The bot has not published its module list yet.' : 'Start the bot to control its modules.'
            }
          />
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      {!isRunning ? (
        <ErrorNote>
          This bot is stopped. Module state is shown from the last snapshot; start it to make changes.
        </ErrorNote>
      ) : null}

      {groups.map(([group, rows]) => (
        <Panel key={group}>
          <SectionTitle title={group} />
          <div className="divide-y divide-white/[0.06]">
            {rows.map((module) => {
              const values = drafts[module.key] || module.savedOpts || {};
              return (
                <div key={module.key} className="px-5 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[14px] text-white/85">{module.label}</p>
                        {module.running ? <Pill tone="strong">running</Pill> : <Pill tone="quiet">idle</Pill>}
                        {module.armed ? <Pill>armed</Pill> : null}
                        {module.readOnly ? <Pill tone="quiet">read-only</Pill> : null}
                        {module.unavailable ? <Pill tone="quiet">unavailable</Pill> : null}
                      </div>
                      {module.describe ? (
                        <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-white/40">
                          {module.describe}
                        </p>
                      ) : null}
                      {module.detail ? (
                        <p className="mt-1 font-mono text-[11.5px] text-white/30">{module.detail}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {module.canStart ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busyKey === `${module.key}:start`}
                          disabled={!isRunning}
                          onClick={() => act(module, 'start')}
                        >
                          Start
                        </Button>
                      ) : null}
                      {module.canStop ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busyKey === `${module.key}:stop`}
                          disabled={!isRunning}
                          onClick={() => act(module, 'stop')}
                        >
                          Stop
                        </Button>
                      ) : null}
                      {module.editable && (module.fields || []).length ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busyKey === `${module.key}:apply`}
                          disabled={!isRunning}
                          onClick={() => act(module, 'apply')}
                        >
                          Apply
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {module.editable && (module.fields || []).length ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {module.fields.map((field) => (
                        <Field
                          key={field.key}
                          label={field.label || field.key}
                          hint={field.required ? 'Required' : undefined}
                        >
                          <Input
                            type={field.type === 'number' ? 'number' : 'text'}
                            min={field.min}
                            max={field.max}
                            value={
                              values[field.key] === undefined || values[field.key] === null
                                ? ''
                                : Array.isArray(values[field.key])
                                  ? values[field.key].join(', ')
                                  : values[field.key]
                            }
                            onChange={(event) =>
                              setDraft(
                                module,
                                field.key,
                                field.type === 'list'
                                  ? event.target.value.split(',').map((part) => part.trim()).filter(Boolean)
                                  : field.type === 'number'
                                    ? Number(event.target.value)
                                    : event.target.value
                              )
                            }
                            disabled={!isRunning}
                          />
                        </Field>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function ScriptsTab({ botId }) {
  const { toast } = useToast();
  const scripts = useResource(`/bots/${encodeURIComponent(botId)}/scripts`, (result) => result.scripts || []);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(BLANK_SCRIPT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [removing, setRemoving] = useState(null);

  const base = `/bots/${encodeURIComponent(botId)}/scripts`;

  const openCreate = () => {
    setForm(scriptToForm(null));
    setError('');
    setEditor({ mode: 'create' });
  };

  const openEdit = (script) => {
    setForm(scriptToForm(script));
    setError('');
    setEditor({ mode: 'edit', script });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const payload = formToPayload(form, { withTargets: false });
    try {
      if (editor.mode === 'create') {
        await api(base, { method: 'POST', body: JSON.stringify(payload) });
        toast('Script added and reloaded on the bot', 'success');
      } else {
        await api(`${base}/${encodeURIComponent(editor.script.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast('Script updated', 'success');
      }
      setEditor(null);
      scripts.reload();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  };

  const act = async (script, action) => {
    setBusyId(`${script.id}:${action}`);
    try {
      await api(`${base}/${encodeURIComponent(script.id)}`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      scripts.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setBusyId('');
    }
  };

  const remove = async () => {
    setBusyId('removing');
    try {
      await api(`${base}/${encodeURIComponent(removing.id)}`, { method: 'DELETE' });
      toast('Script deleted', 'success');
      setRemoving(null);
      scripts.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setBusyId('');
    }
  };

  const reloadAll = async () => {
    setBusyId('reload');
    try {
      await api(`${base}/reload`, { method: 'POST' });
      toast('Scripts reloaded on the bot', 'success');
      scripts.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setBusyId('');
    }
  };

  const rows = scripts.data || [];

  return (
    <>
      <Panel>
        <SectionTitle
          title="Bot scripts"
          description="Automation owned by this bot only. Workspace scripts are managed on the Scripts page."
          actions={
            <>
              <Button variant="secondary" size="sm" loading={busyId === 'reload'} onClick={reloadAll}>
                <RefreshCw className="h-3.5 w-3.5" />
                Reload
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                New script
              </Button>
            </>
          }
        />
        {scripts.loading ? (
          <div className="px-5 py-10">
            <Spinner label="Loading scripts" />
          </div>
        ) : scripts.error ? (
          <div className="px-5 py-5">
            <ErrorNote>{scripts.error}</ErrorNote>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              title="No scripts on this bot"
              description="Add an interval or message trigger that runs inside this bot's process."
              action={<Button onClick={openCreate}>New script</Button>}
            />
          </div>
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Script</th>
                  <th>Type</th>
                  <th>Action</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((script) => (
                  <tr key={script.id}>
                    <td>
                      <span className="block text-white/85">{script.name}</span>
                      {script.description ? (
                        <span className="block text-[11px] text-white/30">{script.description}</span>
                      ) : null}
                    </td>
                    <td className="text-white/50">
                      {script.type === 'interval'
                        ? `every ${script.interval} ms`
                        : `${script.trigger ? script.trigger.matchType : 'contains'}: ${
                            script.trigger ? script.trigger.pattern : ''
                          }`}
                    </td>
                    <td className="font-mono text-[12px] text-white/50">
                      {script.action ? `${script.action.type} · ${script.action.value}` : '--'}
                    </td>
                    <td>{script.enabled ? <Pill tone="strong">enabled</Pill> : <Pill tone="quiet">disabled</Pill>}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busyId === `${script.id}:${script.enabled ? 'disable' : 'enable'}`}
                          onClick={() => act(script, script.enabled ? 'disable' : 'enable')}
                        >
                          {script.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(script)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" title="Delete" onClick={() => setRemoving(script)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={editor && editor.mode === 'edit' ? 'Edit script' : 'New script'}
        description="Saved scripts are written into the bot's script directory and reloaded live."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim() || !form.action.value.trim()}>
              Save script
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <ScriptForm form={form} onChange={setForm} withTargets={false} />
        </div>
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        loading={busyId === 'removing'}
        title="Delete script"
        confirmLabel="Delete"
        description={removing ? `${removing.name} will be removed from this bot.` : ''}
      />
    </>
  );
}
