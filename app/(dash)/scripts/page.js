'use client';

import { useMemo, useState } from 'react';
import { Code, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/components/providers';
import { Button, EmptyState, Modal, PageHeader, Panel, Spinner, StatCard } from '@/components/ui';
import { ConfirmModal, ErrorNote, Pill, SectionTitle } from '@/components/dash-ui';
import { BLANK_SCRIPT, ScriptForm, formToPayload, scriptToForm } from '@/components/script-form';
import { useFleet, useResource } from '@/lib/hooks';
import { api } from '@/lib/api';
import { relTime } from '@/lib/format';

export default function ScriptsPage() {
  const { toast } = useToast();
  const scripts = useResource('/scripts', (result) => result.scripts || []);
  const { bots } = useFleet();

  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(BLANK_SCRIPT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [removing, setRemoving] = useState(null);

  const rows = scripts.data || [];
  const enabled = rows.filter((script) => script.enabled !== false).length;

  const nameOf = useMemo(() => {
    const map = new Map();
    bots.forEach((bot) => map.set(bot.id, (bot.config && bot.config.username) || bot.id));
    return map;
  }, [bots]);

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
    const payload = formToPayload(form);
    try {
      if (editor.mode === 'create') {
        const result = await api('/scripts', { method: 'POST', body: JSON.stringify(payload) });
        const synced = (result.syncedTo || []).length;
        toast(synced ? `Script saved and pushed to ${synced} bot(s)` : 'Script saved', 'success');
      } else {
        await api(`/scripts/${encodeURIComponent(editor.script.id)}`, {
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

  const toggle = async (script) => {
    setBusyId(script.id);
    try {
      await api(`/scripts/${encodeURIComponent(script.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: script.enabled === false }),
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
      await api(`/scripts/${encodeURIComponent(removing.id)}`, { method: 'DELETE' });
      toast('Script deleted', 'success');
      setRemoving(null);
      scripts.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Automation"
        title="Scripts"
        description="Interval loops and message triggers, written into each selected bot and reloaded without a restart."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            New script
          </Button>
        }
      />

      {scripts.error ? <ErrorNote>{scripts.error}</ErrorNote> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Scripts" value={rows.length} hint="In this workspace" />
        <StatCard label="Enabled" value={enabled} hint="Currently able to fire" />
        <StatCard
          label="Intervals"
          value={rows.filter((script) => script.type === 'interval').length}
          hint={`${rows.filter((script) => script.type === 'message-trigger').length} message triggers`}
        />
      </div>

      <Panel>
        <SectionTitle
          title="Library"
          description="Changing a script rewrites it on every target bot the next time it syncs."
        />
        {scripts.loading ? (
          <div className="px-5 py-10">
            <Spinner label="Loading scripts" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={<Code className="h-5 w-5" />}
              title="No scripts yet"
              description="Create an interval script to repeat a command, or a message trigger that reacts to server chat."
              action={<Button onClick={openCreate}>New script</Button>}
            />
          </div>
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Script</th>
                  <th>Trigger</th>
                  <th>Action</th>
                  <th>Targets</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((script) => (
                  <tr key={script.id}>
                    <td>
                      <span className="block text-white/85">{script.name}</span>
                      <span className="block text-[11px] text-white/30">
                        {script.description ? `${script.description} · ` : ''}
                        updated {relTime(script.updatedAt || script.createdAt)}
                      </span>
                    </td>
                    <td className="text-white/50">
                      {script.type === 'interval' ? (
                        <span className="tnum">every {script.interval} ms</span>
                      ) : (
                        <span>
                          {script.trigger ? script.trigger.matchType : 'contains'}
                          <span className="block font-mono text-[11px] text-white/30">
                            {script.trigger ? script.trigger.pattern : ''}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-[12px] text-white/50">
                      {script.action ? `${script.action.type} · ${script.action.value}` : '--'}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {(script.botIds || []).length === 0 ? (
                          <span className="text-white/25">none</span>
                        ) : (
                          (script.botIds || []).slice(0, 4).map((id) => (
                            <Pill key={id} tone="quiet">
                              {nameOf.get(id) || id}
                            </Pill>
                          ))
                        )}
                        {(script.botIds || []).length > 4 ? (
                          <Pill tone="quiet">+{script.botIds.length - 4}</Pill>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {script.enabled === false ? <Pill tone="quiet">disabled</Pill> : <Pill tone="strong">enabled</Pill>}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busyId === script.id}
                          onClick={() => toggle(script)}
                        >
                          {script.enabled === false ? 'Enable' : 'Disable'}
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
        description="Message triggers respect a cooldown so a chatty server cannot spam the action."
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
          <ScriptForm form={form} onChange={setForm} bots={bots} />
        </div>
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        loading={busyId === 'removing'}
        title="Delete script"
        confirmLabel="Delete"
        description={removing ? `${removing.name} will be removed from the workspace and its target bots.` : ''}
      />
    </div>
  );
}
