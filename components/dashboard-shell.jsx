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
  Gem,
  LayoutDashboard,
  LogOut,
  Menu,
  Megaphone,
  Network,
  RefreshCw,
  Settings,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { useAuth, useToast } from '@/components/providers';
import { Spinner } from '@/components/ui';
import { FleetDockProvider, useFleetDock } from '@/components/fleet-dock';
import { api, cn } from '@/lib/api';

const NAV_SECTIONS = [
  {
    label: 'Fleet',
    items: [
      { href: '/overview', label: 'Overview', icon: LayoutDashboard },
      { href: '/bots', label: 'Bots', icon: Bot, live: true },
      { href: '/network', label: 'Network', icon: Network },
    ],
  },
  {
    label: 'Automation',
    items: [
      { href: '/aliases', label: 'Aliases', icon: Terminal },
      { href: '/scripts', label: 'Scripts', icon: Code },
      { href: '/schedules', label: 'Schedules', icon: Clock },
      { href: '/activity', label: 'Activity', icon: Activity },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/users', label: 'Users', icon: Users, adminOnly: true },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const PAGE_TITLES = {
  '/overview': ['Control plane', 'Overview'],
  '/bots': ['Fleet', 'Bots'],
  '/network': ['Infrastructure', 'Network'],
  '/aliases': ['Automation', 'Aliases'],
  '/scripts': ['Automation', 'Scripts'],
  '/schedules': ['Automation', 'Schedules'],
  '/activity': ['History', 'Activity'],
  '/users': ['Administration', 'Users'],
  '/settings': ['Account', 'Settings'],
};

function NavList({ items, pathname, fleet, onNavigate }) {
  return (
    <nav className="space-y-3">
      <p className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/20">{items.label}</p>
      <div className="space-y-0.5">
        {items.items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const running = fleet ? fleet.bots.filter((b) => b.status === 'running').length : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[13px] transition-all duration-300 [transition-timing-function:var(--ease-ios)]',
                active
                  ? 'border border-white/14 bg-white/[0.09] text-white shadow-[0_0_30px_-10px_rgba(255,255,255,.25),inset_0_1px_0_rgba(255,255,255,.08)]'
                  : 'border border-transparent text-white/45 hover:bg-white/[0.045] hover:text-white/85'
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0 transition-all duration-300',
                  active ? 'text-white drop-shadow-[0_0_6px_rgba(255,255,255,.55)]' : 'text-white/35 group-hover:text-white/70'
                )}
              />
              <span className="truncate">{item.label}</span>
              {item.live && fleet ? (
                <span
                  title={`${running} of ${fleet.bots.length} running`}
                  className={cn(
                    'tnum ml-auto inline-flex min-w-[1.6rem] items-center justify-center rounded-lg px-1.5 py-0.5 text-[10px] font-semibold transition',
                    running
                      ? 'bg-white text-black shadow-[0_0_12px_rgba(255,255,255,.3)]'
                      : 'bg-white/[0.07] text-white/35'
                  )}
                >
                  {running}
                </span>
              ) : active ? (
                <span className="ml-auto h-1 w-1 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,.8)]" />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function ShellContent({ children }) {
  const { user, loading, logout } = useAuth();
  const { toast } = useToast();
  const { fleet, openBroadcast } = useFleetDock();
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

  const items = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.adminOnly || user.role === 'admin'),
  })).filter((section) => section.items.length);

  const running = fleet.bots.filter((b) => b.status === 'running').length;
  const shards = fleet.bots.reduce((sum, b) => sum + (Number(b.shards) || 0), 0);
  const [pageEyebrow, pageTitle] = PAGE_TITLES[pathname] || PAGE_TITLES['/overview'];

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
    <div className="flex h-full flex-col">
      <Link href="/overview" className="group flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3 py-3 transition hover:border-white/15 hover:bg-white/[0.05]">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[13px] border border-white/15 bg-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,.12)]">
          <Image src="/nativelaunch-logo.png" alt="NativeLaunch" width={30} height={30} className="h-full w-full object-contain" priority />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold tracking-[-0.02em] text-white">NativeLaunch</span>
          <span className="mt-0.5 flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-white/25">
            <span className={cn('h-1 w-1 rounded-full', fleet.live ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,.9)]' : 'bg-white/25')} />
            Control plane · {fleet.live ? 'live' : 'offline'}
          </span>
        </span>
      </Link>

      <div className="console-scrollbar mt-6 flex-1 space-y-6 overflow-y-auto pr-1">
        {items.map((section) => (
          <NavList key={section.label} items={section} pathname={pathname} fleet={fleet} onNavigate={() => setDrawer(false)} />
        ))}
      </div>

      <div className="mt-6 space-y-3 border-t border-white/[0.07] pt-4">
        <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-2.5">
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[12px] border border-white/15 bg-black">
            <Image src="/operator-avatar.png" alt="Cartoon operator avatar" fill sizes="40px" className="object-cover object-[center_28%]" />
            <span
              className={cn(
                'absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full border border-black',
                fleet.bots.some((b) => b.status === 'running') ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,.9)]' : 'bg-white/25'
              )}
            />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] text-white/80">{user.email}</p>
            <p className="mt-0.5 text-[9px] uppercase tracking-[0.13em] text-white/30">{user.role} operator</p>
          </div>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-[13px] text-white/45 transition hover:bg-white/[0.04] hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Ambient backdrop */}
      <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden">
        <div className="auri auri-a" />
        <div className="auri auri-b" />
        <div className="auri auri-c" />
        <div className="grid-bg mask-radial absolute inset-0 opacity-[0.5]" />
      </div>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 overflow-y-auto border-r border-white/[0.07] bg-black/55 px-4 py-5 backdrop-blur-2xl lg:block console-scrollbar">
        {sidebar}
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-white/[0.09] bg-black px-4 py-6 anim-slide-in console-scrollbar">
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

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-[var(--header-h)] items-center gap-3 border-b border-white/[0.07] bg-black/60 px-4 backdrop-blur-2xl sm:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/60 transition hover:text-white lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Breadcrumb */}
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <span className="text-[12px] uppercase tracking-[0.16em] text-white/25">{pageEyebrow}</span>
            <span className="h-3 w-px bg-white/15" />
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-white">{pageTitle}</span>
          </div>

          {/* Live fleet strip */}
          <div className="ml-auto flex items-center gap-2">
            <div className="mr-1 hidden items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 md:flex">
              <span className="flex items-center gap-1.5 text-[11px] text-white/45">
                <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'bg-white shadow-[0_0_7px_rgba(255,255,255,.9)] anim-pulse' : 'bg-white/20')} />
                <span className="tnum font-medium text-white/75">{running}</span> live
              </span>
              <span className="h-3 w-px bg-white/10" />
              <span className="flex items-center gap-1.5 text-[11px] text-white/45">
                <Gem className="h-3 w-3 text-white/40" />
                <span className="tnum font-medium text-white/75">{shards ? shards.toLocaleString() : '--'}</span> shards
              </span>
            </div>

            <button
              type="button"
              onClick={() => openBroadcast()}
              title="Open command deck"
              className="inline-flex items-center gap-2 rounded-xl border border-white bg-white px-3 py-2 text-[12px] font-semibold text-black shadow-[0_0_24px_-6px_rgba(255,255,255,.45)] transition-all duration-300 hover:bg-white/90 active:scale-95"
            >
              <Megaphone className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Cast</span>
            </button>

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

        <main className="relative px-4 py-8 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-[1240px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }) {
  return (
    <FleetDockProvider>
      <ShellContent>{children}</ShellContent>
    </FleetDockProvider>
  );
}
