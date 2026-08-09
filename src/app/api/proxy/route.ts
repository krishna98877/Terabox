import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { getProxyStatus, refreshProxyPool, setCustomProxies, clearProxyPool } from '@/lib/proxy';

/**
 * GET /api/proxy — Get proxy pool status
 */
export async function GET() {
  try {
    const status = getProxyStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/proxy — Manage proxy pool
 * Body: { action: 'refresh' | 'clear' | 'add', proxies?: string[] }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action as string;

    if (action === 'refresh') {
      const result = await refreshProxyPool();
      return NextResponse.json({ message: 'Proxy pool refreshed', ...result });
    }

    if (action === 'clear') {
      clearProxyPool();
      return NextResponse.json({ message: 'Proxy pool cleared' });
    }

    if (action === 'add') {
      const proxies = body.proxies as string[];
      if (!Array.isArray(proxies) || proxies.length === 0) {
        return NextResponse.json({ error: 'proxies array required' }, { status: 400 });
      }
      setCustomProxies(proxies);
      return NextResponse.json({ message: `Added ${proxies.length} custom proxies` });
    }

    return NextResponse.json({ error: 'Invalid action. Use: refresh, clear, add' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
