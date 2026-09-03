export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function api(path, options = {}) {
  const url = path.startsWith('/api/') || path === '/api'
    ? path
    : `/api${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try { data = await response.json(); } catch { data = null; }
  } else {
    try { data = await response.text(); } catch { data = null; }
  }

  if (!response.ok || (data && data.ok === false)) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nativelaunch:unauthorized'));
    }
    const message = data?.reason || data?.error || data?.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, data);
  }

  return data ?? {};
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
