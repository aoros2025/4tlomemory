export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { MemoryStore, computeRunPatterns, RunMemoryAI } from '../../../lib/runMemory.js';

export async function GET() {
  try {
    const store = new MemoryStore();
    const blocks = store.allBlocks;
    const computed = computeRunPatterns(blocks);

    if (blocks.length >= 5) {
      const ai = new RunMemoryAI();
      computed.synthesis = await ai.synthesizePatterns(blocks, computed);
    }

    return NextResponse.json(computed);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
