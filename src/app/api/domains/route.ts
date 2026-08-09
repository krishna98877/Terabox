import { NextResponse } from 'next/server';
import { getDomains } from '@/lib/mailtm';

// GET /api/domains — Available mail.tm domains
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const domains = await getDomains();
    console.log('[API /domains] Found domains:', domains.length, domains.map(d => d.domain));
    return NextResponse.json({ domains });
  } catch (error) {
    console.error('[API /domains] Error:', (error as Error).message);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
