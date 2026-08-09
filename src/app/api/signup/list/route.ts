import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';

// GET /api/signup/list — List all signup records
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const status = searchParams.get('status');

    const where = status ? { status } : {};

    const [records, total] = await Promise.all([
      db.signupRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          email: true,
          referralLink: true,
          status: true,
          verificationCode: true,
          verificationLink: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.signupRecord.count({ where }),
    ]);

    return NextResponse.json({ records, total });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
