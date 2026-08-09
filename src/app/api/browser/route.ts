import { NextResponse } from 'next/server';
import { isBrowserAvailable } from '@/lib/browser';

export const dynamic = 'force-dynamic';

// GET /api/browser — Check if Playwright browser automator is available
export async function GET() {
  try {
    const available = await isBrowserAvailable();
    return NextResponse.json({ available });
  } catch {
    return NextResponse.json({ available: false });
  }
}
