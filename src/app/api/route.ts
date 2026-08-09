import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * Root API route — lightweight health marker.
 * Also serves as a keep-alive ping target.
 */
export async function GET() {
  return NextResponse.json({
    message: "TeraBox Referral Agent",
    status: "running",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "/api/health",
      init: "/api/init",
      keepalive: "/api/keepalive",
      scheduler: "/api/scheduler",
      config: "/api/config",
      stats: "/api/stats",
      proxy: "/api/proxy",
    },
  });
}
