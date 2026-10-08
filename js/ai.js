// Hand-shape logic. No browser APIs here, so it can be tested with Node.
import { STABLE_FRAMES, COOLDOWN_MS } from "./config.js";

// Joints that connect the 21 hand points (used for drawing).
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// Average distance per landmark, in hand-size units, below which two shapes count as the same.
// Raise it if saved signs are not recognised, lower it if different signs get confused.
export const MATCH_THRESHOLD = 0.35;

/**
 * 21 landmarks -> 63 numbers that do not depend on where the hand is in the picture or how
 * big it looks: the wrist becomes the origin and all is divided by the wrist-to-middle-base distance.
 */
export function normaliseHand(points) {
  const w = points[0];
  const shifted = points.map((p) => ({ x: p.x - w.x, y: p.y - w.y, z: (p.z || 0) - (w.z || 0) }));
  const ref = shifted[9];
  const scale = Math.hypot(ref.x, ref.y, ref.z) || 1;
  return shifted.flatMap((p) => [p.x / scale, p.y / scale, p.z / scale]);
}

/** One or two hands as one vector. Two hands are ordered left to right in the picture. */
export function combineHands(hands) {
  const used = hands.filter((h) => h && h.length === 21).slice(0, 2);
  const ordered = [...used].sort((a, b) => a[0].x - b[0].x);
  return ordered.flatMap(normaliseHand);
}

/** Splits a saved vector back into hands of 21 {x, y, z} points (for drawing). */
export function vectorToHands(vec) {
  const hands = [];
  for (let h = 0; h + 63 <= vec.length; h += 63) {
    const pts = [];
    for (let i = 0; i < 21; i++) pts.push({ x: vec[h + i * 3], y: vec[h + i * 3 + 1], z: vec[h + i * 3 + 2] });
    hands.push(pts);
  }
  return hands;
}

export function isValidVector(v) {
  return Array.isArray(v) && (v.length === 63 || v.length === 126) && v.every((n) => Number.isFinite(n));
}

// ---- Built-in placeholder gestures (NOT real sign language) ----
// Pattern order: thumb, index, middle, ring, pinky (1 = straight).
export const BUILTIN_BY_PATTERN = {
  "11111": { word: "hello", emoji: "✋" },
  "00000": { word: "yes", emoji: "✊" },
  "10000": { word: "good", emoji: "👍" },
  "01000": { word: "one", emoji: "☝️" },
  "01100": { word: "two", emoji: "✌️" },
  "01110": { word: "three", emoji: "3️⃣" },
  "01111": { word: "four", emoji: "4️⃣" },
  "11001": { word: "love", emoji: "🤟" },
};
export const BUILTIN_BY_WORD = Object.fromEntries(Object.values(BUILTIN_BY_PATTERN).map((b) => [b.word, b]));

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Which of the five fingers are straight, as a string such as "01100". */
export function fingerPattern(p) {
  const wrist = p[0];
  const straight = (tip, pip) => d2(p[tip], wrist) > d2(p[pip], wrist) * 1.15;
  // The thumb folds across the palm, so compare against the base of the little finger.
  const thumb = d2(p[4], p[17]) > d2(p[3], p[17]) * 1.1;
  return [thumb, straight(8, 6), straight(12, 10), straight(16, 14), straight(20, 18)]
    .map((v) => (v ? "1" : "0"))
    .join("");
}

export function matchBuiltin(hand) {
  if (!hand || hand.length !== 21) return null;
  return BUILTIN_BY_PATTERN[fingerPattern(hand)]?.word ?? null;
}

// ---- Matching ----
export function distance(a, b) {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / (a.length / 3));
}

/** Nearest saved sign, or null when nothing is close enough. */
export function matchCustom(vec, signs, threshold = MATCH_THRESHOLD) {
  let best = null;
  for (const s of signs) {
    const d = distance(vec, s.landmarks);
    if (!best || d < best.d) best = { word: s.word, d };
  }
  return best && best.d <= threshold ? best.word : null;
}

/** Saved signs win; then the built-in gestures (one hand only). */
export function matchGesture(hands, signs) {
  if (!hands || !hands.length) return null;
  const custom = signs.length ? matchCustom(combineHands(hands), signs) : null;
  if (custom) return custom;
  return hands.length === 1 ? matchBuiltin(hands[0]) : null;
}

/** A word is reported only after steady frames, and the same word is not repeated straight away. */
export class Stabiliser {
  constructor(framesNeeded = STABLE_FRAMES, cooldownMs = COOLDOWN_MS) {
    this.framesNeeded = framesNeeded;
    this.cooldownMs = cooldownMs;
    this.current = null;
    this.count = 0;
    this.lastEmit = new Map();
  }
  push(word, now = Date.now()) {
    if (word !== this.current) {
      this.current = word;
      this.count = 0;
    }
    if (!word) return null;
    this.count++;
    if (this.count < this.framesNeeded) return null;
    const last = this.lastEmit.get(word) ?? -Infinity;
    if (now - last < this.cooldownMs) return null;
    this.lastEmit.set(word, now);
    return word;
  }
}

// ---- Text -> signs ----
export function tokenise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Splits a sentence into words and short phrases (up to 3 words) and finds a sign for each:
 * teacher's saved signs first, then built-in gestures, then spelling the word out.
 */
export function lookupTokens(text, signs) {
  const words = tokenise(text);
  const custom = new Map();
  for (const s of signs) custom.set(s.word.toLowerCase().trim(), s.landmarks); // later entries win
  const out = [];
  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let n = Math.min(3, words.length - i); n >= 1; n--) {
      const phrase = words.slice(i, i + n).join(" ");
      const lm = custom.get(phrase);
      if (lm) {
        out.push({ kind: "custom", label: phrase, landmarks: lm });
        i += n;
        matched = true;
        break;
      }
      if (n === 1 && BUILTIN_BY_WORD[phrase]) {
        out.push({ kind: "builtin", label: phrase, emoji: BUILTIN_BY_WORD[phrase].emoji });
        i += 1;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push({ kind: "spell", label: words[i] });
      i += 1;
    }
  }
  return out;
}
