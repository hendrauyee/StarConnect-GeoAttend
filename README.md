# GeoAttend

Aplikasi absensi berbasis web & native mobile dengan **verifikasi geofence GPS**, **bukti foto real-time**, **pelacakan posisi live background**, dan **manajemen shift & izin lengkap**. Dibangun dengan Next.js 14 (App Router), Expo SDK 57 (React Native), Drizzle ORM + PostgreSQL, Better Auth, Leaflet, dan TanStack Query.

📚 **Dokumentasi lengkap: [docs/](docs/01-overview.md)** — gambaran umum, referensi API, database, aturan bisnis, deployment (Proxmox VM/LXC), panduan pengguna, dan [dokumentasi aplikasi mobile native](docs/08-mobile-app.md).

📖 **Panduan pengguna siap cetak: [Panduan Lengkap GeoAttend v1.6 (PDF)](docs/Panduan-Lengkap-GeoAttend.pdf)** — untuk karyawan sekaligus administrator.

---

## 🚀 Fitur Utama

### 📱 Aplikasi Mobile Native (Android - v1.6.0)
- 📸 **Check-in/out Foto & GPS** — Ambil bukti foto langsung via kamera perangkat & verifikasi jarak geofence.
- 🛰️ **Pelacakan Posisi Background (Live Tracking)** — Melacak lokasi karyawan secara otomatis di background (menggunakan `expo-task-manager` & foreground service) walau layar HP mati/tersimpan di saku selama jam kerja.
- ⚙️ **Pengaturan Server Dinamis** — URL server backend bisa disesuaikan langsung di layar login aplikasi tanpa perlu re-build APK.
- 🔄 **Autentikasi Bearer Token** — Sesi login tersimpan aman via `expo-secure-store`.
- 🗓️ **Jadwal Shift, Piket & Tukar Shift** — Pantau jadwal kerja bulanan, piket harian, dan pengajuan tukar shift antar karyawan langsung dari HP.

### 🌐 Dashboard Web & System Features
- 📍 **Validasi Geofence Server-Side** — Toleransi akurasi GPS & rumus Haversine server-side (radius 10m–5km).
- 🕐 **Pilihan & Aturan Shift** — Mendukung multi-shift, telat, lembur, dan **pulang cepat** yang terhitung otomatis per shift.
- 📊 **Rekap Bulanan & Ekspor** — Laporan absensi lengkap karyawan per bulan, dengan dukungan ekspor CSV & PDF.
- 🏖️ **Izin & Libur** — Pengajuan Sakit/Izin/Cuti dengan workflow persetujuan admin & fitur mandiri tandai libur.
- 🎫 **Kode Pendaftaran** — Keamanan pendaftaran akun baru wajib menggunakan kode registrasi dari administrator.
- 🗺️ **Peta Live Admin** — Pemantauan lokasi seluruh karyawan aktif secara real-time di peta interaktif Leaflet. Marker terkunci di posisi terakhir yang diketahui saat karyawan berhenti bergerak — tidak pernah mundur ke titik absen.
- 🧭 **Riwayat Lokasi Harian** — Dari rekap bulanan, admin bisa membuka rute perjalanan karyawan per hari (ala Google Maps Timeline): jalur tempuh, titik berhenti beserta durasinya, total jarak, plus foto absen masuk & pulang. Retensi 90 hari, otomatis dibersihkan.
- 🔐 **Keamanan & Auth** — Better Auth, HTTP-only cookie, session sliding, CSP & proteksi CSRF domain proxy.

---

## 📱 Aplikasi Mobile Native (Expo SDK 57)

Folder [`mobile/`](mobile/) berisi kode aplikasi Android React Native:

### 1. Menjalankan Mode Development
```bash
cd mobile
npm install
npx expo start
```

### 2. Build APK Production (EAS Build)
Build APK mandiri tanpa Android Studio via Expo Application Services:

```bash
cd mobile

# Menggunakan npx.cmd di Windows PowerShell jika ExecutionPolicy diblokir:
npx.cmd eas build -p android --profile production
```
*Hasil build berupa file APK siap install yang bisa dibagikan langsung ke perangkat karyawan.*

---

## 💻 Menjalankan Web Backend & Web App (Development)

### 1. Prasyarat
- Node.js 20+
- Docker Desktop (untuk PostgreSQL)

### 2. Setup & Seed
```bash
# Salin env
cp .env.example .env.local

# Install dependencies
npm install

# Nyalakan database PostgreSQL
docker compose up -d db

# Jalankan migrasi & seed
npm run db:migrate
npm run db:seed
# → Admin Default: admin@geoattend.local / Admin12345

# Jalankan dev server
npm run dev
```

Buka http://localhost:3000 — login sebagai admin, lalu:
1. Atur area lokasi di **Admin → Pengaturan → Area Absensi**
2. Buat **Kode Pendaftaran** di **Pengaturan → General**

---

## 📜 Perintah Utama

| Perintah | Fungsi |
| :--- | :--- |
| `npm run dev` | Menjalankan Next.js Web Dev Server |
| `npm run build` / `npm start` | Build & jalankan production Web Server |
| `npm run test` | Unit test (Vitest) |
| `npm run db:migrate` | Terapkan migrasi database |
| `npm run db:seed` | Seed akun administrator + area geofence awal |
| `cd mobile && npx expo start` | Menjalankan Expo Dev Server Mobile |

---

## 🐳 Deployment (Docker Production)

```bash
export DB_PASSWORD=<password-kuat>
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
export APP_URL=https://absensi.perusahaan.com

docker compose --profile production up -d --build
```

Health check: `GET /api/health` → `{"status":"ok","db":"connected"}`

---

## 📁 Struktur Proyek

```
GeoAttend/
├── docs/                 # Dokumentasi teknis & panduan PDF pengguna
├── mobile/               # Aplikasi Native Android (Expo SDK 57 / React Native)
│   ├── App.tsx           # Entry & tab navigator
│   ├── app.json          # Konfigurasi izin Android (Kamera, Background GPS, Notifikasi)
│   ├── eas.json          # Profil build APK EAS
│   └── src/
│       ├── api/          # HTTP Client + Bearer Token
│       ├── screens/      # Screen CheckIn, Schedule, Leaves, History, Profile
│       └── tracking/     # Background Location Task (expo-task-manager)
├── src/                  # Web Dashboard & Backend REST API (Next.js 14 App Router)
│   ├── app/              # App Router Pages & API Endpoints
│   ├── components/       # Komponen UI shadcn/Tailwind & Leaflet Live Map
│   ├── lib/              # Drizzle ORM, Better Auth, Validasi Geofence & Shift
│   └── stores/           # State management (Zustand)
└── uploads/              # Penyimpanan terproteksi untuk foto absensi & avatar
```

---

## 🔒 Catatan Keamanan

- Foto absensi disimpan terproteksi di `./uploads` (di luar web root `public/`) dan hanya bisa diakses via endpoint API terautentikasi.
- Seluruh perhitungan lokasi & geofence divalidasi ulang di server (Haversine Formula).
- Token autentikasi mobile tersimpan aman di Encrypted Shared Preferences via `expo-secure-store`.

---

## 📌 Roadmap / Pengembangan Mendatang

- [x] Android push notification (Expo Push + FCM) — notifikasi persetujuan untuk administrator.
- [ ] Pengingat absen terjadwal (worker yang membaca jadwal shift).
- [ ] Support iOS Push Notifications (APNs).
- [ ] Offline queue absensi (penyimpanan antrian offline di perangkat saat sinyal buruk).
- [ ] Face Recognition auto-match server-side.
- [ ] Retensi otomatis pembersihan foto tua > 90 hari.

