# Raphael — Asisten AI Suara (Slime 3D)

Aplikasi web (PWA) yang dipasang ke layar utama HP seperti aplikasi biasa.
Otaknya Claude (Anthropic), suaranya memakai mesin suara bawaan Chrome Android.

## Isi folder

| File | Fungsi |
|---|---|
| `index.html`, `style.css` | Tampilan |
| `slime.js` | Avatar slime 3D (Three.js): idle, mendengar, berpikir, berbicara |
| `voice.js` | Pengenalan suara, wake word, text-to-speech |
| `tools.js` | Perintah HP: buka aplikasi, telepon, WA/SMS, timer, pengingat, kalender, tugas, catatan, memori, senter |
| `app.js` | Otak: percakapan dengan Claude + web search |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | Supaya bisa di-install & dibuka offline |

## 1. Siapkan API key Claude
1. Buka https://console.anthropic.com → buat akun → isi saldo (pay-as-you-go).
2. Menu **API Keys** → **Create Key** → salin (`sk-ant-...`).
3. Biaya kira-kira: obrolan singkat dengan Haiku 5.5 sangat murah; Opus 5.5 lebih pintar tapi ±40× lebih mahal per token. Untuk dipakai harian, **Sonnet 5.5** atau **Haiku 5.5** sudah cukup — ganti di Pengaturan.

## 2. Online-kan aplikasinya (wajib HTTPS agar mikrofon jalan)
Cara termudah — **Netlify Drop** (gratis, tanpa coding):
1. Di laptop buka https://app.netlify.com/drop
2. Seret **folder `raphael`** ke halaman itu.
3. Dapat alamat seperti `https://nama-acak.netlify.app`. Selesai.

Alternatif: GitHub Pages, Cloudflare Pages, atau Vercel (unggah folder yang sama).

## 3. Install di HP (Android)
1. Buka alamat tadi di **Chrome Android**.
2. Menu ⋮ → **Tambahkan ke layar utama / Install app**.
3. Buka ikon slime → ⚙ Pengaturan → tempel API key → Simpan.
4. Izinkan **mikrofon** (dan notifikasi bila diminta).

iPhone: bisa lewat Safari → Bagikan → *Add to Home Screen*, tetapi pengenalan suara di iOS terbatas; fitur ketik tetap jalan.

## 4. Cara pakai
- **Ketuk slime / tombol 🎙** → bicara. Ketuk lagi saat ia bicara untuk memotong.
- **👂 Wake on** → cukup ucapkan *"Hai Raphael, …"* selama aplikasi terbuka (layar dijaga tetap menyala).
- **⌨** untuk mengetik.
- **☰** melihat tugas, pengingat, catatan, dan hal yang ia ingat tentangmu.
- Tekan lama ikon aplikasi → pintasan *Tugas hari ini / Berita / Cuaca*.

Contoh perintah:
- "Cuaca Bandung hari ini gimana?" · "Ringkas berita teknologi terbaru"
- "Putar lagu lofi di YouTube" · "Arahkan aku ke Stasiun Gambir"
- "Pasang timer 10 menit untuk masak mie"
- "Ingatkan aku jam 5 sore beli galon" · "Buat jadwal rapat besok jam 9 di kalender"
- "Tambahkan tugas kirim laporan" · "Apa saja tugasku?"
- "Kirim WA ke 0812xxxx bilang aku telat 10 menit" (draf, kamu yang tekan kirim)
- "Nyalakan senter" · "Ingat ya, aku suka kopi tanpa gula"
- Atau ngobrol santai saja.

## Mode Diskusi 💬
Untuk ngobrol panjang atau diskusi mendalam. Saat aktif, Raphael:
- berpikir lebih dalam (effort tinggi), menjawab lebih panjang (sekitar 4–8 kalimat),
- memberi pendapatnya sendiri, pro-kontra, contoh, dan berani menantang argumenmu,
- selalu menutup dengan pertanyaan supaya diskusi berlanjut,
- **terus mendengarkan** setelah menjawab dan sabar menunggu jeda bicaramu (kira-kira 2 detik diam = selesai),
- bilang "Hmm, biar aku pikirkan…" kalau berpikirnya agak lama,
- berubah warna jadi **ungu**.

Cara mengaktifkan, cukup dengan suara:
- *"Hai Raphael, ayo diskusi"* · *"ngobrol yuk"* · *"yuk ngobrol"* · *"mau curhat nih"* · *"diskusi dong"* · *"mode diskusi"*
- atau langsung dengan topiknya: *"Hai Raphael, ayo diskusi soal masa depan AI"*

Cara mematikan: *"udah dulu diskusinya"* · *"cukup ngobrolnya"* · *"kembali ke mode biasa"*.
Bisa juga lewat tombol **⚡ Biasa / 💬 Diskusi** di kanan atas.
Kalimat lain yang maksudnya sama ("temani aku mikir soal karier dong") biasanya juga dipahami, karena Raphael sendiri bisa mengganti mode.

Catatan: di Mode Diskusi jawaban lebih lama dan sedikit lebih mahal (lebih banyak token).

## Batasan jujur (beda dengan "Hey Google")
Aplikasi web tidak mendapat izin sistem seperti Google Assistant, jadi:
- **Wake word hanya aktif saat aplikasi terbuka** di layar. Tidak bisa mendengar dari latar belakang / saat layar mati.
- Membuka aplikasi lain, telepon, dan kirim pesan **butuh satu ketukan** pada tombol yang muncul (aturan keamanan browser). Pesan selalu berupa draf.
- **Timer & pengingat** berbunyi selama aplikasi terbuka. Untuk yang penting, minta ia membuat **Google Calendar** — itu pasti berbunyi.
- Tidak bisa mengubah Wi-Fi, volume, alarm bawaan, atau pengaturan Android.
- Di Android, mode wake word kadang berbunyi "tit" kecil setiap mikrofon dimulai ulang — itu perilaku Chrome.
- API key tersimpan di HP itu saja (localStorage). Jangan bagikan alamat aplikasimu bersama HP yang sudah berisi key-mu.

Kalau ingin wake word yang benar-benar jalan di latar belakang dan kontrol HP penuh, langkah berikutnya adalah membungkusnya menjadi **aplikasi Android native** (mis. Capacitor/Kotlin + Porcupine wake word + Accessibility Service). Itu proyek terpisah yang lebih besar.

## Ubah kepribadian
Edit fungsi `systemPrompt()` di `app.js`. Nama asisten, wake word, nama panggilanmu, suara, kecepatan dan nada bisa diubah langsung di ⚙ Pengaturan.
