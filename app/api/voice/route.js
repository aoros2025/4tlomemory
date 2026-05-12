export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { RunMemoryAI } from '../../../lib/runMemory.js';

export async function POST(req) {
  try {
    const { transcript } = await req.json();
    if (!transcript?.trim()) return NextResponse.json({ error: 'transcript required' }, { status: 400 });
    const ai = new RunMemoryAI();
    const parsed = await ai.parseVoice(transcript);
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
