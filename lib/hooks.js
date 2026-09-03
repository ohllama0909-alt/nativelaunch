'use client';

/**
 * Data hooks for the control plane.
 *
 * The panel exposes two server-sent event streams: an account-scoped fleet
 * stream at /api/events and a per-bot stream at /api/bots/:id/events. Anything
 * that can arrive over a stream is read from the stream, and plain fetches are
 * used only for the initial state and for resources with no stream of their own.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

const LOG_CAP = 400;

/**
 * Fetch a JSON resource once, with a manual reload.
 *
 * @param path  API path, or a falsy value to skip fetching entirely (used for
 *              admin-only resources on a non-admin account).
 * @param pick  Optional selector mapping the response to the value you want.
 */
export function useResource(path, pick) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  // Keeping the selector in a ref means an inline arrow function in the caller
  // does not retrigger the fetch on every render.
  const select = useRef(pick);
  select.current = pick;

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api(path)
      .then((result) => {
        if (cancelled) return;
        setData(select.current ? select.current(result) : result);
        setError('');
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, reload, setData };
}

/**
 * The bot roster, kept current by the account-scoped event stream.
 *
 * GET /api/bots seeds the list; after that every status change, config edit,
 * addition, and removal arrives as an event, so no polling is needed.
 */
export function useFleet() {
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api('/bots')
      .then((result) => {
        if (cancelled) return;
        setBots(result.bots || []);
        setError('');
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return undefined;
    const source = new EventSource('/api/events');

    const replace = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.bots) setBots(payload.bots);
        setLive(true);
      } catch (_) {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    const patch = (id, changes) =>
      setBots((current) => current.map((bot) => (bot.id === id ? { ...bot, ...changes } : bot)));

    const onStatus = (event) => {
      try {
        const payload = JSON.parse(event.data);
        patch(payload.id, { status: payload.status });
      } catch (_) {}
    };

    const onShards = (event) => {
      try {
        const payload = JSON.parse(event.data);
        patch(payload.id, { shards: payload.shards });
      } catch (_) {}
    };

    const onAdded = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload.bot) return;
        setBots((current) =>
          current.some((bot) => bot.id === payload.bot.id) ? current : [...current, payload.bot]
        );
      } catch (_) {}
    };

    const onUpdated = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload.bot) return;
        setBots((current) => current.map((bot) => (bot.id === payload.bot.id ? payload.bot : bot)));
      } catch (_) {}
    };

    const onRemoved = (event) => {
      try {
        const payload = JSON.parse(event.data);
        setBots((current) => current.filter((bot) => bot.id !== payload.id));
      } catch (_) {}
    };

    // The control service sends unnamed SSE frames with a `type` field, so
    // route the default message event here instead of listening for named SSE
    // events that the server never emits.
    source.onmessage = (event) => {
      try {
        const type = JSON.parse(event.data).type;
        const handlers = {
          hello: replace,
          reloaded: replace,
          status: onStatus,
          shards: onShards,
          'bot-added': onAdded,
          'bot-updated': onUpdated,
          'bot-removed': onRemoved,
        };
        handlers[type]?.(event);
      } catch (_) {}
    };
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);

    return () => {
      source.close();
      setLive(false);
    };
  }, []);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { bots, loading, live, error, reload, setBots };
}

/**
 * Console, status, inventory, and module state for one bot.
 *
 * The per-bot stream opens with a snapshot (status, buffered log tail, and the
 * last inventory), then sends incremental frames. The log buffer is capped so a
 * long-running console cannot grow without bound in the browser.
 */
export function useBotStream(botId) {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('');
  const [inventory, setInventory] = useState(null);
  const [modules, setModules] = useState([]);
  const [lastEvent, setLastEvent] = useState(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!botId) return undefined;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return undefined;

    setLogs([]);
    setInventory(null);
    setModules([]);

    const source = new EventSource(`/api/bots/${encodeURIComponent(botId)}/events`);

    const onSnapshot = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.status) setStatus(payload.status);
        if (Array.isArray(payload.logs)) setLogs(payload.logs.slice(-LOG_CAP));
        if (payload.inventory !== undefined) setInventory(payload.inventory);
        setLive(true);
      } catch (_) {}
    };

    const onLog = (event) => {
      try {
        const payload = JSON.parse(event.data);
        setLogs((current) => {
          const next = [...current, { t: payload.t, line: payload.line }];
          return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
        });
      } catch (_) {}
    };

    const onStatus = (event) => {
      try {
        setStatus(JSON.parse(event.data).status);
      } catch (_) {}
    };

    const onInventory = (event) => {
      try {
        setInventory(JSON.parse(event.data).data);
      } catch (_) {}
    };

    const onModules = (event) => {
      try {
        setModules(JSON.parse(event.data).modules || []);
      } catch (_) {}
    };

    const onEvent = (event) => {
      try {
        setLastEvent(JSON.parse(event.data).event);
      } catch (_) {}
    };

    source.onmessage = (event) => {
      try {
        const type = JSON.parse(event.data).type;
        const handlers = {
          snapshot: onSnapshot,
          log: onLog,
          status: onStatus,
          inventory: onInventory,
          modules: onModules,
          event: onEvent,
        };
        handlers[type]?.(event);
      } catch (_) {}
    };
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);

    return () => {
      source.close();
      setLive(false);
    };
  }, [botId]);

  return {
    logs,
    status,
    inventory,
    modules,
    lastEvent,
    live,
    setModules,
    setInventory,
    setStatus,
  };
}

/** setInterval with a callback ref, so the timer is not reset every render. */
export function useInterval(callback, delay) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (delay == null) return undefined;
    const id = setInterval(() => saved.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

/**
 * Re-render on a timer.
 *
 * Relative timestamps ("in 4m") go stale on their own, so views that show them
 * tick without refetching anything.
 */
export function useTicker(delay = 30000) {
  const [tick, setTick] = useState(0);
  useInterval(() => setTick((value) => value + 1), delay);
  return tick;
}
