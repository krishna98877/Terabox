import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { diagnoseError, isGroqConfigured } from '@/lib/groq';

// POST /api/ai/diagnose — Get AI-powered error diagnosis
export async function POST(request: Request) {
  try {
    if (!isGroqConfigured()) {
      return NextResponse.json({ error: 'Groq API key not configured' }, { status: 400 });
    }

    const body = await request.json();
    const { errorMessage, context } = body;

    if (!errorMessage) {
      return NextResponse.json({ error: 'errorMessage is required' }, { status: 400 });
    }

    const diagnosis = await diagnoseError(errorMessage, context || '');
    return NextResponse.json({ diagnosis });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
