export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { MemoryStore } from '../../../lib/runMemory.js';

export async function GET() {
  try {
    const store = new MemoryStore();
    return NextResponse.json({ sessions: store.getAllSessions() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const store = new MemoryStore();
    const session = store.createSession(body.label || '');
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
