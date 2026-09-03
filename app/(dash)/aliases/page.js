'use client';

import { useState } from 'react';
import { Pencil, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import { useToast } from '@/components/providers';
import { Button, EmptyState, Modal, PageHeader, Panel, Spinner } from '@/components/ui';
import { ConfirmModal, ErrorNote, Field, Input, Pill, SectionTitle } from '@/components/dash-ui';
import { useResource } from '@/lib/hooks';
import { api } from '@/lib/api';
import { relTime } from '@/lib/format';

const BLANK = { name: '', cmd: '', desc: '' };

export default function AliasesPage() {
  const { toast } = useToast();
  const aliases = useResource('/custom-cmds');
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = (aliases.data && aliases.data.cmds) || [];
  const syncedTo = (aliases.data && aliases.data.syncedTo) || 0;

  const openCreate = () => {
    setForm(BLANK);
    setFormError('');
    setEditor({ mode: 'create' });
  };

  const openEdit = (alias) => {
    setForm({ name: alias.name, cmd: alias.cmd, desc: alias.desc || '' });
    setFormError('');
    setEditor({ mode: 'edit', alias });
  };

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (editor.mode === 'create') {
        await api('/custom-cmds', { method: 'POST', body: JSON.stringify(form) });
        toast('Alias created and pushed to your running bots', 'success');
      } else {
        await api(`/custom-cmds/${encodeURIComponent(editor.alias.id)}`, { method: 'PATCH', body: JSON.stringify(form) });
        toast('Alias updated', 'success');
      }
      setEditor(null);
      aliases.reload({ quiet: true });
    } catch (reason) {
      setFormError(reason.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/custom-cmds/${encodeURIComponent(removing.id)}`, { method: 'DELETE' });
      toast('Alias deleted', 'success');
      setRemoving(null);
      aliases.reload({ quiet: true });
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const resync = async () => {
    setBusy(true);
    try {
      const result = await api('/custom-cmds/sync', { method: 'POST' });
      toast(`Pushed to ${result.pushed} running bot${result.pushed === 1 ? '' : 's'}`, 'success');
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Automation"
        title="Aliases"
        description="Saved commands pushed to every bot you own. Other accounts never receive your aliases."
        actions={
          <>
            <Button variant="secondary" onClick={resync} loading={busy} disabled={!rows.length}>
              <RefreshCw className="h-3.5 w-3.5" />
              Re-sync
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              New alias
            </Button>
          </>
        }
      />

      {aliases.error ? <ErrorNote>{aliases.error}</ErrorNote> : null}

      <Panel>
        <SectionTitle
          title="Saved commands"
          description="An alias name may be used anywhere a command is accepted, including mass commands."
          actions={<Pill tone="quiet">{syncedTo} running bot{syncedTo === 1 ? '' : 's'} in sync</Pill>}
        />
        {aliases.loading ? (
          <div className="px-5 py-10">
            <Spinner label="Loading aliases" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={<Terminal className="h-5 w-5" />}
              title="No aliases yet"
              description="Save a command once and reuse it across the fleet."
              action={<Button onClick={openCreate}>Create alias</Button>}
            />
          </div>
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Command</th>
                  <th>Notes</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((alias) => (
                  <tr key={alias.id}>
                    <td className="font-mono text-[12px] text-white">{alias.name}</td>
                    <td className="font-mono text-[12px] text-white/60">{alias.cmd}</td>
                    <td className="text-white/40">{alias.desc || '--'}</td>
                    <td className="text-white/35">{relTime(alias.updatedAt || alias.createdAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(alias)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(alias)}>
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
        title={editor && editor.mode === 'edit' ? 'Edit alias' : 'New alias'}
        description="Aliases are expanded before the command reaches a bot."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <ErrorNote>{formError}</ErrorNote> : null}
          <Field label="Name" hint="Used as !name in game and in mass commands.">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="restock"
              maxLength={40}
            />
          </Field>
          <Field label="Command">
            <Input
              value={form.cmd}
              onChange={(event) => setForm({ ...form, cmd: event.target.value })}
              placeholder="!bones on"
              maxLength={300}
            />
          </Field>
          <Field label="Description" hint="Optional reminder of what this alias does.">
            <Input
              value={form.desc}
              onChange={(event) => setForm({ ...form, desc: event.target.value })}
              maxLength={200}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        loading={busy}
        title="Delete alias"
        confirmLabel="Delete"
        description={removing ? `"${removing.name}" will stop resolving on every bot you own.` : ''}
      />
    </div>
  );
}
