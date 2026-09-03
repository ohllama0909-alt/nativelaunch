import './globals.css';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata = {
  title: {
    default: 'NativeLaunch - Infrastructure for autonomous fleets',
    template: '%s / NativeLaunch',
  },
  description:
    'NativeLaunch is the control plane for autonomous Minecraft fleets. Deploy, orchestrate and observe hundreds of bots from one obsessively designed dashboard.',
  keywords: ['bot hosting', 'automation', 'control panel', 'fleet orchestration'],
  openGraph: {
    title: 'NativeLaunch - Infrastructure for autonomous fleets',
    description: 'Deploy, orchestrate and observe hundreds of bots from one control plane.',
    type: 'website',
  },
};

export const viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
