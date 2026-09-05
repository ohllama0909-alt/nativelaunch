'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bot, CheckCircle2, ChevronDown, ChevronUp, Radio, Send, X } from 'lucide-react';
import { useAuth } from '@/components/providers';
import { useFleet } from '@/lib/hooks';
import { cn } from '@/lib/api';

export function FloatingIndicator({ onOpenBroadcast }) {
  const { user } = useAuth();
  const { bots, activeJob } = useFleet();
  const [dismissedJobId, setDismissedJobId] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const isAdmin = user?.role === 'admin';

  const runningBots = useMemo(() => bots.filter((b) => b.status === 'running'), [bots]);
  const hasRunning = runningBots.length > 0;

  // Show active broadcast if running, or if completed within the last 25 seconds
  const currentJob = useMemo(() => {
    if (!activeJob) return null;
    if (activeJob.id === dismissedJobId) return null;
    if (activeJob.status === 'running') return activeJob;
    if (activeJob.status === 'done' && activeJob.finishedAt) {
      const elapsed = Date.now() - new Date(activeJob.finishedAt).getTime();
      if (elapsed < 25000) return activeJob;
    }
    return null;
  }, [activeJob, dismissedJobId]);

  // Auto-dismiss completed job after 20s
  useEffect(() => {
    if (currentJob && currentJob.status === 'done') {
      const timer = setTimeout(() => {
        setDismissedJobId(currentJob.id);
      }, 20000);
      return () => clearTimeout(timer);
    }
  }, [currentJob]);

  const jobProgressPct = useMemo(() => {
    if (!currentJob || !currentJob.total) return 0;
    return Math.min(100, Math.round((currentJob.done / currentJob.total) * 100));
  }, [currentJob]);

  const staggerSecLabel = useMemo(() => {
    if (!currentJob || !currentJob.staggerMs) return 'instant';
    const sec = currentJob.staggerMs / 1000;
    return `${sec.toFixed(sec % 1 === 0 ? 0 : 1)}s delay`;
  }, [currentJob]);

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2 text-xs select-none">
      {/* Expanded Details Popover */}
      {expanded ? (
        <div className="w-80 rounded-2xl border border-white/[0.12] bg-[#0c0d10]/95 p-4 shadow-2xl backdrop-blur-2xl anim-slide-in">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-white/80" />
              <span className="font-semibold text-white">Live Fleet Status</span>
            </div>
            <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-medium text-white/60">
              {runningBots.length} of {bots.length} running{!isAdmin ? ` (${bots.length}/10 quota)` : ''}
            </span>
          </div>

          <div className="mt-3 max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {runningBots.length === 0 ? (
              <p className="py-2 text-center text-white/35">No bots are currently online.</p>
            ) : (
              runningBots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5 border border-white/[0.04]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
                    <span className="truncate font-medium text-white/85">
                      {bot.config?.username || bot.id}
                    </span>
                  </div>
                  {bot.shards !== null && bot.shards !== undefined ? (
                    <span className="font-mono text-[11px] text-white/70">
                      {Number(bot.shards).toLocaleString()}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-white/30">{bot.status}</span>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-white/[0.08] flex items-center justify-between">
            <Link
              href="/bots"
              onClick={() => setExpanded(false)}
              className="text-[11px] text-white/50 hover:text-white transition"
            >
              View all bots →
            </Link>
            {onOpenBroadcast && hasRunning ? (
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  onOpenBroadcast();
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-white/[0.10] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/[0.18] transition"
              >
                <Send className="h-3 w-3" />
                <span>Broadcast</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Main Floating Capsule */}
      <div className="group flex items-center gap-2 rounded-2xl border border-white/[0.14] bg-[#0c0d10]/90 px-3.5 py-2 shadow-2xl backdrop-blur-2xl transition hover:border-white/25 hover:bg-[#0c0d10]">
        {/* Left: Running Bots Count */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          title="Click to view running bots"
          className="flex items-center gap-2 pr-1 text-left transition hover:opacity-90"
        >
          <span className="relative flex h-2.5 w-2.5">
            {hasRunning ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
              </>
            ) : (
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-white/20" />
            )}
          </span>
          <span className="font-medium text-white">
            {runningBots.length}
            <span className="text-white/40 font-normal">/{bots.length} running{!isAdmin ? ' (max 10)' : ''}</span>
          </span>
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-white/40" />
          ) : (
            <ChevronUp className="h-3 w-3 text-white/40 group-hover:text-white/70 transition" />
          )}
        </button>

        {/* Right: Broadcast Progress (when active or recent) */}
        {currentJob ? (
          <div className="flex items-center gap-2.5 border-l border-white/[0.12] pl-3">
            <div className="flex flex-col gap-1 min-w-[140px] max-w-[210px]">
              <div className="flex items-center justify-between gap-1 text-[11px]">
                <span className="flex items-center gap-1 font-semibold text-white truncate">
                  {currentJob.status === 'running' ? (
                    <>
                      <Radio className="h-3 w-3 text-white animate-pulse shrink-0" />
                      <span className="text-white/80 truncate">Broadcast:</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-white shrink-0" />
                      <span className="text-white/85">Broadcast done:</span>
                    </>
                  )}
                  <span className="font-mono text-white/90 truncate max-w-[80px]" title={currentJob.cmd}>
                    {currentJob.cmd}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-white/60">
                  {currentJob.done}/{currentJob.total}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className={cn(
                    'h-full transition-all duration-300 rounded-full',
                    currentJob.status === 'running'
                      ? 'bg-gradient-to-r from-white/50 to-white'
                      : 'bg-white'
                  )}
                  style={{ width: `${jobProgressPct}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[9px] text-white/40 leading-none">
                <span>{jobProgressPct}% completed</span>
                <span>{staggerSecLabel}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setDismissedJobId(currentJob.id)}
              title="Dismiss broadcast notification"
              className="rounded p-0.5 text-white/30 hover:bg-white/[0.08] hover:text-white transition"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
