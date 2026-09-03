/**
 * Presentation helpers shared by the control plane pages.
 *
 * The API returns ISO timestamps and raw millisecond numbers, and every page
 * needs the same handful of conversions, so they live here rather than being
 * redone per view. Everything tolerates null/undefined and returns a dash
 * instead of throwing, because a half-populated row must still render.
 */

const DASH = '--';

/** Coerce an ISO string, epoch number, or Date into epoch milliseconds. */
export function toMs(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const UNITS = [
  { limit: 45 * 1000, divisor: 1000, suffix: 's' },
  { limit: 90 * 60 * 1000, divisor: 60 * 1000, suffix: 'm' },
  { limit: 36 * 60 * 60 * 1000, divisor: 60 * 60 * 1000, suffix: 'h' },
  { limit: 30 * 24 * 60 * 60 * 1000, divisor: 24 * 60 * 60 * 1000, suffix: 'd' },
];

/** "just now", "4m ago", "in 2h". */
export function relTime(value) {
  const ms = toMs(value);
  if (ms == null) return DASH;
  const delta = ms - Date.now();
  const magnitude = Math.abs(delta);
  if (magnitude < 10 * 1000) return 'just now';
  const unit = UNITS.find((candidate) => magnitude < candidate.limit);
  const amount = unit
    ? Math.round(magnitude / unit.divisor)
    : Math.round(magnitude / (30 * 24 * 60 * 60 * 1000));
  const suffix = unit ? unit.suffix : 'mo';
  return delta < 0 ? `${amount}${suffix} ago` : `in ${amount}${suffix}`;
}

function zoneOption(timezone) {
  if (!timezone || timezone === 'local') return {};
  return { timeZone: timezone };
}

/** Absolute date and time. `timezone` accepts "local", "UTC", or an IANA name. */
export function fmtDateTime(value, timezone) {
  const ms = toMs(value);
  if (ms == null) return DASH;
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...zoneOption(timezone),
    });
  } catch (_) {
    // An unrecognised IANA name must not break the row.
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
  }
}

/** Wall-clock time only, used for console log gutters. */
export function fmtClock(value, timezone) {
  const ms = toMs(value);
  if (ms == null) return '--:--:--';
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      ...zoneOption(timezone),
    });
  } catch (_) {
    return new Date(ms).toISOString().slice(11, 19);
  }
}

/** Compact duration for a millisecond span: "2h 5m", "450ms". */
export function fmtDuration(ms) {
  const total = Number(ms);
  if (!Number.isFinite(total) || total < 0) return DASH;
  if (total < 1000) return `${Math.round(total)}ms`;
  const seconds = Math.floor(total / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Proxy latency reads better with a unit than as a bare number. */
export function fmtLatency(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return DASH;
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Value for an <input type="datetime-local"> in the browser's local zone. */
export function datetimeLocalValue(value) {
  const ms = toMs(value) ?? Date.now();
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** Same, but rendering the UTC clock instead of the local one. */
export function datetimeUtcValue(value) {
  const ms = toMs(value) ?? Date.now();
  return new Date(ms).toISOString().slice(0, 16);
}

/**
 * Turn a datetime-local string into an ISO instant.
 *
 * A datetime-local value carries no offset, so the zone chosen in the form
 * decides what it means: "UTC" appends Z, anything else lets the browser
 * interpret it in its own zone.
 */
export function localInputToIso(value, zone) {
  if (!value) return '';
  if (zone === 'UTC') {
    const ms = Date.parse(`${value}:00Z`);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

/** Whole-number percentage, guarding against a zero denominator. */
export function pct(value, total) {
  const numerator = Number(value) || 0;
  const denominator = Number(total) || 0;
  if (denominator <= 0) return 0;
  return Math.min(100, Math.round((numerator / denominator) * 100));
}

export function titleCase(text) {
  if (!text) return '';
  return String(text)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Short egress label for a bot row.
 *
 * Non-admin accounts receive the proxy URI masked, so this deliberately shows
 * only host:port and never attempts to reconstruct credentials.
 */
export function proxyLabelFor(bot) {
  const config = (bot && bot.config) || {};
  const raw = config.proxy;
  if (typeof raw === 'string' && raw.trim()) {
    let text = raw.trim().replace(/^socks(5h?|4a?)?:\/\//i, '');
    const at = text.lastIndexOf('@');
    if (at !== -1) text = text.slice(at + 1);
    const parts = text.split(':').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
    return text || 'proxied';
  }
  if (config.proxyId) return 'proxied';
  return '';
}

/** Recalculate proxy assignments from the SSE-backed bot roster. */
export function withLiveProxyUsage(proxies, bots, ready = true) {
  const rows = Array.isArray(proxies) ? proxies : [];
  if (!ready) return rows;

  const byId = new Map(rows.map((proxy) => [proxy.id, []]));
  const byLabel = new Map(rows.map((proxy) => [String(proxy.label || '').toLowerCase(), proxy.id]));

  (Array.isArray(bots) ? bots : []).forEach((bot) => {
    const config = bot.config || {};
    const proxyId = config.proxyId || byLabel.get(proxyLabelFor(bot).toLowerCase());
    if (!proxyId || !byId.has(proxyId)) return;
    byId.get(proxyId).push({ id: bot.id, username: config.username || bot.id });
  });

  return rows.map((proxy) => {
    const assignedTo = byId.get(proxy.id) || [];
    const hiddenAssignments = Number(proxy.hiddenAssignments) || 0;
    const capacity = Number(proxy.capacity) || 0;
    const used = assignedTo.length + hiddenAssignments;
    return {
      ...proxy,
      assignedTo,
      freeSlots: Math.max(0, capacity - used),
    };
  });
}
