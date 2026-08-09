import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Render-compatible config */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    'preview-chat-2b43e332-34b4-4755-aaca-c245b07a72c9.space-z.ai',
  ],
  // instrumentation.ts hook is auto-enabled in Next.js 16+
};

export default nextConfig;
