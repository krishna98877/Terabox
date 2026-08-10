import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import {
  startKeepAlive,
  stopKeepAlive,
  getKeepAliveStatus,
  manualPing,
  isKeepAliveRunning,
} from '@/lib/keepalive';

/**
 * GET /api/keepalive — Get keep-alive status
 * POST /api/keepalive — Control keep-alive system
 *   { action: 'start' | 'stop' | 'ping' | 'restart', intervalMs?: number }
 */
export async function GET() {
  try {
    const status = getKeepAliveStatus();
    return NextResponse.json({
      keepAlive: status,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action as string;

    switch (action) {
      case 'start': {
        const intervalMs = body.intervalMs as number | undefined;
        const result = startKeepAlive(intervalMs);
        return NextResponse.json({
          action: 'start',
          ...result,
          status: getKeepAliveStatus(),
        });
      }

      case 'stop': {
        const result = stopKeepAlive();
        return NextResponse.json({
          action: 'stop',
          ...result,
          status: getKeepAliveStatus(),
        });
      }

      case 'restart': {
        stopKeepAlive();
        const intervalMs = body.intervalMs as number | undefined;
        const result = startKeepAlive(intervalMs);
        return NextResponse.json({
          action: 'restart',
          ...result,
          status: getKeepAliveStatus(),
        });
      }

      case 'ping': {
        const result = await manualPing();
        return NextResponse.json({
          action: 'ping',
          ...result,
          status: getKeepAliveStatus(),
        });
      }

      default:
        return NextResponse.json({
          error: 'Invalid action. Use: start, stop, restart, ping',
          isRunning: isKeepAliveRunning(),
        }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
