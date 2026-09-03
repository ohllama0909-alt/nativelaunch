'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { api } from '@/lib/api';

const AuthContext = createContext(null);
const ToastContext = createContext(null);

export function Providers({ children }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await api('/me');
      setUser(result.authenticated ? result.user : null);
      return result.authenticated ? result.user : null;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const unauthorized = () => setUser(null);
    window.addEventListener('nativelaunch:unauthorized', unauthorized);
    window.addEventListener('bothive:unauthorized', unauthorized);
    return () => window.removeEventListener('nativelaunch:unauthorized', unauthorized);
      window.removeEventListener('bothive:unauthorized', unauthorized);
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api('/logout', { method: 'POST' }); } finally { setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, setUser, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current.slice(-3), { id, message, type }]);
    window.setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  const icons = { success: CheckCircle2, error: CircleAlert, warning: CircleAlert, info: Info };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((item) => {
          const Icon = icons[item.type] || Info;
          const tone = item.type === 'error'
            ? 'border-white/35 bg-white/[0.10] text-white'
            : item.type === 'warning'
              ? 'border-white/20 bg-white/[0.07] text-white/90'
              : item.type === 'success'
                ? 'border-white/25 bg-white/[0.08] text-white'
                : 'border-white/12 bg-white/[0.05] text-white/80';
          return (
            <div
              key={item.id}
              className={`anim-rise pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3.5 shadow-[0_24px_60px_-16px_rgba(0,0,0,.95)] backdrop-blur-2xl ${tone}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
              <p className="min-w-0 flex-1 text-[13px] leading-5">{item.message}</p>
              <button
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded-lg p-0.5 opacity-40 transition-opacity duration-300 hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside Providers');
  return value;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside Providers');
  return value;
}
