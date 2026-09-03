'use client';

import { Checkbox } from '@/components/ui';
import { BotPicker, Field, Input, Select } from '@/components/dash-ui';

/**
 * Shared editor for automation scripts.
 *
 * The same shape is accepted by the workspace routes (/api/scripts) and the
 * per-bot routes (/api/bots/:id/scripts); the only difference is that a bot
 * script has no target list, so `bots` is omitted there.
 */
export const BLANK_SCRIPT = {
  name: '',
  description: '',
  type: 'interval',
  enabled: true,
  action: { type: 'command', value: '' },
  interval: 5000,
  cooldown: 3000,
  trigger: { pattern: '', matchType: 'contains', ignoreCase: true, source: 'all' },
  botIds: [],
};

/** Normalizes a stored script into complete form state. */
export function scriptToForm(script) {
  if (!script) return { ...BLANK_SCRIPT, trigger: { ...BLANK_SCRIPT.trigger }, action: { ...BLANK_SCRIPT.action } };
  return {
    name: script.name || '',
    description: script.description || '',
    type: script.type || 'interval',
    enabled: script.enabled !== false,
    action: {
      type: (script.action && script.action.type) === 'chat' ? 'chat' : 'command',
      value: (script.action && script.action.value) || '',
    },
    interval: Number(script.interval) || 5000,
    cooldown: Number(script.cooldown) || 3000,
    trigger: {
      pattern: (script.trigger && script.trigger.pattern) || '',
      matchType: (script.trigger && script.trigger.matchType) || 'contains',
      ignoreCase: !(script.trigger && script.trigger.ignoreCase === false),
      source: (script.trigger && script.trigger.source) || 'all',
    },
    botIds: Array.isArray(script.botIds) ? script.botIds : [],
  };
}

/** Strips the branch that does not apply to the selected trigger type. */
export function formToPayload(form, { withTargets = true } = {}) {
  const payload = {
    name: form.name,
    description: form.description,
    type: form.type,
    enabled: form.enabled,
    action: { type: form.action.type, value: form.action.value },
  };
  if (form.type === 'interval') payload.interval = Number(form.interval) || 5000;
  else {
    payload.trigger = { ...form.trigger };
    payload.cooldown = Number(form.cooldown) || 0;
  }
  if (withTargets) payload.botIds = form.botIds;
  return payload;
}

export function ScriptForm({ form, onChange, bots, withTargets = true }) {
  const set = (patch) => onChange({ ...form, ...patch });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(event) => set({ name: event.target.value })} maxLength={80} />
        </Field>
        <Field label="Trigger type">
          <Select value={form.type} onChange={(event) => set({ type: event.target.value })}>
            <option value="interval">Interval</option>
            <option value="message-trigger">Message trigger</option>
          </Select>
        </Field>
      </div>

      <Field label="Description" hint="Optional.">
        <Input
          value={form.description}
          onChange={(event) => set({ description: event.target.value })}
          maxLength={200}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <Field label="Action">
          <Select
            value={form.action.type}
            onChange={(event) => set({ action: { ...form.action, type: event.target.value } })}
          >
            <option value="command">Command</option>
            <option value="chat">Chat</option>
          </Select>
        </Field>
        <Field label="Value" hint={form.action.type === 'chat' ? 'Sent as chat text.' : 'Sent as a bot command.'}>
          <Input
            value={form.action.value}
            onChange={(event) => set({ action: { ...form.action, value: event.target.value } })}
            placeholder={form.action.type === 'chat' ? 'hello world' : '!stats'}
            maxLength={300}
          />
        </Field>
      </div>

      {form.type === 'interval' ? (
        <Field label="Interval (ms)" hint="Between 1000 and 86400000.">
          <Input
            type="number"
            min={1000}
            max={86400000}
            value={form.interval}
            onChange={(event) => set({ interval: event.target.value })}
          />
        </Field>
      ) : (
        <div className="space-y-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
          <Field label="Pattern">
            <Input
              value={form.trigger.pattern}
              onChange={(event) => set({ trigger: { ...form.trigger, pattern: event.target.value } })}
              placeholder="You have been paid"
              maxLength={200}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Match">
              <Select
                value={form.trigger.matchType}
                onChange={(event) => set({ trigger: { ...form.trigger, matchType: event.target.value } })}
              >
                <option value="contains">Contains</option>
                <option value="exact">Exact</option>
                <option value="regex">Regex</option>
              </Select>
            </Field>
            <Field label="Source">
              <Select
                value={form.trigger.source}
                onChange={(event) => set({ trigger: { ...form.trigger, source: event.target.value } })}
              >
                <option value="all">All</option>
                <option value="chat">Chat</option>
                <option value="system">System</option>
              </Select>
            </Field>
            <Field label="Cooldown (ms)" hint="0 to 300000.">
              <Input
                type="number"
                min={0}
                max={300000}
                value={form.cooldown}
                onChange={(event) => set({ cooldown: event.target.value })}
              />
            </Field>
          </div>
          <Checkbox
            checked={form.trigger.ignoreCase}
            onChange={(checked) => set({ trigger: { ...form.trigger, ignoreCase: checked } })}
            label="Ignore case"
          />
        </div>
      )}

      <Checkbox
        checked={form.enabled}
        onChange={(checked) => set({ enabled: checked })}
        label="Enabled"
        description="Disabled scripts stay saved but never fire."
      />

      {withTargets ? (
        <Field label="Target bots" hint="The script file is written to each selected bot and reloaded live.">
          <BotPicker bots={bots || []} value={form.botIds} onChange={(botIds) => set({ botIds })} />
        </Field>
      ) : null}
    </div>
  );
}
