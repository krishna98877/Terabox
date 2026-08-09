import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { getDashboardStats } from '@/lib/automation';

// GET /api/stats — Dashboard statistics
export async function GET() {
  try {
    const stats = await getDashboardStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
