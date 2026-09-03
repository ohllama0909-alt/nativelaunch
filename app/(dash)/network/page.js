'use client';

import { useMemo, useState } from 'react';
import { Check, Network, Plus, RefreshCw, Search, Trash2, Wifi } from 'lucide-react';
import { useAuth, useToast } from '@/components/providers';
import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
  PageHeader,
  Panel,
  Spinner,
  StatCard,
} from '@/components/ui';
import {
  BotPicker,
  ConfirmModal,
  CopyValue,
  ErrorNote,
  Field,
  Input,
  Meter,
  Pill,
  SectionTitle,
  Select,
  Textarea,
} from '@/components/dash-ui';
import { useFleet, useResource } from '@/lib/hooks';
import { api } from '@/lib/api';
import { fmtDateTime, fmtLatency, relTime, withLiveProxyUsage } from '@/lib/format';

export default function NetworkPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user.role === 'admin';

  const pool = useResource('/proxies', (result) => ({
    proxies: result.proxies || [],
    canReassign: result.canReassign !== false,
  }));
  const { bots, loading: fleetLoading } = useFleet();
  const accounts = useResource(isAdmin ? '/users' : null, (result) => result.users || []);

  const rawProxies = (pool.data && pool.data.proxies) || [];
  const proxies = useMemo(
    () => withLiveProxyUsage(rawProxies, bots, !fleetLoading),
    [rawProxies, bots, fleetLoading]
  );
  const canReassign = !!(pool.data && pool.data.canReassign);

  const [query, setQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState('all');
  const [selected, setSelected] = useState([]);
  const [busyId, setBusyId] = useState('');
  const [testingAll, setTestingAll] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importForm, setImportForm] = useState({ text: '', replace: false, owner: '' });
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ onlyWorking: true, overwrite: false, scope: 'all', botIds: [] });
  const [assigning, setAssigning] = useState(false);

  const [noteEditor, setNoteEditor] = useState(null);
  const [savingNote, setSavingNote] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [bulkRemove, setBulkRemove] = useState(false);
  const [removingBusy, setRemovingBusy] = useState(false);

  const [probe, setProbe] = useState({ value: '', busy: false, result: null });

  const stats = useMemo(() => {
    let alive = 0;
    let dead = 0;
    let unchecked = 0;
    let slots = 0;
    let used = 0;
    proxies.forEach((proxy) => {
      if (proxy.alive === true) alive += 1;
      else if (proxy.alive === false) dead += 1;
      else unchecked += 1;
      slots += Number(proxy.capacity) || 0;
      used += (proxy.assignedTo || []).length + (Number(proxy.hiddenAssignments) || 0);
    });
    return { alive, dead, unchecked, slots, used };
  }, [proxies]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return proxies.filter((proxy) => {
      if (healthFilter === 'alive' && proxy.alive !== true) return false;
      if (healthFilter === 'dead' && proxy.alive !== false) return false;
      if (healthFilter === 'unchecked' && proxy.alive !== null && proxy.alive !== undefined) return false;
      if (healthFilter === 'free' && !(proxy.freeSlots > 0)) return false;
      if (!needle) return true;
      return [proxy.label, proxy.host, proxy.note, proxy.ownerLabel, proxy.username]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [proxies, query, healthFilter]);

  const selectedSet = new Set(selected);
  const allVisibleSelected = visible.length > 0 && visible.every((proxy) => selectedSet.has(proxy.id));

  const toggleAll = (checked) => setSelected(checked ? visible.map((proxy) => proxy.id) : []);

  const toggleOne = (id, checked) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected([...next]);
  };

  const applyPool = (rows) => {
    if (!rows) {
      pool.reload();
      return;
    }
    pool.setData({ proxies: rows, canReassign });
  };

  const runImport = async () => {
    setImporting(true);
    setImportError('');
    const payload = { text: importForm.text, replace: importForm.replace };
    if (isAdmin && importForm.owner) payload.owner = importForm.owner;
    try {
      const result = await api('/proxies', { method: 'POST', body: JSON.stringify(payload) });
      applyPool(result.proxies);
      const parts = [];
      if (result.added) parts.push(`${result.added} added`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.invalid && result.invalid.length) parts.push(`${result.invalid.length} unreadable`);
      if (result.conflicts && result.conflicts.length) parts.push(`${result.conflicts.length} owned elsewhere`);
      toast(parts.length ? parts.join(', ') : 'Nothing to import', parts.length ? 'success' : 'info');
      setImportOpen(false);
      setImportForm({ text: '', replace: false, owner: '' });
    } catch (reason) {
      setImportError(reason.message);
    } finally {
      setImporting(false);
    }
  };

  const checkOne = async (id) => {
    setBusyId(id);
    try {
      const result = await api(`/proxies/${encodeURIComponent(id)}/check`, { method: 'POST' });
      applyPool(rawProxies.map((proxy) => (proxy.id === id ? result.proxy : proxy)));
      toast(
        result.check && result.check.ok
          ? `Alive in ${fmtLatency(result.check.ms)}${result.check.ip ? ` · exit ${result.check.ip}` : ''}`
          : `Dead: ${(result.check && result.check.reason) || 'no response'}`,
        result.check && result.check.ok ? 'success' : 'warning'
      );
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setBusyId('');
    }
  };

  const checkAll = async () => {
    setTestingAll(true);
    const payload = selected.length ? { ids: selected } : {};
    try {
      const result = await api('/proxies/check-all', { method: 'POST', body: JSON.stringify(payload) });
      applyPool(result.proxies);
      toast(`${result.working} working, ${result.failed} failed`, result.failed ? 'warning' : 'success');
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setTestingAll(false);
    }
  };

  const runAssign = async () => {
    setAssigning(true);
    const payload = { onlyWorking: assignForm.onlyWorking, overwrite: assignForm.overwrite };
    if (assignForm.scope === 'selected') payload.botIds = assignForm.botIds;
    try {
      const result = await api('/proxies/assign', { method: 'POST', body: JSON.stringify(payload) });
      const assigned = (result.assigned || []).length;
      toast(
        `${assigned} bot${assigned === 1 ? '' : 's'} assigned${result.skipped ? `, ${result.skipped} skipped` : ''}`,
        assigned ? 'success' : 'info'
      );
      if (result.note) toast(result.note, 'info');
      setAssignOpen(false);
      pool.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setAssigning(false);
    }
  };

  const saveNote = async () => {
    setSavingNote(true);
    const payload = { note: noteEditor.note };
    if (isAdmin) payload.owner = noteEditor.owner || '';
    try {
      await api(`/proxies/${encodeURIComponent(noteEditor.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setNoteEditor(null);
      pool.reload();
      toast('Endpoint updated', 'success');
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const removeOne = async () => {
    setRemovingBusy(true);
    try {
      const result = await api(`/proxies/${encodeURIComponent(removing.id)}`, { method: 'DELETE' });
      toast(
        result.detached ? `Removed and detached from ${result.detached} bot(s)` : 'Endpoint removed',
        'success'
      );
      setRemoving(null);
      pool.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setRemovingBusy(false);
    }
  };

  const removeSelected = async () => {
    setRemovingBusy(true);
    try {
      const result = await api('/proxies', { method: 'DELETE', body: JSON.stringify({ ids: selected }) });
      toast(`${result.removed} endpoint${result.removed === 1 ? '' : 's'} removed`, 'success');
      setSelected([]);
      setBulkRemove(false);
      pool.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setRemovingBusy(false);
    }
  };

  const runProbe = async () => {
    setProbe({ ...probe, busy: true, result: null });
    try {
      const result = await api('/proxy/check', {
        method: 'POST',
        body: JSON.stringify({ proxy: probe.value }),
      });
      setProbe({ ...probe, busy: false, result: { ok: true, ms: result.ms, ip: result.ip } });
    } catch (reason) {
      const data = reason.data || {};
      setProbe({
        ...probe,
        busy: false,
        result: { ok: false, reason: reason.message, ms: data.ms },
      });
    }
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Network"
        title="Proxies"
        description="SOCKS5 egress pool. Each endpoint carries at most three bots so a single exit IP never looks like a swarm."
        actions={
          <>
            <Button variant="secondary" onClick={checkAll} loading={testingAll} disabled={!proxies.length}>
              <RefreshCw className="h-3.5 w-3.5" />
              {selected.length ? `Test ${selected.length}` : 'Test all'}
            </Button>
            {canReassign ? (
              <Button variant="secondary" onClick={() => setAssignOpen(true)} disabled={!proxies.length}>
                <Wifi className="h-3.5 w-3.5" />
                Auto-assign
              </Button>
            ) : null}
            <Button onClick={() => setImportOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Import
            </Button>
          </>
        }
      />

      {pool.error ? <ErrorNote>{pool.error}</ErrorNote> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Endpoints" value={proxies.length} hint="In your pool" />
        <StatCard label="Verified" value={stats.alive} hint="Last check succeeded" tone="positive" />
        <StatCard
          label="Failing"
          value={stats.dead}
          hint={stats.unchecked ? `${stats.unchecked} never tested` : 'All endpoints tested'}
          tone={stats.dead ? 'negative' : undefined}
        />
        <StatCard label="Slots used" value={`${stats.used}/${stats.slots}`} hint="Across the pool" />
      </div>

      <Panel>
        <SectionTitle
          title="Endpoints"
          description="Passwords are never returned by the panel; the URI shown is safe to copy for reuse."
          actions={
            selected.length ? (
              <>
                <Pill tone="strong">{selected.length} selected</Pill>
                <Button variant="danger" size="sm" onClick={() => setBulkRemove(true)}>
                  Remove
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                  Clear
                </Button>
              </>
            ) : null
          }
        />

        <div className="flex flex-col gap-3 border-b border-white/[0.07] px-5 py-4 sm:flex-row sm:items-center">
          <span className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search host, note, owner"
              className="pl-10"
            />
          </span>
          <Select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)} className="sm:w-52">
            <option value="all">All endpoints</option>
            <option value="alive">Verified only</option>
            <option value="dead">Failing only</option>
            <option value="unchecked">Never tested</option>
            <option value="free">Has free slots</option>
          </Select>
        </div>

        {pool.loading ? (
          <div className="px-5 py-10">
            <Spinner label="Loading pool" />
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={<Network className="h-5 w-5" />}
              title={proxies.length ? 'No endpoints match' : 'Your pool is empty'}
              description={
                proxies.length
                  ? 'Adjust the search or health filter.'
                  : 'Paste a provider list to import endpoints. host:port, host:port:user:pass, and socks5:// URIs all work.'
              }
              action={proxies.length ? null : <Button onClick={() => setImportOpen(true)}>Import endpoints</Button>}
            />
          </div>
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <Checkbox checked={allVisibleSelected} onChange={toggleAll} />
                  </th>
                  <th>Endpoint</th>
                  <th>Health</th>
                  <th>Capacity</th>
                  <th>Assigned</th>
                  {isAdmin ? <th>Owner</th> : null}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((proxy) => (
                  <tr key={proxy.id}>
                    <td>
                      <Checkbox
                        checked={selectedSet.has(proxy.id)}
                        onChange={(checked) => toggleOne(proxy.id, checked)}
                      />
                    </td>
                    <td>
                      <span className="block text-white/85">{proxy.label}</span>
                      <span className="block text-[11px] text-white/30">
                        {proxy.hasAuth ? 'authenticated' : 'open'}
                        {proxy.note ? ` · ${proxy.note}` : ''}
                      </span>
                    </td>
                    <td>
                      {proxy.alive === true ? (
                        <span className="flex flex-col">
                          <Pill tone="strong">verified</Pill>
                          <span className="mt-1 text-[11px] text-white/30">
                            {fmtLatency(proxy.latency)} · {relTime(proxy.checkedAt)}
                          </span>
                        </span>
                      ) : proxy.alive === false ? (
                        <span className="flex flex-col">
                          <Pill>failing</Pill>
                          <span className="mt-1 text-[11px] text-white/30">{relTime(proxy.checkedAt)}</span>
                        </span>
                      ) : (
                        <Pill tone="quiet">untested</Pill>
                      )}
                    </td>
                    <td className="w-40">
                      <Meter
                        value={(proxy.assignedTo || []).length + (Number(proxy.hiddenAssignments) || 0)}
                        total={proxy.capacity}
                        label={`${proxy.freeSlots} free`}
                      />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {(proxy.assignedTo || []).map((assignment) => (
                          <Pill key={assignment.id} tone="quiet">
                            {assignment.username || assignment.id}
                          </Pill>
                        ))}
                        {proxy.hiddenAssignments ? (
                          <Pill tone="quiet">+{proxy.hiddenAssignments} elsewhere</Pill>
                        ) : null}
                        {!(proxy.assignedTo || []).length && !proxy.hiddenAssignments ? (
                          <span className="text-white/25">unused</span>
                        ) : null}
                      </div>
                    </td>
                    {isAdmin ? (
                      <td className="text-white/40">{proxy.ownerLabel || <span className="text-white/25">unclaimed</span>}</td>
                    ) : null}
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <CopyValue value={proxy.uri} />
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Test endpoint"
                          loading={busyId === proxy.id}
                          onClick={() => checkOne(proxy.id)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Edit"
                          onClick={() =>
                            setNoteEditor({ id: proxy.id, label: proxy.label, note: proxy.note || '', owner: proxy.owner || '' })
                          }
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" title="Remove" onClick={() => setRemoving(proxy)}>
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

      <Panel>
        <SectionTitle
          title="Ad-hoc check"
          description="Dial a proxy string without adding it to the pool. Useful before importing a provider list."
        />
        <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-end">
          <span className="flex-1">
            <Field label="Proxy string">
              <Input
                value={probe.value}
                onChange={(event) => setProbe({ ...probe, value: event.target.value })}
                placeholder="socks5://user:pass@1.2.3.4:1080"
              />
            </Field>
          </span>
          <Button variant="secondary" onClick={runProbe} loading={probe.busy} disabled={!probe.value.trim()}>
            Dial
          </Button>
        </div>
        {probe.result ? (
          <div className="border-t border-white/[0.07] px-5 py-4 text-[13px]">
            {probe.result.ok ? (
              <span className="text-white/70">
                Handshake succeeded in <span className="tnum text-white">{fmtLatency(probe.result.ms)}</span>
                {probe.result.ip ? (
                  <>
                    {' '}
                    · exit IP <span className="tnum text-white">{probe.result.ip}</span>
                  </>
                ) : null}
              </span>
            ) : (
              <span className="text-white/50">
                Failed: {probe.result.reason}
                {probe.result.ms ? ` (after ${fmtLatency(probe.result.ms)})` : ''}
              </span>
            )}
          </div>
        ) : null}
      </Panel>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import endpoints"
        description="One proxy per line. Duplicates update the existing row instead of creating a second entry."
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runImport} loading={importing} disabled={!importForm.text.trim()}>
              Import
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {importError ? <ErrorNote>{importError}</ErrorNote> : null}
          <Field
            label="Proxy list"
            hint="Accepts host:port, host:port:user:pass, user:pass@host:port, and socks5:// URIs. Lines starting with # are ignored."
          >
            <Textarea
              value={importForm.text}
              onChange={(event) => setImportForm({ ...importForm, text: event.target.value })}
              rows={9}
              className="font-mono text-[12px]"
              placeholder={'1.2.3.4:1080\nuser:pass@5.6.7.8:1080'}
            />
          </Field>
          {isAdmin ? (
            <Field label="Assign to account" hint="Leave blank to claim these endpoints for your own pool.">
              <Select
                value={importForm.owner}
                onChange={(event) => setImportForm({ ...importForm, owner: event.target.value })}
              >
                <option value="">Me ({user.email})</option>
                {(accounts.data || []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.email}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Checkbox
            checked={importForm.replace}
            onChange={(checked) => setImportForm({ ...importForm, replace: checked })}
            label="Replace my pool"
            description="Clears the endpoints you own before importing. Other accounts are untouched."
          />
        </div>
      </Modal>

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Auto-assign egress"
        description="Spreads bots across the pool, respecting the three-bots-per-endpoint cap."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runAssign} loading={assigning}>
              Assign
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Checkbox
            checked={assignForm.onlyWorking}
            onChange={(checked) => setAssignForm({ ...assignForm, onlyWorking: checked })}
            label="Verified endpoints only"
            description="Skips endpoints whose last check failed or that were never tested."
          />
          <Checkbox
            checked={assignForm.overwrite}
            onChange={(checked) => setAssignForm({ ...assignForm, overwrite: checked })}
            label="Overwrite existing assignments"
            description="Off by default, so bots that already have egress keep it."
          />
          <Field label="Targets">
            <Select
              value={assignForm.scope}
              onChange={(event) => setAssignForm({ ...assignForm, scope: event.target.value })}
            >
              <option value="all">Every bot I manage</option>
              <option value="selected">Choose bots</option>
            </Select>
          </Field>
          {assignForm.scope === 'selected' ? (
            <BotPicker
              bots={bots}
              value={assignForm.botIds}
              onChange={(botIds) => setAssignForm({ ...assignForm, botIds })}
            />
          ) : null}
          <p className="text-[12px] leading-relaxed text-white/35">
            Assignment writes the endpoint into each bot config. Running bots need a restart before the new egress
            takes effect.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!noteEditor}
        onClose={() => setNoteEditor(null)}
        title="Edit endpoint"
        description={noteEditor ? noteEditor.label : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoteEditor(null)}>
              Cancel
            </Button>
            <Button onClick={saveNote} loading={savingNote}>
              Save
            </Button>
          </>
        }
      >
        {noteEditor ? (
          <div className="space-y-4">
            <Field label="Note" hint="Up to 200 characters. Handy for provider name or expiry.">
              <Input
                value={noteEditor.note}
                onChange={(event) => setNoteEditor({ ...noteEditor, note: event.target.value })}
                maxLength={200}
              />
            </Field>
            {isAdmin ? (
              <Field label="Owner" hint="Unclaimed endpoints are visible to admins only.">
                <Select
                  value={noteEditor.owner}
                  onChange={(event) => setNoteEditor({ ...noteEditor, owner: event.target.value })}
                >
                  <option value="">Unclaimed</option>
                  {(accounts.data || []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.email}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={removeOne}
        loading={removingBusy}
        title="Remove endpoint"
        confirmLabel="Remove"
        description={
          removing
            ? `${removing.label} will be deleted and detached from any bot using it. Those bots fall back to a direct connection on next restart.`
            : ''
        }
      />

      <ConfirmModal
        open={bulkRemove}
        onClose={() => setBulkRemove(false)}
        onConfirm={removeSelected}
        loading={removingBusy}
        title="Remove endpoints"
        confirmLabel={`Remove ${selected.length}`}
        description="Selected endpoints are deleted and detached from any bot using them."
      />
    </div>
  );
}
