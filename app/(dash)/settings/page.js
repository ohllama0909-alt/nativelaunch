'use client';

import { useEffect, useState } from 'react';
import { useAuth, useToast } from '@/components/providers';
import { Button, Checkbox, PageHeader, Panel, Spinner } from '@/components/ui';
import { ErrorNote, Field, Input, KeyValue, SectionTitle, Select } from '@/components/dash-ui';
import { useResource } from '@/lib/hooks';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

const DEFAULT_PREFERENCES = {
  theme: 'dark',
  density: 'comfortable',
  startPage: 'overview',
  sidebar: 'expanded',
  timezone: 'local',
  confirmDanger: true,
  autoRefresh: true,
};

export default function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const { toast } = useToast();
  const stored = useResource('/preferences', (result) => result.preferences || {});

  const [prefs, setPrefs] = useState(DEFAULT_PREFERENCES);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsError, setPrefsError] = useState('');

  const [account, setAccount] = useState({ email: '', password: '', confirm: '' });
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState('');

  useEffect(() => {
    if (stored.data) setPrefs({ ...DEFAULT_PREFERENCES, ...stored.data });
  }, [stored.data]);

  useEffect(() => {
    setAccount((current) => ({ ...current, email: user.email || '' }));
  }, [user.email]);

  const savePreferences = async () => {
    setSavingPrefs(true);
    setPrefsError('');
    try {
      const result = await api('/preferences', { method: 'PATCH', body: JSON.stringify(prefs) });
      setPrefs({ ...DEFAULT_PREFERENCES, ...(result.preferences || {}) });
      toast('Preferences saved', 'success');
      refresh();
    } catch (reason) {
      setPrefsError(reason.message);
    } finally {
      setSavingPrefs(false);
    }
  };

  const saveAccount = async () => {
    if (account.password && account.password !== account.confirm) {
      setAccountError('The two passwords do not match.');
      return;
    }
    setSavingAccount(true);
    setAccountError('');
    const payload = {};
    if (account.email && account.email !== user.email) payload.email = account.email;
    if (account.password) payload.password = account.password;
    if (!Object.keys(payload).length) {
      setSavingAccount(false);
      setAccountError('Nothing to change.');
      return;
    }
    try {
      await api('/account', { method: 'PATCH', body: JSON.stringify(payload) });
      setAccount({ ...account, password: '', confirm: '' });
      toast(
        payload.password
          ? 'Account updated. Other sessions have been signed out.'
          : 'Account updated.',
        'success'
      );
      refresh();
    } catch (reason) {
      setAccountError(reason.message);
    } finally {
      setSavingAccount(false);
    }
  };

  const set = (patch) => setPrefs({ ...prefs, ...patch });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Sign-in details and per-account panel preferences."
        actions={
          <Button variant="secondary" onClick={logout}>
            Sign out
          </Button>
        }
      />

      <Panel>
        <SectionTitle title="Session" description="Read-only details about the account you are signed in as." />
        <div className="px-5 py-5">
          <KeyValue
            rows={[
              { label: 'Signed in as', value: user.email },
              { label: 'Role', value: user.role === 'admin' ? 'Admin' : 'User' },
              { label: 'Account created', value: user.createdAt ? fmtDateTime(user.createdAt) : '--' },
              { label: 'Last login', value: user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : '--' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          title="Credentials"
          description="Changing your password signs out every other session immediately."
          actions={
            <Button onClick={saveAccount} loading={savingAccount}>
              Update account
            </Button>
          }
        />
        <div className="space-y-4 px-5 py-5">
          {accountError ? <ErrorNote>{accountError}</ErrorNote> : null}
          <Field label="Email or username">
            <Input value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" hint="Minimum 6 characters. Leave blank to keep the current one.">
              <Input
                type="password"
                value={account.password}
                onChange={(event) => setAccount({ ...account, password: event.target.value })}
                autoComplete="new-password"
                placeholder="unchanged"
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                type="password"
                value={account.confirm}
                onChange={(event) => setAccount({ ...account, confirm: event.target.value })}
                autoComplete="new-password"
                placeholder="unchanged"
              />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          title="Preferences"
          description="Stored per account in your workspace file."
          actions={
            <Button onClick={savePreferences} loading={savingPrefs}>
              Save preferences
            </Button>
          }
        />
        {stored.loading ? (
          <div className="px-5 py-10">
            <Spinner label="Loading preferences" />
          </div>
        ) : (
          <div className="space-y-5 px-5 py-5">
            {prefsError ? <ErrorNote>{prefsError}</ErrorNote> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Theme">
                <Select value={prefs.theme} onChange={(event) => set({ theme: event.target.value })}>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">Match system</option>
                </Select>
              </Field>
              <Field label="Density">
                <Select value={prefs.density} onChange={(event) => set({ density: event.target.value })}>
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </Select>
              </Field>
              <Field label="Start page" hint="Where the panel lands after you sign in.">
                <Select value={prefs.startPage} onChange={(event) => set({ startPage: event.target.value })}>
                  <option value="overview">Overview</option>
                  <option value="bots">Bots</option>
                  <option value="proxies">Proxies</option>
                  <option value="commands">Aliases</option>
                  <option value="schedules">Schedules</option>
                  <option value="account">Settings</option>
                </Select>
              </Field>
              <Field label="Sidebar">
                <Select value={prefs.sidebar} onChange={(event) => set({ sidebar: event.target.value })}>
                  <option value="expanded">Expanded</option>
                  <option value="collapsed">Collapsed</option>
                </Select>
              </Field>
              <Field label="Timezone" hint="Use local, UTC, or an IANA name such as Asia/Colombo.">
                <Input value={prefs.timezone} onChange={(event) => set({ timezone: event.target.value })} />
              </Field>
            </div>
            <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <Checkbox
                checked={prefs.confirmDanger !== false}
                onChange={(checked) => set({ confirmDanger: checked })}
                label="Confirm destructive actions"
                description="Ask before deleting bots, accounts, or proxy endpoints."
              />
              <Checkbox
                checked={prefs.autoRefresh !== false}
                onChange={(checked) => set({ autoRefresh: checked })}
                label="Auto refresh tables"
                description="Poll list views in the background in addition to the live event stream."
              />
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
