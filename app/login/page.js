'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowLeft, LockKeyhole, UserRound, CheckCircle2, LogOut } from 'lucide-react';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui';
import { Marquee } from '@/components/reveal';

const STATS = [
  ['99.98%', 'Fleet uptime'],
  ['<40ms', 'Console latency'],
  ['SOCKS5', 'Proxy isolation'],
];

export default function LoginPage() {
  const { user, loading, login, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_540px]">
      {/* Editorial panel */}
      <section className="relative hidden overflow-hidden border-r border-white/[0.07] p-14 lg:flex lg:flex-col lg:justify-between">
        <div className="grid-bg mask-radial absolute inset-0 opacity-70" />
        <div className="spotlight pointer-events-none absolute inset-x-0 top-0 h-[520px]" />

        <Link href="/" className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-white text-[13px] font-bold text-black">NL</span>
          <div>
            <strong className="block text-[15px] font-medium tracking-[-0.02em] text-white">NativeLaunch</strong>
            <span className="text-[9px] uppercase tracking-[0.19em] text-white/30">Control plane</span>
          </div>
        </Link>

        <div className="relative max-w-2xl">
          <p className="eyebrow mb-7 flex items-center gap-2.5">
            <span className="anim-pulse h-1 w-1 rounded-full bg-white" />
            Secure workspace access
          </p>
          <h1 className="display anim-rise text-[58px] text-white xl:text-[70px]">
            Every bot.
            <br />
            <span className="text-white/35">One pane</span>
            <br />
            of glass.
          </h1>
          <p className="anim-rise mt-8 max-w-md text-[16px] leading-relaxed text-white/45" style={{ animationDelay: '120ms' }}>
            Accounts, proxies, scripts, aliases, schedules and live consoles stay fully
            isolated per tenant.
          </p>

          <div className="anim-rise mt-12 grid max-w-lg grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06]" style={{ animationDelay: '220ms' }}>
            {STATS.map(([value, label]) => (
              <div key={label} className="bg-black/60 px-5 py-5 backdrop-blur-xl">
                <p className="tnum text-[22px] font-semibold tracking-[-0.04em] text-white">{value}</p>
                <p className="mt-1.5 text-[10px] uppercase tracking-[0.13em] text-white/30">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <Marquee duration={44}>
            {['ORCHESTRATE', 'OBSERVE', 'AUTOMATE', 'SCALE'].map((word) => (
              <span key={word} className="flex items-center gap-8 pr-8 text-[11px] uppercase tracking-[0.3em] text-white/15">
                {word}
                <span className="h-1 w-1 rounded-full bg-white/20" />
              </span>
            ))}
          </Marquee>
        </div>
      </section>

      {/* Form panel */}
      <section className="relative flex min-h-screen items-center justify-center px-6 py-12 sm:px-12">
        {user ? (
          <div className="anim-rise w-full max-w-sm">
            <Link href="/" className="mb-10 inline-flex items-center gap-2 text-[12px] text-white/35 transition hover:text-white lg:hidden">
              <ArrowLeft className="h-3.5 w-3.5" /> Back home
            </Link>

            <div className="mb-8">
              <span className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-white font-bold text-black">NL</span>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-white/70">
              <CheckCircle2 className="h-3.5 w-3.5 text-white" /> Signed in
            </div>

            <h2 className="display mt-4 text-[34px] text-white">Welcome back</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-white/40">
              You are signed in as <strong className="text-white">{user.email || user.username || 'User'}</strong> ({user.role || 'Member'}).
            </p>

            <div className="mt-8 space-y-3">
              <Link
                href="/"
                className="sheen inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-[13px] font-medium text-black transition-all duration-300 hover:bg-white/90 active:scale-95"
              >
                Return to home <ArrowRight className="h-4 w-4" />
              </Link>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={logout}
                className="w-full"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="anim-rise w-full max-w-sm">
            <Link href="/" className="mb-10 inline-flex items-center gap-2 text-[12px] text-white/35 transition hover:text-white lg:hidden">
              <ArrowLeft className="h-3.5 w-3.5" /> Back home
            </Link>

            <div className="mb-8 lg:hidden">
              <span className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-white font-bold text-black">NL</span>
            </div>

            <h2 className="display text-[34px] text-white">Sign in</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-white/40">
              Use your workspace username or email.
            </p>

            <div className="mt-10 space-y-5">
              <label className="block">
                <span className="field-label">Username or email</span>
                <span className="relative block">
                  <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                  <input
                    className="field-control pl-11"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    autoFocus
                    required
                    placeholder="admin or you@example.com"
                  />
                </span>
              </label>

              <label className="block">
                <span className="field-label">Password</span>
                <span className="relative block">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                  <input
                    className="field-control pl-11"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    placeholder="Enter your password"
                  />
                </span>
              </label>
            </div>

            {error && (
              <p className="anim-rise mt-5 rounded-xl border border-white/25 bg-white/[0.07] px-4 py-3 text-[13px] text-white backdrop-blur-xl">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" loading={submitting} className="mt-8 w-full">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>

            <p className="mt-8 text-center text-[11px] text-white/20">
              Protected workspace. All sessions are logged.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
