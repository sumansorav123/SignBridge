// MediaPipe hand tracking (loaded from a CDN on first use) and hand drawing.
import { MEDIAPIPE } from "./config.js";
import { HAND_CONNECTIONS, vectorToHands } from "./ai.js";

let landmarkerPromise = null;

export function loadLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const mp = await import(MEDIAPIPE.bundle);
      const fileset = await mp.FilesetResolver.forVisionTasks(MEDIAPIPE.wasm);
      const make = (delegate) =>
        mp.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MEDIAPIPE.model, delegate },
          runningMode: "VIDEO",
          numHands: 2,
        });
      try {
        return await make("GPU");
      } catch {
        return await make("CPU");
      }
    })();
    landmarkerPromise.catch(() => {
      landmarkerPromise = null; // allow a retry
    });
  }
  return landmarkerPromise;
}

/**
 * Runs hand tracking on a playing <video>. Calls onHands(hands) every frame with an array of
 * hands (each 21 {x, y, z} points, 0..1 across the picture). Returns a stop function.
 */
export async function startTracking(video, onHands) {
  const landmarker = await loadLandmarker();
  let stopped = false;
  let lastTime = -1;
  const loop = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      try {
        const res = landmarker.detectForVideo(video, performance.now());
        onHands(res.landmarks || []);
      } catch {
        /* skip a bad frame */
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return () => {
    stopped = true;
  };
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawPoints(ctx, pts, dotR) {
  ctx.strokeStyle = "#2457d6";
  ctx.fillStyle = "#e8590c";
  ctx.lineWidth = Math.max(2, dotR * 0.8);
  ctx.lineCap = "round";
  for (const [a, b] of HAND_CONNECTIONS) line(ctx, pts[a], pts[b]);
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === 0 ? dotR * 1.6 : dotR, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Draws a saved sign (63 or 126 numbers) as a skeleton, scaled to fit the canvas. */
export function drawSign(canvas, vec) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const hands = vectorToHands(vec).map((h, k) => h.map((p) => ({ x: p.x + k * 2.8, y: p.y })));
  const all = hands.flat();
  if (!all.length) return;
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 0.12 * Math.min(canvas.width, canvas.height);
  const s = Math.min((canvas.width - 2 * pad) / (maxX - minX || 1), (canvas.height - 2 * pad) / (maxY - minY || 1));
  const ox = (canvas.width - (maxX - minX) * s) / 2 - minX * s;
  const oy = (canvas.height - (maxY - minY) * s) / 2 - minY * s;
  const dotR = Math.max(2, canvas.width / 60);
  for (const h of hands) drawPoints(ctx, h.map((p) => ({ x: p.x * s + ox, y: p.y * s + oy })), dotR);
}

/** Draws live tracked hands over a video (canvas is sized to the video). */
export function drawLive(canvas, video, hands) {
  const w = video.videoWidth || 640, h = video.videoHeight || 480;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  for (const hand of hands) drawPoints(ctx, hand.map((p) => ({ x: p.x * w, y: p.y * h })), 4);
}
