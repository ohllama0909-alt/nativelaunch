'use client';

/**
 * Deep link to a single bot.
 *
 * The split view at /bots is the primary way in, but direct links from the
 * overview, activity, and schedules pages need a standalone route. Both render
 * the same BotWorkspace, so there is only one implementation to maintain.
 */

import { useParams } from 'next/navigation';
import { BotWorkspace } from '@/components/bot-workspace';

export default function BotDetailPage() {
  const params = useParams();
  const botId = decodeURIComponent(String(params.id || ''));

  return <BotWorkspace botId={botId} backHref="/bots" />;
}
