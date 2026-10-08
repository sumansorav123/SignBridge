// Settings you may want to change. Everything else works as is.

// Class codes are the teacher's PeerJS id without this prefix. Change it if you run your
// own copy so your classes never collide with other SignBridge copies on the public broker.
export const PEER_PREFIX = "signbridge-v1-";

// PeerJS connection options.
//  - Leave host/port/path/secure out to use the free public PeerJS broker.
//  - To use your own broker, uncomment those four lines (see README).
//  - To help strict networks (school or office Wi-Fi), add a TURN server to iceServers.
export const PEER_OPTIONS = {
  // host: "peer.example.com",
  // port: 443,
  // path: "/",
  // secure: true,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
      // { urls: "turn:turn.example.com:3478", username: "USER", credential: "PASSWORD" },
    ],
  },
};

// MediaPipe hand tracking is downloaded the first time it is needed.
const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
export const MEDIAPIPE = {
  bundle: `${MP}/vision_bundle.mjs`,
  wasm: `${MP}/wasm`,
  model:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
};

export const SPEECH_LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ta-IN", label: "Tamil" },
];

// A sign must be seen on this many frames in a row, then the same word waits this long.
export const STABLE_FRAMES = 6;
export const COOLDOWN_MS = 2000;

// How long each sign stays on the student's big display, in milliseconds.
export const SIGN_DISPLAY_MS = 1200;
