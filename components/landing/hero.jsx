'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Play } from 'lucide-react';
import { Marquee, RevealWords } from '@/components/reveal';

const WORDS = ['fleets', 'bots', 'proxies', 'scripts', 'schedules'];

const LOGS = [
  { t: '09:41:02', m: 'fleet.boot  -  24 workers online', dim: false },
  { t: '09:41:03', m: 'proxy.pool  -  18 endpoints verified', dim: true },
  { t: '09:41:05', m: 'module.load -  BoneCollector attached', dim: true },
  { t: '09:41:07', m: 'schedule.run -  nightly-sweep queued', dim: true },
  { t: '09:41:09', m: 'bot.hive-07  -  authenticated', dim: false },
  { t: '09:41:11', m: 'fleet.status -  all systems nominal', dim: false },
];

export function Hero() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((v) => (v + 1) % WORDS.length), 2100);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="relative overflow-hidden pt-40 sm:pt-48">
      <div className="grid-bg mask-radial absolute inset-0 opacity-60" />
      <div className="spotlight pointer-events-none absolute inset-x-0 top-0 h-[720px]" />

      <div className="relative mx-auto max-w-6xl px-6">
        {/* Announcement pill */}
        <div className="anim-rise flex justify-center">
          <Link
            href="/login"
            className="group inline-flex items-center gap-2.5 rounded-full border border-white/[0.09] bg-white/[0.04] py-1.5 pl-1.5 pr-4 text-[12px] text-white/50 backdrop-blur-xl transition-all duration-500 [transition-timing-function:var(--ease-ios)] hover:border-white/25 hover:text-white"
          >
            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-black">
              v4.0
            </span>
            Command palette, live consoles, proxy pools
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* Display headline */}
        <h1 className="display mt-11 text-center text-[52px] leading-[0.9] text-white sm:text-[86px] lg:text-[112px]">
          <RevealWords text="Infrastructure for" delay={80} />
          <br />
          <span className="relative inline-flex h-[1.05em] items-baseline justify-center overflow-hidden align-bottom">
            <span className="invisible">schedules</span>
            {WORDS.map((word, i) => (
              <span
                key={word}
                aria-hidden={i !== index}
                className="shimmer absolute inset-0 flex items-baseline justify-center transition-all duration-[900ms] [transition-timing-function:var(--ease-expo)]"
                style={{
                  opacity: i === index ? 1 : 0,
                  transform:
                    i === index
                      ? 'translateY(0) scale(1)'
                      : `translateY(${i < index ? '-60%' : '60%'}) scale(.94)`,
                  filter: i === index ? 'blur(0)' : 'blur(9px)',
                }}
              >
                {word}
              </span>
            ))}
          </span>
          <br />
          <RevealWords text="that never sleep." delay={340} />
        </h1>

        <p
          className="anim-rise mx-auto mt-9 max-w-xl text-center text-[16px] leading-relaxed text-white/45 sm:text-[18px]"
          style={{ animationDelay: '520ms' }}
        >
          NativeLaunch is the control plane for autonomous Minecraft fleets. Spin up hundreds of
          workers, route them through isolated proxies, and watch every packet land in real time.
        </p>

        <div
          className="anim-rise mt-11 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: '640ms' }}
        >
          <Link
            href="/login"
            className="sheen group inline-flex h-12 items-center gap-2 rounded-xl bg-white px-7 text-[14px] font-medium text-black transition-all duration-300 [transition-timing-function:var(--ease-ios)] hover:bg-white/90 active:scale-[.97]"
          >
            Launch console
            <ArrowUpRight className="h-4 w-4 transition-transform duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
          <a
            href="#workflow"
            className="group inline-flex h-12 items-center gap-2.5 rounded-xl border border-white/12 bg-white/[0.05] px-7 text-[14px] font-medium text-white backdrop-blur-xl transition-all duration-300 hover:border-white/30 hover:bg-white/[0.1] active:scale-[.97]"
          >
            <Play className="h-3.5 w-3.5 fill-white transition-transform duration-500 group-hover:scale-110" />
            See how it works
          </a>
        </div>

        {/* Console preview */}
        <div className="anim-scale relative mt-24" style={{ animationDelay: '760ms' }}>
          <div className="pointer-events-none absolute -inset-x-16 -top-16 bottom-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(255,255,255,.09),transparent_70%)]" />
          <div className="glass relative overflow-hidden rounded-[26px] p-2">
            <div className="overflow-hidden rounded-[19px] border border-white/[0.07] bg-[#070707]">
              {/* window chrome */}
              <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-3.5">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/12" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                </div>
                <p className="mx-auto rounded-md bg-white/[0.04] px-3 py-1 font-mono text-[10px] text-white/25">
                  nativelaunch / fleet / live
                </p>
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.13em] text-white/35">
                  <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_9px_rgba(255,255,255,.9)]" />
                  live
                </span>
              </div>

              <div className="grid gap-px bg-white/[0.06] sm:grid-cols-3">
                {[['24', 'Bots running'], ['18', 'Proxies healthy'], ['1.2k', 'Events / min']].map(([v, l]) => (
                  <div key={l} className="bg-[#070707] px-6 py-6">
                    <p className="tnum text-[30px] font-semibold leading-none tracking-[-0.045em] text-white">{v}</p>
                    <p className="mt-2.5 text-[10px] uppercase tracking-[0.13em] text-white/30">{l}</p>
                  </div>
                ))}
              </div>

              <div className="border-t border-white/[0.07] p-6 font-mono text-[12px] leading-relaxed">
                {LOGS.map((log, i) => (
                  <p
                    key={log.t}
                    className="anim-fade flex gap-4"
                    style={{ animationDelay: `${900 + i * 150}ms` }}
                  >
                    <span className="shrink-0 text-white/20">{log.t}</span>
                    <span className={log.dim ? 'text-white/35' : 'text-white/80'}>{log.m}</span>
                  </p>
                ))}
                <p className="mt-2 flex gap-4">
                  <span className="shrink-0 text-white/20">09:41:12</span>
                  <span className="anim-pulse inline-block h-4 w-2 bg-white" />
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyword marquee */}
      <div className="relative mt-24 border-y border-white/[0.06] py-5">
        <Marquee duration={30}>
          {['ORCHESTRATION', 'LIVE CONSOLES', 'PROXY POOLS', 'SCRIPT ENGINE', 'SCHEDULING', 'MULTI-TENANT', 'SSE STREAMS', 'MODULE REGISTRY'].map((word) => (
            <span key={word} className="flex items-center gap-10 pr-10 text-[12px] uppercase tracking-[0.28em] text-white/20">
              {word}
              <span className="h-1 w-1 rounded-full bg-white/20" />
            </span>
          ))}
        </Marquee>
      </div>
    </section>
  );
}
