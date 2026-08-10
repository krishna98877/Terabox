import { NextResponse } from 'next/server';
import { getDomains } from '@/lib/catchmail';

// GET /api/domains — Available catchmail.io domains
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const domains = await getDomains();
    console.log('[API /domains] Domains:', domains);
    return NextResponse.json({ domains });
  } catch (error) {
    console.error('[API /domains] Error:', (error as Error).message);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
