'use client';

import Link from 'next/link';
import { Activity, Bot, Clock, Network } from 'lucide-react';
import { useAuth } from '@/components/providers';
import { EmptyState, PageHeader, Panel, Spinner, StatCard, StatusBadge } from '@/components/ui';
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

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Control plane"
        title="Overview"
        description={`Signed in as ${user.email}. Everything below is scoped to what this account may manage.`}
        actions={<LiveDot live={live} label="Streaming" />}
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bots online"
          value={loading ? '--' : `${running.length}/${bots.length}`}
          hint={bots.length ? `${pct(running.length, bots.length)}% of the roster running` : 'No bots registered yet'}
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
                    <td className="font-mono text-[12px] text-white/80">{job.cmd}</td>
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
