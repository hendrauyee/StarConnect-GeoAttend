# 01 — Gambaran Umum GeoAttend

## Apa itu GeoAttend?

GeoAttend adalah sistem absensi berbasis web dengan tiga lapis verifikasi:

1. **Geofence GPS** — absensi hanya sah di dalam radius lokasi kantor yang dikonfigurasi
2. **Bukti foto real-time** — foto wajib diambil langsung dari kamera (bukan galeri)
3. **Pelacakan live** — posisi karyawan yang sedang hadir terpantau di peta admin

Aplikasi berjalan **local-first** di infrastruktur sendiri (Proxmox/Docker/VPS) tanpa biaya langganan.

## Fitur Lengkap

### Untuk Karyawan
- Absen masuk/pulang dengan kamera + validasi lokasi otomatis
- **Pilihan shift** saat absen untuk role dengan lebih dari satu shift (absen pulang otomatis mengikuti shift absen masuk)
- **Izin & Libur**: ajukan Sakit/Izin/Cuti (menunggu persetujuan administrator) atau tandai Libur hari ini sendiri
- Pendaftaran akun memakai **kode pendaftaran** dari administrator
- Indikator jarak real-time ke area absensi + peringatan sinyal GPS lemah
- Riwayat absensi dengan kalender bulanan berkode warna + detail foto
- Profil: ubah nama, foto profil, dan kata sandi sendiri
- Pengiriman posisi live otomatis selama status hadir (untuk pemantauan lapangan)

### Untuk Administrator
- Dashboard overview: statistik hadir/dalam/luar area + absensi terbaru
- **Peta Live**: marker bergerak mengikuti posisi karyawan (hijau berdenyut = live, biru = posisi terakhir), popup foto & jam
- **Rekap Bulanan**: satu baris per shift per hari (jam masuk/pulang, telat, lembur, **pulang cepat**, keterangan Hadir/Sakit/Izin/Cuti/Libur), ringkasan per karyawan, filter, ekspor **Excel (.xlsx, 2 sheet)**, CSV & PDF
- Kartu **Jadwal Shift Hari Ini** di Overview dikelompokkan **per role** (Admin & CS → NOC → Teknisi) beserta jumlah orangnya
- **Persetujuan Izin**: setujui/tolak pengajuan sakit/izin/cuti karyawan (dengan catatan)
- **Kelola Pengguna**: tambah akun langsung, edit nama/email/reset password, ubah role, hapus
- **Pengaturan**: editor geofence interaktif (drag pin + radius), jam kerja SOP per role, identitas aplikasi (nama+logo), dan **kode pendaftaran** akun

### Modul Stok Gudang
Aplikasi yang sama melayani dua merek berdasarkan **Host header**: `stok.` →
shell Stok Gudang, selain itu GeoAttend (lihat `lib/brand.server.ts`). Satu
basis data, satu login.

- Master barang berkategori: kode, satuan, stok awal, **stok minimum**, foto
- **Catat masuk/keluar** dengan foto & catatan opsional, plus **konfirmasi arah**
  sebelum tersimpan (mencegah masuk/keluar tertukar)
- Stok berjalan **dihitung dari buku besar** (stok awal + seluruh mutasi), bukan
  disimpan sebagai satu angka — riwayat selalu bisa dipertanggungjawabkan
- Status otomatis Habis / Menipis / Aman, ringkasan periode, riwayat berfilter
- **Ekspor Excel** daftar inventaris sesuai filter yang tampil
- Role `gudang` adalah akun **web-only** khusus subdomain stok (tidak bisa masuk
  absensi maupun aplikasi mobile)

## Arsitektur

```
┌──────────────────────────────────────────────────────┐
│  Browser (Karyawan / Administrator)                  │
│  Next.js App Router (React 18, Tailwind, Leaflet)    │
│  - TanStack Query (server state, polling)            │
│  - Zustand (GPS/UI state)                            │
│  - LiveTracker (kirim posisi tiap 20 detik)          │
└──────────────────┬───────────────────────────────────┘
                   │ HTTPS (cookie session HTTP-only)
┌──────────────────▼───────────────────────────────────┐
│  Next.js Server (API Routes, port 3000)              │
│  - Better Auth (session, password hash scrypt)       │
│  - Zod validation di semua endpoint                  │
│  - Validasi geofence server-side (Haversine)         │
│  - Foto → filesystem ./uploads (di luar public/)     │
└──────┬───────────────────────────────┬───────────────┘
       │ Drizzle ORM                   │ fs/promises
┌──────▼──────────────┐        ┌───────▼──────────────┐
│  PostgreSQL 16      │        │  ./uploads/          │
│  (Docker/native)    │        │  ├── attendance/     │
│                     │        │  └── avatars/        │
└─────────────────────┘        └──────────────────────┘
```

## Tech Stack

| Kategori | Teknologi | Versi |
| :--- | :--- | :--- |
| Framework | Next.js (App Router) | 14.2.x |
| Bahasa | TypeScript (strict) | 5.4.x |
| UI | Tailwind CSS + komponen kustom ala shadcn | 3.4.x |
| Peta | Leaflet + React-Leaflet (OpenStreetMap) | 1.9 / 4.2 |
| ORM | Drizzle ORM | 0.45.x |
| Database | PostgreSQL (image PostGIS) | 16 |
| Auth | Better Auth | 1.6.x |
| Validasi | Zod | 3.23.x |
| State server | TanStack Query | 5.x |
| State client | Zustand | 4.5.x |
| Kamera | react-webcam | 7.x |
| Tanggal | date-fns (locale id) | 3.x |
| PDF | jsPDF + jspdf-autotable (dynamic import) | 2.5 / 3.8 |
| Excel | ExcelJS (dynamic import, chunk terpisah) | 4.4.x |
| Notifikasi | sonner | 1.5.x |

## Struktur Proyek

```
GeoAttend/
├── docs/                       # Dokumentasi (folder ini)
├── docker-compose.yml          # db (default) + app (profile: production)
├── Dockerfile                  # Multi-stage build Next.js standalone
├── drizzle.config.ts
├── scripts/seed.ts             # Seed administrator + geofence + SOP shift
├── tests/unit/                 # Vitest: geo & perhitungan shift
├── uploads/                    # Foto absensi & avatar (gitignored)
└── src/
    ├── middleware.ts           # Guard cookie session (optimistik)
    ├── app/
    │   ├── (auth)/             # login, register
    │   ├── (dashboard)/        # checkin, history, profile, admin/*
    │   │   └── admin/          # layout guard role administrator
    │   │       ├── page.tsx        # Overview
    │   │       ├── live-map/       # Peta live + tracking
    │   │       ├── reports/        # Rekap bulanan (Excel/CSV/PDF)
    │   │       ├── leaves/         # Persetujuan izin/libur
    │   │       ├── users/          # Kelola pengguna
    │   │       └── settings/       # Geofence + jam kerja SOP + kode pendaftaran
    │   └── api/                # Lihat docs/02-api.md
    ├── components/
    │   ├── ui/                 # Button, Card, Dialog, Input, ...
    │   ├── layouts/            # Header, DesktopSidebar, MobileNav
    │   └── features/           # attendance/, map/, admin/, auth/, profile/
    ├── lib/
    │   ├── export/xlsx.ts      # Penulis .xlsx bersama (ExcelJS, dinamis)
    │   ├── stock/              # Buku besar stok (index.ts) + label (labels.ts)
    │   ├── db/                 # schema.ts, koneksi, migrations/
    │   ├── auth/               # Better Auth server + client + helpers
    │   ├── geo/                # Haversine + validasi geofence
    │   ├── shifts/calc.ts      # Logika telat/lembur/pulang cepat (pure, teruji)
    │   ├── leaves.ts           # Helper izin/libur (label, rentang tanggal)
    │   ├── settings.ts         # Pengaturan app (nama, logo, kode pendaftaran)
    │   ├── storage/local-fs.ts # Simpan/baca foto dengan proteksi path
    │   └── constants.ts        # WORK_ROLES, DEFAULT_SHIFTS, dll.
    ├── hooks/                  # useGeolocation, useAttendance (query hooks)
    ├── stores/                 # Zustand
    └── types/api.ts            # Zod schema + tipe request/response
```

## Prinsip Desain

- **Server tidak mempercayai client**: geofence, duplikasi absen, dan role dicek ulang server-side
- **Foto tidak publik**: disimpan di luar `public/`, disajikan via endpoint terautentikasi
- **Mobile-first**: bottom nav di HP, sidebar di desktop; target Lighthouse > 90
- **Bahasa Indonesia** untuk seluruh teks pengguna
- **Satu sumber kebenaran perhitungan**: `lib/shifts/calc.ts` dipakai web (dan nanti mobile via API rekap bila diperlukan)
