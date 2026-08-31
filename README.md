# GeoAttend

Aplikasi absensi **multi-tenant** berbasis web & native mobile dengan **verifikasi geofence GPS**, **bukti foto real-time**, **pelacakan posisi live background**, dan **manajemen shift & izin lengkap**. Dibangun dengan Next.js 14 (App Router), Expo SDK 57 (React Native), Drizzle ORM + PostgreSQL, Better Auth, Leaflet, dan TanStack Query.

Dikembangkan & dioperasikan oleh **StarConnect**.

📚 **Dokumentasi lengkap: [docs/](docs/01-overview.md)** — gambaran umum, referensi API, database, aturan bisnis, deployment (Proxmox VM/LXC), panduan pengguna, dan [dokumentasi aplikasi mobile native](docs/08-mobile-app.md).

📖 **Panduan pengguna siap cetak: [Panduan Lengkap GeoAttend v1.6 (PDF)](docs/Panduan-Lengkap-GeoAttend.pdf)** — untuk karyawan sekaligus administrator.

---

## 🚀 Fitur Utama

### 🏢 Multi-POP (Multi-Tenant)
- 🌐 **Setiap POP Berdiri Sendiri** — Satu instalasi bisa melayani banyak POP (site/cabang) sekaligus. Karyawan, teknisi, admin, geofence, jam kerja, jadwal, izin, live tracking, dan stok gudang setiap POP terisolasi total dari POP lain.
- 👑 **Super Admin Lintas-POP** — Peran khusus yang membuat POP baru beserta admin pertamanya, dan bisa membuka data POP mana pun bila diperlukan. Admin biasa hanya melihat & mengelola POP miliknya sendiri — tidak pernah bisa mengakses data POP lain, termasuk lewat manipulasi request langsung.
- 📍 **Lokasi Kantor per-POP** — Setiap POP mengatur sendiri titik geofence (lat/long/radius) sesuai alamat kantornya masing-masing; validasi absen karyawan selalu memakai geofence POP-nya sendiri.

### 📱 Aplikasi Mobile Native (Android)
- 📸 **Check-in/out Foto & GPS** — Ambil bukti foto langsung via kamera perangkat & verifikasi jarak geofence.
- 🛰️ **Pelacakan Posisi Background (Live Tracking)** — Melacak lokasi karyawan secara otomatis di background (menggunakan `expo-task-manager` & foreground service) walau layar HP mati/tersimpan di saku selama jam kerja.
- ⚙️ **Pengaturan Server Dinamis** — URL server backend bisa disesuaikan langsung di layar login aplikasi tanpa perlu re-build APK.
- 🔄 **Autentikasi Bearer Token** — Sesi login tersimpan aman via `expo-secure-store`.
- 🗓️ **Jadwal Shift, Piket & Tukar Shift** — Pantau jadwal kerja bulanan, piket harian, dan pengajuan tukar shift antar karyawan langsung dari HP. Semua data sudah otomatis sesuai POP karyawan yang login — tidak perlu pengaturan tambahan di app.

### 🌐 Dashboard Web & System Features
- 📍 **Validasi Geofence Server-Side** — Toleransi akurasi GPS & rumus Haversine server-side (radius 10m–5km), per-POP.
- 🕐 **Pilihan & Aturan Shift** — Mendukung multi-shift, telat, lembur, dan **pulang cepat** yang terhitung otomatis per shift, per-POP.
- 📊 **Rekap Bulanan & Ekspor** — Laporan absensi lengkap karyawan per bulan, dengan dukungan ekspor CSV & PDF.
- 🏖️ **Izin & Libur** — Pengajuan Sakit/Izin/Cuti dengan workflow persetujuan admin & fitur mandiri tandai libur.
- 🎫 **Kode Pendaftaran** — Keamanan pendaftaran akun baru wajib menggunakan kode registrasi dari administrator.
- 🗺️ **Peta Live Admin** — Pemantauan lokasi seluruh karyawan aktif secara real-time di peta interaktif Leaflet, per-POP. Marker terkunci di posisi terakhir yang diketahui saat karyawan berhenti bergerak — tidak pernah mundur ke titik absen.
- 🧭 **Riwayat Lokasi Harian** — Dari rekap bulanan, admin bisa membuka rute perjalanan karyawan per hari (ala Google Maps Timeline): jalur tempuh, titik berhenti beserta durasinya, total jarak, plus foto absen masuk & pulang. Retensi 90 hari, otomatis dibersihkan.
- 📦 **Modul Stok Gudang** — Kategori, master barang, dan buku besar keluar-masuk barang, terpisah per POP.
- 🔐 **Keamanan & Auth** — Better Auth, HTTP-only cookie, session sliding, CSP & proteksi CSRF domain proxy, isolasi data lintas-tenant di setiap endpoint API.

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
```

Seed membuat 3 hal sekaligus (aman dijalankan ulang):
- **Super Admin** (tidak terikat POP manapun): `superadmin@geoattend.local` / `SuperAdmin12345`
- **POP Default** — POP pertama, dengan geofence & jam kerja SOP contoh
- **Administrator POP Default**: `admin@geoattend.local` / `Admin12345`

```bash
# Jalankan dev server
npm run dev
```

Buka http://localhost:3000 dan login:

**Sebagai super admin** (`superadmin@geoattend.local`) — buka menu **Kelola POP** di sidebar untuk:
1. Buat POP baru (nama + kode singkat, mis. `LPG` untuk POP Lampung)
2. Klik **Tambah Admin** pada POP itu untuk membuat akun administrator pertamanya

**Sebagai administrator satu POP** (mis. `admin@geoattend.local`) — hanya mengelola POP miliknya sendiri:
1. Atur lokasi kantor di **Pengaturan → Area Absensi** (geofence POP ini saja)
2. Buat **Kode Pendaftaran** di **Pengaturan → General**
3. Tambah karyawan/teknisi lewat **Pengguna → Tambah Pengguna**

---

## 📱 Aplikasi Mobile Native (Expo SDK 57)

Folder [`mobile/`](mobile/) berisi kode aplikasi Android React Native. App mobile **tidak perlu tahu apa pun soal POP** — server otomatis membatasi setiap request (absen, jadwal, izin, tukar shift) ke POP milik akun yang login.

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

> **Push notification (FCM):** `mobile/google-services.json` harus terdaftar di Firebase Console dengan package name yang SAMA PERSIS dengan `android.package` di `mobile/app.json` (`net.starconnect.geoattend`). Kalau package name pernah diganti, buat ulang app Android di Firebase Console dan unduh `google-services.json` yang baru sebelum build — kalau tidak cocok, build APK bisa gagal atau notifikasi push tidak akan berfungsi.

---

## 📜 Perintah Utama

| Perintah | Fungsi |
| :--- | :--- |
| `npm run dev` | Menjalankan Next.js Web Dev Server |
| `npm run build` / `npm start` | Build & jalankan production Web Server |
| `npm run test` | Unit test (Vitest) |
| `npm run db:migrate` | Terapkan migrasi database |
| `npm run db:seed` | Seed super admin + POP Default + admin & geofence contohnya (idempotent) |
| `npm run db:seed-stock` | Impor data awal stok gudang dari CSV ke POP Default |
| `cd mobile && npx expo start` | Menjalankan Expo Dev Server Mobile |

---

## 🐳 Deployment (Docker Production)

```bash
export DB_PASSWORD=<password-kuat>
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
export APP_URL=https://absensi.serayu.id

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
│   ├── app/
│   │   ├── api/pops/     # CRUD POP (super_admin saja)
│   │   └── (dashboard)/admin/pops/  # Halaman "Kelola POP"
│   ├── components/       # Komponen UI shadcn/Tailwind, Leaflet Live Map, PopManager
│   ├── lib/
│   │   ├── auth/pop-scope.ts  # Resolusi POP aktif untuk tiap request API
│   │   ├── db/           # Drizzle ORM (tabel `pops` + kolom `popId` di tabel terkait)
│   │   └── ...           # Better Auth, Validasi Geofence & Shift
│   └── stores/           # State management (Zustand)
└── uploads/              # Penyimpanan terproteksi untuk foto absensi & avatar
```

---

## 🔒 Catatan Keamanan

- Foto absensi disimpan terproteksi di `./uploads` (di luar web root `public/`) dan hanya bisa diakses via endpoint API terautentikasi.
- Seluruh perhitungan lokasi & geofence divalidasi ulang di server (Haversine Formula), selalu di-scope ke POP pemilik data.
- Token autentikasi mobile tersimpan aman di Encrypted Shared Preferences via `expo-secure-store`.
- Isolasi multi-tenant ditegakkan di setiap endpoint API (bukan cuma di UI) — administrator satu POP tidak bisa membaca, mengubah, atau menghapus data POP lain walau lewat request API langsung.

---

## 📌 Roadmap / Pengembangan Mendatang

- [x] Multi-POP (multi-tenant) — isolasi penuh per POP + super admin lintas-POP.
- [x] Android push notification (Expo Push + FCM) — notifikasi persetujuan untuk administrator (per-POP).
- [ ] Pendaftaran mandiri (kode pendaftaran) per-POP — saat ini onboarding karyawan lewat admin yang menambahkan langsung.
- [ ] Dashboard gabungan lintas-POP untuk super admin (rekap semua POP dalam satu layar).
- [ ] Pengingat absen terjadwal (worker yang membaca jadwal shift).
- [ ] Support iOS Push Notifications (APNs).
- [ ] Offline queue absensi (penyimpanan antrian offline di perangkat saat sinyal buruk).
- [ ] Face Recognition auto-match server-side.
- [ ] Retensi otomatis pembersihan foto tua > 90 hari.
