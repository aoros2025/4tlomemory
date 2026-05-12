export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { MemoryStore } from '../../../../lib/runMemory.js';

export async function GET(req, { params }) {
  try {
    const store = new MemoryStore();
    const data = store.getSession(params.id);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}

export async function POST(req, { params }) {
  try {
    const store = new MemoryStore();
    const session = store.endSession(params.id);
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
