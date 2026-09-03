'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { cn } from '@/lib/api';

const LINKS = [
  { href: '#platform', label: 'Platform' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
        <nav
          className={cn(
            'flex w-full max-w-6xl items-center gap-2 rounded-2xl border px-3 py-2.5 transition-all duration-700 [transition-timing-function:var(--ease-ios)]',
            scrolled
              ? 'border-white/[0.09] bg-black/65 shadow-[0_20px_60px_-20px_rgba(0,0,0,.95)] backdrop-blur-2xl'
              : 'border-transparent bg-transparent'
          )}
        >
          <Link href="/" className="group flex items-center gap-2.5 pl-1.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white text-[12px] font-bold text-black transition-transform duration-500 [transition-timing-function:var(--ease-ios)] group-hover:rotate-[-8deg]">
              BH
            </span>
            <span className="text-[14px] font-medium tracking-[-0.02em] text-white">NativeLaunch</span>
          </Link>

          <div className="mx-auto hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-lg px-3.5 py-2 text-[13px] text-white/45 transition-all duration-300 hover:bg-white/[0.06] hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Link
              href="/login"
              className="hidden rounded-xl px-4 py-2 text-[13px] text-white/55 transition-all duration-300 hover:bg-white/[0.06] hover:text-white sm:block"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="sheen group inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-[13px] font-medium text-black transition-all duration-300 [transition-timing-function:var(--ease-ios)] hover:bg-white/90 active:scale-95"
            >
              Launch console
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
              className="rounded-xl border border-white/10 bg-white/[0.05] p-2 text-white/60 md:hidden"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </nav>
      </header>

      {open && (
        <div className="anim-fade fixed inset-0 z-40 bg-black/90 pt-28 backdrop-blur-2xl md:hidden" onClick={() => setOpen(false)}>
          <div className="anim-rise flex flex-col gap-1 px-6">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="border-b border-white/[0.07] py-5 text-[26px] font-medium tracking-[-0.03em] text-white/70"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
