// Everything is kept in this browser (localStorage), so accounts, signs and history are per device.
// The login session is in sessionStorage so two tabs can be signed in as different people.
import { isValidVector } from "./ai.js";

const read = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

async function hash(password, salt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${password}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Accounts (demo only: stored on this device, not secure) ----
export async function register({ name, email, password, role }) {
  name = String(name || "").trim();
  email = String(email || "").trim().toLowerCase();
  if (!name) return { error: "Please enter your name." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Please enter a valid email address." };
  if (String(password || "").length < 6) return { error: "Password must be at least 6 characters." };
  if (role !== "teacher" && role !== "student") return { error: "Choose teacher or student." };
  const users = read("sb.users", []);
  if (users.some((u) => u.email === email)) return { error: "An account with this email already exists on this device." };
  const salt = uid();
  const user = { id: uid(), name, email, role, salt, hash: await hash(password, salt), createdAt: Date.now() };
  users.push(user);
  write("sb.users", users);
  sessionStorage.setItem("sb.session", user.id);
  return { user: publicUser(user) };
}

export async function login(email, password) {
  email = String(email || "").trim().toLowerCase();
  const u = read("sb.users", []).find((x) => x.email === email);
  if (!u || u.hash !== (await hash(String(password || ""), u.salt))) return { error: "Wrong email or password." };
  sessionStorage.setItem("sb.session", u.id);
  return { user: publicUser(u) };
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
export function currentUser() {
  const id = sessionStorage.getItem("sb.session");
  const u = id && read("sb.users", []).find((x) => x.id === id);
  return u ? publicUser(u) : null;
}
export const logout = () => sessionStorage.removeItem("sb.session");

// ---- Teacher's sign dictionary ----
export const getSigns = (teacherId) => read(`sb.signs.${teacherId}`, []);

export function saveSign(teacherId, word, landmarks) {
  word = String(word || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!word) return { error: "Type the word this sign means." };
  if (!isValidVector(landmarks)) return { error: "That hand shape could not be saved." };
  const signs = getSigns(teacherId).filter((s) => s.word !== word);
  signs.push({ word, landmarks, createdAt: Date.now() });
  write(`sb.signs.${teacherId}`, signs);
  return { ok: true };
}

export function deleteSign(teacherId, word) {
  write(`sb.signs.${teacherId}`, getSigns(teacherId).filter((s) => s.word !== word));
}

export const exportSigns = (teacherId) =>
  JSON.stringify({ app: "signbridge", version: 1, signs: getSigns(teacherId) }, null, 2);

export function importSigns(teacherId, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That file is not valid JSON." };
  }
  const list = Array.isArray(data) ? data : data && data.signs;
  if (!Array.isArray(list)) return { error: "That file does not look like a SignBridge backup." };
  const good = list.filter((s) => s && typeof s.word === "string" && s.word.trim() && isValidVector(s.landmarks));
  if (!good.length) return { error: "No usable signs were found in that file." };
  const map = new Map(getSigns(teacherId).map((s) => [s.word, s]));
  for (const s of good) {
    const word = s.word.trim().toLowerCase().replace(/\s+/g, " ");
    map.set(word, { word, landmarks: s.landmarks, createdAt: s.createdAt || Date.now() });
  }
  write(`sb.signs.${teacherId}`, [...map.values()]);
  return { ok: true, count: good.length, skipped: list.length - good.length };
}

// ---- Class history ----
export const getClasses = (teacherId) =>
  read("sb.classes", []).filter((c) => c.teacherId === teacherId).sort((a, b) => b.startedAt - a.startedAt);
export const getClass = (id) => read("sb.classes", []).find((c) => c.id === id) || null;
export function saveClass(cls) {
  const all = read("sb.classes", []);
  const i = all.findIndex((c) => c.id === cls.id);
  if (i >= 0) all[i] = cls;
  else all.push(cls);
  write("sb.classes", all);
}
