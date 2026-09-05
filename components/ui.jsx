'use client';

import { useEffect } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { cn } from '@/lib/api';

/* ------------------------------------------------------------------
   NativeLaunch Monochrome primitives.
   Public API is unchanged - every dashboard page inherits the
   new glass/iOS language without markup edits.
   ------------------------------------------------------------------ */

export function Button({ children, variant = 'secondary', size = 'md', className, loading, disabled, ...props }) {
  const variants = {
    primary: 'sheen border-white bg-white text-black shadow-[0_10px_36px_-10px_rgba(255,255,255,.5)] hover:bg-white/90 active:scale-[.97]',
    secondary: 'border-white/12 bg-white/[0.06] text-white backdrop-blur-xl hover:border-white/25 hover:bg-white/[0.11] active:scale-[.97]',
    ghost: 'border-transparent bg-transparent text-white/45 hover:bg-white/[0.07] hover:text-white active:scale-[.97]',
    danger: 'border-white/25 bg-white/[0.04] text-white hover:border-white hover:bg-white hover:text-black active:scale-[.97]',
    success: 'border-white/15 bg-white/[0.08] text-white hover:bg-white/[0.14] active:scale-[.97]',
  };
  const sizes = {
    sm: 'h-8 gap-1.5 rounded-[10px] px-3 text-xs',
    md: 'h-10 gap-2 rounded-xl px-4 text-[13px]',
    lg: 'h-12 gap-2 rounded-xl px-6 text-sm',
  };
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center border font-medium tracking-[-0.01em] transition-all duration-300 [transition-timing-function:var(--ease-ios)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoaderCircle className="h-4 w-4 anim-spin" />}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...props }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/50 backdrop-blur-xl transition-all duration-300 [transition-timing-function:var(--ease-ios)] hover:border-white/25 hover:bg-white/[0.11] hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="anim-rise relative flex flex-col gap-5 border-b border-white/[0.07] pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="relative min-w-0">
        {eyebrow && (
          <p className="eyebrow mb-2.5 flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/50 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            {eyebrow}
          </p>
        )}
        <h1 className="display text-grad text-[32px] sm:text-[40px]">{title}</h1>
        {description && (
          <p className="mt-3.5 max-w-2xl text-[15px] leading-relaxed text-white/45">{description}</p>
        )}
      </div>
      {actions && <div className="relative flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

export function Panel({ children, className }) {
  return <section className={cn('panel-surface', className)}>{children}</section>;
}

export function StatCard({ label, value, hint, icon, tone = 'default' }) {
  const dots = {
    default: 'bg-white/25',
    blue: 'bg-white/70',
    green: 'bg-white shadow-[0_0_10px_rgba(255,255,255,.85)]',
    red: 'bg-white anim-pulse',
    amber: 'bg-white/50',
  };
  return (
    <Panel className="group relative flex min-h-32 items-start justify-between overflow-hidden p-5 transition-transform duration-500 [transition-timing-function:var(--ease-ios)] hover:-translate-y-0.5">
      <span className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <span className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-white/[0.06] blur-2xl opacity-0 transition-opacity duration-700 group-hover:opacity-100" />
      <div className="relative min-w-0">
        <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dots[tone] || dots.default, tone === 'green' && 'shadow-[0_0_8px_rgba(255,255,255,.9)]', tone === 'red' && 'shadow-[0_0_8px_rgba(255,255,255,.7)]')} />
          <span className="truncate">{label}</span>
        </p>
        <p className="tnum mt-3.5 text-[32px] font-semibold leading-none tracking-[-0.045em] text-white">{value}</p>
        {hint && <p className="mt-2.5 truncate text-xs text-white/35">{hint}</p>}
      </div>
      {icon && (
        <span className="relative shrink-0 rounded-xl border border-white/[0.09] bg-white/[0.04] p-2.5 text-white/40 transition-all duration-500 [transition-timing-function:var(--ease-ios)] group-hover:border-white/25 group-hover:bg-white/[0.08] group-hover:text-white group-hover:shadow-[0_0_18px_-4px_rgba(255,255,255,.35)]">
          {icon}
        </span>
      )}
    </Panel>
  );
}

export function StatusBadge({ status }) {
  const normalized = String(status || 'stopped').toLowerCase();
  const tones = {
    running: { wrap: 'border-white/25 bg-white/[0.10] text-white', dot: 'bg-white shadow-[0_0_9px_rgba(255,255,255,.9)]' },
    online: { wrap: 'border-white/25 bg-white/[0.10] text-white', dot: 'bg-white shadow-[0_0_9px_rgba(255,255,255,.9)]' },
    done: { wrap: 'border-white/25 bg-white/[0.10] text-white', dot: 'bg-white' },
    stopped: { wrap: 'border-white/[0.09] bg-white/[0.03] text-white/40', dot: 'bg-white/30' },
    offline: { wrap: 'border-white/[0.09] bg-white/[0.03] text-white/40', dot: 'bg-white/30' },
    cancelled: { wrap: 'border-white/[0.09] bg-white/[0.03] text-white/40', dot: 'bg-white/30' },
    pending: { wrap: 'border-white/15 bg-white/[0.05] text-white/65', dot: 'bg-white/60 anim-pulse' },
    partial: { wrap: 'border-white/15 bg-white/[0.05] text-white/65', dot: 'bg-white/60' },
    running_job: { wrap: 'border-white/25 bg-white/[0.10] text-white', dot: 'bg-white anim-pulse' },
    error: { wrap: 'border-white/40 bg-white/[0.07] text-white', dot: 'bg-white anim-ring' },
    failed: { wrap: 'border-white/40 bg-white/[0.07] text-white', dot: 'bg-white anim-ring' },
  };
  const tone = tones[normalized] || tones.stopped;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.11em] backdrop-blur-xl', tone.wrap)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
      {normalized.replace('_', ' ')}
    </span>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="anim-fade flex min-h-64 flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="anim-float mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-white/35 backdrop-blur-xl">
          {icon}
        </div>
      )}
      <h3 className="text-[17px] font-medium tracking-[-0.02em] text-white">{title}</h3>
      {description && <p className="mt-2.5 max-w-md text-sm leading-relaxed text-white/40">{description}</p>}
      {action && <div className="mt-7">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="anim-fade fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-5"
      onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'anim-scale max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-[26px] border border-white/12 bg-[#0b0b0b]/95 shadow-[0_-20px_80px_rgba(0,0,0,.9)] backdrop-blur-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-[22px] sm:shadow-[0_40px_120px_rgba(0,0,0,.95)]',
          wide ? 'max-w-3xl' : 'max-w-lg'
        )}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/[0.07] bg-[#0b0b0b]/85 px-6 py-5 backdrop-blur-2xl">
          <div className="min-w-0">
            <h2 id="modal-title" className="text-[17px] font-medium tracking-[-0.02em] text-white">{title}</h2>
            {description && <p className="mt-1.5 text-[13px] leading-relaxed text-white/40">{description}</p>}
          </div>
          <IconButton label="Close" className="h-8 w-8 shrink-0 rounded-lg" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="p-6">{children}</div>
        {footer && (
          <div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2.5 border-t border-white/[0.07] bg-[#0b0b0b]/92 px-6 py-4 backdrop-blur-2xl">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-4">
      <span className="relative flex h-9 w-9">
        <span className="absolute inset-0 rounded-full border border-white/10" />
        <span className="anim-spin absolute inset-0 rounded-full border border-transparent border-t-white" />
      </span>
      <span className="text-xs uppercase tracking-[0.16em] text-white/35">{label}</span>
    </div>
  );
}

export function Tabs({ items, value, onChange }) {
  return (
    <div className="flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1 backdrop-blur-xl">
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative whitespace-nowrap rounded-xl px-4 py-2 text-xs font-medium transition-all duration-500 [transition-timing-function:var(--ease-ios)]',
              active ? 'bg-white text-black shadow-[0_4px_16px_rgba(0,0,0,.5)]' : 'text-white/40 hover:bg-white/[0.06] hover:text-white/80'
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, description, disabled }) {
  const compact = !label && !description;
  return (
    <label
      aria-label={compact ? 'Select row' : undefined}
      className={cn(
        'flex cursor-pointer items-start transition-all duration-300 [transition-timing-function:var(--ease-ios)]',
        compact ? 'inline-flex rounded-md border-transparent p-0.5' : 'gap-3 rounded-xl border p-3.5',
        !compact && (checked ? 'border-white/25 bg-white/[0.07]' : 'border-white/[0.08] bg-white/[0.02]'),
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-white/20 hover:bg-white/[0.06]'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-all duration-300 [transition-timing-function:var(--ease-ios)]',
          checked ? 'border-white bg-white' : 'border-white/25 bg-transparent'
        )}
      >
        <svg viewBox="0 0 12 12" className={cn('h-2.5 w-2.5 transition-transform duration-300', checked ? 'scale-100' : 'scale-0')} fill="none">
          <path d="M1.5 6.2 4.4 9l6-6.4" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="sr-only"
      />
      {!compact && <span className="min-w-0">
        <span className="block text-[13px] font-medium text-white/90">{label}</span>
        {description && <span className="mt-1 block text-xs leading-relaxed text-white/35">{description}</span>}
      </span>}
    </label>
  );
}
