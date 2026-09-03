'use client';

import { useMemo, useState } from 'react';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/components/providers';
import {
  Button,
  EmptyState,
  Modal,
  PageHeader,
  Panel,
  Spinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import {
  BotPicker,
  ConfirmModal,
  ErrorNote,
  Field,
  Input,
  Pill,
  SectionTitle,
  Select,
} from '@/components/dash-ui';
import { useFleet, useResource, useTicker } from '@/lib/hooks';
import { api } from '@/lib/api';
import { datetimeLocalValue, fmtDateTime, localInputToIso, relTime } from '@/lib/format';

const PENDING = new Set(['pending', 'running']);

export default function SchedulesPage() {
  const { toast } = useToast();
  const schedules = useResource('/schedules', (result) => result.schedules || []);
  const { bots } = useFleet();
  useTicker(30000);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    action: 'start',
    runAt: datetimeLocalValue(Date.now() + 15 * 60 * 1000),
    timeZone: 'local',
    botIds: [],
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const rows = schedules.data || [];
  const upcoming = rows.filter((schedule) => PENDING.has(schedule.status));

  const nameOf = useMemo(() => {
    const map = new Map();
    bots.forEach((bot) => map.set(bot.id, (bot.config && bot.config.username) || bot.id));
    return map;
  }, [bots]);

  const create = async () => {
    setSaving(true);
    setError('');
    const payload = {
      action: form.action,
      runAt: localInputToIso(form.runAt, form.timeZone),
      timeZone: form.timeZone,
      botIds: form.botIds,
    };
    try {
      await api('/schedules', { method: 'POST', body: JSON.stringify(payload) });
      toast('Schedule created', 'success');
      setCreating(false);
      setForm({ ...form, botIds: [] });
      schedules.reload();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    setCancelBusy(true);
    try {
      await api(`/schedules/${encodeURIComponent(cancelling.id)}`, { method: 'DELETE' });
      toast('Schedule cancelled', 'success');
      setCancelling(null);
      schedules.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Automation"
        title="Schedules"
        description="One-shot start or stop runs. The panel process owns the timer, so schedules survive a page reload but not a panel restart mid-run."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            New schedule
          </Button>
        }
      />

      {schedules.error ? <ErrorNote>{schedules.error}</ErrorNote> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Pending" value={upcoming.length} hint="Waiting to fire" />
        <StatCard label="Total" value={rows.length} hint="Including completed runs" />
        <StatCard
          label="Next run"
          value={upcoming.length ? relTime(upcoming[0].runAt) : '--'}
          hint={upcoming.length ? fmtDateTime(upcoming[0].runAt) : 'Nothing queued'}
        />
      </div>

      <Panel>
        <SectionTitle
          title="Queue"
          description="Bots that are already in the requested state are recorded as skipped rather than failed."
        />
        {schedules.loading ? (
          <div className="px-5 py-10">
            <Spinner label="Loading schedules" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={<Clock className="h-5 w-5" />}
              title="No schedules"
              description="Queue a start before peak hours or a stop overnight."
              action={<Button onClick={() => setCreating(true)}>New schedule</Button>}
            />
          </div>
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run at</th>
                  <th>Action</th>
                  <th>Bots</th>
                  <th>Status</th>
                  <th>Result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((schedule) => (
                  <tr key={schedule.id}>
                    <td>
                      <span className="block text-white/85">{fmtDateTime(schedule.runAt)}</span>
                      <span className="block text-[11px] text-white/30">
                        {relTime(schedule.runAt)} · {schedule.timeZone === 'UTC' ? 'UTC' : 'local time'}
                      </span>
                    </td>
                    <td>
                      <Pill tone={schedule.action === 'start' ? 'strong' : 'default'}>{schedule.action}</Pill>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {(schedule.botIds || []).slice(0, 4).map((id) => (
                          <Pill key={id} tone="quiet">
                            {nameOf.get(id) || id}
                          </Pill>
                        ))}
                        {(schedule.botIds || []).length > 4 ? (
                          <Pill tone="quiet">+{schedule.botIds.length - 4}</Pill>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={schedule.status} />
                    </td>
                    <td className="tnum text-white/50">
                      {PENDING.has(schedule.status) ? (
                        <span className="text-white/25">--</span>
                      ) : (
                        <span>
                          {schedule.ok || 0} ok
                          {schedule.skipped ? ` · ${schedule.skipped} skipped` : ''}
                          {schedule.failed ? ` · ${schedule.failed} failed` : ''}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end">
                        {schedule.status === 'pending' ? (
                          <Button variant="ghost" size="sm" title="Cancel" onClick={() => setCancelling(schedule)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
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
        open={creating}
        onClose={() => setCreating(false)}
        title="New schedule"
        description="Pick a moment and the bots to act on. Up to 200 bots per schedule."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving} disabled={!form.botIds.length || !form.runAt}>
              Create schedule
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Action">
              <Select value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })}>
                <option value="start">Start bots</option>
                <option value="stop">Stop bots</option>
              </Select>
            </Field>
            <Field label="Interpret time as">
              <Select value={form.timeZone} onChange={(event) => setForm({ ...form, timeZone: event.target.value })}>
                <option value="local">This browser's local time</option>
                <option value="UTC">UTC</option>
              </Select>
            </Field>
          </div>
          <Field label="Run at" hint="Must be in the future.">
            <Input
              type="datetime-local"
              value={form.runAt}
              onChange={(event) => setForm({ ...form, runAt: event.target.value })}
            />
          </Field>
          <Field label="Bots">
            <BotPicker bots={bots} value={form.botIds} onChange={(botIds) => setForm({ ...form, botIds })} />
          </Field>
        </div>
      </Modal>

      <ConfirmModal
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={cancel}
        loading={cancelBusy}
        title="Cancel schedule"
        confirmLabel="Cancel schedule"
        description={
          cancelling
            ? `The ${cancelling.action} scheduled for ${fmtDateTime(cancelling.runAt)} will not run. A schedule that has already started cannot be cancelled.`
            : ''
        }
      />
    </div>
  );
}
