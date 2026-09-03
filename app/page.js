import { LandingNav } from '@/components/landing/landing-nav';
import { LandingFooter } from '@/components/landing/landing-footer';
import { Hero } from '@/components/landing/hero';
import {
  FeatureBento,
  Workflow,
  StatsBand,
  ModulesMarquee,
  Testimonials,
  Pricing,
  Faq,
} from '@/components/landing/sections';

export const metadata = {
  title: 'NativeLaunch - Infrastructure for autonomous fleets',
  description:
    'Deploy, orchestrate and observe hundreds of Minecraft bots from one obsessively designed control plane. Live consoles, proxy pools, hot-reloading scripts.',
};

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <LandingNav />
      <main>
        <Hero />
        <FeatureBento />
        <Workflow />
        <StatsBand />
        <ModulesMarquee />
        <Testimonials />
        <Pricing />
        <Faq />
      </main>
      <LandingFooter />
    </div>
  );
}
