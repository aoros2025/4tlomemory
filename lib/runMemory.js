import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const MEMORY_PATH = '/tmp/4tlomemory_data.json';

const EMOTIONS = ['neutral', 'calm', 'focused', 'energized', 'anxious', 'tired', 'peaceful', 'joyful'];

const VOICE_PARSE_SCHEMA = `{
  "loose_zone": "short location name or empty string",
  "elevation_change": "flat|climbing|descending",
  "surface": "pavement|trail|grass|gravel|mixed",
  "pace": "easy|steady|pushing|sprint",
  "breath": "easy|controlled|heavy",
  "fatigue": "fresh|moderate|heavy",
  "light": "dawn|morning|midday|afternoon|dusk|night",
  "temperature": "cold|cool|mild|warm|hot",
  "sound": "description or empty string",
  "smell": "description or empty string",
  "trigger_type": "ambient|intentional",
  "trigger_note": "the note or observation or empty string",
  "weight": 5,
  "emotion": "neutral|calm|focused|energized|anxious|tired|peaceful|joyful"
}`;

const PATTERN_SYNTHESIS_SCHEMA = `{
  "sensory_narrative": "2-3 sentences on the dominant sensory patterns across runs — what environments, sounds, smells recur",
  "body_story": "2-3 sentences on body state patterns — when does the body feel strong vs heavy, what triggers effort",
  "pattern_loop": "the single most powerful recurring loop — the condition that reliably produces a specific body or emotional state",
  "next_focus": "one specific thing to pay attention to on the next run to deepen pattern awareness"
}`;

// ─── MEMORY STORE ─────────────────────────────────────────────────────────────

export class MemoryStore {
  constructor() {
    this._data = this._load();
  }

  _load() {
    if (fs.existsSync(MEMORY_PATH)) {
      try { return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8')); } catch {}
    }
    return { sessions: [], blocks: [] };
  }

  _save() {
    fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(this._data, null, 2), 'utf-8');
  }

  createSession(label = '') {
    const session = {
      session_id: `run_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${uuidv4().slice(0, 4)}`,
      label: label || null,
      started_at: new Date().toISOString(),
      ended_at: null,
    };
    this._data.sessions.unshift(session);
    this._save();
    return session;
  }

  endSession(session_id) {
    const s = this._data.sessions.find(s => s.session_id === session_id);
    if (!s) throw new Error(`Session not found: ${session_id}`);
    s.ended_at = new Date().toISOString();
    this._save();
    return s;
  }

  addBlock(block) {
    this._data.blocks.unshift(block);
    this._save();
    return block;
  }

  getSession(session_id) {
    const session = this._data.sessions.find(s => s.session_id === session_id);
    if (!session) throw new Error(`Session not found: ${session_id}`);
    const blocks = this._data.blocks
      .filter(b => b.session_id === session_id)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return { session, blocks };
  }

  getAllSessions() {
    return this._data.sessions.map(session => {
      const blocks = this._data.blocks.filter(b => b.session_id === session.session_id);
      const emotionCounts = {};
      let highWeightCount = 0;
      blocks.forEach(b => {
        if (b.emotion) emotionCounts[b.emotion] = (emotionCounts[b.emotion] || 0) + 1;
        if ((b.weight || 0) >= 7) highWeightCount++;
      });
      const dominant_emotion = Object.entries(emotionCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || null;
      const duration_mins = session.ended_at
        ? Math.round((new Date(session.ended_at) - new Date(session.started_at)) / 60000)
        : null;
      return { ...session, block_count: blocks.length, dominant_emotion, high_weight_count: highWeightCount, duration_mins };
    });
  }

  get allBlocks() { return this._data.blocks; }
}

// ─── BLOCK FACTORY ────────────────────────────────────────────────────────────

export function createBlock({
  session_id,
  loose_zone = null,
  elevation_change = null,
  surface = null,
  pace = null,
  breath = null,
  fatigue = null,
  light = null,
  temperature = null,
  sound = null,
  smell = null,
  trigger_type = 'ambient',
  trigger_input = null,
  trigger_note = null,
  weight = 1,
  emotion = null,
  connected_to = [],
} = {}) {
  return {
    block_id: uuidv4(),
    session_id,
    timestamp: new Date().toISOString(),
    location: { loose_zone, elevation_change, surface },
    body: { pace, breath, fatigue },
    environment: { light, temperature, sound, smell },
    trigger: { type: trigger_type, input: trigger_input, note: trigger_note },
    weight: Math.max(1, Math.min(10, Number(weight) || 1)),
    emotion,
    connected_to,
  };
}

// ─── PATTERN ENGINE ───────────────────────────────────────────────────────────

export function computeRunPatterns(blocks) {
  const n = blocks.length;
  const confidence = Math.min(1, n / 30);
  const confidence_label =
    n === 0 ? 'No runs yet' :
    n <= 3  ? 'First signals' :
    n <= 8  ? 'Patterns forming' :
    n <= 15 ? 'Clear patterns' :
    n <= 29 ? 'Strong pattern data' :
              'Deep pattern data';

  if (n === 0) {
    return {
      confidence: 0, confidence_label, block_count: 0,
      emotion_frequency: {}, dominant_zones: [],
      high_weight_blocks: [], trigger_breakdown: {},
      body_state_trends: {}, synthesis: null,
    };
  }

  // Emotion frequency
  const emotion_frequency = {};
  EMOTIONS.forEach(e => emotion_frequency[e] = 0);
  blocks.forEach(b => { if (b.emotion && b.emotion in emotion_frequency) emotion_frequency[b.emotion]++; });

  // Dominant zones (top 5)
  const zoneCounts = {};
  blocks.forEach(b => {
    const z = b.location?.loose_zone;
    if (z) zoneCounts[z] = (zoneCounts[z] || 0) + 1;
  });
  const dominant_zones = Object.entries(zoneCounts)
    .sort(([, a], [, b]) => b - a).slice(0, 5)
    .map(([zone, count]) => ({ zone, count }));

  // High-weight blocks (top 5)
  const high_weight_blocks = [...blocks]
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, 5);

  // Trigger breakdown
  const trigger_breakdown = { ambient: { count: 0, total_weight: 0 }, intentional: { count: 0, total_weight: 0 } };
  blocks.forEach(b => {
    const t = b.trigger?.type === 'intentional' ? 'intentional' : 'ambient';
    trigger_breakdown[t].count++;
    trigger_breakdown[t].total_weight += b.weight || 0;
  });
  Object.keys(trigger_breakdown).forEach(t => {
    const { count, total_weight } = trigger_breakdown[t];
    trigger_breakdown[t].avg_weight = count > 0 ? +(total_weight / count).toFixed(1) : 0;
  });

  // Body state trends
  const bodyFields = { pace: {}, breath: {}, fatigue: {} };
  blocks.forEach(b => {
    ['pace', 'breath', 'fatigue'].forEach(f => {
      const v = b.body?.[f];
      if (v) bodyFields[f][v] = (bodyFields[f][v] || 0) + 1;
    });
  });
  const body_state_trends = bodyFields;

  return {
    confidence: +confidence.toFixed(2),
    confidence_label,
    block_count: n,
    emotion_frequency,
    dominant_zones,
    high_weight_blocks,
    trigger_breakdown,
    body_state_trends,
    synthesis: null,
  };
}

// ─── AI ENGINE ────────────────────────────────────────────────────────────────

export class RunMemoryAI {
  constructor() {
    const key = process.env.ANTHROPIC_API_KEY;
    this.demoMode = !key;
    this.client = key ? new Anthropic({ apiKey: key }) : null;
  }

  async parseVoice(transcript) {
    if (this.demoMode) return this._mockVoice(transcript);
    const response = await this.client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 600,
      system: `You are a run-logger assistant. Parse the runner's spoken note into structured fields.
Respond ONLY with valid JSON matching this schema — no markdown, no explanation:
${VOICE_PARSE_SCHEMA}
If a field is not mentioned or unclear, use null for optional string fields, or the most neutral enum value.
weight should reflect how significant/notable the moment was (1=background, 10=peak moment).`,
      messages: [{ role: 'user', content: `Runner said: "${transcript}"` }],
    });
    let text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (text.startsWith('```')) text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return { ...JSON.parse(text), _demo: false };
  }

  async synthesizePatterns(blocks, computed) {
    if (this.demoMode) return this._mockPatterns();
    const summary = [
      `Total blocks: ${computed.block_count}`,
      `Dominant emotions: ${Object.entries(computed.emotion_frequency).sort(([,a],[,b])=>b-a).slice(0,3).map(([e,c])=>`${e}(${c})`).join(', ')}`,
      `Top zones: ${computed.dominant_zones.map(z=>`${z.zone}(${z.count})`).join(', ') || 'none'}`,
      `Trigger split: ${computed.trigger_breakdown.intentional?.count || 0} intentional / ${computed.trigger_breakdown.ambient?.count || 0} ambient`,
      `Avg intentional weight: ${computed.trigger_breakdown.intentional?.avg_weight || 0}`,
      `Top 3 high-weight notes: ${computed.high_weight_blocks.slice(0,3).map(b=>`"${b.trigger?.note || b.location?.loose_zone || '—'}"(w${b.weight})`).join(', ')}`,
    ].join('\n');

    const response = await this.client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 700,
      system: `You are a run-pattern analyst. Given summary stats from a runner's memory blocks across multiple runs, synthesize the patterns.
Respond ONLY with valid JSON matching this schema — no markdown:
${PATTERN_SYNTHESIS_SCHEMA}`,
      messages: [{ role: 'user', content: `Pattern data:\n${summary}` }],
    });
    let text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (text.startsWith('```')) text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return { ...JSON.parse(text), _demo: false };
  }

  _mockVoice(transcript) {
    const lower = (transcript || '').toLowerCase();
    return {
      _demo: true,
      loose_zone: lower.includes('park') ? 'park' : lower.includes('hill') ? 'hill section' : 'local route',
      elevation_change: lower.includes('hill') || lower.includes('climb') ? 'climbing' : lower.includes('down') ? 'descending' : 'flat',
      surface: lower.includes('trail') || lower.includes('dirt') ? 'trail' : lower.includes('grass') ? 'grass' : 'pavement',
      pace: lower.includes('fast') || lower.includes('push') ? 'pushing' : lower.includes('slow') ? 'easy' : 'steady',
      breath: lower.includes('breath') || lower.includes('heavy') ? 'heavy' : 'controlled',
      fatigue: lower.includes('tired') || lower.includes('heavy legs') ? 'heavy' : 'moderate',
      light: new Date().getHours() < 9 ? 'morning' : new Date().getHours() < 17 ? 'midday' : 'dusk',
      temperature: 'cool',
      sound: lower.includes('music') ? 'music' : lower.includes('traffic') ? 'traffic' : null,
      smell: lower.includes('coffee') ? 'coffee' : lower.includes('grass') ? 'fresh grass' : null,
      trigger_type: lower.includes('notice') || lower.includes('smell') || lower.includes('saw') ? 'intentional' : 'ambient',
      trigger_note: transcript,
      weight: lower.includes('amazing') || lower.includes('love') || lower.includes('best') ? 9 : 5,
      emotion: lower.includes('good') || lower.includes('great') ? 'energized' : lower.includes('tired') ? 'tired' : 'calm',
    };
  }

  _mockPatterns() {
    return {
      _demo: true,
      sensory_narrative: 'Demo mode: Your runs show a consistent pattern of urban-to-natural transitions — starting on pavement and finding relief in quieter zones. Sound environments shift from traffic to ambient nature, correlating with lower perceived effort.',
      body_story: 'Demo mode: Body state data suggests your first mile is your heaviest — breath and fatigue ratings peak early, then level into a controlled steady state. Hills trigger the highest-weight intentional blocks.',
      pattern_loop: 'Demo mode: Coffee smell → pace drop + calm emotion → weight 7+ block. This sensory anchor recurs across sessions and appears to mark natural rest-check moments.',
      next_focus: 'Demo mode: Note the exact moment your breath shifts from heavy to controlled — this transition point contains high-pattern density and is currently untracked.',
    };
  }
}
