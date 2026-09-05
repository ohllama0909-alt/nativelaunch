'use client';

import Link from 'next/link';
import { Activity, Bot, Clock, Gem, Layers, Network } from 'lucide-react';
import { useAuth } from '@/components/providers';
import { EmptyState, Panel, Spinner, StatCard, StatusBadge } from '@/components/ui';
import { ErrorNote, LiveDot, Meter, Pill, SectionTitle } from '@/components/dash-ui';
import { useFleet, useResource, useTicker } from '@/lib/hooks';
import { fmtDateTime, pct, proxyLabelFor, relTime } from '@/lib/format';

export default function OverviewPage() {
  const { user } = useAuth();
  const { bots, loading, live, error } = useFleet();
  const proxies = useResource('/proxies');
  const schedules = useResource('/schedules', (result) => result.schedules || []);
  const jobs = useResource('/jobs', (result) => result.jobs || []);
  useTicker(15000);

  const running = bots.filter((bot) => bot.status === 'running');
  const proxyRows = (proxies.data && proxies.data.proxies) || [];
  const capacity = (proxies.data && proxies.data.capacity) || 0;
  const alive = proxyRows.filter((row) => row.alive);
  const unchecked = proxyRows.filter((row) => !row.lastCheck);
  const usedSlots = proxyRows.reduce(
    (sum, row) => sum + ((row.assignedTo && row.assignedTo.length) || 0) + (row.hiddenAssignments || 0),
    0
  );
  const totalSlots = proxyRows.length * capacity;
  const direct = bots.filter((bot) => !(bot.config && bot.config.proxy));
  const pending = (schedules.data || []).filter((schedule) => schedule.status === 'pending');
  const activeJobs = (jobs.data || []).filter((job) => job.status === 'running');
  const recentJobs = (jobs.data || []).slice(0, 5);
  const nextUp = [...pending].sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt)).slice(0, 5);
  const totalShards = bots.reduce((sum, bot) => sum + (Number(bot.shards) || 0), 0);
  const categories = (() => {
    const map = new Map();
    for (const bot of bots) {
      const name = ((bot.config && bot.config.category) || 'Uncategorized').trim() || 'Uncategorized';
      if (!map.has(name)) map.set(name, { name, total: 0, running: 0 });
      const row = map.get(name);
      row.total += 1;
      if (bot.status === 'running') row.running += 1;
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  })();

  return (
    <div className="space-y-7">
      <header className="anim-rise relative overflow-hidden rounded-[26px] border border-white/[0.09] bg-white/[0.02] p-6 backdrop-blur-xl sm:p-8">
        <div className="spotlight pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-white/[0.05] blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="eyebrow mb-3 flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-white anim-pulse' : 'bg-white/25'}`} />
              Control plane
            </p>
            <h1 className="display text-gradient text-[34px] sm:text-[44px]">Mission control</h1>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/45">
              Signed in as <span className="text-white/75">{user.email}</span>. Everything below is scoped to
              what this account may manage.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <LiveDot live={live} label="Streaming" />
            {totalShards > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/65">
                <Gem className="h-3 w-3 text-white/40" />
                <span className="tnum font-semibold text-white">{totalShards.toLocaleString()}</span> shards
              </span>
            ) : null}
            <Link
              href="/bots"
              className="sheen inline-flex h-10 items-center gap-2 rounded-xl border border-white bg-white px-4 text-[13px] font-semibold text-black transition-all duration-300 [transition-timing-function:var(--ease-ios)] hover:bg-white/90 active:scale-[.97]"
            >
              <Bot className="h-3.5 w-3.5" />
              Open fleet
            </Link>
          </div>
        </div>
      </header>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bots online"
          value={loading ? '--' : `${running.length}/${bots.length}`}
          hint={
            bots.length
              ? user && user.role !== 'admin'
                ? `${running.length} running · ${bots.length}/10 quota used`
                : `${pct(running.length, bots.length)}% of the roster running`
              : 'No bots registered yet'
          }
          icon={<Bot className="h-4 w-4" />}
        />
        <StatCard
          label="Proxies verified"
          value={proxies.loading ? '--' : `${alive.length}/${proxyRows.length}`}
          hint={unchecked.length ? `${unchecked.length} never tested` : 'Every endpoint has been probed'}
          icon={<Network className="h-4 w-4" />}
        />
        <StatCard
          label="Scheduled actions"
          value={schedules.loading ? '--' : pending.length}
          hint={nextUp.length ? `Next ${relTime(nextUp[0].runAt)}` : 'Nothing queued'}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Running jobs"
          value={jobs.loading ? '--' : activeJobs.length}
          hint={activeJobs.length ? 'Mass commands in flight' : 'Command queue idle'}
          icon={<Activity className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <SectionTitle
            title="Fleet"
            description="Live status from the account-scoped event stream."
            actions={
              <Link href="/bots" className="text-[12px] text-white/45 transition hover:text-white">
                Manage bots
              </Link>
            }
          />
          {loading ? (
            <div className="px-5 py-10">
              <Spinner label="Loading roster" />
            </div>
          ) : bots.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                icon={<Bot className="h-5 w-5" />}
                title="No bots yet"
                description="Register your first bot to start streaming console output and inventory."
              />
            </div>
          ) : (
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bot</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Category</th>
                    <th>Shards</th>
                    <th>Server</th>
                    <th>Egress</th>
                  </tr>
                </thead>
                <tbody>
                  {bots.slice(0, 8).map((bot) => (
                    <tr key={bot.id}>
                      <td>
                        <Link href={`/bots/${encodeURIComponent(bot.id)}`} className="transition hover:text-white">
                          <span className="block text-white/85">{(bot.config && bot.config.username) || bot.id}</span>
                          <span className="block text-[11px] text-white/30">{bot.id}</span>
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={bot.status} />
                      </td>
                      <td className="hidden max-w-[140px] truncate text-white/50 md:table-cell">
                        {(bot.config && bot.config.category) || 'Uncategorized'}
                      </td>
                      <td>
                        {bot.shards !== null && bot.shards !== undefined ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-white">
                            <Gem className="h-3 w-3 text-white/70" />
                            {Number(bot.shards).toLocaleString()}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-white/20">--</span>
                        )}
                      </td>
                      <td className="text-white/50">
                        {bot.config ? `${bot.config.host}:${bot.config.port}` : '--'}
                      </td>
                      <td className="text-white/50">
                        {proxyLabelFor(bot) || <span className="text-white/25">direct</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel>
            <SectionTitle
              title="Categories"
              description="Broadcast to any of these straight from the fleet."
              actions={
                <Link href="/bots" className="text-[12px] text-white/45 transition hover:text-white">
                  Fleet
                </Link>
              }
            />
            <div className="px-5 py-4">
              {categories.length === 0 ? (
                <p className="text-[13px] text-white/35">No bots yet — categories appear here.</p>
              ) : (
                <ul className="space-y-3">
                  {categories.slice(0, 6).map((cat) => {
                    const pct = cat.total ? Math.round((cat.running / cat.total) * 100) : 0;
                    return (
                      <li key={cat.name}>
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]">
                          <span className="flex min-w-0 items-center gap-2 text-white/75">
                            <Layers className="h-3 w-3 shrink-0 text-white/30" />
                            <span className="truncate">{cat.name}</span>
                          </span>
                          <span className="tnum shrink-0 text-white/40">
                            {cat.running}/{cat.total}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                          <div
                            className="h-full rounded-full bg-white transition-all duration-700"
                            style={{ width: `${pct}%`, transitionTimingFunction: 'var(--ease-ios)' }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Panel>

          <Panel>
            <SectionTitle
              title="Proxy capacity"
              actions={
                <Link href="/network" className="text-[12px] text-white/45 transition hover:text-white">
                  Network
                </Link>
              }
            />
            <div className="space-y-4 px-5 py-5">
              {proxyRows.length === 0 ? (
                <p className="text-[13px] text-white/35">No proxy endpoints in this pool yet.</p>
              ) : (
                <>
                  <Meter value={usedSlots} total={totalSlots} label="Slots in use" />
                  <div className="flex flex-wrap gap-2">
                    <Pill tone="strong">{alive.length} verified</Pill>
                    <Pill>{proxyRows.length - alive.length} unverified</Pill>
                    <Pill tone="quiet">{capacity} bots per proxy</Pill>
                  </div>
                </>
              )}
              {direct.length > 0 ? (
                <p className="text-[12px] leading-relaxed text-white/35">
                  {direct.length} bot{direct.length === 1 ? '' : 's'} connect directly with no proxy assigned.
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel>
            <SectionTitle
              title="Next scheduled"
              actions={
                <Link href="/schedules" className="text-[12px] text-white/45 transition hover:text-white">
                  Schedules
                </Link>
              }
            />
            <div className="px-5 py-4">
              {nextUp.length === 0 ? (
                <p className="text-[13px] text-white/35">No pending actions.</p>
              ) : (
                <ul className="space-y-3">
                  {nextUp.map((schedule) => (
                    <li key={schedule.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] text-white/80">
                          {schedule.action === 'start' ? 'Start' : 'Stop'} {schedule.botIds.length} bot
                          {schedule.botIds.length === 1 ? '' : 's'}
                        </p>
                        <p className="truncate text-[11px] text-white/30">
                          {fmtDateTime(schedule.runAt, schedule.timeZone)}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-white/40">{relTime(schedule.runAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </div>
      </div>

      <Panel>
        <SectionTitle
          title="Recent mass commands"
          description="Jobs run server-side, so closing the panel never interrupts them."
          actions={
            <Link href="/activity" className="text-[12px] text-white/45 transition hover:text-white">
              Activity
            </Link>
          }
        />
        {recentJobs.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={<Activity className="h-5 w-5" />}
              title="No commands dispatched"
              description="Broadcast a command from the Bots page to see its progress here."
            />
          </div>
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id}>
                    <td className="font-mono text-[12px] text-white/80">
                      <span className="block">{job.cmd}</span>
                      {(job.includeCategories && job.includeCategories.length) ||
                      (job.excludeCategories && job.excludeCategories.length) ? (
                        <span className="mt-1 block font-sans text-[10px] text-white/30">
                          {(job.includeCategories || []).length
                            ? `to ${(job.includeCategories || []).join(', ')}`
                            : 'to everyone'}
                          {(job.excludeCategories || []).length
                            ? ` · except ${(job.excludeCategories || []).join(', ')}`
                            : ''}
                        </span>
                      ) : null}
                    </td>
                    <td className="tnum text-white/50">
                      {job.done}/{job.total} · {job.ok} ok
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="text-white/40">{relTime(job.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
