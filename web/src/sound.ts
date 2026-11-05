// Kuribotas' own sounds, made in code: no audio files, nothing recorded or copied from anyone.
// Nudge: pots falling in the kitchen, and a lid left spinning on the floor.
// Tornado: a batucada with heavy bass that speeds up and drops into a kuduro-style beat.
// A family server can replace either with its own files (<data>/sounds/nudge.mp3, tornado.mp3)
// and offer extra nudges (nudge-<name>.mp3) that each device picks with /som. Those files stay
// private, outside Git and the image, and are fetched once when sound is unlocked.
// Browsers only allow sound after the person has touched the page once, so the first
// tap or key press "unlocks" it; before that, nudges are silent (they still shake).

let ctx: AudioContext | null = null;
let shaper: WaveShaperNode | null = null;
let familyLoading = false;
const family = new Map<string, AudioBuffer>(); // "nudge", "nudge-3", "tornado"…
let nudgeChoice: string | null = null; // what this device picked with /som (null = the default)

// The nudge sounds this device can pick: the default, each extra file, and the pots made in code.
export const DEFAULT_SOUND = "padrao";
export const BUILT_IN_SOUND = "panelas";

export function nudgeChoices(files: readonly string[]): string[] {
  const extras = files.filter((f) => f.startsWith("nudge-")).map((f) => f.slice("nudge-".length));
  return [DEFAULT_SOUND, ...extras, BUILT_IN_SOUND];
}

// Which sound to play for a nudge, given this device's choice and the files loaded.
// A choice whose file has gone falls back to the default; no default file means the pots.
export function nudgeSource(choice: string | null, files: readonly string[]): string {
  if (choice === BUILT_IN_SOUND) return BUILT_IN_SOUND;
  if (choice !== null && choice !== DEFAULT_SOUND && files.includes(`nudge-${choice}`)) return `nudge-${choice}`;
  return files.includes("nudge") ? "nudge" : BUILT_IN_SOUND;
}

// How long the tornado shakes: as long as the family's tornado sound, or 2.5 s for the built-in one.
export function tornadoSeconds(): number {
  return family.get("tornado")?.duration ?? 2.5;
}

export function availableNudges(): string[] {
  return nudgeChoices([...family.keys()]);
}

export function setNudgeSound(choice: string | null): void {
  nudgeChoice = choice;
}

export function unlockSound(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (!familyLoading) {
      familyLoading = true;
      void loadFamilySounds(ctx);
    }
  } catch {
    ctx = null; // no Web Audio here: nudges stay silent
  }
}

export function playNudge(tornado: boolean): void {
  if (ctx === null || ctx.state !== "running") return;
  const start = ctx.currentTime + 0.03;
  if (tornado) {
    const own = family.get("tornado");
    if (own !== undefined) playBuffer(ctx, own, start);
    else batucadaKuduro(ctx, start);
    return;
  }
  const source = nudgeSource(nudgeChoice, [...family.keys()]);
  const own = family.get(source);
  if (own !== undefined) playBuffer(ctx, own, start);
  else fallingPots(ctx, start);
}

// Asks the server which family sounds exist, then fetches only those (no 404s in the console).
// Any failure just leaves the sounds made in code in place.
async function loadFamilySounds(c: AudioContext): Promise<void> {
  try {
    const res = await fetch("/sounds/available", { cache: "no-cache" });
    if (!res.ok) return;
    const body = (await res.json()) as { files?: unknown };
    const files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === "string") : [];
    for (const name of files) {
      const file = await fetch(`/sounds/${encodeURIComponent(name)}.mp3`, { cache: "no-cache" });
      if (file.ok) family.set(name, await c.decodeAudioData(await file.arrayBuffer()));
    }
  } catch {
    // offline, old server, or a file the browser can't decode: keep the built-in sounds
  }
}

function playBuffer(c: AudioContext, buffer: AudioBuffer, at: number): void {
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.connect(c.destination);
  src.start(at);
}

// Android vibrates; iPhones don't let web pages do it, so there it's only the shake.
export function vibrate(tornado: boolean): void {
  if (!("vibrate" in navigator)) return;
  try {
    navigator.vibrate(tornado ? [150, 50, 200, 50, 250, 50, 300, 50, 500] : [300, 80, 300, 80, 300]);
  } catch {
    // not allowed right now: fine
  }
}

// --- the nudge -------------------------------------------------------------------------------

function fallingPots(c: AudioContext, t: number): void {
  clang(c, t, 310, 0.16, 0.8); // the big pot
  clang(c, t + 0.09, 520, 0.12, 0.5); // a smaller one
  clang(c, t + 0.15, 240, 0.1, 0.7); // it bounces
  clang(c, t + 0.25, 690, 0.09, 0.4); // a lid
  // ...which spins on the floor: hits that get faster and quieter, then stop.
  let at = t + 0.4;
  let gap = 0.11;
  let vol = 0.07;
  for (let i = 0; i < 16; i++) {
    clang(c, at, i % 2 === 0 ? 820 : 853, vol, 0.12);
    at += gap;
    gap *= 0.86;
    vol *= 0.9;
  }
}

// Metal: a few out-of-tune partials (like a real pot, not a musical note) that ring and fade,
// slightly different every time, plus a clack.
function clang(c: AudioContext, at: number, base: number, vol: number, ring: number): void {
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.32, 0.7, 0.8],
    [4.25, 0.5, 0.55],
    [6.63, 0.35, 0.4],
    [9.38, 0.2, 0.3],
  ];
  for (const [ratio, level, decay] of partials) {
    const end = at + ring * decay;
    envelope(c, at, end, vol * level, osc(c, "sine", base * ratio * (1 + (Math.random() - 0.5) * 0.02), at, end));
  }
  noise(c, at, 0.03, vol * 2.5, "highpass", 2500, 0.7);
}

// --- the tornado ------------------------------------------------------------------------------

const KUDURO_BPM = 140;
// One bar in 16ths: K kick, C clap, T tom, h hi-hat. Kick on every beat with a push before the 4th,
// claps on 2 and 4, toms answering in between.
const KUDURO: Record<"K" | "C" | "T" | "h", string> = {
  K: "K...K...K.K.K...",
  C: "....C.......C...",
  T: "..T....T..T...T.",
  h: "hhhhhhhhhhhhhhhh",
};

function batucadaKuduro(c: AudioContext, t: number): void {
  // The batucada: deep drums speeding up, a slap on every third hit.
  let at = t;
  let gap = 0.26;
  for (let i = 0; i < 7; i++) {
    if (i % 3 === 2) {
      slap(c, at, 0.3 + i * 0.015);
      boom(c, at, 0.3, 0.2, 90, 55);
    } else {
      boom(c, at, 0.5 + i * 0.03, 0.4);
    }
    at += gap;
    gap *= 0.82;
  }
  // ...drops into 12 steps of kuduro, and lands on one big hit.
  const step = 60 / KUDURO_BPM / 4;
  for (let i = 0; i < 12; i++) {
    const s = at + i * step;
    if (KUDURO.K[i] === "K") boom(c, s, 0.65, 0.42);
    if (KUDURO.C[i] === "C") clap(c, s);
    if (KUDURO.T[i] === "T") tom(c, s);
    if (KUDURO.h[i] === "h") noise(c, s, 0.04, 0.06, "highpass", 7000, 0.7);
  }
  boom(c, at + 12 * step, 0.9, 0.9, 70, 30);
}

// Bass that phones can hear: a deep sine (felt on speakers and headphones) plus a saturated
// copy an octave up (phone speakers barely play below 100 Hz).
function boom(c: AudioContext, at: number, vol: number, dur: number, top = 110, bottom = 38): void {
  const end = at + dur;
  for (const [mult, level, out] of [
    [1, vol, c.destination],
    [2, vol * 0.35, drive(c)],
  ] as const) {
    const o = osc(c, "sine", top * mult, at, end);
    o.frequency.exponentialRampToValueAtTime(bottom * mult, at + dur * 0.6);
    envelope(c, at, end, level, o, out);
  }
}

function drive(c: AudioContext): WaveShaperNode {
  if (shaper === null) {
    shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(3 * ((i / (curve.length - 1)) * 2 - 1));
    shaper.curve = curve;
    shaper.connect(c.destination);
  }
  return shaper;
}

function slap(c: AudioContext, at: number, vol: number): void {
  noise(c, at, 0.12, vol, "bandpass", 1800, 0.8);
  const o = osc(c, "triangle", 330, at, at + 0.08);
  o.frequency.exponentialRampToValueAtTime(180, at + 0.08);
  envelope(c, at, at + 0.08, vol * 0.5, o);
}

function clap(c: AudioContext, at: number): void {
  for (const s of [0, 0.012, 0.024]) noise(c, at + s, 0.09, 0.3, "bandpass", 1300, 1.2);
}

function tom(c: AudioContext, at: number): void {
  const o = osc(c, "sine", 160, at, at + 0.18);
  o.frequency.exponentialRampToValueAtTime(96, at + 0.18);
  envelope(c, at, at + 0.18, 0.25, o);
}

// --- building blocks --------------------------------------------------------------------------

function osc(c: AudioContext, type: OscillatorType, freq: number, at: number, end: number): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  o.start(at);
  o.stop(end + 0.02);
  return o;
}

// Quick attack, exponential fade: every hit sounds struck, never clicks.
function envelope(c: AudioContext, at: number, end: number, vol: number, source: AudioNode, out: AudioNode = c.destination): void {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  source.connect(g).connect(out);
}

function noise(
  c: AudioContext,
  at: number,
  dur: number,
  vol: number,
  type: BiquadFilterType,
  freq: number,
  q: number,
): void {
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  src.connect(filter);
  envelope(c, at, at + dur, vol, filter);
  src.start(at);
  src.stop(at + dur);
}
