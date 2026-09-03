'use client';

import { Children, cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { cn } from '@/lib/api';
import { Button, Checkbox, Modal } from '@/components/ui';

/** Label + control. Wrapping in <label> keeps the hit target honest. */
export function Field({ label, hint, children, className }) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || fieldId,
        'aria-labelledby': children.props['aria-labelledby'] || (label ? labelId : undefined),
      })
    : children;
  return (
    <div className={cn('block', className)}>
      {label ? <span id={labelId} className="field-label">{label}</span> : null}
      {control}
      {hint ? <span className="mt-1.5 block text-[11px] leading-relaxed text-white/30">{hint}</span> : null}
    </div>
  );
}

export function Input({ className, ...props }) {
  return <input className={cn('field-control', className)} {...props} />;
}

export function Textarea({ className, rows = 5, ...props }) {
  return <textarea rows={rows} className={cn('field-control resize-y font-mono text-[12px]', className)} {...props} />;
}

/**
 * Accessible custom listbox used by every dashboard dropdown.
 *
 * It deliberately keeps the familiar Select API: existing callers can pass
 * <option> children and read event.target.value from onChange. The menu is
 * portalled to the document so it is never clipped by a table or modal.
 */
export function Select({ className, children, value, defaultValue, onChange, disabled, name, ...props }) {
  const options = useMemo(() => Children.toArray(children)
    .filter((child) => isValidElement(child) && child.type === 'option')
    .map((child) => ({
      value: String(child.props.value ?? child.props.children ?? ''),
      label: child.props.children,
      disabled: !!child.props.disabled,
    })), [children]);
  const [internalValue, setInternalValue] = useState(() => String(defaultValue ?? options[0]?.value ?? ''));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const listboxId = useId();
  const currentValue = String(value !== undefined ? value : internalValue);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === currentValue));
  const selected = options[selectedIndex] || options[0];

  const positionMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 7;
    const estimatedHeight = Math.min(300, options.length * 43 + 12);
    const openAbove = window.innerHeight - rect.bottom < estimatedHeight + gap && rect.top > estimatedHeight;
    setMenuStyle({
      position: 'fixed',
      zIndex: 120,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      top: openAbove ? Math.max(8, rect.top - estimatedHeight - gap) : rect.bottom + gap,
      width: rect.width,
      maxHeight: Math.min(300, openAbove ? rect.top - 16 : window.innerHeight - rect.bottom - 16),
    });
  };

  const openMenu = () => {
    if (disabled || !options.length) return;
    setActiveIndex(selectedIndex);
    positionMenu();
    setOpen(true);
  };

  const choose = (option) => {
    if (!option || option.disabled) return;
    if (value === undefined) setInternalValue(option.value);
    onChange?.({ target: { value: option.value, name }, currentTarget: { value: option.value, name } });
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const move = (direction) => {
    if (!options.length) return;
    let next = activeIndex;
    do { next = (next + direction + options.length) % options.length; }
    while (options[next]?.disabled && next !== activeIndex);
    setActiveIndex(next);
    window.requestAnimationFrame(() => menuRef.current?.querySelector(`[data-option-index="${next}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      else move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' && open) { event.preventDefault(); setActiveIndex(0); return; }
    if (event.key === 'End' && open) { event.preventDefault(); setActiveIndex(options.length - 1); return; }
    if ((event.key === 'Enter' || event.key === ' ') && open) { event.preventDefault(); choose(options[activeIndex]); return; }
    if ((event.key === 'Enter' || event.key === ' ') && !open) { event.preventDefault(); openMenu(); return; }
    if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); }
  };

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const reposition = () => positionMenu();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, options.length]);

  return (
    <span className="relative block">
      {name ? <input type="hidden" name={name} value={currentValue} /> : null}
      <button
        {...props}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'field-control flex min-h-10 items-center justify-between gap-3 pr-3 text-left disabled:cursor-not-allowed disabled:opacity-45',
          open && 'border-white/40 bg-white/[0.07] ring-4 ring-white/[0.06]',
          className
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', selected ? 'text-white' : 'text-white/25')}>
          {selected?.label ?? 'Select an option'}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-white/30 transition-transform duration-300', open && 'rotate-180 text-white/65')} />
      </button>

      {open && menuStyle && typeof document !== 'undefined' ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-activedescendant={`${listboxId}-${activeIndex}`}
          style={menuStyle}
          className="console-scrollbar anim-scale overflow-y-auto rounded-xl border border-white/15 bg-[#0a0a0a]/95 p-1.5 shadow-[0_24px_80px_rgba(0,0,0,.95)] backdrop-blur-2xl"
        >
          {options.map((option, index) => {
            const isSelected = option.value === currentValue;
            const isActive = index === activeIndex;
            return (
              <button
                key={`${option.value}-${index}`}
                id={`${listboxId}-${index}`}
                data-option-index={index}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(option)}
                className={cn(
                  'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-150',
                  isActive ? 'bg-white/[0.10] text-white' : 'text-white/55',
                  option.disabled && 'cursor-not-allowed opacity-30'
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <Check className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
              </button>
            );
          })}
        </div>,
        document.body
      ) : null}
    </span>
  );
}

export function Toolbar({ children, className }) {
  return <div className={cn('flex flex-wrap items-center gap-2.5', className)}>{children}</div>;
}

export function Pill({ children, tone = 'default', className }) {
  const tones = {
    default: 'border-white/[0.09] bg-white/[0.04] text-white/55',
    strong: 'border-white/25 bg-white/[0.10] text-white',
    quiet: 'border-white/[0.07] bg-transparent text-white/35',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.11em]',
        tones[tone] || tones.default,
        className
      )}
    >
      {children}
    </span>
  );
}

export function LiveDot({ live, label = 'Live' }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.11em] text-white/35">
      <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-white anim-pulse' : 'bg-white/25')} />
      {live ? label : 'Offline'}
    </span>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p className="rounded-xl border border-white/25 bg-white/[0.07] px-4 py-3 text-[13px] leading-relaxed text-white">
      {children}
    </p>
  );
}

export function SectionTitle({ title, description, actions }) {
  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.07] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-[15px] font-medium tracking-[-0.02em] text-white">{title}</h2>
        {description ? <p className="mt-1 text-[12px] leading-relaxed text-white/35">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function KeyValue({ rows }) {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .filter(Boolean)
    .map((row) => (Array.isArray(row) ? row : [row.label, row.value]));

  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.08] sm:grid-cols-2">
      {normalizedRows.map(([label, value]) => (
        <div key={label} className="bg-black px-4 py-3">
          <dt className="text-[10px] uppercase tracking-[0.13em] text-white/30">{label}</dt>
          <dd className="mt-1 truncate text-[13px] text-white/80">
            {value === null || value === undefined || value === '' ? '--' : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CopyValue({ value, className }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-white/25">--</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (_) {
      /* clipboard blocked - the value stays visible either way */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy"
      className={cn(
        'group inline-flex max-w-full items-center gap-2 text-left font-mono text-[12px] text-white/70 transition hover:text-white',
        className
      )}
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-white" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-60" />
      )}
    </button>
  );
}

export function Meter({ value, total, label }) {
  const percent = total ? Math.min(100, Math.round((Number(value) / Number(total)) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-white/40">
        <span>{label}</span>
        <span className="tnum">
          {value}/{total}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-white transition-all duration-700"
          style={{ width: `${percent}%`, transitionTimingFunction: 'var(--ease-ios)' }}
        />
      </div>
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  loading,
  onConfirm,
  onClose,
  children,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children || <p className="text-[13px] leading-relaxed text-white/45">This action cannot be undone.</p>}
    </Modal>
  );
}

/** Multi-select over the visible roster - used by schedules, scripts, mass commands. */
export function BotPicker({ bots, value, onChange, emptyLabel = 'No bots available to this account.' }) {
  const selected = new Set(value || []);

  const toggle = (id, checked) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange([...next]);
  };

  if (!bots.length) {
    return (
      <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[13px] text-white/35">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.11em] text-white/35">{selected.size} selected</span>
        <span className="flex gap-3">
          <button
            type="button"
            onClick={() => onChange(bots.map((bot) => bot.id))}
            className="text-[11px] text-white/40 transition hover:text-white"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] text-white/40 transition hover:text-white"
          >
            None
          </button>
        </span>
      </div>
      <div className="console-scrollbar max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {bots.map((bot) => (
          <Checkbox
            key={bot.id}
            checked={selected.has(bot.id)}
            onChange={(checked) => toggle(bot.id, checked)}
            label={(bot.config && bot.config.username) || bot.id}
            description={`${bot.id} · ${bot.status || 'stopped'}`}
          />
        ))}
      </div>
    </div>
  );
}
