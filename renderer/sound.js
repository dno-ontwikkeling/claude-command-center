'use strict';

// ---------------------------------------------------------------------------
// Notification sounds — small Web Audio synths so we ship no audio files.
// Each preset is a waveform plus a sequence of note multipliers played over a
// base pitch. The base pitch shifts by `kind` so "needs input" sounds brighter
// than "finished". Lives in its own module so both agents.js (which fires the
// sounds) and settings.js (which previews them) can import without a cycle.
// ---------------------------------------------------------------------------

export const SOUNDS = {
  beep: { label: 'Beep', wave: 'sine', notes: [1], dur: 130 },
  chime: { label: 'Chime', wave: 'sine', notes: [1, 1.5], dur: 120 },
  ping: { label: 'Ping', wave: 'triangle', notes: [1.6], dur: 90 },
  marimba: { label: 'Marimba', wave: 'triangle', notes: [1, 1.26, 1.5], dur: 110 },
  pop: { label: 'Pop', wave: 'square', notes: [0.85], dur: 70 },
};

let audioCtx;

// volume is 0..1; scaled by a gentle ceiling so full volume stays comfortable.
export function beep(kind, soundType, volume) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const def = SOUNDS[soundType] || SOUNDS.beep;
    const base = kind === 'needs-input' ? 880 : 620;
    const vol = Math.max(0, Math.min(1, volume ?? 0.5)) * 0.3;
    if (vol === 0) return;
    const step = def.dur / 1000;
    def.notes.forEach((mult, i) => {
      const t = audioCtx.currentTime + i * step;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = def.wave;
      osc.frequency.value = base * mult;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + step);
      osc.start(t);
      osc.stop(t + step);
    });
  } catch {
    /* audio unavailable */
  }
}
