import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import {
  isPoolActive,
  getWorkerStates,
  getMaxWorkers,
  startPool,
  stopPool,
} from '@/lib/automation/scheduler';

// GET /api/scheduler — Check pool status + worker states
export async function GET() {
  return NextResponse.json({
    running: isPoolActive(),
    maxWorkers: getMaxWorkers(),
    workers: getWorkerStates(),
  });
}

// POST /api/scheduler — Start/stop the parallel worker pool
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action as 'start' | 'stop';

    if (action === 'start') {
      const result = await startPool();
      return NextResponse.json({
        running: isPoolActive(),
        workers: getWorkerStates(),
        message: result.message,
      });
    }

    if (action === 'stop') {
      const result = await stopPool();
      return NextResponse.json({
        running: isPoolActive(),
        workers: getWorkerStates(),
        message: result.message,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use "start" or "stop".' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
