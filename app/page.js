'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const EMOTION_COLORS = {
  neutral:   '#888888',
  calm:      '#6090c0',
  focused:   '#80c0a0',
  energized: '#e0a030',
  anxious:   '#e07060',
  tired:     '#808080',
  peaceful:  '#a080c0',
  joyful:    '#e0c040',
};

const PILL_FIELDS = {
  surface:    ['pavement', 'trail', 'grass', 'gravel', 'mixed'],
  elevation_change: ['flat', 'climbing', 'descending'],
  pace:       ['easy', 'steady', 'pushing', 'sprint'],
  breath:     ['easy', 'controlled', 'heavy'],
  fatigue:    ['fresh', 'moderate', 'heavy'],
  light:      ['dawn', 'morning', 'midday', 'afternoon', 'dusk', 'night'],
  temperature: ['cold', 'cool', 'mild', 'warm', 'hot'],
  emotion:    ['neutral', 'calm', 'focused', 'energized', 'anxious', 'tired', 'peaceful', 'joyful'],
};

const FIELD_LABELS = {
  surface: 'Surface', elevation_change: 'Elevation', pace: 'Pace',
  breath: 'Breath', fatigue: 'Fatigue', light: 'Light',
  temperature: 'Temperature', emotion: 'Emotion',
};

const EMPTY_FORM = {
  loose_zone: '', surface: null, elevation_change: null, pace: null,
  breath: null, fatigue: null, light: null, temperature: null,
  sound: '', smell: '', trigger_type: 'ambient', trigger_note: '', weight: 5, emotion: null,
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab] = useState('run');
  const [session, setSession] = useState(null);          // active session
  const [sessionLabel, setSessionLabel] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [blockCount, setBlockCount] = useState(0);
  const [savingBlock, setSavingBlock] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');

  const [sessions, setSessions] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const [replaySessionId, setReplaySessionId] = useState(null);
  const [replayData, setReplayData] = useState(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [expandedBlock, setExpandedBlock] = useState(null);

  const [patterns, setPatterns] = useState(null);
  const [loadingPatterns, setLoadingPatterns] = useState(false);

  const timerRef = useRef(null);
  const recognitionRef = useRef(null);

  // Elapsed timer
  useEffect(() => {
    if (session && !session.ended_at) {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - new Date(session.started_at)) / 1000));
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [session]);

  const formatElapsed = s => {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // Tab switch loaders
  const switchTab = t => {
    setTab(t);
    if (t === 'sessions') loadSessions();
    if (t === 'patterns') loadPatterns();
    if (t === 'replay') loadSessions();
  };

  async function loadSessions() {
    setLoadingSessions(true);
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data.sessions || []);
      if (!replaySessionId && data.sessions?.length > 0) {
        setReplaySessionId(data.sessions[0].session_id);
      }
    } finally { setLoadingSessions(false); }
  }

  const loadReplay = useCallback(async (sid) => {
    if (!sid) return;
    setLoadingReplay(true);
    setReplayData(null);
    try {
      const res = await fetch(`/api/sessions/${sid}`);
      const data = await res.json();
      setReplayData(data);
    } finally { setLoadingReplay(false); }
  }, []);

  useEffect(() => {
    if (tab === 'replay' && replaySessionId) loadReplay(replaySessionId);
  }, [replaySessionId, tab, loadReplay]);

  async function loadPatterns() {
    setLoadingPatterns(true);
    try {
      const res = await fetch('/api/patterns');
      setPatterns(await res.json());
    } finally { setLoadingPatterns(false); }
  }

  // ── Run actions ──

  async function startRun() {
    setStartingRun(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: sessionLabel.trim() || undefined }),
      });
      const data = await res.json();
      setSession(data);
      setBlockCount(0);
      setElapsed(0);
      setForm(EMPTY_FORM);
    } finally { setStartingRun(false); }
  }

  async function saveBlock() {
    if (!session) return;
    setSavingBlock(true);
    try {
      await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session.session_id,
          loose_zone: form.loose_zone || null,
          elevation_change: form.elevation_change,
          surface: form.surface,
          pace: form.pace,
          breath: form.breath,
          fatigue: form.fatigue,
          light: form.light,
          temperature: form.temperature,
          sound: form.sound || null,
          smell: form.smell || null,
          trigger_type: form.trigger_type,
          trigger_note: form.trigger_note || null,
          weight: form.weight,
          emotion: form.emotion,
        }),
      });
      setBlockCount(c => c + 1);
      setForm(EMPTY_FORM);
    } finally { setSavingBlock(false); }
  }

  async function endRun() {
    if (!session) return;
    await fetch(`/api/sessions/${session.session_id}`, { method: 'POST' });
    clearInterval(timerRef.current);
    const ended = { ...session, ended_at: new Date().toISOString() };
    setSession(null);
    setReplaySessionId(ended.session_id);
    switchTab('replay');
  }

  // ── Voice input ──

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceStatus('Voice not supported in this browser'); return; }
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    recognitionRef.current = r;

    r.onstart = () => { setListening(true); setVoiceStatus('Listening…'); };
    r.onend = () => { setListening(false); };
    r.onerror = e => { setListening(false); setVoiceStatus(`Error: ${e.error}`); };

    r.onresult = async (e) => {
      const transcript = e.results[0][0].transcript;
      setVoiceStatus(`Parsing: "${transcript}"…`);
      try {
        const res = await fetch('/api/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript }),
        });
        const parsed = await res.json();
        setForm(prev => ({
          ...prev,
          loose_zone: parsed.loose_zone || prev.loose_zone,
          elevation_change: parsed.elevation_change || prev.elevation_change,
          surface: parsed.surface || prev.surface,
          pace: parsed.pace || prev.pace,
          breath: parsed.breath || prev.breath,
          fatigue: parsed.fatigue || prev.fatigue,
          light: parsed.light || prev.light,
          temperature: parsed.temperature || prev.temperature,
          sound: parsed.sound || prev.sound,
          smell: parsed.smell || prev.smell,
          trigger_type: parsed.trigger_type || prev.trigger_type,
          trigger_note: parsed.trigger_note || prev.trigger_note,
          weight: parsed.weight || prev.weight,
          emotion: parsed.emotion || prev.emotion,
        }));
        setVoiceStatus(parsed._demo ? 'Parsed (demo mode)' : 'Form pre-filled from voice');
        setTimeout(() => setVoiceStatus(''), 3000);
      } catch {
        setVoiceStatus('Parse failed');
      }
    };
    r.start();
  }

  function setField(key, val) {
    setForm(prev => ({ ...prev, [key]: prev[key] === val ? null : val }));
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#080810', color: '#e0e0f0', padding: '1.5rem 1rem' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '1.75rem' }}>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: '#fff' }}>
            4TLOmeMEMORY
          </h1>
          <p style={{ color: '#555', marginTop: '0.3rem', fontSize: '0.85rem' }}>
            Run memory — log sensory blocks, replay sessions, find patterns
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.75rem', borderBottom: '1px solid #1a1a28' }}>
          {['run', 'sessions', 'replay', 'patterns'].map(t => (
            <button key={t} onClick={() => switchTab(t)} style={{
              background: 'none', border: 'none', color: tab === t ? '#fff' : '#444',
              fontWeight: tab === t ? 600 : 400, fontSize: '0.9rem', padding: '0.45rem 0',
              borderBottom: tab === t ? '2px solid #6060c0' : '2px solid transparent',
              cursor: 'pointer', textTransform: 'capitalize', marginBottom: '-1px',
            }}>{t}</button>
          ))}
        </div>

        {/* ── RUN TAB ── */}
        {tab === 'run' && (
          <div>
            {!session ? (
              <div style={{ textAlign: 'center', paddingTop: '3rem' }}>
                <input
                  value={sessionLabel}
                  onChange={e => setSessionLabel(e.target.value)}
                  placeholder="Run label (optional)"
                  onKeyDown={e => e.key === 'Enter' && startRun()}
                  style={{ ...inputStyle, maxWidth: '280px', marginBottom: '1rem', textAlign: 'center' }}
                />
                <br />
                <button onClick={startRun} disabled={startingRun} style={primaryBtn}>
                  {startingRun ? 'Starting…' : '▶ Start Run'}
                </button>
              </div>
            ) : (
              <div>
                {/* Session header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', padding: '0.75rem 1rem', background: '#0f0f1e', border: '1px solid #20203a', borderRadius: '10px' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: '#5050a0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Active Run</div>
                    <div style={{ fontSize: '0.95rem', color: '#ccc', fontWeight: 500 }}>{session.label || session.session_id}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(elapsed)}</div>
                    <div style={{ fontSize: '0.72rem', color: '#555' }}>{blockCount} block{blockCount !== 1 ? 's' : ''}</div>
                  </div>
                </div>

                {/* Quick-tap form */}
                <div style={{ background: '#0d0d1a', border: '1px solid #1a1a30', borderRadius: '12px', padding: '1.1rem' }}>

                  {/* Zone */}
                  <FieldRow label="Zone">
                    <input value={form.loose_zone} onChange={e => setForm(p => ({ ...p, loose_zone: e.target.value }))}
                      placeholder="e.g. downtown east, river path…"
                      style={{ ...inputStyle, fontSize: '0.88rem' }} />
                  </FieldRow>

                  {/* Pill fields */}
                  {Object.entries(PILL_FIELDS).map(([key, options]) => (
                    <FieldRow key={key} label={FIELD_LABELS[key]}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                        {options.map(opt => {
                          const isEmotion = key === 'emotion';
                          const color = isEmotion ? EMOTION_COLORS[opt] : '#6060c0';
                          const active = form[key] === opt;
                          return (
                            <button key={opt} onClick={() => setField(key, opt)} style={{
                              padding: '0.25rem 0.65rem', borderRadius: '999px', fontSize: '0.78rem',
                              border: active ? `1.5px solid ${color}` : '1.5px solid #252535',
                              background: active ? `${color}22` : 'transparent',
                              color: active ? color : '#555',
                              cursor: 'pointer', transition: 'all 0.12s',
                            }}>{opt}</button>
                          );
                        })}
                      </div>
                    </FieldRow>
                  ))}

                  {/* Sound + Smell */}
                  <FieldRow label="Sound">
                    <input value={form.sound} onChange={e => setForm(p => ({ ...p, sound: e.target.value }))}
                      placeholder="traffic, birds, music…" style={{ ...inputStyle, fontSize: '0.88rem' }} />
                  </FieldRow>
                  <FieldRow label="Smell">
                    <input value={form.smell} onChange={e => setForm(p => ({ ...p, smell: e.target.value }))}
                      placeholder="coffee, rain, exhaust…" style={{ ...inputStyle, fontSize: '0.88rem' }} />
                  </FieldRow>

                  {/* Trigger type */}
                  <FieldRow label="Trigger">
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      {['ambient', 'intentional'].map(t => (
                        <button key={t} onClick={() => setForm(p => ({ ...p, trigger_type: t }))} style={{
                          padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.78rem',
                          border: form.trigger_type === t ? '1.5px solid #6060c0' : '1.5px solid #252535',
                          background: form.trigger_type === t ? '#6060c022' : 'transparent',
                          color: form.trigger_type === t ? '#8080e0' : '#555',
                          cursor: 'pointer',
                        }}>{t}</button>
                      ))}
                    </div>
                  </FieldRow>

                  {/* Note */}
                  <FieldRow label="Note">
                    <input value={form.trigger_note} onChange={e => setForm(p => ({ ...p, trigger_note: e.target.value }))}
                      placeholder="What caught your attention?" style={{ ...inputStyle, fontSize: '0.88rem' }} />
                  </FieldRow>

                  {/* Weight */}
                  <FieldRow label={`Weight (${form.weight})`}>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {Array.from({ length: 10 }, (_, i) => i + 1).map(i => {
                        const active = i <= form.weight;
                        const c = form.weight >= 8 ? '#e07070' : form.weight >= 5 ? '#d0a060' : '#6080a0';
                        return (
                          <button key={i} onClick={() => setForm(p => ({ ...p, weight: i }))} style={{
                            width: '20px', height: '20px', borderRadius: '50%', border: 'none',
                            background: active ? c : '#1e1e30', cursor: 'pointer', padding: 0,
                            transition: 'background 0.1s',
                          }} />
                        );
                      })}
                    </div>
                  </FieldRow>

                </div>

                {/* Voice + Save + End */}
                <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  <button onClick={startVoice} disabled={listening} style={{
                    ...secondaryBtn,
                    border: listening ? '1px solid #e07060' : '1px solid #252535',
                    color: listening ? '#e07060' : '#aaa',
                    minWidth: '48px',
                  }}>
                    {listening ? '⏹' : '🎙'}
                  </button>
                  {voiceStatus && <span style={{ fontSize: '0.78rem', color: '#666', alignSelf: 'center' }}>{voiceStatus}</span>}
                  <button onClick={saveBlock} disabled={savingBlock} style={{ ...primaryBtn, flex: 1 }}>
                    {savingBlock ? 'Saving…' : '+ Save Block'}
                  </button>
                  <button onClick={endRun} style={{ ...secondaryBtn }}>
                    End Run
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SESSIONS TAB ── */}
        {tab === 'sessions' && (
          <div>
            {loadingSessions && <p style={{ color: '#444' }}>Loading…</p>}
            {sessions && sessions.length === 0 && <p style={{ color: '#444' }}>No sessions yet. Start a run first.</p>}
            {sessions && sessions.map(s => (
              <div key={s.session_id}
                onClick={() => { setReplaySessionId(s.session_id); switchTab('replay'); }}
                style={{ marginBottom: '0.75rem', padding: '0.9rem 1.1rem', background: '#0d0d1a', border: '1px solid #1a1a30', borderRadius: '10px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '0.9rem', color: '#ccc', fontWeight: 500 }}>{s.label || s.session_id}</div>
                    <div style={{ fontSize: '0.75rem', color: '#444', marginTop: '0.2rem' }}>
                      {new Date(s.started_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {s.duration_mins != null ? ` · ${s.duration_mins}min` : s.ended_at ? '' : ' · in progress'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', color: '#555' }}>{s.block_count} blocks</span>
                      {s.high_weight_count > 0 && (
                        <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: '#2a1a0a', border: '1px solid #503010', borderRadius: '4px', color: '#d0a060' }}>
                          {s.high_weight_count} high
                        </span>
                      )}
                    </div>
                    {s.dominant_emotion && <EmotionPill emotion={s.dominant_emotion} />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── REPLAY TAB ── */}
        {tab === 'replay' && (
          <div>
            {/* Session picker */}
            {sessions && sessions.length > 0 && (
              <select
                value={replaySessionId || ''}
                onChange={e => setReplaySessionId(e.target.value)}
                style={{ ...inputStyle, marginBottom: '1.25rem', cursor: 'pointer' }}
              >
                {sessions.map(s => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.label || s.session_id} — {new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ({s.block_count} blocks)
                  </option>
                ))}
              </select>
            )}

            {loadingReplay && <p style={{ color: '#444' }}>Loading…</p>}
            {!loadingReplay && replayData && replayData.blocks.length === 0 && (
              <p style={{ color: '#444' }}>No blocks in this session.</p>
            )}
            {replayData && replayData.blocks.length > 0 && (
              <ReplayTimeline
                blocks={replayData.blocks}
                expanded={expandedBlock}
                setExpanded={setExpandedBlock}
              />
            )}
            {!sessions && !loadingSessions && !replayData && (
              <p style={{ color: '#444' }}>No sessions yet. Start a run first.</p>
            )}
          </div>
        )}

        {/* ── PATTERNS TAB ── */}
        {tab === 'patterns' && (
          <div>
            {loadingPatterns && <p style={{ color: '#444' }}>Analyzing…</p>}
            {patterns && <PatternsView patterns={patterns} />}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── SHARED STYLES ────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', background: '#0d0d1a', border: '1px solid #1e1e30',
  borderRadius: '8px', color: '#e0e0f0', padding: '0.6rem 0.85rem',
  fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};

const primaryBtn = {
  padding: '0.7rem 1.2rem', borderRadius: '8px', fontSize: '0.92rem',
  fontWeight: 600, border: 'none', cursor: 'pointer',
  background: '#fff', color: '#000', transition: 'all 0.2s',
};

const secondaryBtn = {
  padding: '0.7rem 1rem', borderRadius: '8px', fontSize: '0.88rem',
  fontWeight: 400, border: '1px solid #252535', cursor: 'pointer',
  background: 'transparent', color: '#aaa',
};

// ─── FIELD ROW ────────────────────────────────────────────────────────────────

function FieldRow({ label, children }) {
  return (
    <div style={{ marginBottom: '0.85rem' }}>
      <div style={{ fontSize: '0.68rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>{label}</div>
      {children}
    </div>
  );
}

// ─── EMOTION PILL ─────────────────────────────────────────────────────────────

function EmotionPill({ emotion }) {
  const color = EMOTION_COLORS[emotion] || '#888';
  return (
    <span style={{
      fontSize: '0.7rem', padding: '0.12rem 0.5rem', borderRadius: '999px',
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>{emotion}</span>
  );
}

// ─── REPLAY TIMELINE ──────────────────────────────────────────────────────────

function ReplayTimeline({ blocks, expanded, setExpanded }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', left: '11px', top: '8px', bottom: 0,
        width: '2px', background: 'linear-gradient(to bottom, #20203a, #10101e 80%, transparent)',
        borderRadius: '1px',
      }} />

      {blocks.map((block, idx) => {
        const emotion = block.emotion;
        const color = EMOTION_COLORS[emotion] || '#5050a0';
        const isIntentional = block.trigger?.type === 'intentional';
        const weight = block.weight || 1;
        const time = new Date(block.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        const isOpen = expanded === block.block_id;

        return (
          <div key={block.block_id} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.65rem' }}>
            {/* Node */}
            <div style={{ flexShrink: 0, paddingTop: '0.6rem' }}>
              <div style={{
                width: isIntentional ? '24px' : '18px',
                height: isIntentional ? '24px' : '18px',
                borderRadius: '50%', zIndex: 1, position: 'relative',
                background: isIntentional ? `${color}33` : '#0d0d1a',
                border: `${isIntentional ? 2 : 1}px solid ${isIntentional ? color : '#252535'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginLeft: isIntentional ? '0' : '3px',
              }}>
                <div style={{ width: isIntentional ? '8px' : '6px', height: isIntentional ? '8px' : '6px', borderRadius: '50%', background: isIntentional ? color : '#303050' }} />
              </div>
            </div>

            {/* Card */}
            <div onClick={() => setExpanded(isOpen ? null : block.block_id)} style={{
              flex: 1, padding: '0.75rem 0.9rem', background: '#0d0d1a',
              border: `1px solid ${isOpen ? color + '44' : '#1a1a2e'}`, borderRadius: '9px',
              cursor: 'pointer', transition: 'border-color 0.15s', marginBottom: 0,
            }}>
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.72rem', color: '#444' }}>{time}</span>
                <span style={{ fontSize: '0.7rem', padding: '0.08rem 0.4rem', borderRadius: '4px', background: isIntentional ? '#1a0f2a' : '#111120', color: isIntentional ? '#9060c0' : '#404060', border: `1px solid ${isIntentional ? '#30204a' : '#1e1e2e'}` }}>
                  {isIntentional ? 'intentional' : 'ambient'}
                </span>
                {emotion && <EmotionPill emotion={emotion} />}
                <WeightDots weight={weight} />
              </div>

              {/* Zone */}
              {block.location?.loose_zone && (
                <div style={{ fontSize: '0.83rem', color: '#888', marginBottom: '0.25rem' }}>{block.location.loose_zone}</div>
              )}

              {/* Note */}
              {block.trigger?.note && (
                <div style={{ fontSize: '0.82rem', color: '#666', lineHeight: 1.5, fontStyle: 'italic' }}>
                  "{block.trigger.note.slice(0, 100)}{block.trigger.note.length > 100 ? '…' : ''}"
                </div>
              )}

              {/* Expanded */}
              {isOpen && (
                <div style={{ marginTop: '0.85rem', borderTop: '1px solid #1a1a2e', paddingTop: '0.85rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
                    {[
                      ['Surface', block.location?.surface],
                      ['Elevation', block.location?.elevation_change],
                      ['Pace', block.body?.pace],
                      ['Breath', block.body?.breath],
                      ['Fatigue', block.body?.fatigue],
                      ['Light', block.environment?.light],
                      ['Temperature', block.environment?.temperature],
                      ['Sound', block.environment?.sound],
                      ['Smell', block.environment?.smell],
                    ].map(([label, val]) => val ? (
                      <div key={label}>
                        <div style={{ fontSize: '0.62rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                        <div style={{ fontSize: '0.82rem', color: '#888' }}>{val}</div>
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}

              <div style={{ marginTop: '0.4rem', fontSize: '0.65rem', color: '#2a2a3a' }}>{isOpen ? '↑ collapse' : '↓ expand'}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── WEIGHT DOTS ──────────────────────────────────────────────────────────────

function WeightDots({ weight }) {
  const filled = Math.round(weight / 2);
  const c = weight >= 8 ? '#e07070' : weight >= 5 ? '#d0a060' : '#6080a0';
  return (
    <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{ width: '4px', height: '4px', borderRadius: '50%', background: i <= filled ? c : '#1e1e30' }} />
      ))}
    </div>
  );
}

// ─── PATTERNS VIEW ────────────────────────────────────────────────────────────

function PatternsView({ patterns }) {
  const { confidence, confidence_label, block_count, emotion_frequency,
    dominant_zones, high_weight_blocks, trigger_breakdown, body_state_trends, synthesis } = patterns;

  const isEmpty = block_count === 0;

  return (
    <div>
      {/* Confidence */}
      <div style={{ marginBottom: '1.5rem', padding: '1.1rem', background: '#0d0d1a', border: '1px solid #1a1a30', borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.65rem' }}>
          <div>
            <div style={{ fontSize: '0.68rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.2rem' }}>Pattern Confidence</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: '#e0e0f0' }}>{confidence_label}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>{block_count}</div>
            <div style={{ fontSize: '0.68rem', color: '#444' }}>memory blocks</div>
          </div>
        </div>
        <div style={{ height: '5px', background: '#1a1a2e', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${confidence * 100}%`,
            background: confidence < 0.25 ? '#303050' : confidence < 0.5 ? '#604020' : confidence < 0.75 ? '#406040' : '#6060c0',
            borderRadius: '3px', transition: 'width 0.6s ease',
          }} />
        </div>
        {isEmpty && <p style={{ fontSize: '0.85rem', color: '#444', marginTop: '0.75rem', lineHeight: 1.6 }}>
          Start a run and log memory blocks. After 5+ blocks, pattern synthesis unlocks. After 30+, deep patterns emerge.
        </p>}
        {!isEmpty && block_count < 5 && <p style={{ fontSize: '0.75rem', color: '#444', marginTop: '0.5rem' }}>
          {5 - block_count} more blocks to unlock AI synthesis
        </p>}
      </div>

      {!isEmpty && (
        <>
          {/* Emotion frequency */}
          <div style={{ marginBottom: '1.5rem' }}>
            <SectionLabel>Emotion Frequency</SectionLabel>
            {Object.entries(emotion_frequency).filter(([, c]) => c > 0).sort(([, a], [, b]) => b - a).map(([e, count]) => (
              <div key={e} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.75rem', width: '90px', flexShrink: 0, color: EMOTION_COLORS[e] || '#888' }}>{e}</span>
                <div style={{ flex: 1, height: '4px', background: '#1a1a2e', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(count / block_count) * 100}%`, background: EMOTION_COLORS[e] || '#6060c0', borderRadius: '2px' }} />
                </div>
                <span style={{ fontSize: '0.7rem', color: '#444', width: '16px', textAlign: 'right' }}>{count}</span>
              </div>
            ))}
            {Object.values(emotion_frequency).every(c => c === 0) && <p style={{ color: '#444', fontSize: '0.82rem' }}>No emotion data yet.</p>}
          </div>

          {/* Dominant zones */}
          {dominant_zones.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <SectionLabel>Dominant Zones</SectionLabel>
              {dominant_zones.map(({ zone, count }) => (
                <div key={zone} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: '7px', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.85rem', color: '#aaa' }}>{zone}</span>
                  <span style={{ fontSize: '0.72rem', color: '#555' }}>{count} block{count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          )}

          {/* Trigger breakdown */}
          <div style={{ marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {['ambient', 'intentional'].map(t => {
              const d = trigger_breakdown[t] || {};
              return (
                <div key={t} style={{ padding: '0.85rem', background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.68rem', color: t === 'intentional' ? '#8060c0' : '#404070', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>{t}</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff' }}>{d.count || 0}</div>
                  <div style={{ fontSize: '0.72rem', color: '#444' }}>avg weight {d.avg_weight || 0}</div>
                </div>
              );
            })}
          </div>

          {/* Body state trends */}
          {Object.values(body_state_trends).some(d => Object.keys(d).length > 0) && (
            <div style={{ marginBottom: '1.5rem' }}>
              <SectionLabel>Body State Trends</SectionLabel>
              {Object.entries(body_state_trends).map(([field, dist]) => Object.keys(dist).length > 0 ? (
                <div key={field} style={{ marginBottom: '0.6rem' }}>
                  <div style={{ fontSize: '0.68rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>{field}</div>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {Object.entries(dist).sort(([, a], [, b]) => b - a).map(([val, count]) => (
                      <span key={val} style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', background: '#111120', border: '1px solid #1e1e30', borderRadius: '4px', color: '#777' }}>
                        {val} <span style={{ color: '#555' }}>×{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null)}
            </div>
          )}

          {/* High-weight blocks */}
          {high_weight_blocks.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <SectionLabel>Peak Moments (high weight)</SectionLabel>
              {high_weight_blocks.map(block => (
                <div key={block.block_id} style={{ marginBottom: '0.5rem', padding: '0.75rem 0.9rem', background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <WeightDots weight={block.weight} />
                    {block.emotion && <EmotionPill emotion={block.emotion} />}
                    {block.location?.loose_zone && <span style={{ fontSize: '0.72rem', color: '#555' }}>{block.location.loose_zone}</span>}
                  </div>
                  {block.trigger?.note && <div style={{ fontSize: '0.82rem', color: '#666', fontStyle: 'italic' }}>"{block.trigger.note.slice(0, 100)}"</div>}
                </div>
              ))}
            </div>
          )}

          {/* AI synthesis */}
          {synthesis && (
            <div style={{ padding: '1.1rem', background: '#0a0a18', border: '1px solid #20203a', borderRadius: '12px' }}>
              <div style={{ fontSize: '0.68rem', color: '#4040a0', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem' }}>Pattern Synthesis</div>
              {synthesis._demo && (
                <div style={{ marginBottom: '0.85rem', padding: '0.5rem 0.75rem', background: '#1a1500', border: '1px solid #443300', borderRadius: '6px', fontSize: '0.75rem', color: '#aa8800' }}>
                  Demo mode — add ANTHROPIC_API_KEY for real AI synthesis
                </div>
              )}
              {[
                ['Sensory Patterns', synthesis.sensory_narrative],
                ['Body Story', synthesis.body_story],
                ['Pattern Loop', synthesis.pattern_loop],
                ['Next Focus', synthesis.next_focus],
              ].map(([label, val]) => val ? (
                <div key={label} style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.65rem', color: '#33336a', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>{label}</div>
                  <div style={{ fontSize: '0.88rem', color: '#b0b0d0', lineHeight: 1.65 }}>{val}</div>
                </div>
              ) : null)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: '0.68rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.6rem' }}>{children}</div>;
}
