// Thin wrapper over the browser Web Speech API (works best in Chrome and Edge).

const getCtor = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
export const recognitionSupported = () => !!getCtor();

/** Starts listening and keeps listening until the returned function is called. */
export function startListening({ lang, onFinal, onInterim, onError }) {
  const Ctor = getCtor();
  if (!Ctor) {
    onError?.("This browser does not support speech recognition. Use Chrome or Edge, or type your text instead.");
    return () => {};
  }
  let active = true;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const text = res[0].transcript;
      if (res.isFinal) {
        const t = text.trim();
        if (t) onFinal?.(t);
      } else {
        interim += text;
      }
    }
    onInterim?.(interim);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      active = false;
      onError?.("Microphone permission was blocked.");
    } else if (e.error !== "no-speech" && e.error !== "aborted") {
      onError?.(`Speech recognition error: ${e.error}`);
    }
  };
  // Chrome stops after a pause, so start again while still active.
  rec.onend = () => {
    if (!active) return;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  };
  try {
    rec.start();
  } catch {
    /* ignore */
  }
  return () => {
    active = false;
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
    onInterim?.("");
  };
}

export function speak(text, lang = "en-US") {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.speak(u);
}
