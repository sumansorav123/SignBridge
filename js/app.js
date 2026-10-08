import { SPEECH_LANGUAGES, SIGN_DISPLAY_MS } from "./config.js";
import { Stabiliser, lookupTokens, matchGesture, combineHands, BUILTIN_BY_WORD } from "./ai.js";
import * as store from "./store.js";
import { startListening, speak, recognitionSupported } from "./speech.js";
import { startTracking, drawSign, drawLive } from "./tracker.js";
import { getLocalMedia, stopStream, makeCode, cleanCode, openTeacherSession, joinClass } from "./call.js";
import { barChart, hBarChart } from "./charts.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const app = $("#app");

let cleanups = []; // run whenever the page changes
let live = null; // the class in progress on this tab (teacher or student), if any

// ---------- small helpers ----------
let flashTimer;
function notify(msg) {
  $("#flash").innerHTML = `<div class="msg">${esc(msg)}</div>`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ($("#flash").innerHTML = ""), 6000);
}
function redirect(path) {
  const target = "#" + path;
  if (location.hash === target) render();
  else location.replace(target);
}
const cameraMessage = (e) =>
  e && (e.name === "NotAllowedError" || e.name === "SecurityError")
    ? "Camera or microphone permission was blocked. Allow it in the browser and try again."
    : e && e.name === "NotFoundError"
    ? "No camera or microphone was found."
    : (e && e.message) || "Could not start the camera.";

function shell(user, inner, active = "") {
  let nav = "";
  if (live) {
    nav = `<span class="muted">Class in progress</span>`;
  } else if (user) {
    const link = (href, label, key) => `<a href="${href}" class="${active === key ? "active" : ""}">${label}</a>`;
    nav =
      user.role === "teacher"
        ? link("#/teacher", "Home", "home") + link("#/teacher/dictionary", "Sign dictionary", "dict") + link("#/teacher/dashboard", "Dashboard", "dash")
        : link("#/student", "Join a class", "home");
    nav += `<span class="muted small">${esc(user.name)} (${user.role})</span><button id="logout">Log out</button>`;
  } else {
    nav = `<a href="#/login">Log in</a><a href="#/register">Register</a>`;
  }
  app.innerHTML = `<header class="top"><a class="brand" href="#/">🤟 SignBridge</a><nav>${nav}</nav></header><main>${inner}</main>`;
  $("#logout")?.addEventListener("click", () => {
    store.logout();
    redirect("/");
  });
}

// ---------- router ----------
async function render() {
  cleanups.forEach((f) => {
    try {
      f();
    } catch {}
  });
  cleanups = [];
  const user = store.currentUser();
  const [a, b, c] = location.hash.slice(1).split("/").filter(Boolean);

  // While a class is running on this tab, only the class page is available.
  if (live && live.role === "teacher" && !(a === "teacher" && b === "class")) return redirect("/teacher/class");
  if (live && live.role === "student" && !(a === "student" && b === "class")) return redirect("/student/class");

  if (a === "teacher" || a === "student") {
    if (!user) return redirect("/login");
    if (user.role !== a) {
      notify(`That page is for ${a}s. You are signed in as a ${user.role}.`);
      return redirect("/" + user.role);
    }
  }
  if ((a === "login" || a === "register") && user) return redirect("/" + user.role);

  if (!a) return landing(user);
  if (a === "login") return authPage("login");
  if (a === "register") return authPage("register");
  if (a === "teacher" && !b) return teacherHome(user);
  if (a === "teacher" && b === "class") return teacherClass(user);
  if (a === "teacher" && b === "dictionary") return dictionaryPage(user);
  if (a === "teacher" && b === "dashboard") return dashboardPage(user);
  if (a === "teacher" && b === "transcript") return transcriptPage(user, c);
  if (a === "student" && !b) return studentJoin(user);
  if (a === "student" && b === "class") return studentClass(user);
  return redirect("/");
}

// ---------- landing and auth ----------
function landing(user) {
  shell(
    user,
    `<section class="hero"><h1>An AI classroom where teachers and deaf students understand each other</h1>
    <p>The teacher speaks and the student sees signs. The student signs and the teacher reads and hears the words.
    Teachers teach the app new signs in their own sign dictionary.</p>
    <div class="row">${
      user
        ? `<a class="btn primary" href="#/${user.role}">Go to my page</a>`
        : `<a class="btn primary" href="#/register">Create an account</a><a class="btn" href="#/login">Log in</a>`
    }</div></section>
    <div class="grid g3">
      <div class="card"><h2>Voice to sign</h2><p>Speech is turned into text, then into signs the student can see.</p></div>
      <div class="card"><h2>Sign to voice</h2><p>The camera tracks the student's hands and the teacher sees and hears the word.</p></div>
      <div class="card"><h2>Your own signs</h2><p>Teachers save real signs in a dictionary. Students receive them when they join.</p></div>
    </div>
    <p class="notice"><strong>Prototype.</strong> Accounts and history are stored only in this browser. The built-in gestures (open hand = hello, fist = yes, thumbs up = good…) are placeholders, not real sign language. Do not reuse a real password.</p>`
  );
}

function authPage(mode) {
  const reg = mode === "register";
  shell(
    null,
    `<div class="card" style="max-width:440px;margin:1rem auto"><h1>${reg ? "Create an account" : "Log in"}</h1>
    <form id="auth-form" novalidate>
      ${reg ? `<label for="name">Name</label><input id="name" type="text" autocomplete="name">` : ""}
      <label for="email">Email</label><input id="email" type="email" autocomplete="email">
      <label for="password">Password${reg ? " (6+ characters)" : ""}</label><input id="password" type="password" autocomplete="${reg ? "new-password" : "current-password"}">
      ${reg ? `<label>I am a</label><div class="radios"><label><input type="radio" name="role" value="teacher" checked> Teacher</label><label><input type="radio" name="role" value="student"> Student</label></div>` : ""}
      <p class="error" id="form-error" role="alert"></p>
      <button class="primary" id="submit" type="submit">${reg ? "Register" : "Log in"}</button>
    </form>
    <p class="small muted">${reg ? `Already registered? <a href="#/login">Log in</a>` : `New here? <a href="#/register">Create an account</a>`}</p></div>`
  );
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#submit");
    btn.disabled = true;
    $("#form-error").textContent = "";
    const r = reg
      ? await store.register({ name: $("#name").value, email: $("#email").value, password: $("#password").value, role: $("input[name=role]:checked").value })
      : await store.login($("#email").value, $("#password").value);
    btn.disabled = false;
    if (r.error) return ($("#form-error").textContent = r.error);
    redirect("/" + r.user.role);
  });
}

// ---------- teacher: home ----------
function teacherHome(user) {
  const classes = store.getClasses(user.id);
  const nSigns = store.getSigns(user.id).length;
  const dur = (c) => (c.endedAt ? (c.endedAt - c.startedAt < 60000 ? "<1 min" : Math.round((c.endedAt - c.startedAt) / 60000) + " min") : "not ended");
  shell(
    user,
    `<h1>Welcome, ${esc(user.name)}</h1>
    <div class="grid g2">
      <div class="card"><h2>Start a class</h2>
        <p class="muted small">You have <strong id="sign-count">${nSigns}</strong> saved sign${nSigns === 1 ? "" : "s"}. ${nSigns ? "" : `<a href="#/teacher/dictionary">Add some first</a> so students see your real signs.`}</p>
        <label for="lang">Language you will speak</label>
        <select id="lang">${SPEECH_LANGUAGES.map((l) => `<option value="${l.code}">${l.label}</option>`).join("")}</select>
        <p class="error" id="start-error" role="alert"></p>
        <button class="primary" id="start-class">Start class</button>
        <p class="small muted">You will get a class code and a join link to give your student. Your camera and microphone are used.</p></div>
      <div class="card"><h2>Past classes</h2>${
        classes.length
          ? `<table><thead><tr><th>Date</th><th>Student</th><th>Length</th><th></th></tr></thead><tbody>${classes
              .map(
                (c) =>
                  `<tr><td>${new Date(c.startedAt).toLocaleString()}</td><td>${esc(c.studentName || "—")}</td><td>${dur(c)}</td><td><a href="#/teacher/transcript/${c.id}">Transcript</a></td></tr>`
              )
              .join("")}</tbody></table>`
          : `<p class="muted">No classes yet.</p>`
      }</div>
    </div>`,
    "home"
  );
  $("#start-class").addEventListener("click", async () => {
    const btn = $("#start-class");
    btn.disabled = true;
    $("#start-error").textContent = "";
    try {
      await startClass(user, $("#lang").value);
      redirect("/teacher/class");
    } catch (e) {
      $("#start-error").textContent = e.name ? cameraMessage(e) : e.message;
      btn.disabled = false;
    }
  });
}

// ---------- teacher: running a class ----------
async function startClass(user, lang) {
  const stream = await getLocalMedia();
  const l = {
    role: "teacher", user, stream, lang, session: null, code: "", cls: null,
    status: "Waiting for the student to join…", stopListen: null, remoteStream: null, speakAloud: true,
  };
  try {
    let session = null;
    for (let i = 0; i < 4 && !session; i++) {
      const code = makeCode();
      try {
        session = await openTeacherSession(code, stream, teacherHandlers(l));
        l.code = code;
      } catch (e) {
        if (e.type !== "unavailable-id") {
          throw new Error(e.type === "timeout" ? "Could not reach the PeerJS server. Check your internet connection." : e.message || "Could not open the class.");
        }
      }
    }
    if (!session) throw new Error("Could not get a free class code. Please try again.");
    l.session = session;
    l.cls = { id: store.uid(), code: l.code, teacherId: user.id, studentName: "", startedAt: Date.now(), endedAt: null, entries: [] };
    store.saveClass(l.cls);
  } catch (e) {
    stopStream(stream);
    throw e;
  }
  live = l;
}

function teacherHandlers(l) {
  return {
    onStudentConnected: () => tStatus(l, "A student is connecting…"),
    onStudentStream: (s) => {
      l.remoteStream = s;
      if (live === l && $("#remote-video")) $("#remote-video").srcObject = s;
    },
    onStudentLeft: () => tStatus(l, `${l.cls.studentName || "The student"} left. They can rejoin with the same code.`),
    onError: (e) => tStatus(l, "Connection problem: " + (e.message || e.type)),
    onData: (d) => {
      if (!d || typeof d !== "object") return;
      if (d.t === "join") {
        l.cls.studentName = String(d.name || "Student").slice(0, 60);
        store.saveClass(l.cls);
        l.session.send({ t: "welcome", teacher: l.user.name });
        l.session.send({ t: "dict", signs: store.getSigns(l.user.id) });
        tStatus(l, `${l.cls.studentName} joined.`);
      } else if (d.t === "sign" && typeof d.word === "string") {
        const word = d.word.slice(0, 60);
        addEntry(l, "student", "sign", word);
        if (l.speakAloud) speak(word, l.lang);
      } else if (d.t === "speech" && typeof d.text === "string") {
        addEntry(l, "student", "student-speech", d.text.slice(0, 500));
      }
    },
  };
}

function tStatus(l, text) {
  l.status = text;
  if (live === l && $("#status")) $("#status").textContent = text;
}

function addEntry(l, from, kind, text, extra = {}) {
  const e = { at: Date.now(), from, kind, text, ...extra };
  l.cls.entries.push(e);
  store.saveClass(l.cls);
  if (live === l) {
    const box = kind === "speech" ? $("#teacher-log") : $("#recv-log");
    if (box) appendTeacherLine(box, e);
  }
}

const LABELS = { speech: "You said", sign: "Student signed", "student-speech": "Student said" };
function appendTeacherLine(box, e) {
  const div = document.createElement("div");
  div.dataset.kind = e.kind;
  div.textContent = `${timeOf(e.at)}  ${LABELS[e.kind]}: ${e.text}${e.delivered === false ? "  (no student connected, not delivered)" : ""}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function teacherSay(l, text) {
  const delivered = l.session.send({ t: "speech", text });
  addEntry(l, "teacher", "speech", text, { delivered });
}

function teacherClass(user) {
  if (!live || live.role !== "teacher") return redirect("/teacher");
  const l = live;
  const link = `${location.origin}${location.pathname}?join=${l.code}`;
  shell(
    user,
    `<div class="card"><div class="row">
      <div><div class="muted small">Class code</div><div class="code" id="class-code">${l.code}</div></div>
      <div class="row" style="margin-left:auto"><button id="copy-link">Copy join link</button><button class="danger" id="btn-end">End class</button></div></div>
      <p id="status" class="muted" role="status">${esc(l.status)}</p>
      <p class="small muted">Join link: <span id="join-link">${esc(link)}</span></p></div>
    <div class="grid g2">
      <div class="card"><h2>Video</h2>
        <div class="video"><video id="remote-video" autoplay playsinline></video><span class="tag">Student</span></div>
        <div class="video pip"><div class="mirror"><video id="local-video" muted autoplay playsinline></video></div><span class="tag">You</span></div></div>
      <div class="card"><h2>Speak to the student</h2>
        <div class="row"><select id="speech-lang" aria-label="Speech language">${SPEECH_LANGUAGES.map((x) => `<option value="${x.code}" ${x.code === l.lang ? "selected" : ""}>${x.label}</option>`).join("")}</select>
        <button class="primary" id="btn-speak">Start speaking</button></div>
        <p class="muted small" id="interim" aria-live="polite"></p><p class="error small" id="speech-error"></p>
        <form id="typed-form" class="row"><input type="text" id="typed" placeholder="Or type a sentence…" aria-label="Type a sentence" style="flex:1"><button type="submit">Send</button></form>
        <div class="log" id="teacher-log" aria-label="What you said"></div>
        <h2>From the student</h2>
        <label style="font-weight:500"><input type="checkbox" id="voice-on" ${l.speakAloud ? "checked" : ""}> Read the student's signs aloud</label>
        <div class="log" id="recv-log" aria-label="From the student"></div></div>
    </div>`
  );
  $("#local-video").srcObject = l.stream;
  if (l.remoteStream) $("#remote-video").srcObject = l.remoteStream;
  l.cls.entries.forEach((e) => appendTeacherLine(e.kind === "speech" ? $("#teacher-log") : $("#recv-log"), e));
  if (!recognitionSupported()) $("#speech-error").textContent = "This browser has no speech recognition. Use Chrome or Edge, or type your sentences.";

  $("#voice-on").addEventListener("change", (e) => (l.speakAloud = e.target.checked));
  $("#speech-lang").addEventListener("change", (e) => {
    l.lang = e.target.value;
    if (l.stopListen) {
      toggleSpeaking(l, false);
      toggleSpeaking(l, true);
    }
  });
  $("#btn-speak").addEventListener("click", () => toggleSpeaking(l, !l.stopListen));
  if (l.stopListen) $("#btn-speak").textContent = "Stop speaking";
  $("#typed-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("#typed").value.trim();
    if (t) teacherSay(l, t.slice(0, 500));
    $("#typed").value = "";
  });
  $("#copy-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify("Join link copied.");
    } catch {
      notify("Copy failed. Select the link and copy it by hand.");
    }
  });
  $("#btn-end").addEventListener("click", () => endClass(l));
}

function toggleSpeaking(l, on) {
  const btn = $("#btn-speak");
  if (on) {
    l.stopListen = startListening({
      lang: l.lang,
      onFinal: (t) => teacherSay(l, t),
      onInterim: (t) => {
        if (live === l && $("#interim")) $("#interim").textContent = t;
      },
      onError: (m) => {
        if ($("#speech-error")) $("#speech-error").textContent = m;
      },
    });
    if (btn) btn.textContent = "Stop speaking";
  } else {
    l.stopListen?.();
    l.stopListen = null;
    if (btn) btn.textContent = "Start speaking";
  }
}

function endClass(l) {
  l.stopListen?.();
  l.cls.endedAt = Date.now();
  store.saveClass(l.cls);
  l.session.send({ t: "end" });
  const id = l.cls.id;
  setTimeout(() => l.session.close(), 400);
  stopStream(l.stream);
  live = null;
  redirect("/teacher/transcript/" + id);
}

// If the tab is closed during a class, still record that it ended.
window.addEventListener("pagehide", () => {
  if (live && live.role === "teacher" && live.cls && !live.cls.endedAt) {
    live.cls.endedAt = Date.now();
    store.saveClass(live.cls);
  }
});

// ---------- teacher: sign dictionary ----------
function dictionaryPage(user) {
  shell(
    user,
    `<h1>Sign dictionary</h1>
    <div class="grid g2">
      <div class="card"><h2>Teach a new sign</h2>
        <div class="video"><div class="mirror"><video id="cam" muted autoplay playsinline></video><canvas id="overlay"></canvas></div></div>
        <p class="small muted" id="track-status">Starting camera…</p>
        <label for="sign-word">What does this sign mean?</label>
        <input type="text" id="sign-word" placeholder="e.g. water or thank you" maxlength="40">
        <div class="countdown" id="countdown" aria-live="assertive"></div>
        <p class="error" id="dict-error" role="alert"></p>
        <button class="primary" id="capture-btn">Capture in 3 seconds</button>
        <p class="small muted">Type the word, press the button, then hold your hand shape still in front of the camera. One or two hands are saved. Use the same hand position when you sign it in class.</p></div>
      <div class="card"><h2>Saved signs (<span id="sign-total">0</span>)</h2>
        <div class="signs-list" id="signs-list"></div>
        <div class="row" style="margin-top:1rem"><button id="backup-btn">Download backup</button>
        <label class="btn" for="restore-input" style="margin:0;font-weight:500">Restore from file</label>
        <input type="file" id="restore-input" accept="application/json,.json" hidden></div>
        <p class="small" id="restore-msg" role="status"></p></div>
    </div>`,
    "dict"
  );
  const list = $("#signs-list");
  function refresh() {
    const signs = store.getSigns(user.id).sort((a, b) => a.word.localeCompare(b.word));
    $("#sign-total").textContent = signs.length;
    list.innerHTML = "";
    if (!signs.length) list.innerHTML = `<p class="muted">No signs yet.</p>`;
    for (const s of signs) {
      const d = document.createElement("div");
      d.className = "sign";
      d.dataset.word = s.word;
      const cv = document.createElement("canvas");
      cv.width = 150;
      cv.height = 110;
      const name = document.createElement("div");
      name.innerHTML = `<strong>${esc(s.word)}</strong> <span class="small muted">${s.landmarks.length === 126 ? "2 hands" : "1 hand"}</span>`;
      const del = document.createElement("button");
      del.textContent = "Delete";
      del.setAttribute("aria-label", `Delete sign ${s.word}`);
      del.addEventListener("click", () => {
        store.deleteSign(user.id, s.word);
        refresh();
      });
      d.append(cv, name, del);
      list.appendChild(d);
      drawSign(cv, s.landmarks);
    }
  }
  refresh();

  let gone = false, hands = [], stream = null, stopTrack = null, timer = null;
  cleanups.push(() => {
    gone = true;
    clearInterval(timer);
    stopTrack?.();
    stopStream(stream);
  });
  (async () => {
    try {
      stream = await getLocalMedia(false);
      if (gone) return stopStream(stream);
      const video = $("#cam");
      video.srcObject = stream;
      await video.play().catch(() => {});
      $("#track-status").textContent = "Loading hand tracking (first time only)…";
      const stop = await startTracking(video, (h) => {
        hands = h;
        const ov = $("#overlay");
        if (ov) drawLive(ov, video, h);
      });
      if (gone) return stop();
      stopTrack = stop;
      $("#track-status").textContent = "Hand tracking ready. Show your hand to the camera.";
    } catch (e) {
      $("#track-status").textContent = "";
      $("#dict-error").textContent = e.name ? cameraMessage(e) : "Could not start hand tracking: " + e.message;
    }
  })();

  $("#capture-btn").addEventListener("click", () => {
    const err = $("#dict-error");
    err.textContent = "";
    if (!$("#sign-word").value.trim()) return (err.textContent = "Type the word this sign means first.");
    if (!stopTrack) return (err.textContent = "Hand tracking is not ready yet.");
    const btn = $("#capture-btn");
    btn.disabled = true;
    let n = 3;
    $("#countdown").textContent = n;
    timer = setInterval(() => {
      n--;
      if (n > 0) return ($("#countdown").textContent = n);
      clearInterval(timer);
      $("#countdown").textContent = "";
      btn.disabled = false;
      const vec = combineHands(hands);
      if (!vec.length) return (err.textContent = "No hand was detected. Show your hand clearly and try again.");
      const r = store.saveSign(user.id, $("#sign-word").value, vec);
      if (r.error) return (err.textContent = r.error);
      $("#sign-word").value = "";
      refresh();
      notify("Sign saved.");
    }, 1000);
  });

  $("#backup-btn").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([store.exportSigns(user.id)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "signbridge-signs.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("#restore-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const r = store.importSigns(user.id, await file.text());
    $("#restore-msg").textContent = r.error ? r.error : `Restored ${r.count} sign${r.count === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} skipped)` : ""}.`;
    $("#restore-msg").className = "small " + (r.error ? "error" : "");
    if (!r.error) refresh();
  });
}

// ---------- teacher: dashboard and transcript ----------
function dashboardPage(user) {
  const classes = store.getClasses(user.id);
  const count = (kind) => classes.reduce((n, c) => n + c.entries.filter((e) => e.kind === kind).length, 0);
  const minutes = Math.round(classes.filter((c) => c.endedAt).reduce((n, c) => n + (c.endedAt - c.startedAt), 0) / 60000);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ start: d.getTime(), label: d.toLocaleDateString([], { month: "short", day: "numeric" }), value: 0 });
  }
  for (const c of classes) {
    const day = [...days].reverse().find((d) => c.startedAt >= d.start);
    if (day) day.value++;
  }
  const freq = new Map();
  for (const c of classes) for (const e of c.entries) if (e.kind === "sign") freq.set(e.text, (freq.get(e.text) || 0) + 1);
  const top = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  const perClass = classes.slice(0, 8).reverse().map((c) => ({
    label: new Date(c.startedAt).toLocaleDateString([], { month: "short", day: "numeric" }),
    value: c.entries.length,
  }));

  shell(
    user,
    `<h1>Dashboard</h1>
    ${classes.length ? "" : `<p class="notice">No classes yet. Charts appear after your first class.</p>`}
    <div class="grid g3">
      <div class="card"><div class="muted small">Classes</div><div class="stat" id="stat-classes">${classes.length}</div></div>
      <div class="card"><div class="muted small">Minutes taught</div><div class="stat" id="stat-minutes">${minutes}</div></div>
      <div class="card"><div class="muted small">Saved signs</div><div class="stat" id="stat-dict">${store.getSigns(user.id).length}</div></div>
      <div class="card"><div class="muted small">Things you said</div><div class="stat" id="stat-teacher">${count("speech")}</div></div>
      <div class="card"><div class="muted small">Signs from students</div><div class="stat" id="stat-signs">${count("sign")}</div></div>
      <div class="card"><div class="muted small">Student speech</div><div class="stat" id="stat-student">${count("student-speech")}</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Classes in the last 7 days</h2>${barChart(days, { title: "Classes per day" })}</div>
      <div class="card"><h2>Most recognised signs</h2>${top.length ? hBarChart(top, { title: "Most recognised signs" }) : `<p class="muted">No signs recognised yet.</p>`}</div>
      <div class="card"><h2>Activity per class</h2>${perClass.length ? barChart(perClass, { title: "Messages per class", color: "#8a5cf6" }) : `<p class="muted">No data yet.</p>`}</div>
    </div>`,
    "dash"
  );
}

function transcriptPage(user, id) {
  const c = id && store.getClass(id);
  if (!c || c.teacherId !== user.id) {
    return shell(user, `<h1>Transcript</h1><p class="error">That class was not found.</p><a href="#/teacher">Back</a>`);
  }
  const lines = c.entries.map((e) => `${timeOf(e.at)}  ${LABELS[e.kind] || e.kind}: ${e.text}`);
  shell(
    user,
    `<h1>Transcript</h1>
    <div class="card"><p><strong>Class ${esc(c.code)}</strong> · ${new Date(c.startedAt).toLocaleString()} · Student: ${esc(c.studentName || "—")}${c.endedAt ? "" : " · not ended"}</p>
    <div class="log" id="transcript" style="max-height:none">${
      c.entries.length ? c.entries.map((e, i) => `<div data-kind="${e.kind}">${esc(lines[i])}</div>`).join("") : `<p class="muted">Nothing was said or signed.</p>`
    }</div>
    <div class="row"><button id="dl-transcript">Download as text</button><a class="btn" href="#/teacher">Back to home</a></div></div>`
  );
  $("#dl-transcript").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([`SignBridge class ${c.code}\n${new Date(c.startedAt).toLocaleString()}\n\n${lines.join("\n")}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `signbridge-${c.code}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// ---------- student: join ----------
function studentJoin(user) {
  const pending = cleanCode(sessionStorage.getItem("sb.join") || "");
  shell(
    user,
    `<div class="card" style="max-width:480px;margin:1rem auto"><h1>Join a class</h1>
    <p class="muted">Ask your teacher for the class code or join link. Your camera and microphone will be used.</p>
    <form id="join-form"><label for="join-code">Class code</label>
    <input type="text" id="join-code" value="${esc(pending)}" maxlength="10" autocomplete="off" style="text-transform:uppercase;letter-spacing:.2em">
    <p class="error" id="join-error" role="alert"></p>
    <button class="primary" id="join-btn" type="submit">Join class</button></form></div>`,
    "home"
  );
  $("#join-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#join-btn");
    const err = $("#join-error");
    err.textContent = "";
    const code = cleanCode($("#join-code").value);
    if (code.length < 4) return (err.textContent = "Enter the class code from your teacher.");
    btn.disabled = true;
    btn.textContent = "Joining…";
    try {
      await joinFlow(user, code);
      sessionStorage.removeItem("sb.join");
      redirect("/student/class");
    } catch (ex) {
      err.textContent = ex.name && /Error$/.test(ex.name) && ex.name !== "Error" ? cameraMessage(ex) : ex.message;
      btn.disabled = false;
      btn.textContent = "Join class";
    }
  });
}

async function joinFlow(user, code) {
  const stream = await getLocalMedia();
  const l = {
    role: "student", user, code, stream, session: null, dict: [], stab: new Stabiliser(), queue: [], playing: false,
    lines: [], mySigns: [], captions: "", remoteStream: null, status: "Connected.", stopListen: null, tracking: false,
  };
  try {
    l.session = await joinClass(code, stream, user.name, studentHandlers(l));
  } catch (e) {
    stopStream(stream);
    throw e;
  }
  l.status = `Connected to ${l.session.teacherName || "your teacher"}.`;
  live = l;
}

function leaveStudent(l, message) {
  clearTimeout(l.timer);
  l.stopListen?.();
  l.stopTrack?.();
  try {
    l.session.close();
  } catch {}
  stopStream(l.stream);
  if (live === l) live = null;
  if (message) notify(message);
  redirect("/student");
}

function studentHandlers(l) {
  return {
    onTeacherStream: (s) => {
      l.remoteStream = s;
      if (live === l && $("#remote-video")) $("#remote-video").srcObject = s;
    },
    onClosed: () => live === l && leaveStudent(l, "The connection to the class was lost."),
    onData: (d) => {
      if (!d || typeof d !== "object") return;
      if (d.t === "dict" && Array.isArray(d.signs)) {
        l.dict = d.signs.filter((s) => s && typeof s.word === "string" && Array.isArray(s.landmarks) && (s.landmarks.length === 63 || s.landmarks.length === 126));
        if (live === l && $("#dict-count")) $("#dict-count").textContent = dictText(l);
      } else if (d.t === "speech" && typeof d.text === "string") {
        const text = d.text.slice(0, 500);
        const tokens = lookupTokens(text, l.dict);
        l.captions = text;
        l.lines.push({ at: Date.now(), text, tokens });
        if (live === l) {
          if ($("#captions")) $("#captions").textContent = text;
          if ($("#signs-log")) appendSignLine($("#signs-log"), l.lines[l.lines.length - 1]);
        }
        l.queue.push(...tokens);
        if (!l.playing) playNext(l);
      } else if (d.t === "end") {
        leaveStudent(l, "The teacher ended the class.");
      }
    },
  };
}

const dictText = (l) => `Your teacher's dictionary: ${l.dict.length} sign${l.dict.length === 1 ? "" : "s"}.`;

function chipEl(t) {
  const el = document.createElement("span");
  el.className = "chip";
  el.dataset.kind = t.kind;
  el.dataset.label = t.label;
  if (t.kind === "custom") {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    el.appendChild(cv);
    drawSign(cv, t.landmarks);
  } else if (t.kind === "builtin") {
    el.insertAdjacentHTML("beforeend", `<span class="emoji">${t.emoji}</span>`);
  } else {
    el.insertAdjacentHTML("beforeend", `<span class="emoji" style="font-size:1.1rem">🔤</span>`);
  }
  el.insertAdjacentHTML("beforeend", `<span>${esc(t.label)}</span>`);
  return el;
}

function appendSignLine(box, line) {
  const div = document.createElement("div");
  div.innerHTML = `<div class="small muted">${timeOf(line.at)}  ${esc(line.text)}</div>`;
  const chips = document.createElement("div");
  chips.className = "chips";
  line.tokens.forEach((t) => chips.appendChild(chipEl(t)));
  div.appendChild(chips);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function playNext(l) {
  const t = l.queue.shift();
  if (!t) {
    l.playing = false;
    return;
  }
  l.playing = true;
  l.current = t;
  if (live === l) renderStage(t);
  l.timer = setTimeout(() => playNext(l), SIGN_DISPLAY_MS);
}

function renderStage(t) {
  const st = $("#stage");
  if (!st) return;
  st.dataset.kind = t.kind;
  st.dataset.label = t.label;
  if (t.kind === "custom") {
    st.innerHTML = `<canvas width="260" height="260"></canvas><div class="word">${esc(t.label)}</div>`;
    drawSign($("canvas", st), t.landmarks);
  } else if (t.kind === "builtin") {
    st.innerHTML = `<div class="emoji">${t.emoji}</div><div class="word">${esc(t.label)}</div>`;
  } else {
    st.innerHTML = `<div class="spell">${esc(t.label.toUpperCase().split("").join(" "))}</div><div class="muted">no sign saved, spelled out</div>`;
  }
}

// ---------- student: in class ----------
function studentClass(user) {
  if (!live || live.role !== "student") return redirect("/student");
  const l = live;
  shell(
    user,
    `<div class="card"><div class="row"><div><h1 style="margin:0">In class</h1><p id="status" class="muted" role="status" style="margin:0">${esc(l.status)}</p></div>
      <button class="danger" id="btn-leave" style="margin-left:auto">Leave class</button></div></div>
    <div class="grid g2">
      <div class="card"><div class="video"><video id="remote-video" autoplay playsinline></video><span class="tag">Teacher</span></div>
        <div class="captions" id="captions" aria-live="polite">${esc(l.captions)}</div>
        <div class="video pip"><div class="mirror"><video id="local-video" muted autoplay playsinline></video><canvas id="overlay"></canvas></div><span class="tag">You</span></div>
        <p class="small muted" id="track-status"></p></div>
      <div class="card"><h2>Teacher's words as signs</h2>
        <div class="stage" id="stage" aria-live="polite"><span class="muted">Signs appear here when your teacher speaks.</span></div>
        <div class="log" id="signs-log" aria-label="Sign history"></div>
        <p class="small muted" id="dict-count">${esc(dictText(l))}</p>
        <h2>Your signs</h2><div class="log" id="my-signs" aria-label="Signs you made"></div>
        <div class="row"><select id="speech-lang" aria-label="Speech language">${SPEECH_LANGUAGES.map((x) => `<option value="${x.code}">${x.label}</option>`).join("")}</select>
        <button id="btn-mic">Speak to teacher</button></div>
        <p class="small muted" id="mic-interim"></p><p class="error small" id="mic-error"></p></div>
    </div>`
  );
  $("#local-video").srcObject = l.stream;
  if (l.remoteStream) $("#remote-video").srcObject = l.remoteStream;
  l.lines.forEach((ln) => appendSignLine($("#signs-log"), ln));
  l.mySigns.forEach((s) => appendMySign($("#my-signs"), s));
  if (l.current) renderStage(l.current);
  $("#btn-leave").addEventListener("click", () => leaveStudent(l, "You left the class."));

  $("#btn-mic").addEventListener("click", () => {
    if (l.stopListen) {
      l.stopListen();
      l.stopListen = null;
      $("#btn-mic").textContent = "Speak to teacher";
      return;
    }
    l.stopListen = startListening({
      lang: $("#speech-lang").value,
      onFinal: (text) => {
        l.session.send({ t: "speech", text });
        const s = { at: Date.now(), text, kind: "speech" };
        l.mySigns.push(s);
        if (live === l) appendMySign($("#my-signs"), s);
      },
      onInterim: (t) => live === l && $("#mic-interim") && ($("#mic-interim").textContent = t),
      onError: (m) => $("#mic-error") && ($("#mic-error").textContent = m),
    });
    $("#btn-mic").textContent = "Stop speaking";
  });

  if (!l.tracking) {
    l.tracking = true;
    startStudentTracking(l);
  } else if ($("#track-status")) {
    $("#track-status").textContent = l.trackText || "";
  }
}

function appendMySign(box, s) {
  if (!box) return;
  const div = document.createElement("div");
  div.textContent = `${timeOf(s.at)}  ${s.kind === "speech" ? "You said" : "You signed"}: ${s.text}`;
  div.dataset.kind = s.kind;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function startStudentTracking(l) {
  const setText = (t) => {
    l.trackText = t;
    if (live === l && $("#track-status")) $("#track-status").textContent = t;
  };
  const video = $("#local-video");
  try {
    await video.play().catch(() => {});
    setText("Loading hand tracking (first time only)…");
    l.stopTrack = await startTracking(video, (hands) => {
      const ov = $("#overlay");
      if (ov && live === l) drawLive(ov, $("#local-video") || video, hands);
      const word = l.stab.push(matchGesture(hands, l.dict));
      if (!word) return;
      l.session.send({ t: "sign", word });
      const s = { at: Date.now(), text: word, kind: "sign", emoji: BUILTIN_BY_WORD[word]?.emoji };
      l.mySigns.push(s);
      if (live === l) appendMySign($("#my-signs"), s);
    });
    if (live !== l) l.stopTrack();
    setText("Hand tracking ready. Sign in front of the camera.");
  } catch (e) {
    setText("Hand tracking could not start: " + (e.message || e) + " You can still watch and listen.");
  }
}

window.addEventListener("hashchange", render);

// A join link (?join=CODE) is remembered, then the address is cleaned up.
const joinParam = new URLSearchParams(location.search).get("join");
if (joinParam) {
  sessionStorage.setItem("sb.join", cleanCode(joinParam));
  history.replaceState(null, "", location.pathname + "#/student");
}
render();
