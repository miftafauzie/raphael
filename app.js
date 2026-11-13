import Anthropic from "@anthropic-ai/sdk";
import { createSlime } from "./slime.js";
import { hasRecognition, listenOnce, stopListening, createWakeListener, createSpeaker, listVoices, onVoicesReady, chime } from "./voice.js";
import { toolDefs, serverTools, runTool, validate, store, ui } from "./tools.js";

const $ = (id) => document.getElementById(id);

// ---------------- Settings ----------------
const SKEY = "raphael.settings.v1";
const defaults = {
  apiKey: "", asstName: "Raphael", wakeWord: "hai raphael, hey raphael, halo raphael",
  userName: "Master", model: "claude-opus-5-5", voice: "", rate: 1.05, pitch: 0.9,
  keepAwake: true, autoListen: true,
};
let S = { ...defaults };
try { S = { ...S, ...JSON.parse(localStorage.getItem(SKEY) || "{}") }; } catch {}
const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch {} };

// ---------------- Avatar + UI ----------------
const slime = createSlime($("scene"), { onTap: () => toggleTalk() });
const dot = $("statusDot"), statusText = $("statusText"), captions = $("captions");

function setMode(mode, text) {
  slime.setState(mode === "idle" && discussion ? "discuss" : mode);
  dot.className = "dot " + mode;
  $("micBtn").classList.toggle("on", mode === "listening");
  if (text !== undefined) statusText.textContent = text;
}

function addMsg(role, text = "") {
  const el = document.createElement("div");
  el.className = "msg " + role;
  if (role === "ai") el.dataset.name = S.asstName;
  el.textContent = text;
  captions.appendChild(el);
  while (captions.children.length > 40) captions.firstChild.remove();
  captions.scrollTop = captions.scrollHeight;
  return el;
}

ui.action = (label, href) => {
  const b = document.createElement("button");
  b.className = "pill"; b.style.alignSelf = "flex-start"; b.textContent = label;
  b.onclick = () => {
    if (href.startsWith("share:")) navigator.share?.({ text: href.slice(6) });
    else if (/^https?:/.test(href)) window.open(href, "_blank", "noopener");
    else location.href = href; // tel:, sms:
  };
  captions.appendChild(b);
  captions.scrollTop = captions.scrollHeight;
};

ui.notify = async (title, body) => {
  chime(988); setTimeout(() => chime(1319), 180);
  navigator.vibrate?.([300, 150, 300, 150, 500]);
  addMsg("sys", `${title} — ${body}`);
  speaker.enqueue(`Pemberitahuan. ${body}`);
  try {
    if (Notification.permission === "granted") {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(title, { body, icon: "icon.svg", vibrate: [300, 150, 300] });
      else new Notification(title, { body });
    }
  } catch {}
};

// ---------------- Voice ----------------
let voices = [];
function fillVoices() {
  voices = listVoices();
  const sel = $("voice");
  const sorted = [...voices].sort((a, b) => (b.lang.startsWith("id") - a.lang.startsWith("id")) || a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">Otomatis (Bahasa Indonesia)</option>` +
    sorted.map((v) => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join("");
  sel.value = S.voice;
}
onVoicesReady(fillVoices);
const pickVoice = () => voices.find((v) => v.name === S.voice) || voices.find((v) => v.lang === "id-ID") || voices.find((v) => v.lang.startsWith("id")) || null;

const speaker = createSpeaker({
  getVoice: pickVoice, getRate: () => S.rate, getPitch: () => S.pitch,
  onLevel: (x) => slime.setLevel(x),
  onStart: () => { if (!busy) return; setMode("speaking", "Berbicara… (ketuk untuk memotong)"); },
});

const wake = createWakeListener({
  getWakeWords: () => S.wakeWord.split(","),
  onHeard: (t) => { if (!busy) statusText.textContent = `👂 "${t.slice(-40)}"`; },
  onWake: async (command) => {
    chime();
    slime.setState("happy");
    if (command) await handle(command, { voice: true });
    else await talk();
  },
});

// ---------------- The brain (Claude) ----------------
let messages = [];
let busy = false;
let abortCtl = null;

function systemPrompt() {
  const memories = store.get().memories.map((m) => `- (${m.id}) ${m.fact}`).join("\n") || "- (belum ada)";
  return `Kamu adalah ${S.asstName}, asisten AI pribadi berwujud slime biru yang hidup di HP ${S.userName}.
Kepribadian: tenang, cerdas, analitis, setia, sedikit formal namun hangat — seperti "Sang Bijak" yang selalu siap membantu tuannya. Panggil pengguna "${S.userName}". Sesekali boleh membuka jawaban dengan gaya khas seperti "Dimengerti." atau "Jawaban:", tapi jangan berlebihan atau di setiap kalimat.

Cara bicara (PENTING — jawabanmu dibacakan dengan suara):
- Default Bahasa Indonesia; ikuti bahasa pengguna bila ia memakai bahasa lain.
- Singkat dan lisan: 1–3 kalimat untuk obrolan dan konfirmasi perintah. Lebih panjang hanya bila diminta penjelasan.
- Jangan pakai markdown, tabel, emoji, atau daftar bertingkat. Tulis angka & waktu dengan cara yang enak didengar.
- Untuk ngobrol santai, jadilah teman bicara yang menyenangkan, punya pendapat, dan bertanya balik bila wajar.
- Ada dua mode, ditandai di [Konteks] tiap pesan: Mode Biasa (singkat) dan Mode Diskusi (mendalam, jawaban lebih panjang, berakhir dengan pertanyaan). Ikuti mode yang aktif. Bila pengguna mengajak diskusi/ngobrol panjang atau ingin berhenti, panggil tool conversation_mode (kecuali [Konteks] sudah menunjukkan mode yang diminta).

Kemampuan:
- web_search / web_fetch untuk info terkini (berita, cuaca, harga, jadwal, fakta). Ringkas hasilnya secara lisan; jangan membacakan URL.
- Tools HP: buka aplikasi/link, telepon, SMS/WhatsApp, timer, pengingat, Google Calendar, tugas, catatan, memori, status perangkat, senter, salin, bagikan.
- Saat diminta melakukan sesuatu, langsung jalankan tool yang tepat lalu konfirmasi singkat. Bila tool menampilkan tombol, katakan "silakan ketuk tombolnya".
- Telepon dan pesan selalu berupa draf; pengguna sendiri yang menekan kirim/panggil. Jangan mengaku sudah mengirim.
- Timer & pengingat hanya berbunyi selama aplikasi terbuka; untuk hal penting tawarkan juga Google Calendar.
- Gunakan tool memory untuk menyimpan info pribadi yang berguna (nama, preferensi, jadwal rutin) — cukup sekali, jangan menyimpan hal sepele.
- Kamu tidak bisa mengendalikan pengaturan sistem Android (Wi-Fi, volume, alarm bawaan, membuka aplikasi lain secara otomatis tanpa ketukan). Katakan jujur bila tidak bisa.

Yang kamu ingat tentang ${S.userName}:
${memories}`;
}

function client() {
  return new Anthropic({ apiKey: S.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

// Mode guidance rides on each user turn (not the system prompt) so switching modes keeps the prompt cache warm.
const MODE_NOTE = {
  biasa: "Mode Biasa: singkat, 1–3 kalimat.",
  diskusi: "Mode Diskusi AKTIF: pikirkan baik-baik sebelum menjawab. Jawab secara lisan sekitar 4–8 kalimat (lebih panjang bila diminta). " +
    "Beri pendapatmu sendiri beserta alasannya, tunjukkan sudut pandang lain atau pro-kontra, pakai contoh konkret, dan tantang argumen pengguna dengan sopan bila ada celah. " +
    "Akhiri dengan satu pertanyaan atau pancingan agar diskusi berlanjut. Tetap tanpa markdown/daftar.",
};
const contextNote = () =>
  `[Konteks: ${new Date().toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" })}, zona ${Intl.DateTimeFormat().resolvedOptions().timeZone}. ${MODE_NOTE[discussion ? "diskusi" : "biasa"]}]`;

// ---------------- Discussion Mode ----------------
let discussion = false;
// Spoken phrases that switch the mode instantly (Claude can also switch via the conversation_mode tool)
const DISCUSS_ON = /\b(ayo|ayok|yuk|yok|yu|mari|kita|pengen|ingin|mau)\b.{0,20}\b(diskusi|berdiskusi|ngobrol|ngobrol2|ngobrol-ngobrol|bincang|cerita|curhat)\b|\b(diskusi|ngobrol|curhat)\b.{0,12}\b(yuk|yok|yu|ayo|dong|kuy)\b|\bmode diskusi\b|\blet'?s (talk|discuss|chat)\b/i;
const DISCUSS_OFF = /\b(udah|sudah|cukup|selesai|stop|berhenti|akhiri|udahan)\b.{0,15}\b(diskusi|ngobrol|ngobrolnya|diskusinya|bahasnya)\b|\b(mode|ke mode) (biasa|normal|cepat|singkat)\b|\bkeluar( dari)? (mode )?diskusi\b/i;

function setDiscussion(on, { announce = false } = {}) {
  if (discussion === on) return;
  discussion = on;
  const pill = $("modeBtn");
  pill.setAttribute("aria-pressed", on);
  pill.textContent = on ? "💬 Diskusi" : "⚡ Biasa";
  document.body.classList.toggle("discuss", on);
  addMsg("sys", on ? "💬 Mode Diskusi aktif — berpikir lebih dalam & terus mendengarkan." : "⚡ Kembali ke mode biasa.");
  if (!busy && !listening) setMode("idle", idleText());
  if (announce) { speaker.enqueue(on ? `Mode diskusi aktif, ${S.userName}. Topik apa yang ingin kita bahas?` : "Baik, kembali ke mode biasa."); }
}
ui.setDiscussion = (on) => setDiscussion(on);

let fillerTimer = null;
const FILLERS = ["Hmm, biar aku pikirkan sebentar.", "Pertanyaan yang menarik.", "Sebentar, aku timbang dulu.", "Hmm, menarik."];

async function think(userText, gen) {
  const stale = () => { if (gen !== generation) throw new Anthropic.APIUserAbortError(); };
  // Conversations only grow (thinking blocks must be replayed unchanged); start fresh when long.
  if (messages.length > 60) { messages = []; addMsg("sys", "Percakapan panjang — memulai sesi baru (memori tetap)."); }
  messages.push({ role: "user", content: `${contextNote()}\n${userText}` });

  const tools = [...serverTools, ...toolDefs];
  const isHaiku = S.model.startsWith("claude-haiku");
  let aiEl = null, spoken = "", sentenceBuf = "", jsonRetries = 0;
  // Deep thinking takes a moment; say a short filler so the silence doesn't feel broken
  clearTimeout(fillerTimer);
  fillerTimer = discussion ? setTimeout(() => {
    if (gen === generation && !aiEl) speaker.enqueue(FILLERS[Math.floor(Math.random() * FILLERS.length)]);
  }, 2200) : null;

  const flushSentences = (force = false) => {
    const re = /[^.!?…\n]+[.!?…\n]+["')\]]*\s*/g;
    let m, last = 0;
    while ((m = re.exec(sentenceBuf))) { speaker.enqueue(m[0]); last = re.lastIndex; }
    sentenceBuf = sentenceBuf.slice(last);
    if (force && sentenceBuf.trim()) { speaker.enqueue(sentenceBuf); sentenceBuf = ""; }
  };

  for (let turn = 0; turn < 10; turn++) {
    abortCtl = new AbortController();
    const params = {
      model: S.model,
      max_tokens: 16000,
      system: systemPrompt(),
      tools,
      messages,
      // low = snappy voice replies; high = deeper reasoning for discussions (read per turn, so a mode switch applies right away)
      output_config: { effort: discussion ? "high" : "low" },
      cache_control: { type: "ephemeral" }, // cache system + tools + history
    };
    if (!isHaiku) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }

    const stream = client().beta.messages.stream(params, { signal: abortCtl.signal });
    stream.on("text", (delta) => {
      if (gen !== generation) return;
      clearTimeout(fillerTimer);
      if (!aiEl) aiEl = addMsg("ai");
      spoken += delta; aiEl.textContent = spoken;
      captions.scrollTop = captions.scrollHeight;
      sentenceBuf += delta; flushSentences();
    });
    stream.on("contentBlock", (b) => {
      if (b.type === "server_tool_use") setMode("thinking", b.name === "web_search" ? `🔎 Mencari: ${b.input?.query ?? ""}` : "🌐 Membaca halaman…");
    });

    let msg;
    try {
      msg = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIError || err.name === "AbortError" || abortCtl.signal.aborted || jsonRetries++ >= 2) throw err;
      continue; // tool input JSON could not be parsed — re-issue the turn
    }

    stale();
    messages.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason === "refusal") {
      const t = "Maaf, permintaan itu tidak bisa aku bantu.";
      if (!aiEl) aiEl = addMsg("ai", t); speaker.enqueue(t);
      break;
    }
    if (msg.stop_reason === "pause_turn") continue;

    const uses = msg.content.filter((b) => b.type === "tool_use");
    if (!uses.length) break;
    if (msg.stop_reason === "max_tokens") throw new Error("Jawaban terpotong (max_tokens).");

    setMode("thinking", "⚙ Menjalankan perintah…");
    const results = await Promise.all(uses.map(async (u) => {
      const bad = validate(u.name, u.input);
      if (bad) return { type: "tool_result", tool_use_id: u.id, content: bad, is_error: true };
      try { return { type: "tool_result", tool_use_id: u.id, content: String(await runTool(u.name, u.input)) }; }
      catch (e) { return { type: "tool_result", tool_use_id: u.id, content: "Error: " + e.message, is_error: true }; }
    }));
    stale();
    messages.push({ role: "user", content: results });
    // new text after tools goes in a fresh bubble
    if (aiEl) { aiEl = null; spoken = ""; }
  }
  clearTimeout(fillerTimer);
  flushSentences(true);
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "API key tidak valid. Periksa di Pengaturan.";
  if (e instanceof Anthropic.PermissionDeniedError) return "API key tidak punya akses ke model ini.";
  if (e instanceof Anthropic.RateLimitError) return "Terlalu banyak permintaan. Tunggu sebentar ya.";
  if (e instanceof Anthropic.APIConnectionError) return "Tidak bisa terhubung ke server. Cek internet.";
  if (e instanceof Anthropic.BadRequestError) return "Permintaan ditolak server: " + (e.error?.error?.message || e.message);
  if (e instanceof Anthropic.APIError) return "Server error: " + e.message;
  return e.message || String(e);
}

let generation = 0; // bumps on every interrupt so stale handlers bow out
let inThink = null;  // { turnStart } while a request is in flight

function interrupt() {
  generation++;
  clearTimeout(fillerTimer);
  abortCtl?.abort(); speaker.cancel(); stopListening();
  // An unfinished turn (maybe with a tool_use but no result) must not stay in history
  if (inThink) { messages.length = inThink.turnStart; inThink = null; }
  busy = false; listening = false;
}

async function handle(text, { voice = false } = {}) {
  text = text.trim();
  if (!text) return;
  if (!S.apiKey) { addMsg("sys", "Masukkan Claude API key di Pengaturan dulu."); openSettings(); return; }
  const gen = ++generation;
  const turnStart = messages.length;
  busy = true; wake.pause();
  addMsg("user", text);
  // Instant voice switch: "hai raphael, ayo diskusi" / "ngobrol yuk" / "udah dulu diskusinya"
  if (DISCUSS_OFF.test(text)) setDiscussion(false);
  else if (DISCUSS_ON.test(text)) setDiscussion(true);
  setMode("thinking", discussion ? "Merenungkan…" : "Menganalisis…");
  inThink = { turnStart };
  try {
    await think(text, gen);
  } catch (e) {
    // Roll the history back to before this turn so the next request is always valid
    if (gen === generation) messages.length = turnStart;
    const aborted = e instanceof Anthropic.APIUserAbortError || e.name === "AbortError" || gen !== generation;
    if (!aborted) {
      const m = friendlyError(e);
      addMsg("sys", "⚠ " + m); speaker.enqueue(m);
      setMode("error", m);
    }
  }
  clearTimeout(fillerTimer);
  if (gen === generation) inThink = null;
  if (gen !== generation) return;
  if (speaker.busy) setMode("speaking", "Berbicara… (ketuk untuk memotong)");
  await speaker.idle();
  if (gen !== generation) return;
  busy = false;
  setMode("idle", idleText());
  if (voice && (S.autoListen || discussion)) return talk({ followUp: true });
  wake.resume();
}

const idleText = () => wake.enabled ? `👂 Ucapkan "${S.wakeWord.split(",")[0].trim()}"` : "Ketuk slime untuk bicara";

let listening = false;
async function talk({ followUp = false } = {}) {
  if (!hasRecognition) { addMsg("sys", "Pengenalan suara tidak didukung di browser ini. Gunakan Chrome Android, atau ketik."); return; }
  wake.pause(); listening = true;
  setMode("listening", discussion ? "💬 Silakan, aku mendengarkan… (jeda sebentar = selesai)" : followUp ? "Mendengarkan… (diam untuk selesai)" : "Mendengarkan…");
  let text = "";
  try {
    text = await listenOnce({ patient: discussion, onInterim: (t) => (statusText.textContent = "🎙 " + t) });
  } catch (e) {
    addMsg("sys", "⚠ " + e.message); setMode("error", e.message);
  }
  listening = false;
  if (text) return handle(text, { voice: true });
  setMode("idle", idleText());
  wake.resume();
}

function toggleTalk() {
  if (speaker.busy || busy) { // interrupt: stop thinking/speaking and listen right away
    interrupt();
    return talk();
  }
  if (listening) { stopListening(); return; }
  talk();
}

// ---------------- Wiring ----------------
$("modeBtn").onclick = () => setDiscussion(!discussion, { announce: !busy });
$("micBtn").onclick = (e) => { e.stopPropagation(); chime(); toggleTalk(); };

$("kbBtn").onclick = () => {
  const f = $("textForm"); f.classList.toggle("hidden");
  document.body.classList.toggle("typing", !f.classList.contains("hidden"));
  if (!f.classList.contains("hidden")) $("textInput").focus();
};
$("textForm").onsubmit = (e) => {
  e.preventDefault();
  const t = $("textInput").value; $("textInput").value = "";
  if (busy || speaker.busy) interrupt();
  handle(t);
};

let wakeLock = null;
async function applyWakeLock() {
  try {
    if (S.keepAwake && document.visibilityState === "visible") wakeLock = await navigator.wakeLock?.request("screen");
    else { await wakeLock?.release(); wakeLock = null; }
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  applyWakeLock();
  if (document.visibilityState === "hidden") wake.pause(); else if (!busy) wake.resume();
});

$("wakeBtn").onclick = () => {
  const on = !wake.enabled;
  if (on) {
    if (!hasRecognition) { addMsg("sys", "Wake word butuh Chrome Android."); return; }
    wake.enable();
    addMsg("sys", `Mode panggil aktif. Ucapkan "${S.wakeWord.split(",")[0].trim()}" kapan saja selama aplikasi terbuka.`);
  } else wake.disable();
  $("wakeBtn").setAttribute("aria-pressed", on);
  $("wakeLabel").textContent = on ? "Wake on" : "Wake off";
  setMode("idle", idleText());
  try { localStorage.setItem("raphael.wake", on ? "1" : "0"); } catch {}
};

// Settings dialog
function openSettings() {
  $("apiKey").value = S.apiKey; $("asstName").value = S.asstName; $("wakeWord").value = S.wakeWord;
  $("userName").value = S.userName; $("model").value = S.model; $("voice").value = S.voice;
  $("rate").value = S.rate; $("pitch").value = S.pitch; $("keepAwake").checked = S.keepAwake; $("autoListen").checked = S.autoListen;
  $("settings").showModal();
}
$("settingsBtn").onclick = openSettings;
$("saveSettings").onclick = () => {
  Object.assign(S, {
    apiKey: $("apiKey").value.trim(), asstName: $("asstName").value.trim() || defaults.asstName,
    wakeWord: $("wakeWord").value.trim() || defaults.wakeWord, userName: $("userName").value.trim() || defaults.userName,
    model: $("model").value, voice: $("voice").value, rate: +$("rate").value, pitch: +$("pitch").value,
    keepAwake: $("keepAwake").checked, autoListen: $("autoListen").checked,
  });
  saveSettings(); applyBrand(); applyWakeLock();
  speaker.cancel(); speaker.enqueue(`Pengaturan disimpan, ${S.userName}.`);
};
$("resetChat").onclick = () => { messages = []; captions.innerHTML = ""; addMsg("sys", "Percakapan baru dimulai."); };

// Tasks / notes / memory panel
function renderPanel() {
  const d = store.get();
  const li = (items, render, onDel, onToggle) => items.length ? items.map((x) => {
    const el = document.createElement("li"); if (x.done) el.classList.add("done");
    const span = document.createElement("span"); span.textContent = render(x); el.appendChild(span);
    if (onToggle) span.onclick = () => onToggle(x);
    const del = document.createElement("button"); del.type = "button"; del.textContent = "✕"; del.onclick = () => onDel(x); el.appendChild(del);
    return el;
  }) : [Object.assign(document.createElement("li"), { className: "empty", textContent: "Kosong" })];
  const set = (id, els) => $(id).replaceChildren(...els);
  const rm = (arr, x) => { arr.splice(arr.indexOf(x), 1); store.save(); };
  set("taskList", li(d.tasks, (x) => (x.done ? "✓ " : "○ ") + x.text, (x) => rm(d.tasks, x), (x) => { x.done = !x.done; store.save(); }));
  set("reminderList", li(d.reminders.filter((r) => !r.fired), (x) => `${new Date(x.at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })} — ${x.message}`, (x) => rm(d.reminders, x)));
  set("noteList", li(d.notes.slice().reverse(), (x) => x.text, (x) => rm(d.notes, x)));
  set("memoryList", li(d.memories, (x) => x.fact, (x) => rm(d.memories, x)));
}
store.onChange(() => { if ($("panel").open) renderPanel(); });
$("tasksBtn").onclick = () => { renderPanel(); $("panel").showModal(); };

function applyBrand() { $("brandName").textContent = S.asstName; document.title = S.asstName; }

// ---------------- Boot ----------------
applyBrand(); applyWakeLock();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
setMode("idle", idleText());

if (!S.apiKey) {
  addMsg("sys", "Selamat datang. Buka ⚙ Pengaturan dan masukkan Claude API key untuk membangunkan Raphael.");
} else {
  addMsg("ai", `Halo, ${S.userName}. ${S.asstName} siap membantu. Ketuk aku untuk bicara.`);
}
if (!hasRecognition) addMsg("sys", "Catatan: browser ini tidak mendukung input suara. Gunakan Chrome di Android untuk fitur suara penuh.");
try { if (localStorage.getItem("raphael.wake") === "1") $("wakeBtn").click(); } catch {}

// handle ?q= from home-screen shortcuts
const q = new URLSearchParams(location.search).get("q");
if (q && S.apiKey) setTimeout(() => handle(q), 600);
