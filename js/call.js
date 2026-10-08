// Browser-to-browser connection through PeerJS (the PeerJS script is loaded in index.html).
// The class code is the teacher's peer id without PEER_PREFIX.
import { PEER_PREFIX, PEER_OPTIONS } from "./config.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alike characters
export const makeCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");
export const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);

export function getLocalMedia(audio = true) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("Camera access needs https:// or http://localhost."));
  }
  return navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio });
}

export const stopStream = (s) => s && s.getTracks().forEach((t) => t.stop());

function needPeer() {
  if (typeof Peer === "undefined") throw new Error("The PeerJS library did not load. Check your internet connection and reload.");
}

/**
 * Teacher: registers the class code and waits for one student.
 * Resolves with { send, close } once the code is registered; rejects with err.type
 * "unavailable-id" when the code is taken. Handlers: onStudentConnected, onData, onStudentLeft,
 * onStudentStream, onError (problems after opening).
 */
export function openTeacherSession(code, stream, h) {
  needPeer();
  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_PREFIX + code, PEER_OPTIONS);
    let conn = null;
    let opened = false;
    const timer = setTimeout(() => {
      if (!opened) {
        peer.destroy();
        reject(Object.assign(new Error("Could not reach the PeerJS server."), { type: "timeout" }));
      }
    }, 15000);

    peer.on("open", () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        send(msg) {
          if (conn && conn.open) {
            conn.send(msg);
            return true;
          }
          return false;
        },
        hasStudent: () => !!(conn && conn.open),
        close() {
          try {
            conn?.close();
          } catch {}
          peer.destroy();
        },
      });
    });
    peer.on("error", (e) => {
      if (!opened) {
        clearTimeout(timer);
        reject(e);
      } else h.onError?.(e);
    });
    peer.on("disconnected", () => {
      if (opened && !peer.destroyed) {
        h.onError?.({ type: "disconnected", message: "Lost the PeerJS server; reconnecting." });
        try {
          peer.reconnect();
        } catch {}
      }
    });
    peer.on("connection", (c) => {
      if (conn && conn.open) {
        // This class already has a student.
        c.on("open", () => {
          c.send({ t: "busy" });
          setTimeout(() => c.close(), 300);
        });
        return;
      }
      conn = c;
      c.on("open", () => h.onStudentConnected?.());
      c.on("data", (d) => h.onData?.(d));
      c.on("close", () => {
        if (conn === c) {
          conn = null;
          h.onStudentLeft?.();
        }
      });
    });
    peer.on("call", (call) => {
      call.answer(stream);
      call.on("stream", (s) => h.onStudentStream?.(s));
    });
  });
}

/**
 * Student: connects to the class and waits for the teacher's welcome message.
 * Resolves with { send, close, teacherName }. Rejects with an Error whose message is
 * safe to show. Handlers: onData, onTeacherStream, onClosed.
 */
export function joinClass(code, stream, name, h) {
  needPeer();
  return new Promise((resolve, reject) => {
    const peer = new Peer(undefined, PEER_OPTIONS);
    let conn = null;
    let done = false;
    const fail = (message) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        peer.destroy();
      } catch {}
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("Could not reach the class. Check the code and your internet connection."), 15000);

    peer.on("error", (e) => {
      if (!done) {
        if (e.type === "peer-unavailable") fail("No class found with that code. Check it and try again.");
        else fail("Connection problem: " + (e.type || e.message || "unknown"));
      }
    });

    peer.on("open", () => {
      const teacherId = PEER_PREFIX + code;
      conn = peer.connect(teacherId, { reliable: true });
      conn.on("open", () => {
        conn.send({ t: "join", name });
        const call = peer.call(teacherId, stream);
        call.on("stream", (s) => h.onTeacherStream?.(s));
      });
      conn.on("data", (d) => {
        if (!done) {
          if (d && d.t === "busy") return fail("This class already has a student.");
          if (d && d.t === "welcome") {
            done = true;
            clearTimeout(timer);
            resolve({
              teacherName: d.teacher,
              send(msg) {
                if (conn.open) conn.send(msg);
              },
              close() {
                try {
                  conn.close();
                } catch {}
                peer.destroy();
              },
            });
            return;
          }
        }
        h.onData?.(d);
      });
      conn.on("close", () => {
        if (!done) fail("The class closed the connection.");
        else h.onClosed?.();
      });
    });
  });
}
