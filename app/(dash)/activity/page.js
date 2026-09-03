'use client';

import { Activity } from 'lucide-react';
import { EmptyState, PageHeader, Panel, Spinner, StatCard, StatusBadge } from '@/components/ui';
import { ErrorNote, Meter, Pill, SectionTitle } from '@/components/dash-ui';
import { useInterval, useResource, useTicker } from '@/lib/hooks';
import { fmtDateTime, fmtDuration, relTime } from '@/lib/format';

export default function ActivityPage() {
  const jobs = useResource('/jobs', (result) => result.jobs || []);
  useTicker(5000);

  const rows = jobs.data || [];
  const active = rows.filter((job) => job.status === 'running');

  // Only poll while something is in flight; a finished history is static.
  useInterval(() => jobs.reload({ quiet: true }), active.length ? 3000 : null);

  const dispatched = rows.reduce((sum, job) => sum + (job.total || 0), 0);
  const delivered = rows.reduce((sum, job) => sum + (job.ok || 0), 0);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="History"
        title="Activity"
        description="Mass-command jobs execute on the server and survive a panel restart, so this history is authoritative."
        actions={<Pill tone={active.length ? 'strong' : 'quiet'}>{active.length} running</Pill>}
      />

      {jobs.error ? <ErrorNote>{jobs.error}</ErrorNote> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Jobs recorded" value={rows.length} hint="Most recent 50 are retained" />
        <StatCard label="Commands dispatched" value={dispatched} hint="Across every job" />
        <StatCard
          label="Delivered"
          value={delivered}
          hint={dispatched ? `${Math.round((delivered / dispatched) * 100)}% reached a live bot` : 'Nothing sent yet'}
        />
      </div>

      <Panel>
        <SectionTitle
          title="Job history"
          description="Skipped targets were registered but not running when their turn came up."
        />
        {jobs.loading ? (
          <div className="px-5 py-10">
            <Spinner label="Loading history" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={<Activity className="h-5 w-5" />}
              title="No jobs yet"
              description="Broadcast a command from the Bots page and its progress will appear here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {rows.map((job) => (
              <li key={job.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] text-white">{job.cmd}</p>
                    <p className="mt-1 text-[11px] text-white/30">
                      {job.ownerLabel ? `${job.ownerLabel} · ` : ''}
                      {fmtDateTime(job.createdAt)} · {relTime(job.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.interrupted ? <Pill tone="quiet">interrupted</Pill> : null}
                    {job.staggerMs ? <Pill tone="quiet">{fmtDuration(job.staggerMs)} apart</Pill> : null}
                    <StatusBadge status={job.status} />
                  </div>
                </div>

                <Meter value={job.done} total={job.total} label="Delivered" />

                <div className="flex flex-wrap gap-4 text-[11px] text-white/35">
                  <span className="tnum">{job.ok} sent</span>
                  <span className="tnum">{job.skipped} skipped</span>
                  <span className="tnum">{job.total} targets</span>
                  {job.status === 'running' && job.next ? (
                    <span>
                      next {job.next} {job.nextAt ? relTime(job.nextAt) : ''}
                    </span>
                  ) : null}
                  {job.finishedAt ? <span>finished {relTime(job.finishedAt)}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
