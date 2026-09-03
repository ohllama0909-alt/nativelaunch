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
import { Bot, ChevronDown, Play, Plus, Search, Send, Sparkles, Square } from 'lucide-react';
import { useAuth, useToast } from '@/components/providers';
import { Button, Checkbox, EmptyState, Modal, PageHeader, Spinner } from '@/components/ui';
import { BotPicker, ErrorNote, Field, Input, LiveDot, Pill, Select } from '@/components/dash-ui';
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
  reconnectDelay: '5000',
  afkMode: true,
  autoRegister: false,
  autoLogin: false,
  loginPassword: '',
  discordEnabled: false,
  discordToken: '',
  discordGuildId: '',
  webhookUrl: '',
  collectSlot: '13',
  cycleDelay: '15000',
  ownerId: '',
};

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

export default function BotsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fleet = useFleet();
  const proxies = useResource('/proxies', (result) => result.proxies || []);
  const isAdmin = user.role === 'admin';
  const owners = useResource(isAdmin ? '/users' : null, (result) => result.users || []);

  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [groupBusy, setGroupBusy] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(BLANK_BOT);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [generatingName, setGeneratingName] = useState(false);
  const [usernameMeta, setUsernameMeta] = useState(null);

  const [castOpen, setCastOpen] = useState(false);
  const [cast, setCast] = useState({ cmd: '', staggerMs: '250', botIds: [] });
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

  const createBot = async () => {
    const id = form.id.trim();
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
      reconnectDelay: Number(form.reconnectDelay) || 5000,
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
        cycleDelay: Number(form.cycleDelay) || 15000,
      },
    };
    if (form.proxyId) payload.proxyId = form.proxyId;
    if (form.loginPassword) payload.loginPassword = form.loginPassword;
    if (isAdmin && form.ownerId) payload.ownerId = form.ownerId;

    setCreating(true);
    setCreateError('');
    try {
      const result = await api('/bots', { method: 'POST', body: JSON.stringify(payload) });
      toast(`${id} created`, 'success');
      setCreateOpen(false);
      setForm(BLANK_BOT);
      setUsernameMeta(null);
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
      const body = { cmd, staggerMs: Number(cast.staggerMs) || 0 };
      if (cast.botIds.length) body.botIds = cast.botIds;
      const result = await api('/mass-cmd', { method: 'POST', body: JSON.stringify(body) });
      toast(`Queued for ${result.total} bot${result.total === 1 ? '' : 's'}`, 'success');
      setCastOpen(false);
      setCast({ cmd: '', staggerMs: '250', botIds: [] });
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
        description={`${fleet.bots.length} bot${fleet.bots.length === 1 ? '' : 's'} across ${
          groups.length || 0
        } categor${groups.length === 1 ? 'y' : 'ies'} · ${runningTotal} running`}
        actions={
          <>
            <LiveDot live={fleet.live} label="Fleet" />
            <Button variant="secondary" onClick={() => setCastOpen(true)} disabled={!runningTotal}>
              <Send className="h-3.5 w-3.5" />
              Broadcast
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New bot
            </Button>
          </>
        }
      />

      {fleet.error ? <ErrorNote>{fleet.error}</ErrorNote> : null}

      <div className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        {/* Roster rail */}
        <aside className="panel-surface overflow-hidden rounded-2xl lg:sticky lg:top-[calc(var(--header-h)+1.25rem)]">
          <div className="space-y-2.5 border-b border-white/[0.07] p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/25" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search roster"
                className="pl-9"
                aria-label="Search roster"
              />
            </div>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              <option value="running">Running only</option>
              <option value="stopped">Stopped only</option>
            </Select>
          </div>

          <div className="console-scrollbar max-h-[calc(100vh-19rem)] overflow-y-auto p-2">
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
              return (
                <section key={group.name} className="mb-1.5">
                  <div className="flex items-center gap-1 rounded-lg px-1.5 py-1.5">
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
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-[0.11em] text-white/45">
                        {group.name}
                      </span>
                      <span className="tnum shrink-0 text-[10px] text-white/30">
                        {group.running}/{group.bots.length}
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        title={`Start all in ${group.name}`}
                        disabled={groupBusy === `${group.name}:start`}
                        onClick={() => groupLifecycle(group, 'start')}
                        className="rounded-md p-1.5 text-white/30 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title={`Stop all in ${group.name}`}
                        disabled={groupBusy === `${group.name}:stop`}
                        onClick={() => groupLifecycle(group, 'stop')}
                        className="rounded-md p-1.5 text-white/30 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                      >
                        <Square className="h-3 w-3" />
                      </button>
                    </span>
                  </div>

                  {isCollapsed ? null : (
                    <ul className="space-y-0.5">
                      {group.bots.map((bot) => {
                        const config = bot.config || {};
                        const isActive = bot.id === selected;
                        const isRunning = bot.status === 'running';
                        return (
                          <li key={bot.id}>
                            <button
                              type="button"
                              onClick={() => setSelected(bot.id)}
                              aria-current={isActive ? 'true' : undefined}
                              className={cn(
                                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150',
                                isActive ? 'bg-white/[0.10] text-white' : 'text-white/55 hover:bg-white/[0.04] hover:text-white/80'
                              )}
                            >
                              <span
                                title={bot.status || 'stopped'}
                                className={cn(
                                  'h-1.5 w-1.5 shrink-0 rounded-full',
                                  isRunning ? 'bg-white anim-pulse' : 'bg-white/20'
                                )}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] leading-tight">
                                  {config.username || bot.id}
                                </span>
                                <span className="mt-0.5 block truncate font-mono text-[10px] text-white/30">
                                  {egressLabel(bot)}
                                </span>
                              </span>
                              {bot.shards ? <span className="tnum shrink-0 text-[10px] text-white/30">{bot.shards}</span> : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </aside>

        {/* Workspace for the selected bot */}
        <div className="min-w-0">
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
                    <Button onClick={() => setCreateOpen(true)}>
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
            <Button loading={creating} onClick={createBot}>
              Create bot
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {createError ? <ErrorNote>{createError}</ErrorNote> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bot ID" hint="Letters, numbers, hyphen, underscore. Used as the process name.">
              <Input
                value={form.id}
                onChange={(event) => setForm({ ...form, id: event.target.value })}
                placeholder="miner-01"
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
            <Field label="Reconnect delay (ms)">
              <Input
                type="number"
                min="500"
                value={form.reconnectDelay}
                onChange={(event) => setForm({ ...form, reconnectDelay: event.target.value })}
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

          {form.autoRegister || form.autoLogin ? (
            <Field label="Login password" hint="Stored server-side and never returned to the browser.">
              <Input
                type="password"
                autoComplete="new-password"
                value={form.loginPassword}
                onChange={(event) => setForm({ ...form, loginPassword: event.target.value })}
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
            <Field label="Collector cycle (ms)">
              <Input
                type="number"
                value={form.cycleDelay}
                onChange={(event) => setForm({ ...form, cycleDelay: event.target.value })}
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
          <Field label="Stagger (ms)" hint="Delay between bots, to avoid tripping server rate limits.">
            <Input
              type="number"
              min="0"
              max="300000"
              value={cast.staggerMs}
              onChange={(event) => setCast({ ...cast, staggerMs: event.target.value })}
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
