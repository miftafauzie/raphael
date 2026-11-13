// Speech in (Web Speech API recognition) and speech out (speechSynthesis), browser-native.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const hasRecognition = !!SR;

// ---------------- Listening ----------------
let active = null; // current recognizer

export function stopListening() {
  if (active) { try { active.abort(); } catch {} active = null; }
}

/**
 * Listen for one utterance. Resolves with final text ("" if nothing heard).
 * patient: keep listening through short pauses (for discussions) and stop only
 * after `silenceMs` of quiet once the user has started talking.
 */
export function listenOnce({ lang = "id-ID", onInterim, patient = false, silenceMs = 2300, maxWaitMs = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error("Browser ini belum mendukung pengenalan suara. Pakai Chrome di Android."));
    stopListening();
    const rec = new SR();
    rec.lang = lang; rec.interimResults = true; rec.continuous = patient; rec.maxAlternatives = 1;
    let finalText = "", done = false, silenceTimer = null;
    const stopSoon = (ms) => { clearTimeout(silenceTimer); silenceTimer = setTimeout(() => { try { rec.stop(); } catch {} }, ms); };
    if (patient) stopSoon(maxWaitMs); // nobody spoke at all
    rec.onresult = (e) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript;
      }
      onInterim?.((finalText + interim).trim());
      if (patient) stopSoon(silenceMs);
    };
    rec.onerror = (e) => {
      if (done) return;
      if (e.error === "no-speech" || e.error === "aborted") { done = true; resolve(""); }
      else if (e.error === "not-allowed") { done = true; reject(new Error("Izin mikrofon ditolak. Izinkan mikrofon di pengaturan situs.")); }
      else { done = true; reject(new Error("Pengenalan suara gagal: " + e.error)); }
    };
    rec.onend = () => { clearTimeout(silenceTimer); if (active === rec) active = null; if (!done) { done = true; resolve(finalText.trim()); } };
    active = rec;
    rec.start();
  });
}

/**
 * Wake-word loop: keeps recognition running while the app is open and calls
 * onWake(commandText) when a wake word is heard ("" if only the wake word).
 */
export function createWakeListener({ lang = "id-ID", getWakeWords, onWake, onHeard }) {
  let running = false, paused = false, rec = null, restartTimer = null;

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

  function start() {
    if (!SR || !running || paused) return;
    rec = new SR();
    rec.lang = lang; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = norm(r[0].transcript);
        onHeard?.(text, r.isFinal);
        for (const w of getWakeWords().map(norm).filter(Boolean)) {
          const idx = text.indexOf(w);
          if (idx === -1) continue;
          // Wait for final result so we capture the whole command after the wake word
          if (!r.isFinal) return;
          const command = r[0].transcript.slice(0).trim();
          const after = norm(command).slice(idx + w.length).trim();
          pause();
          onWake(after);
          return;
        }
      }
    };
    rec.onerror = () => {};
    rec.onend = () => { rec = null; if (running && !paused) restartTimer = setTimeout(start, 250); };
    try { rec.start(); } catch { restartTimer = setTimeout(start, 1000); }
  }
  function pause() { paused = true; clearTimeout(restartTimer); if (rec) { try { rec.abort(); } catch {} rec = null; } }

  return {
    enable() { running = true; paused = false; start(); },
    disable() { running = false; pause(); },
    pause,
    resume() { if (running) { paused = false; start(); } },
    get enabled() { return running; },
  };
}

// ---------------- Speaking ----------------
export function listVoices() {
  return speechSynthesis.getVoices();
}
export function onVoicesReady(cb) {
  if (speechSynthesis.getVoices().length) cb();
  speechSynthesis.addEventListener?.("voiceschanged", cb);
}

/** Turn markdown-ish text into something pleasant to read aloud. */
export function speakable(text) {
  return text
    .replace(/```[\s\S]*?```/g, " (kode ditampilkan di layar) ")
    .replace(/https?:\/\/\S+/g, " tautan ")
    .replace(/[*_#>`~|]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function createSpeaker({ getVoice, getRate, getPitch, onLevel, onStart, onEnd }) {
  const queue = [];
  let speaking = false, levelTimer = null, idleResolvers = [];
  let keepAlive = null;

  function pump() {
    if (speaking) return;
    const text = queue.shift();
    if (!text) {
      clearInterval(levelTimer); clearInterval(keepAlive); onLevel?.(0);
      const r = idleResolvers; idleResolvers = []; r.forEach((f) => f());
      onEnd?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = getVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "id-ID";
    u.rate = getRate(); u.pitch = getPitch();
    u.onstart = () => {
      onStart?.();
      clearInterval(levelTimer);
      // speechSynthesis gives no audio level, so we simulate a lively mouth/body motion
      levelTimer = setInterval(() => onLevel?.(0.35 + Math.random() * 0.65), 90);
    };
    u.onboundary = () => onLevel?.(1);
    // Watchdog: some Android TTS engines never fire onend, which would freeze the app
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(watchdog); speaking = false; pump(); };
    const watchdog = setTimeout(finish, 3000 + text.length * 110 / u.rate);
    u.onend = u.onerror = finish;
    speaking = true;
    speechSynthesis.speak(u);
    // Chrome sometimes pauses long speech; nudge it
    clearInterval(keepAlive);
    keepAlive = setInterval(() => { if (speechSynthesis.paused) speechSynthesis.resume(); }, 5000);
  }

  return {
    enqueue(text) {
      const t = speakable(text);
      if (!t) return;
      queue.push(t); pump();
    },
    cancel() {
      queue.length = 0; speaking = false; speechSynthesis.cancel();
      clearInterval(levelTimer); clearInterval(keepAlive); onLevel?.(0);
      const r = idleResolvers; idleResolvers = []; r.forEach((f) => f());
    },
    idle() { return (!speaking && !queue.length) ? Promise.resolve() : new Promise((r) => idleResolvers.push(r)); },
    get busy() { return speaking || queue.length > 0; },
  };
}

/** Short "ding" so the user knows we are listening. */
export function chime(freq = 880) {
  try {
    const ctx = chime.ctx || (chime.ctx = new AudioContext());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; o.type = "sine";
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.3);
  } catch {}
}
