import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';

// GET /api/config — Get referral config
export async function GET() {
  try {
    let config = await db.referralConfig.findFirst();
    if (!config) {
      config = await db.referralConfig.create({
        data: {
          masterLink: '',
          isActive: true,
          autoSignup: false,
          signupInterval: 30,
          maxSignupsPerDay: 50,
        },
      });
    }
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// PATCH /api/config — Update referral config
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    let config = await db.referralConfig.findFirst();

    if (!config) {
      config = await db.referralConfig.create({
        data: {
          masterLink: body.masterLink || '',
          isActive: body.isActive ?? true,
          autoSignup: body.autoSignup ?? false,
          signupInterval: body.signupInterval ?? 30,
          maxSignupsPerDay: body.maxSignupsPerDay ?? 50,
        },
      });
    } else {
      config = await db.referralConfig.update({
        where: { id: config.id },
        data: {
          ...(body.masterLink !== undefined && { masterLink: body.masterLink }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.autoSignup !== undefined && { autoSignup: body.autoSignup }),
          ...(body.signupInterval !== undefined && { signupInterval: body.signupInterval }),
          ...(body.maxSignupsPerDay !== undefined && { maxSignupsPerDay: body.maxSignupsPerDay }),
        },
      });
    }

    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
