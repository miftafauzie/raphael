// Client-side tools Raphael can run on the phone, plus a tiny local store.

// ---------------- Store (localStorage, fails soft) ----------------
const KEY = "raphael.data.v1";
let mem = { tasks: [], notes: [], reminders: [], memories: [] };
try { mem = { ...mem, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {}
const listeners = new Set();
export const store = {
  get: () => mem,
  save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch {} listeners.forEach((f) => f()); },
  onChange(f) { listeners.add(f); },
};
const uid = () => Math.random().toString(36).slice(2, 8);

// ---------------- UI hooks (set by app.js) ----------------
export const ui = {
  action: (_label, _href) => {},   // render a tappable action button
  notify: (_title, _body) => {},    // fire a notification + voice
  setDiscussion: (_on) => {},       // switch Discussion Mode on/off
};

/** Try to open a link. Browsers block pop-ups without a recent tap, so we also show a button. */
function openLink(href, label) {
  let opened = false;
  try {
    if (/^https?:/i.test(href)) opened = !!window.open(href, "_blank", "noopener");
  } catch {}
  ui.action(label, href);
  return opened
    ? `Dibuka: ${label}.`
    : `Tombol "${label}" ditampilkan di layar; minta pengguna mengetuknya (browser memblokir pembukaan otomatis).`;
}

// ---------------- App deep links ----------------
const enc = encodeURIComponent;
const APPS = {
  youtube: (q) => q ? `https://www.youtube.com/results?search_query=${enc(q)}` : "https://www.youtube.com/",
  youtube_music: (q) => q ? `https://music.youtube.com/search?q=${enc(q)}` : "https://music.youtube.com/",
  spotify: (q) => q ? `https://open.spotify.com/search/${enc(q)}` : "https://open.spotify.com/",
  google: (q) => `https://www.google.com/search?q=${enc(q || "")}`,
  maps: (q) => q ? `https://www.google.com/maps/search/?api=1&query=${enc(q)}` : "https://www.google.com/maps",
  navigate: (q) => `https://www.google.com/maps/dir/?api=1&destination=${enc(q || "")}&travelmode=driving`,
  gmail: () => "https://mail.google.com/",
  calendar: () => "https://calendar.google.com/",
  drive: () => "https://drive.google.com/",
  whatsapp: () => "https://wa.me/",
  instagram: (q) => q ? `https://www.instagram.com/${enc(q.replace(/^@/, ""))}/` : "https://www.instagram.com/",
  tiktok: (q) => q ? `https://www.tiktok.com/search?q=${enc(q)}` : "https://www.tiktok.com/",
  twitter_x: (q) => q ? `https://x.com/search?q=${enc(q)}` : "https://x.com/",
  translate: (q) => `https://translate.google.com/?sl=auto&tl=id&text=${enc(q || "")}`,
  tokopedia: (q) => `https://www.tokopedia.com/search?q=${enc(q || "")}`,
  shopee: (q) => `https://shopee.co.id/search?keyword=${enc(q || "")}`,
  wikipedia: (q) => `https://id.wikipedia.org/w/index.php?search=${enc(q || "")}`,
};

// ---------------- Tool definitions (sent to Claude) ----------------
const T = (name, description, properties, required = []) => ({
  name, description, eager_input_streaming: true,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});

export const toolDefs = [
  T("open_link", "Buka URL apa pun di browser HP pengguna.", {
    url: { type: "string", description: "URL lengkap (https://...)" },
    label: { type: "string", description: "Label singkat tombol, mis. 'Buka Wikipedia'" },
  }, ["url", "label"]),
  T("open_app", "Buka aplikasi/layanan populer di HP, opsional dengan kata kunci pencarian. 'navigate' = petunjuk arah Google Maps ke tujuan.", {
    app: { type: "string", enum: Object.keys(APPS) },
    query: { type: "string", description: "Kata kunci, tujuan, atau username (opsional)" },
  }, ["app"]),
  T("phone_call", "Siapkan panggilan telepon ke nomor tertentu (pengguna menekan panggil).", {
    number: { type: "string", description: "Nomor telepon, mis. 08123456789" },
  }, ["number"]),
  T("send_message", "Siapkan pesan SMS atau WhatsApp dengan teks terisi; pengguna menekan kirim sendiri.", {
    channel: { type: "string", enum: ["sms", "whatsapp"] },
    number: { type: "string", description: "Nomor tujuan (kosongkan bila tidak tahu; WhatsApp akan minta pilih kontak)" },
    text: { type: "string" },
  }, ["channel", "text"]),
  T("set_timer", "Pasang timer hitung mundur (berbunyi selama aplikasi terbuka).", {
    seconds: { type: "integer", minimum: 1 },
    label: { type: "string" },
  }, ["seconds"]),
  T("set_reminder", "Pasang pengingat pada waktu tertentu (berbunyi selama aplikasi terbuka). Untuk pengingat yang pasti berbunyi walau aplikasi tertutup, sarankan juga create_calendar_event.", {
    when: { type: "string", description: "Waktu lokal ISO 8601, mis. 2026-11-13T17:30:00" },
    message: { type: "string" },
  }, ["when", "message"]),
  T("create_calendar_event", "Buat acara di Google Calendar (membuka formulir terisi; pengguna menekan simpan).", {
    title: { type: "string" },
    start: { type: "string", description: "Waktu lokal ISO 8601" },
    end: { type: "string", description: "Waktu lokal ISO 8601 (default +1 jam)" },
    details: { type: "string" },
    location: { type: "string" },
  }, ["title", "start"]),
  T("manage_tasks", "Kelola daftar tugas/to-do pengguna.", {
    action: { type: "string", enum: ["add", "list", "complete", "delete", "clear_done"] },
    text: { type: "string", description: "Isi tugas (untuk add)" },
    id: { type: "string", description: "ID tugas (untuk complete/delete)" },
  }, ["action"]),
  T("manage_notes", "Simpan, cari, atau hapus catatan pengguna.", {
    action: { type: "string", enum: ["add", "list", "search", "delete"] },
    text: { type: "string" },
    query: { type: "string" },
    id: { type: "string" },
  }, ["action"]),
  T("memory", "Ingat atau lupakan fakta jangka panjang tentang pengguna (nama, preferensi, kebiasaan). Gunakan saat pengguna menyebut info pribadi yang berguna nanti, atau meminta diingat.", {
    action: { type: "string", enum: ["remember", "forget"] },
    fact: { type: "string" },
    id: { type: "string" },
  }, ["action"]),
  T("device_status", "Info perangkat: tanggal/jam, baterai, koneksi, dan lokasi (minta izin).", {
    include_location: { type: "boolean" },
  }),
  T("flashlight", "Nyalakan/matikan senter HP (jika didukung).", {
    on: { type: "boolean" },
  }, ["on"]),
  T("conversation_mode", "Ganti gaya percakapan. 'diskusi' = Mode Diskusi (berpikir lebih dalam, jawaban lebih panjang, terus mendengarkan). 'biasa' = mode cepat & singkat. Panggil saat pengguna mengajak diskusi/ngobrol panjang, atau ingin berhenti/kembali normal.", {
    mode: { type: "string", enum: ["diskusi", "biasa"] },
  }, ["mode"]),
  T("clipboard_copy", "Salin teks ke clipboard HP.", { text: { type: "string" } }, ["text"]),
  T("share_text", "Buka menu bagikan Android untuk membagikan teks.", { text: { type: "string" } }, ["text"]),
];

export const serverTools = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "ID", timezone: "Asia/Jakarta" } },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
];

// ---------------- Input validation (eager streaming => validate ourselves) ----------------
export function validate(name, input) {
  const def = toolDefs.find((d) => d.name === name);
  if (!def) return `Tool tidak dikenal: ${name}`;
  if (!input || typeof input !== "object") return "Input harus berupa objek.";
  const { properties, required } = def.input_schema;
  for (const r of required) if (input[r] === undefined || input[r] === "") return `Field wajib hilang: ${r}`;
  for (const [k, v] of Object.entries(input)) {
    const p = properties[k];
    if (!p) return `Field tidak dikenal: ${k}`;
    if (p.type === "string" && typeof v !== "string") return `${k} harus string`;
    if (p.type === "integer" && !Number.isInteger(v)) return `${k} harus bilangan bulat`;
    if (p.type === "boolean" && typeof v !== "boolean") return `${k} harus boolean`;
    if (p.enum && !p.enum.includes(v)) return `${k} harus salah satu dari ${p.enum.join(", ")}`;
  }
  return null;
}

// ---------------- Timers & reminders ----------------
const timers = new Map();
function scheduleCheck() {
  const now = Date.now();
  for (const r of mem.reminders) {
    if (!r.fired && r.at <= now) {
      r.fired = true; store.save();
      ui.notify("Pengingat", r.message);
    }
  }
}
setInterval(scheduleCheck, 5000);
setTimeout(scheduleCheck, 1500);

function parseLocal(s) {
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
const gcalFmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fmtTime = (d) => d.toLocaleString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

let torchTrack = null;

// ---------------- Handlers ----------------
export async function runTool(name, input) {
  switch (name) {
    case "open_link": {
      if (!/^https?:\/\//i.test(input.url)) return "URL harus diawali http(s)://";
      return openLink(input.url, input.label);
    }
    case "open_app": {
      const href = APPS[input.app](input.query || "");
      return openLink(href, `Buka ${input.app.replace("_", " ")}${input.query ? `: ${input.query}` : ""}`);
    }
    case "phone_call": {
      const n = input.number.replace(/[^\d+]/g, "");
      ui.action(`📞 Telepon ${n}`, `tel:${n}`);
      return `Tombol telepon ke ${n} ditampilkan. Pengguna perlu mengetuknya.`;
    }
    case "send_message": {
      let n = (input.number || "").replace(/[^\d+]/g, "");
      if (input.channel === "whatsapp") {
        if (n.startsWith("0")) n = "62" + n.slice(1);
        n = n.replace(/^\+/, "");
        ui.action(`💬 WhatsApp${n ? " ke " + n : ""}`, `https://wa.me/${n}?text=${enc(input.text)}`);
      } else {
        ui.action(`✉️ SMS${n ? " ke " + n : ""}`, `sms:${n}?body=${enc(input.text)}`);
      }
      return "Draf pesan siap; pengguna mengetuk tombol lalu menekan kirim di aplikasinya.";
    }
    case "set_timer": {
      const id = uid();
      const label = input.label || "Timer";
      timers.set(id, setTimeout(() => { timers.delete(id); ui.notify("⏰ " + label, "Waktunya habis!"); }, input.seconds * 1000));
      const m = Math.floor(input.seconds / 60), s = input.seconds % 60;
      return `Timer "${label}" dipasang ${m ? m + " menit " : ""}${s ? s + " detik" : ""}. Aplikasi harus tetap terbuka.`;
    }
    case "set_reminder": {
      const d = parseLocal(input.when);
      if (!d) return "Format waktu tidak valid.";
      if (d.getTime() < Date.now() - 60000) return "Waktu itu sudah lewat.";
      mem.reminders.push({ id: uid(), at: d.getTime(), message: input.message, fired: false });
      store.save();
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
      return `Pengingat dipasang untuk ${fmtTime(d)}: "${input.message}". Berbunyi selama aplikasi terbuka.`;
    }
    case "create_calendar_event": {
      const s = parseLocal(input.start);
      if (!s) return "Format waktu mulai tidak valid.";
      const e = parseLocal(input.end || "") || new Date(s.getTime() + 3600e3);
      const href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(input.title)}&dates=${gcalFmt(s)}/${gcalFmt(e)}` +
        (input.details ? `&details=${enc(input.details)}` : "") + (input.location ? `&location=${enc(input.location)}` : "");
      return openLink(href, `📅 Simpan "${input.title}" ke Kalender`);
    }
    case "manage_tasks": {
      const t = mem.tasks;
      if (input.action === "add") { if (!input.text) return "Isi tugas kosong."; const it = { id: uid(), text: input.text, done: false, at: Date.now() }; t.push(it); store.save(); return `Ditambahkan (id ${it.id}).`; }
      if (input.action === "complete" || input.action === "delete") {
        const it = t.find((x) => x.id === input.id) || t.find((x) => input.text && x.text.toLowerCase().includes(input.text.toLowerCase()));
        if (!it) return "Tugas tidak ditemukan. Panggil list dulu untuk melihat ID.";
        if (input.action === "complete") it.done = true; else t.splice(t.indexOf(it), 1);
        store.save(); return `OK: "${it.text}" ${input.action === "complete" ? "selesai" : "dihapus"}.`;
      }
      if (input.action === "clear_done") { mem.tasks = t.filter((x) => !x.done); store.save(); return "Tugas selesai dibersihkan."; }
      return t.length ? JSON.stringify(t.map(({ id, text, done }) => ({ id, text, done }))) : "Daftar tugas kosong.";
    }
    case "manage_notes": {
      const n = mem.notes;
      if (input.action === "add") { if (!input.text) return "Catatan kosong."; const it = { id: uid(), text: input.text, at: Date.now() }; n.push(it); store.save(); return `Catatan disimpan (id ${it.id}).`; }
      if (input.action === "delete") { const i = n.findIndex((x) => x.id === input.id); if (i < 0) return "Catatan tidak ditemukan."; n.splice(i, 1); store.save(); return "Catatan dihapus."; }
      const q = (input.query || "").toLowerCase();
      const res = n.filter((x) => !q || x.text.toLowerCase().includes(q)).slice(-30);
      return res.length ? JSON.stringify(res.map(({ id, text, at }) => ({ id, text, tanggal: new Date(at).toLocaleDateString("id-ID") }))) : "Tidak ada catatan.";
    }
    case "memory": {
      if (input.action === "remember") { if (!input.fact) return "Fakta kosong."; mem.memories.push({ id: uid(), fact: input.fact }); store.save(); return "Diingat."; }
      const i = mem.memories.findIndex((x) => x.id === input.id || (input.fact && x.fact.toLowerCase().includes(input.fact.toLowerCase())));
      if (i < 0) return "Tidak ditemukan."; mem.memories.splice(i, 1); store.save(); return "Dilupakan.";
    }
    case "device_status": {
      const out = { waktu: new Date().toLocaleString("id-ID", { dateStyle: "full", timeStyle: "short" }), online: navigator.onLine };
      try { const b = await navigator.getBattery?.(); if (b) out.baterai = `${Math.round(b.level * 100)}%${b.charging ? " (mengisi)" : ""}`; } catch {}
      const c = navigator.connection; if (c) out.jaringan = c.effectiveType;
      if (input.include_location && navigator.geolocation) {
        try {
          const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000, maximumAge: 60000 }));
          out.lokasi = { lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), akurasi_m: Math.round(p.coords.accuracy) };
        } catch (e) { out.lokasi = "tidak tersedia (" + (e.message || "izin ditolak") + ")"; }
      }
      return JSON.stringify(out);
    }
    case "flashlight": {
      try {
        if (input.on) {
          if (!torchTrack) {
            const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            torchTrack = s.getVideoTracks()[0];
          }
          if (!torchTrack.getCapabilities?.().torch) { torchTrack.stop(); torchTrack = null; return "Senter tidak didukung browser/HP ini."; }
          await torchTrack.applyConstraints({ advanced: [{ torch: true }] });
          return "Senter menyala.";
        }
        if (torchTrack) { torchTrack.stop(); torchTrack = null; }
        return "Senter mati.";
      } catch (e) { return "Gagal mengakses senter: " + e.message; }
    }
    case "conversation_mode": {
      const on = input.mode === "diskusi";
      ui.setDiscussion(on);
      return on
        ? "Mode Diskusi aktif mulai jawaban ini. Sapa pengguna dengan antusias dan tanyakan topik apa yang ingin dibahas bila belum jelas."
        : "Kembali ke mode biasa. Konfirmasi singkat saja.";
    }
    case "clipboard_copy": {
      try { await navigator.clipboard.writeText(input.text); return "Disalin ke clipboard."; }
      catch { return "Gagal menyalin (browser butuh ketukan pengguna)."; }
    }
    case "share_text": {
      if (!navigator.share) return "Fitur bagikan tidak didukung.";
      try { await navigator.share({ text: input.text }); return "Menu bagikan dibuka."; }
      catch { ui.action("📤 Bagikan", "share:" + input.text); return "Tombol bagikan ditampilkan."; }
    }
  }
  return `Tool ${name} belum diimplementasikan.`;
}
