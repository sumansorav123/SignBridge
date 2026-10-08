# SignBridge prototype

An AI classroom where teachers and deaf students understand each other. A plain website: HTML + ES modules, **no build step, no npm install**.

- **Voice to sign:** the teacher speaks (or types), the browser turns it into text, and the student's screen shows signs for the words.
- **Sign to voice:** the student signs at the camera, MediaPipe tracks the hands, the shape is matched to a word, and the teacher sees the word and hears it spoken.
- **Sign dictionary:** the teacher saves real signs with the camera. Students receive them automatically when they join.
- **Dashboard and transcripts** for the teacher.

> This rebuild was written from the project summary, not recovered from the earlier prototype code. See "What was and was not tested".

## Files

```
index.html          page shell, loads PeerJS and js/app.js
css/styles.css
js/config.js        settings: PeerJS options, TURN, MediaPipe URLs, thresholds
js/ai.js            hand-shape maths, matching, stabiliser, text-to-signs (no browser APIs)
js/store.js         accounts, signs, class history (localStorage / sessionStorage)
js/speech.js        speech recognition and speech synthesis
js/tracker.js       MediaPipe hand tracking and hand drawing
js/call.js          PeerJS connection, video and messages
js/charts.js        SVG charts
js/app.js           router and all views
tests/ai.test.mjs   unit tests (Node, no packages)
tests/e2e/          optional browser test (needs Playwright, developer only)
```

## Run locally

The camera needs `http://localhost` or `https://`. Opening `index.html` by double-click (`file://`) will not work. Use any static server from this folder:

```
python3 -m http.server 8080
```
or `npx serve .`, then open `http://localhost:8080`.

Use **Chrome or Edge** (speech recognition works best there). You need internet the first time: PeerJS, MediaPipe and its hand model load from CDNs.

## Deploy

The whole folder is the site. Nothing to build.

- **Netlify:** open app.netlify.com/drop and drag the folder in.
- **Vercel:** `npx vercel` in this folder (framework "Other", no build command, output directory `.`), or import the repo and leave the build settings empty.
- **GitHub Pages:** push the folder to a repository, then Settings → Pages → deploy from the main branch, root folder.

Deployed sites use https, so the camera works on every device.

## Try it with two tabs or two devices

1. Tab 1: **Register** as a teacher. Open **Sign dictionary**, type a word (for example `water`), press **Capture in 3 seconds**, and hold a hand shape still. Add a few signs.
2. Teacher home: **Start class**. You get a 6-character code and a join link.
3. Tab 2 (or another device): open the join link, or the site and enter the code. **Register as a student** and press **Join class**.
4. Teacher: **Start speaking** (or type a sentence). The student sees signs.
5. Student: make a saved sign or a built-in gesture. The teacher sees and hears the word.
6. Teacher: **End class** to see the transcript, then the **Dashboard**.

Accounts are stored per device. On two devices, register the teacher on one and the student on the other; the student does not need the teacher's account. Two tabs of one browser share accounts but have separate logins.

## Built-in gestures (placeholders, not real sign language)

open hand = hello, fist = yes, thumbs up = good, one to four fingers = one to four, thumb + index + pinky = love. Teachers should add real signs in the dictionary. Saved signs are checked first, then these.

## Settings (js/config.js, js/ai.js)

- **TURN server** (needed on strict school or office networks): uncomment the `turn:` line in `iceServers` and fill in your server and credentials. Free options are limited; a self-run `coturn` or a paid TURN service is reliable.
- **Your own PeerJS broker** (recommended beyond demos; the free public one has no guarantees):
  `npm install -g peer` then `peerjs --port 9000 --path /signbridge`. Behind https (for example a reverse proxy), set in `config.js`: `host`, `port: 443`, `path: "/signbridge"`, `secure: true`.
- **Matching strictness:** `MATCH_THRESHOLD` in `js/ai.js` (0.35). Raise it if saved signs are not recognised, lower it if different signs get confused. Saved signs are checked before built-ins, so a loose threshold can make a saved sign "steal" a built-in gesture that looks similar.
- **Steady frames and cooldown:** `STABLE_FRAMES` (6) and `COOLDOWN_MS` (2000) in `config.js`.

## Known limits

- Matching compares single hand shapes. **No motion, no sentences, no facial expression.** Real sign languages use all of these, so this is a teaching and demo aid, not a translator.
- Words with no saved sign are shown as spelled-out letters, not as a fingerspelling alphabet.
- One teacher and one student per class. A second student is refused.
- Accounts, signs and history live in this browser only (localStorage). Clearing site data deletes them. Use **Download backup** in the dictionary. Accounts are not secure (hash stored on the device); do not reuse a real password.
- The dictionary is sent to the student when they join. Signs added during a class appear next class.
- If the teacher closes the tab, the class ends for the student. Reloading the page during a class ends it.
- Needs the public PeerJS broker (or yours) and, for some networks, a TURN server. If video does not connect on a strict network, add TURN.
- Teacher and student must both allow the camera and microphone.
- Speech recognition uses the browser's service (in Chrome it sends audio to Google). Not available in Firefox.
- Accessibility is basic (labels, keyboard use, live regions) and has not been checked with a screen reader.

## What was and was not tested

Tested here:
- `node --test tests/ai.test.mjs`: 9 unit tests pass (normalisation, one- and two-hand matching, built-ins, stabiliser, text lookup).
- `python3 tests/e2e/e2e.py`: 81 checks pass in headless Chromium, run twice with the same result. It covers register / login / errors, role guards, dictionary capture with countdown, backup and restore, class start, join link, bad and refused codes, both video panels, dictionary delivery, voice to sign, sign to voice (built-in, one-hand and two-hand taught signs, muted voice), student speech, leave and rejoin, end class, transcript, dashboard.

**Stubbed in that test, so not proven:** PeerJS (replaced by a tab-to-tab fake, so real WebRTC and the public broker were not exercised and the video shown was a fake picture), MediaPipe (hands were injected, so real tracking and the real hand model were not exercised), speech recognition and speech synthesis (faked).

**Not tested at all:** two real devices, a real network or TURN, real hands and a real webcam, real speech, Firefox or Safari, phones, a screen reader. The first run on real hardware may need tuning of `MATCH_THRESHOLD`; real hands vary more than the test shapes.


## Upgrade notes: interactive + API-ready UI

This version keeps the original no-build architecture but adds a more modern responsive classroom UI, live-status indicators, richer teacher analytics, classroom-health metrics, quick visual feedback, and an optional API layer.

### Optional API

The browser remains fully functional with localStorage when no API is configured. To connect a backend, add `?api=https://your-api.example.com` to the URL or set `localStorage.sb.apiBase`. The frontend expects:

- `GET /health` → `{ "status": "ok" }`
- `POST /api/classes` → save a completed class/session
- `GET /api/teachers/{teacherId}/dashboard` → optional remote analytics

The adapter is in `js/api.js`, so a FastAPI/Node backend can be added without rewriting the UI. For production, move accounts, sign dictionaries, class history and analytics from localStorage into a database such as MySQL/PostgreSQL and keep authentication server-side.

### Recommended production AI API

For real sign-language translation, replace the placeholder gesture matcher with a server-side/video model endpoint. A practical architecture is: browser camera → MediaPipe landmarks → `/api/sign/recognize` → ML model → recognised sign + confidence → classroom event. Keep the local matcher as a fallback when the API is unavailable.

## 3D Natural-Language Sign Avatar

SignBridge now includes a procedural browser-based 3D sign avatar for the student classroom.

### Flow

Teacher speaks naturally -> Web Speech Recognition -> speech text is sent through the live PeerJS classroom -> student receives the sentence -> supported sign words are queued -> 3D avatar animates its arms, hands and fingers.

The avatar currently includes demo gesture mappings for words such as `hello`, `thank`, `thanks`, `you`, `yes`, `no`, `good`, `help`, `water`, `please`, `stop`, `welcome`, `class`, `understand`, `repeat`, and `today`.

### Important production note

The procedural avatar is an interactive proof-of-concept, not a validated sign-language translation model. For a real accessibility deployment, replace the gesture map with a linguistically validated sign-language dataset and motion-captured/GLB avatar animations, with language/region support (for example, Indian Sign Language) reviewed by qualified Deaf signers and accessibility experts.

The current architecture is intentionally ready for that replacement: `js/avatar.js` owns the avatar renderer and gesture library, while the live classroom remains responsible for speech transport and sequencing.
