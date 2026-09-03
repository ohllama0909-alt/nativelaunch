/** @type {import('next').NextConfig} */

// The panel runs as two processes: the API server (default 127.0.0.1:3000) and
// this Next app (127.0.0.1:3318). The browser calls /api/* on the Next origin,
// so in development those calls are proxied to the API server. In production
// both are served behind one reverse proxy, so no rewrite is applied.
const API_ORIGIN = process.env.NATIVELAUNCH_API_ORIGIN || 'http://127.0.0.1:3000';

const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/reload', destination: `${API_ORIGIN}/reload` },
    ];
  },
};

export default nextConfig;
