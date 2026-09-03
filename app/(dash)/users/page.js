'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
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
  ErrorNote,
  Field,
  Input,
  Pill,
  SectionTitle,
  Select,
} from '@/components/dash-ui';
import { useFleet, useResource } from '@/lib/hooks';
import { api } from '@/lib/api';
import { fmtDateTime, relTime } from '@/lib/format';

const BLANK_USER = {
  email: '',
  password: '',
  role: 'user',
  allBots: false,
  botIds: [],
  categories: [],
};

export default function UsersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user.role === 'admin';
  const accounts = useResource(isAdmin ? '/users' : null, (result) => result.users || []);
  const { bots } = useFleet();

  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(BLANK_USER);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const rows = accounts.data || [];

  const categories = useMemo(() => {
    const set = new Set();
    bots.forEach((bot) => set.add((bot.config && bot.config.category) || 'Uncategorized'));
    return [...set].sort();
  }, [bots]);

  if (!isAdmin) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Access" title="Users" />
        <Panel>
          <div className="px-5 py-8">
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="Admins only"
              description="Account management is restricted to admin accounts."
            />
          </div>
        </Panel>
      </div>
    );
  }

  const openCreate = () => {
    setForm(BLANK_USER);
    setError('');
    setEditor({ mode: 'create' });
  };

  const openEdit = (account) => {
    const permissions = account.permissions || {};
    setForm({
      email: account.email || '',
      password: '',
      role: account.role || 'user',
      allBots: !!permissions.allBots,
      botIds: permissions.botIds || [],
      categories: permissions.categories || [],
    });
    setError('');
    setEditor({ mode: 'edit', account });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const payload = {
      email: form.email,
      role: form.role,
      permissions: {
        allBots: form.role === 'admin' ? true : form.allBots,
        botIds: form.botIds,
        categories: form.categories,
      },
    };
    // On edit an empty password means "leave it alone", so it is only sent
    // when the admin actually typed a replacement.
    if (form.password) payload.password = form.password;

    try {
      if (editor.mode === 'create') {
        await api('/users', { method: 'POST', body: JSON.stringify(payload) });
        toast('Account created', 'success');
      } else {
        await api(`/users/${encodeURIComponent(editor.account.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast('Account updated', 'success');
      }
      setEditor(null);
      accounts.reload();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setRemoveBusy(true);
    try {
      await api(`/users/${encodeURIComponent(removing.id)}`, { method: 'DELETE' });
      toast('Account deleted', 'success');
      setRemoving(null);
      accounts.reload();
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setRemoveBusy(false);
    }
  };

  const toggleCategory = (category, checked) => {
    const next = new Set(form.categories);
    if (checked) next.add(category);
    else next.delete(category);
    setForm({ ...form, categories: [...next] });
  };

  const scopeLabel = (account) => {
    const permissions = account.permissions || {};
    if (account.role === 'admin' || permissions.allBots) return 'Every bot';
    const parts = [];
    if ((permissions.botIds || []).length) parts.push(`${permissions.botIds.length} bot(s)`);
    if ((permissions.categories || []).length) parts.push(`${permissions.categories.length} category(ies)`);
    return parts.length ? parts.join(' + ') : 'No access';
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Access"
        title="Users"
        description="Each account sees only the bots and proxy endpoints it owns or has been granted."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            New account
          </Button>
        }
      />

      {accounts.error ? <ErrorNote>{accounts.error}</ErrorNote> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Accounts" value={rows.length} hint="Total registered" />
        <StatCard
          label="Admins"
          value={rows.filter((account) => account.role === 'admin').length}
          hint="Full workspace access"
        />
        <StatCard
          label="Scoped users"
          value={rows.filter((account) => account.role !== 'admin').length}
          hint="Limited by permissions"
        />
      </div>

      <Panel>
        <SectionTitle
          title="Accounts"
          description="Changing a password signs that account out of every other session."
        />
        {accounts.loading ? (
          <div className="px-5 py-10">
            <Spinner label="Loading accounts" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState icon={<Users className="h-5 w-5" />} title="No accounts" description="Create the first account." />
          </div>
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Bot access</th>
                  <th>Last login</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <span className="block text-white/85">{account.email}</span>
                      <span className="block text-[11px] text-white/30">
                        created {fmtDateTime(account.createdAt)}
                        {account.id === user.id ? ' · you' : ''}
                      </span>
                    </td>
                    <td>
                      {account.role === 'admin' ? <Pill tone="strong">admin</Pill> : <Pill tone="quiet">user</Pill>}
                    </td>
                    <td className="text-white/50">{scopeLabel(account)}</td>
                    <td className="text-white/40">
                      {account.lastLoginAt ? relTime(account.lastLoginAt) : <span className="text-white/25">never</span>}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(account)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={account.id === user.id ? 'You cannot delete your own account' : 'Delete'}
                          disabled={account.id === user.id}
                          onClick={() => setRemoving(account)}
                        >
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
        title={editor && editor.mode === 'edit' ? 'Edit account' : 'New account'}
        description="Logins accept an email address or a short username."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              loading={saving}
              disabled={!form.email.trim() || (editor && editor.mode === 'create' && form.password.length < 6)}
            >
              Save account
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email or username">
              <Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
          </div>

          <Field
            label="Password"
            hint={
              editor && editor.mode === 'edit'
                ? 'Leave blank to keep the current password. Minimum 6 characters.'
                : 'Minimum 6 characters.'
            }
          >
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              autoComplete="new-password"
              placeholder={editor && editor.mode === 'edit' ? 'unchanged' : ''}
            />
          </Field>

          {form.role === 'admin' ? (
            <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[12.5px] leading-relaxed text-white/45">
              Admins can see and manage every bot, proxy endpoint, and account, including unclaimed legacy proxy rows.
            </p>
          ) : (
            <div className="space-y-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <Checkbox
                checked={form.allBots}
                onChange={(checked) => setForm({ ...form, allBots: checked })}
                label="Access to every bot"
                description="Overrides the per-bot and category grants below."
              />
              {!form.allBots ? (
                <>
                  <Field label="Specific bots">
                    <BotPicker
                      bots={bots}
                      value={form.botIds}
                      onChange={(botIds) => setForm({ ...form, botIds })}
                    />
                  </Field>
                  {categories.length ? (
                    <Field label="Categories" hint="Grants access to any bot in these categories, including future ones.">
                      <div className="space-y-2">
                        {categories.map((category) => (
                          <Checkbox
                            key={category}
                            checked={form.categories.includes(category)}
                            onChange={(checked) => toggleCategory(category, checked)}
                            label={category}
                          />
                        ))}
                      </div>
                    </Field>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        loading={removeBusy}
        title="Delete account"
        confirmLabel="Delete account"
        description={
          removing
            ? `${removing.email} will lose access immediately. Bots and proxy endpoints they own must be reassigned or deleted first.`
            : ''
        }
      />
    </div>
  );
}
