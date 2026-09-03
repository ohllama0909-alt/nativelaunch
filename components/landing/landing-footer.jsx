'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { Reveal, Marquee } from '@/components/reveal';

const COLUMNS = [
  {
    title: 'Platform',
    links: [
      { label: 'Overview', href: '#platform' },
      { label: 'Workflow', href: '#workflow' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    title: 'Console',
    links: [
      { label: 'Sign in', href: '/login' },
      { label: 'Fleet dashboard', href: '/login' },
      { label: 'Proxy network', href: '/login' },
      { label: 'Script library', href: '/login' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Documentation', href: '#platform' },
      { label: 'Module registry', href: '#platform' },
      { label: 'Status', href: '#platform' },
      { label: 'Changelog', href: '#platform' },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-white/[0.07]">
      <div className="spotlight pointer-events-none absolute inset-x-0 bottom-0 h-[360px] rotate-180" />

      {/* Closing statement */}
      <div className="relative mx-auto max-w-6xl px-6 pt-24 sm:pt-32">
        <Reveal className="text-center">
          <p className="eyebrow mb-7">Ready when you are</p>
          <h2 className="display text-[46px] text-white sm:text-[76px] lg:text-[96px]">
            Run the fleet.
            <br />
            <span className="text-white/25">Not the chaos.</span>
          </h2>
          <div className="mt-11 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login"
              className="sheen group inline-flex h-12 items-center gap-2 rounded-xl bg-white px-7 text-[14px] font-medium text-black transition-all duration-300 [transition-timing-function:var(--ease-ios)] hover:bg-white/90 active:scale-[.97]"
            >
              Launch console
              <ArrowUpRight className="h-4 w-4 transition-transform duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#pricing"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.05] px-7 text-[14px] font-medium text-white backdrop-blur-xl transition-all duration-300 hover:border-white/30 hover:bg-white/[0.1] active:scale-[.97]"
            >
              Compare plans
            </a>
          </div>
        </Reveal>
      </div>

      {/* Oversized wordmark marquee */}
      <div className="relative mt-24 select-none border-y border-white/[0.06] py-6">
        <Marquee duration={40}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="display flex items-center gap-8 pr-8 text-[62px] text-white/[0.055] sm:text-[92px]"
            >
              NATIVELAUNCH
              <span className="h-2 w-2 rounded-full bg-white/10" />
            </span>
          ))}
        </Marquee>
      </div>

      {/* Link columns */}
      <div className="relative mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/12 bg-white/[0.05] p-1.5"><Image src="/nativelaunch-logo.png" alt="NativeLaunch" width={24} height={24} className="h-full w-full object-contain" /></span>
              <span className="text-[14px] font-medium tracking-[-0.02em] text-white">NativeLaunch</span>
            </div>
            <p className="mt-5 max-w-xs text-[13px] leading-relaxed text-white/35">
              The control plane for autonomous fleets. Deploy, orchestrate and observe
              hundreds of bots from one obsessively designed dashboard.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-[10px] uppercase tracking-[0.13em] text-white/40 backdrop-blur-xl">
              <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_9px_rgba(255,255,255,.9)]" />
              All systems operational
            </div>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-[10px] font-medium uppercase tracking-[0.17em] text-white/25">{column.title}</p>
              <ul className="mt-5 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="group inline-flex items-center gap-1.5 text-[13px] text-white/45 transition-colors duration-300 hover:text-white"
                    >
                      {link.label}
                      <ArrowUpRight className="h-3 w-3 opacity-0 transition-all duration-300 group-hover:opacity-60" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-white/[0.07] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-white/25">© {new Date().getFullYear()} NativeLaunch. All rights reserved.</p>
          <p className="text-[11px] text-white/25">Built for operators who care about the details.</p>
        </div>
      </div>
    </footer>
  );
}
