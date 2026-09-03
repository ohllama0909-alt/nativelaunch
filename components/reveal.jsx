'use client';

import { useEffect, useRef, useState, createElement } from 'react';

/**
 * Scroll-reveal primitive. Zero dependencies - uses IntersectionObserver and
 * the .reveal/.in classes defined in globals.css.
 */
export function Reveal({ children, delay = 0, as = 'div', className = '', once = true, ...rest }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShown(true);
            if (once) io.unobserve(entry.target);
          } else if (!once) {
            setShown(false);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return createElement(
    as,
    {
      ref,
      className: `reveal ${shown ? 'in' : ''} ${className}`.trim(),
      style: { '--d': `${delay}ms` },
      ...rest,
    },
    children
  );
}

/** Splits a string into per-word spans that rise in sequence. */
export function RevealWords({ text, className = '', delay = 0, step = 55 }) {
  const words = String(text).split(' ');
  return (
    <span className={className}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="inline-block overflow-hidden align-bottom">
          <span className="inline-block anim-rise" style={{ animationDelay: `${delay + i * step}ms` }}>
            {word}
            {i < words.length - 1 ? '\u00A0' : ''}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Infinite marquee row. Children are duplicated for a seamless loop. */
export function Marquee({ children, duration = 34, reverse = false, className = '' }) {
  return (
    <div className={`marquee-mask marquee-pause overflow-hidden ${className}`}>
      <div
        className="marquee-track"
        style={{
          '--dur': `${duration}s`,
          animationDirection: reverse ? 'reverse' : 'normal',
        }}
      >
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center" aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}
