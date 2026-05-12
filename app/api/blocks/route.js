export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { MemoryStore, createBlock } from '../../../lib/runMemory.js';

export async function POST(req) {
  try {
    const body = await req.json();
    if (!body.session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    const store = new MemoryStore();
    const block = createBlock(body);
    store.addBlock(block);
    return NextResponse.json(block);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
