'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Bot,
  Clock,
  Code,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  RefreshCw,
  Settings,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { useAuth, useToast } from '@/components/providers';
import { Spinner } from '@/components/ui';
import { FloatingIndicator } from '@/components/floating-indicator';
import { api, cn } from '@/lib/api';

const NAV = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/bots', label: 'Bots', icon: Bot },
  { href: '/network', label: 'Network', icon: Network },
  { href: '/aliases', label: 'Aliases', icon: Terminal },
  { href: '/scripts', label: 'Scripts', icon: Code },
  { href: '/schedules', label: 'Schedules', icon: Clock },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/users', label: 'Users', icon: Users, adminOnly: true },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function NavList({ items, pathname, onNavigate }) {
  return (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition duration-200',
              active ? 'bg-white/[0.08] text-white' : 'text-white/45 hover:bg-white/[0.04] hover:text-white/80'
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0 transition', active ? 'text-white' : 'text-white/35')} />
            <span className="truncate">{item.label}</span>
            {active ? <span className="ml-auto h-1 w-1 rounded-full bg-white" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardShell({ children }) {
  const { user, loading, logout } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Authenticating" />
      </div>
    );
  }

  if (!user) return null;

  const items = NAV.filter((item) => !item.adminOnly || user.role === 'admin');

  // GET /api/reload re-reads bots.json and live-reloads config on running
  // bots. It never restarts a process, so this is safe from the header.
  const hotReload = async () => {
    setReloading(true);
    try {
      const result = await api('/reload');
      toast(`Reloaded - ${result.reloaded} live, ${result.total} registered`, 'success');
    } catch (reason) {
      toast(reason.message, 'error');
    } finally {
      setReloading(false);
    }
  };

  const signOut = async () => {
    await logout();
    router.replace('/login');
  };

  const sidebar = (
    <div className="flex h-full flex-col gap-6">
      <Link href="/overview" className="flex items-center gap-2.5 px-2">
        <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[11px] border border-white/15 bg-white/[0.06] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.12)]">
          <Image src="/nativelaunch-logo.png" alt="NativeLaunch" width={28} height={28} className="h-full w-full object-contain" priority />
        </span>
        <span><span className="block text-[14px] font-medium tracking-[-0.02em] text-white">NativeLaunch</span><span className="mt-0.5 block text-[8px] uppercase tracking-[0.18em] text-white/25">Control plane</span></span>
      </Link>

      <NavList items={items} pathname={pathname} onNavigate={() => setDrawer(false)} />

      <div className="mt-auto space-y-3 border-t border-white/[0.07] px-2 pt-4">
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2">
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[10px] border border-white/15 bg-black">
            <Image src="/operator-avatar.png" alt="Cartoon operator avatar" fill sizes="40px" className="object-cover object-[center_28%]" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] text-white/80">{user.email}</p>
            <p className="mt-0.5 text-[9px] uppercase tracking-[0.13em] text-white/30">{user.role} operator</p>
          </div>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-2.5 rounded-xl px-1 py-2 text-[13px] text-white/45 transition hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 overflow-y-auto border-r border-white/[0.07] bg-black/60 px-4 py-6 backdrop-blur-xl lg:block console-scrollbar">
        {sidebar}
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-64 overflow-y-auto border-r border-white/[0.09] bg-black px-4 py-6 anim-slide-in console-scrollbar">
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-5 rounded-lg p-2 text-white/40 transition hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-[var(--header-h)] items-center gap-3 border-b border-white/[0.07] bg-black/70 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="rounded-lg p-2 text-white/50 transition hover:text-white lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={hotReload}
              disabled={reloading}
              title="Re-read bots.json and live-reload running bots"
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-[12px] text-white/60 transition hover:border-white/20 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', reloading && 'anim-spin')} />
              <span className="hidden sm:inline">Hot reload</span>
            </button>
          </div>
        </header>

        <main className="px-4 py-8 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-[1240px]">{children}</div>
        </main>
      </div>

      <FloatingIndicator />
    </div>
  );
}
