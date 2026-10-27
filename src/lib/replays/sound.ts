/**
 * Retro Replays sound effects, synthesized with Web Audio (no sound files):
 * square wave blips for the snap and a catch, filtered noise for a throw, a
 * hit and the crowd, a referee's whistle, a fanfare for a touchdown, a horn
 * at the final. Off until the visitor turns it on with the sound button;
 * the choice is kept for every replay on the site (`tylernfl.replay-sound`
 * in localStorage, every access in try/catch). The audio context starts on
 * that click, which browsers require before any sound.
 */
import type { EffectKind } from './timeline.ts';

const KEY = 'tylernfl.replay-sound';
const VOLUME = 0.22;

export type SoundName = EffectKind | 'final' | 'fast' | 'boom' | 'juke' | 'firstdown';

let on = readOn();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
const listeners = new Set<(on: boolean) => void>();

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function soundOn(): boolean {
  return on;
}

/** Turn sound on or off everywhere; call from a click so the audio context may start. */
export function setSound(next: boolean): void {
  on = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
  if (next) wake();
  for (const listener of listeners) listener(next);
}

/** Be told when sound is turned on or off; returns the function that stops it. */
export function onSoundChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Make or resume the audio context; only works inside a user gesture the first time. */
export function wake(): void {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

// A saved "on" from an earlier visit needs a gesture before anything sounds.
if (typeof window !== 'undefined') {
  const first = () => {
    if (on) wake();
  };
  addEventListener('pointerdown', first, { once: true, capture: true });
  addEventListener('keydown', first, { once: true, capture: true });
}

interface Tone {
  type?: OscillatorType;
  freq: number;
  /** Frequency at the end, for a slide */
  to?: number;
  at?: number;
  dur: number;
  gain?: number;
  /** Vibrato rate and depth in Hz */
  vibrato?: [number, number];
}

function tone(t0: number, { type = 'square', freq, to, at = 0, dur, gain = 0.5, vibrato }: Tone) {
  const c = ctx!;
  const osc = c.createOscillator();
  const env = c.createGain();
  const start = t0 + at;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  if (vibrato) {
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = vibrato[0];
    depth.gain.value = vibrato[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + dur);
  }
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  env.gain.setValueAtTime(gain, start + dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env).connect(master!);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

interface Hiss {
  at?: number;
  dur: number;
  gain?: number;
  type?: BiquadFilterType;
  freq: number;
  to?: number;
  /** Seconds to rise to full, for a swell */
  attack?: number;
}

function hiss(t0: number, { at = 0, dur, gain = 0.5, type = 'bandpass', freq, to, attack = 0.005 }: Hiss) {
  const c = ctx!;
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const env = c.createGain();
  const start = t0 + at;
  src.buffer = noise;
  src.loop = true;
  filter.type = type;
  filter.frequency.setValueAtTime(freq, start);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, start + dur);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(env).connect(master!);
  src.start(start);
  src.stop(start + dur + 0.02);
}

const crowd = (t: number, dur: number, gain = 0.35) => hiss(t, { dur, gain, freq: 900, to: 1400, attack: dur * 0.25 });
const thud = (t: number, at = 0, gain = 0.6) => {
  tone(t, { type: 'sine', freq: 140, to: 45, at, dur: 0.16, gain });
  hiss(t, { at, dur: 0.12, gain: gain * 0.6, type: 'lowpass', freq: 600 });
};

const SOUNDS: Record<SoundName, (t: number) => void> = {
  snap: (t) => {
    tone(t, { freq: 196, dur: 0.07, gain: 0.35 });
    tone(t, { freq: 262, at: 0.09, dur: 0.06, gain: 0.3 });
  },
  throw: (t) => hiss(t, { dur: 0.32, gain: 0.35, freq: 500, to: 2600 }),
  kick: (t) => {
    thud(t, 0, 0.7);
    hiss(t, { at: 0.04, dur: 0.4, gain: 0.25, freq: 400, to: 2000 });
  },
  catch: (t) => {
    tone(t, { freq: 988, dur: 0.06, gain: 0.3 });
    tone(t, { freq: 1319, at: 0.07, dur: 0.12, gain: 0.3 });
  },
  incomplete: (t) => {
    tone(t, { freq: 330, to: 220, dur: 0.25, gain: 0.25 });
    SOUNDS.whistle(t + 0.25);
  },
  hit: (t) => thud(t),
  whistle: (t) => tone(t, { type: 'sine', freq: 2900, dur: 0.45, gain: 0.3, vibrato: [32, 180] }),
  flag: (t) => tone(t, { type: 'sine', freq: 2900, dur: 0.25, gain: 0.25, vibrato: [32, 180] }),
  interception: (t) => {
    tone(t, { freq: 523, dur: 0.12, gain: 0.35 });
    tone(t, { freq: 415, at: 0.13, dur: 0.12, gain: 0.35 });
    tone(t, { freq: 831, at: 0.27, dur: 0.4, gain: 0.35 });
    crowd(t + 0.1, 1.6, 0.3);
  },
  fumble: (t) => {
    thud(t);
    tone(t, { freq: 392, to: 98, at: 0.05, dur: 0.5, gain: 0.3 });
    crowd(t + 0.1, 1.2, 0.25);
  },
  sack: (t) => {
    thud(t, 0, 0.8);
    thud(t, 0.09, 0.5);
    crowd(t + 0.05, 1, 0.22);
  },
  blocked: (t) => {
    thud(t, 0, 0.8);
    crowd(t + 0.05, 1.2, 0.28);
  },
  touchdown: (t) => {
    // The charge: G C E G, hold E G.
    const notes = [392, 523, 659, 784, 659, 784];
    const at = [0, 0.11, 0.22, 0.33, 0.5, 0.61];
    const dur = [0.1, 0.1, 0.1, 0.16, 0.1, 0.5];
    notes.forEach((freq, i) => tone(t, { freq, at: at[i]!, dur: dur[i]!, gain: 0.32 }));
    notes.forEach((freq, i) => tone(t, { type: 'triangle', freq: freq / 2, at: at[i]!, dur: dur[i]!, gain: 0.3 }));
    crowd(t, 2.6, 0.4);
  },
  safety: (t) => {
    thud(t, 0, 0.8);
    tone(t, { freq: 523, at: 0.1, dur: 0.12, gain: 0.3 });
    tone(t, { freq: 784, at: 0.24, dur: 0.3, gain: 0.3 });
    crowd(t, 1.6, 0.3);
  },
  fast: (t) => tone(t, { type: 'sawtooth', freq: 260, to: 1100, dur: 0.3, gain: 0.12 }),
  boom: (t) => {
    thud(t, 0, 1);
    tone(t, { type: 'square', freq: 110, to: 40, dur: 0.35, gain: 0.3 });
    crowd(t + 0.05, 0.9, 0.25);
  },
  // A quick swish past, and the crowd's "ooh".
  juke: (t) => {
    hiss(t, { dur: 0.22, gain: 0.35, freq: 2400, to: 600 });
    tone(t, { type: 'triangle', freq: 660, to: 990, at: 0.05, dur: 0.12, gain: 0.25 });
    crowd(t + 0.05, 0.8, 0.2);
  },
  firstdown: (t) => {
    tone(t, { freq: 784, dur: 0.08, gain: 0.28 });
    tone(t, { freq: 988, at: 0.09, dur: 0.08, gain: 0.28 });
    tone(t, { freq: 1175, at: 0.18, dur: 0.2, gain: 0.28 });
  },
  final: (t) => {
    // The horn: two detuned saws, held, under a lowpass so it is not harsh.
    const c = ctx!;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.connect(master!);
    for (const freq of [233, 277, 349]) {
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
      env.gain.setValueAtTime(0.18, t + 0.95);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
      osc.connect(env).connect(filter);
      osc.start(t);
      osc.stop(t + 1.2);
    }
    crowd(t + 0.2, 2.4, 0.35);
  },
};

/** Play a sound now, if sound is on and the audio context has started. */
export function playSound(name: SoundName): void {
  if (!on || !ctx || !master || ctx.state !== 'running') return;
  SOUNDS[name](ctx.currentTime + 0.01);
}
