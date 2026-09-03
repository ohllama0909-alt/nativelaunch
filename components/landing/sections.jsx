'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Activity, Bot, Braces, CalendarClock, Command, Network,
  Check, ArrowUpRight, Minus, Plus,
} from 'lucide-react';
import { Reveal, Marquee } from '@/components/reveal';
import { cn } from '@/lib/api';

/* ------------------------------------------------------------------ */

export function SectionHead({ eyebrow, title, sub, align = 'left' }) {
  return (
    <Reveal className={cn('max-w-3xl', align === 'center' && 'mx-auto text-center')}>
      <p className="eyebrow mb-6 inline-flex items-center gap-2.5">
        <span className="h-1 w-1 rounded-full bg-white/50" />
        {eyebrow}
      </p>
      <h2 className="display text-[40px] text-white sm:text-[58px]">{title}</h2>
      {sub && <p className="mt-6 text-[16px] leading-relaxed text-white/40">{sub}</p>}
    </Reveal>
  );
}

/* ---------------------------- Features ---------------------------- */

const FEATURES = [
  {
    icon: Bot,
    title: 'Fleet orchestration',
    body: 'Spawn, restart and retire hundreds of isolated bot processes. Each worker forks with its own config, credentials and lifecycle.',
    span: 'lg:col-span-3 lg:row-span-2',
    feature: true,
  },
  {
    icon: Network,
    title: 'Proxy network',
    body: 'SOCKS5 pools with health checks, automatic assignment and a hard capacity ceiling of three workers per endpoint.',
    span: 'lg:col-span-3',
  },
  {
    icon: Activity,
    title: 'Live telemetry',
    body: 'Server-sent events push status, logs and shard health into the console with sub-40ms latency.',
    span: 'lg:col-span-2',
  },
  {
    icon: Braces,
    title: 'Script engine',
    body: 'Author, version and hot-reload behaviour scripts without restarting a single worker.',
    span: 'lg:col-span-2',
  },
  {
    icon: CalendarClock,
    title: 'Schedules',
    body: 'Cron-style jobs that fan out across the fleet and report back per-bot results.',
    span: 'lg:col-span-2',
  },
  {
    icon: Command,
    title: 'Command palette',
    body: 'Cmd K from anywhere. Navigate, search and fire fleet-wide commands without lifting your hands.',
    span: 'lg:col-span-6',
  },
];

export function FeatureBento() {
  return (
    <section id="platform" className="relative mx-auto max-w-6xl px-6 py-28 sm:py-36">
      <SectionHead
        eyebrow="The platform"
        title={<>Everything the fleet needs.<br /><span className="text-white/25">Nothing it does not.</span></>}
        sub="Six surfaces, one mental model. Every screen shares the same glass language, the same keyboard grammar and the same real-time spine."
      />

      <div className="mt-16 grid gap-3 lg:grid-cols-6">
        {FEATURES.map((item, i) => {
          const Icon = item.icon;
          return (
            <Reveal
              key={item.title}
              delay={i * 70}
              className={cn('group panel-surface relative overflow-hidden p-7', item.span)}
            >
              <span className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

              <span className="inline-flex rounded-xl border border-white/[0.09] bg-white/[0.04] p-2.5 text-white/50 transition-all duration-500 [transition-timing-function:var(--ease-ios)] group-hover:border-white/25 group-hover:text-white">
                <Icon className="h-[18px] w-[18px]" />
              </span>

              <h3 className="mt-6 text-[19px] font-medium tracking-[-0.025em] text-white">{item.title}</h3>
              <p className="mt-3 max-w-md text-[14px] leading-relaxed text-white/40">{item.body}</p>

              {item.feature && (
                <div className="mt-9 overflow-hidden rounded-2xl border border-white/[0.07] bg-black/50">
                  <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
                    <span className="font-mono text-[10px] text-white/25">fleet.status</span>
                    <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.13em] text-white/35">
                      <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_9px_rgba(255,255,255,.9)]" />
                      streaming
                    </span>
                  </div>
                  <div className="space-y-2.5 p-4">
                    {[
                      ['hive-01', 'running', 100],
                      ['hive-02', 'running', 92],
                      ['hive-03', 'pending', 48],
                      ['hive-04', 'running', 78],
                      ['hive-05', 'stopped', 12],
                    ].map(([name, state, pct]) => (
                      <div key={name} className="flex items-center gap-3">
                        <span className="w-16 shrink-0 font-mono text-[11px] text-white/45">{name}</span>
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                          <span
                            className="block h-full rounded-full bg-white/70 transition-[width] duration-1000 [transition-timing-function:var(--ease-expo)]"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="w-16 shrink-0 text-right text-[10px] uppercase tracking-[0.1em] text-white/30">{state}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------- Workflow ---------------------------- */

const STEPS = [
  { n: '01', t: 'Provision', d: 'Add an account, pick a target server and attach a proxy endpoint. The worker forks in under two seconds.' },
  { n: '02', t: 'Compose', d: 'Toggle modules, bind aliases and drop in a behaviour script. Everything hot-reloads without a restart.' },
  { n: '03', t: 'Schedule', d: 'Queue recurring jobs that fan out across the fleet and report per-bot results back to the activity log.' },
  { n: '04', t: 'Observe', d: 'Stream every log line, status change and inventory delta live. Intervene from the console at any moment.' },
];

export function Workflow() {
  return (
    <section id="workflow" className="relative border-y border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <SectionHead
          eyebrow="How it works"
          title={<>Four steps from<br /><span className="text-white/25">zero to fleet.</span></>}
        />

        <div className="mt-16 grid gap-px overflow-hidden rounded-[22px] border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <Reveal
              key={step.n}
              delay={i * 90}
              className="group relative bg-black px-7 py-9 transition-colors duration-500 hover:bg-white/[0.03]"
            >
              <span className="tnum block text-[11px] font-medium tracking-[0.2em] text-white/25">{step.n}</span>
              <h3 className="mt-6 text-[21px] font-medium tracking-[-0.025em] text-white">{step.t}</h3>
              <p className="mt-3.5 text-[13px] leading-relaxed text-white/40">{step.d}</p>
              <span className="absolute bottom-0 left-0 h-px w-0 bg-white transition-[width] duration-700 [transition-timing-function:var(--ease-expo)] group-hover:w-full" />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- Stats ---------------------------- */

const STATS = [
  ['400+', 'Concurrent workers'],
  ['1200', 'Log lines buffered'],
  ['18', 'Behaviour modules'],
  ['99.98%', 'Control plane uptime'],
];

export function StatsBand() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="grid gap-px overflow-hidden rounded-[22px] border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map(([value, label], i) => (
          <Reveal key={label} delay={i * 80} className="bg-black px-7 py-10 text-center">
            <p className="tnum display text-[46px] text-white sm:text-[54px]">{value}</p>
            <p className="mt-3 text-[10px] uppercase tracking-[0.15em] text-white/30">{label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------- Modules marquee ---------------------------- */

const MODULES = [
  'AutoAuth', 'AutoHome', 'BoneCollector', 'BoneDropper', 'BoxPvpMiner', 'ChatGames',
  'CrystalTrap', 'DiscordBridge', 'Fight', 'Follower', 'GoTo', 'GuiManager',
  'InventoryCleaner', 'MineAndSell', 'PayoutBridge', 'TpKiller',
];

export function ModulesMarquee() {
  const chip = (name) => (
    <span
      key={name}
      className="mr-3 inline-flex shrink-0 items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-[13px] text-white/50 backdrop-blur-xl transition-colors duration-300 hover:border-white/25 hover:text-white"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
      {name}
    </span>
  );

  return (
    <section className="border-y border-white/[0.06] py-20">
      <div className="mx-auto mb-11 max-w-6xl px-6">
        <SectionHead
          eyebrow="Module registry"
          title="Composable behaviour."
          sub="Every worker is assembled from independent modules. Toggle them per bot, per workspace, or fleet-wide."
          align="center"
        />
      </div>
      <div className="space-y-3">
        <Marquee duration={46}>{MODULES.map(chip)}</Marquee>
        <Marquee duration={52} reverse>{[...MODULES].reverse().map(chip)}</Marquee>
      </div>
    </section>
  );
}

/* ---------------------------- Testimonials ---------------------------- */

const QUOTES = [
  {
    q: 'We went from three terminal windows and a spreadsheet to one console. The live log stream alone paid for itself in the first week.',
    a: 'Fleet operator',
    r: 'Running 120 workers',
  },
  {
    q: 'The proxy pool health checks catch dead endpoints before a single bot notices. That used to be an hour of manual triage every morning.',
    a: 'Infrastructure lead',
    r: 'Managing 40 endpoints',
  },
  {
    q: 'Hot-reloading scripts across the whole fleet without a restart is the feature I did not know I needed. Now I cannot work without it.',
    a: 'Automation engineer',
    r: 'Shipping daily',
  },
];

export function Testimonials() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
      <SectionHead eyebrow="In production" title="Built for operators." align="center" />

      <div className="mt-16 grid gap-3 lg:grid-cols-3">
        {QUOTES.map((item, i) => (
          <Reveal key={item.a} delay={i * 90} className="panel-surface flex flex-col p-7">
            <p className="display mb-6 text-[38px] leading-none text-white/12">&ldquo;</p>
            <p className="flex-1 text-[15px] leading-relaxed text-white/60">{item.q}</p>
            <div className="mt-8 border-t border-white/[0.07] pt-5">
              <p className="text-[13px] font-medium text-white">{item.a}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-white/25">{item.r}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------- Pricing ---------------------------- */

const PLANS = [
  {
    name: 'Solo',
    price: 'Free',
    note: 'For a single operator',
    features: ['Up to 3 bots', '1 proxy endpoint', 'Live console', 'Community modules'],
    cta: 'Start free',
    featured: false,
  },
  {
    name: 'Operator',
    price: '$24',
    unit: '/mo',
    note: 'For serious fleets',
    features: ['Up to 100 bots', 'Unlimited proxies', 'Script engine + hot reload', 'Schedules and jobs', 'Multi-user workspace', 'Priority support'],
    cta: 'Launch console',
    featured: true,
  },
  {
    name: 'Fleet',
    price: 'Custom',
    note: 'For teams at scale',
    features: ['Unlimited workers', 'Dedicated shards', 'SSO and audit log', 'Custom modules', 'Onboarding engineer'],
    cta: 'Talk to us',
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="relative border-y border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <SectionHead
          eyebrow="Pricing"
          title="Simple, honest tiers."
          sub="No seat maths, no surprise overages. Scale the fleet, not the invoice."
          align="center"
        />

        <div className="mt-16 grid gap-3 lg:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal
              key={plan.name}
              delay={i * 90}
              className={cn(
                'relative flex flex-col rounded-[22px] border p-8 transition-all duration-500 [transition-timing-function:var(--ease-ios)]',
                plan.featured
                  ? 'border-white/25 bg-white/[0.06] shadow-[0_40px_100px_-40px_rgba(255,255,255,.2)] backdrop-blur-2xl lg:-my-4 lg:py-12'
                  : 'border-white/[0.08] bg-white/[0.015] backdrop-blur-xl hover:border-white/20'
              )}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-8 rounded-full bg-white px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-black">
                  Most popular
                </span>
              )}

              <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-white/40">{plan.name}</p>

              <p className="mt-6 flex items-baseline gap-1">
                <span className="display text-[52px] text-white">{plan.price}</span>
                {plan.unit && <span className="text-[15px] text-white/30">{plan.unit}</span>}
              </p>
              <p className="mt-2.5 text-[13px] text-white/35">{plan.note}</p>

              <ul className="mt-9 flex-1 space-y-3.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-[13px] text-white/55">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/50" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href="/login"
                className={cn(
                  'mt-10 inline-flex h-11 items-center justify-center gap-2 rounded-xl text-[13px] font-medium transition-all duration-300 [transition-timing-function:var(--ease-ios)] active:scale-[.97]',
                  plan.featured
                    ? 'sheen bg-white text-black hover:bg-white/90'
                    : 'border border-white/12 bg-white/[0.05] text-white hover:border-white/30 hover:bg-white/[0.1]'
                )}
              >
                {plan.cta}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- FAQ ---------------------------- */

const FAQS = [
  {
    q: 'What exactly does NativeLaunch run?',
    a: 'NativeLaunch is a control plane for headless Minecraft clients. Each bot forks as an isolated Node process with its own credentials, proxy route, module set and log buffer, supervised by a single control service.',
  },
  {
    q: 'How are proxies handled?',
    a: 'You register SOCKS5 endpoints in the network page. NativeLaunch health-checks them on demand or in bulk, then assigns workers automatically with a hard ceiling of three bots per endpoint so no single route gets saturated.',
  },
  {
    q: 'Can multiple people share a workspace?',
    a: 'Yes. Users have roles, and every bot, script, alias and schedule is scoped to a workspace. Admins see the users page and can reassign ownership of any worker.',
  },
  {
    q: 'Is the console really real time?',
    a: 'Everything streams over server-sent events. Fleet-level status, per-bot logs, inventory refreshes and job results all push to the browser without polling. The client keeps the last 1,200 log lines per bot.',
  },
  {
    q: 'Do I need to restart bots to change behaviour?',
    a: 'No. Modules toggle live, aliases sync instantly and behaviour scripts hot-reload across the fleet. Restarts are reserved for credential or target-server changes.',
  },
];

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
      <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr]">
        <SectionHead
          eyebrow="Questions"
          title={<>Answers,<br /><span className="text-white/25">no fluff.</span></>}
        />

        <div className="divide-y divide-white/[0.07] border-y border-white/[0.07]">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={item.q} delay={i * 60}>
                <button
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  className="group flex w-full items-start gap-6 py-6 text-left"
                >
                  <span className="flex-1 text-[17px] font-medium tracking-[-0.02em] text-white/85 transition-colors duration-300 group-hover:text-white">
                    {item.q}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all duration-500 [transition-timing-function:var(--ease-ios)]',
                      isOpen ? 'rotate-180 border-white bg-white text-black' : 'border-white/12 text-white/40 group-hover:border-white/30'
                    )}
                  >
                    {isOpen ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  </span>
                </button>
                <div
                  className="grid transition-all duration-700 [transition-timing-function:var(--ease-expo)]"
                  style={{ gridTemplateRows: isOpen ? '1fr' : '0fr', opacity: isOpen ? 1 : 0 }}
                >
                  <div className="overflow-hidden">
                    <p className="pb-7 pr-14 text-[14px] leading-relaxed text-white/45">{item.a}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
