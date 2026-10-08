import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fingerPattern, matchBuiltin, lookupTokens, distance, matchCustom, matchGesture, Stabiliser,
  combineHands, normaliseHand, vectorToHands, isValidVector, MATCH_THRESHOLD,
} from "../js/ai.js";

// Builds a synthetic hand. Fingers: thumb, index, middle, ring, pinky (true = straight).
function hand(fingers, ox = 0, oy = 0, scale = 1) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9, z: 0 }));
  const set = (i, x, y) => (pts[i] = { x, y, z: 0 });
  set(0, 0.5, 0.9);
  set(9, 0.5, 0.65);
  set(17, 0.6, 0.8);
  [[6, 8, 0.45], [10, 12, 0.5], [14, 16, 0.55], [18, 20, 0.58]].forEach(([pip, tip, x], k) => {
    set(pip, x, 0.7);
    set(tip, x, fingers[k + 1] ? 0.5 : 0.8);
  });
  set(3, 0.4, 0.8);
  set(4, fingers[0] ? 0.28 : 0.5, 0.8);
  return pts.map((p) => ({ x: p.x * scale + ox, y: p.y * scale + oy, z: 0 }));
}

test("normalise ignores position and size", () => {
  const a = normaliseHand(hand([true, true, false, false, false]));
  const b = normaliseHand(hand([true, true, false, false, false], 0.2, -0.1, 0.5));
  assert.ok(distance(a, b) < 1e-9);
  assert.equal(a.length, 63);
});

test("combineHands: 63 numbers per hand, left hand first", () => {
  const left = hand([true, true, true, true, true], -0.3);
  const right = hand([false, false, false, false, false], 0.3);
  assert.equal(combineHands([right, left]).length, 126);
  assert.equal(combineHands([right]).length, 63);
  assert.deepEqual(combineHands([right, left]), combineHands([left, right]));
});

test("built-in finger patterns", () => {
  assert.equal(fingerPattern(hand([true, true, true, true, true])), "11111");
  assert.equal(matchBuiltin(hand([false, false, false, false, false])), "yes");
  assert.equal(matchBuiltin(hand([false, true, true, false, false])), "two");
  assert.equal(matchBuiltin(hand([true, true, false, false, true])), "love");
  assert.equal(matchBuiltin(hand([true, false, false, false, true])), null);
});

test("custom signs are matched and beat built-ins", () => {
  const h = hand([false, true, true, false, false]);
  const signs = [{ word: "water", landmarks: normaliseHand(h) }];
  assert.equal(matchCustom(normaliseHand(h), signs), "water");
  assert.equal(matchGesture([h], signs), "water");
  assert.equal(matchGesture([h], []), "two");
  assert.equal(matchGesture([], signs), null);
});

test("different shapes are not matched", () => {
  const signs = [{ word: "water", landmarks: normaliseHand(hand([true, true, true, true, true])) }];
  assert.equal(matchCustom(normaliseHand(hand([false, false, false, false, false])), signs), null);
  assert.equal(MATCH_THRESHOLD, 0.35);
});

test("a two-hand sign only matches two hands", () => {
  const l = hand([true, true, true, true, true], -0.3), r = hand([false, false, false, false, false], 0.3);
  const signs = [{ word: "book", landmarks: combineHands([l, r]) }];
  assert.equal(matchGesture([l, r], signs), "book");
  assert.notEqual(matchGesture([l], signs), "book");
});

test("stabiliser needs steady frames and has a cooldown", () => {
  const s = new Stabiliser(3, 1000);
  assert.equal(s.push("hello", 0), null);
  assert.equal(s.push("hello", 10), null);
  assert.equal(s.push("hello", 20), "hello");
  assert.equal(s.push("hello", 30), null);
  assert.equal(s.push("hello", 2000), "hello");
  assert.equal(s.push(null, 2100), null);
  const d = new Stabiliser();
  assert.equal(d.framesNeeded, 6);
  assert.equal(d.cooldownMs, 2000);
});

test("lookup prefers phrases, then built-ins, then fingerspelling", () => {
  const signs = [{ word: "thank you", landmarks: [1] }, { word: "water", landmarks: [2] }];
  const t = lookupTokens("Hello, thank you for the water!", signs);
  assert.deepEqual(t.map((x) => `${x.kind}:${x.label}`), ["builtin:hello", "custom:thank you", "spell:for", "spell:the", "custom:water"]);
});

test("saved vectors round-trip to hands for drawing and validate", () => {
  const v = combineHands([hand([true, false, false, false, true])]);
  const hs = vectorToHands(v);
  assert.equal(hs.length, 1);
  assert.equal(hs[0].length, 21);
  assert.ok(isValidVector(v));
  assert.ok(!isValidVector([1, 2, 3]));
  assert.ok(!isValidVector(v.map(() => NaN)));
});
