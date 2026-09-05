import './globals.css';
import { Providers } from '@/components/providers';

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
