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
};

export default nextConfig;
