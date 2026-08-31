# GeoAttend Mobile (Android)

Aplikasi mobile GeoAttend — Expo (React Native, SDK 57). Mengonsumsi API yang sama
dengan versi web ([docs/02-api.md](../docs/02-api.md)) memakai **bearer token**
(plugin `bearer` Better Auth sudah aktif di backend).

## Fitur

- Login dengan alamat server yang bisa diubah (default: `https://absensi.serayu.id`)
- Absen masuk/pulang: foto kamera (wajib), validasi jarak geofence real-time, pilihan shift
- **Pelacakan posisi background** — berjalan walau HP di saku, selama status hadir;
  berhenti otomatis saat absen pulang / server menolak (`NOT_CLOCKED_IN`)
- Izin & Libur: tandai libur hari ini, ajukan sakit/izin/cuti, pantau status
- Riwayat absensi + profil

## Struktur

```
mobile/
├── App.tsx                  # Navigasi tab + session gate
├── index.ts                 # Entry — daftarkan background task SEBELUM app render
├── app.json                 # Config Expo (izin lokasi background, kamera, package id)
├── eas.json                 # Profil build EAS (development / preview / production)
└── src/
    ├── api/client.ts        # Fetch wrapper: base URL + bearer token (SecureStore)
    ├── api/types.ts         # Tipe API (subset dari ../src/types/api.ts — jaga sinkron)
    ├── auth/session.tsx     # Context login/logout/get-session
    ├── lib/                 # Haversine, format tanggal, pemilihan shift
    ├── tracking/locationTask.ts  # Background task kirim posisi tiap 20 detik
    ├── components/ui.tsx    # Button, Field, PasswordField, Card, Badge
    └── screens/             # Login, CheckIn, Leaves, History, Profile
```

## Development

```bash
cd mobile
npm install
npx expo start        # scan QR dengan Expo Go di HP (fitur background location TIDAK jalan di Expo Go)
```

> Untuk menguji **kamera + background location** butuh *development build*
> (bukan Expo Go): `eas build -p android --profile development`, install APK-nya,
> lalu `npx expo start --dev-client`.

## Build APK (EAS — tanpa Android Studio)

Sekali saja:

```bash
npm install -g eas-cli
eas login                      # akun expo.dev (gratis)
cd mobile
eas init                       # tautkan proyek (ikuti prompt)
```

Build:

```bash
# Untuk PowerShell di Windows (bila npx terblokir Script Execution Policy):
npx.cmd eas build -p android --profile production

# Atau standar CLI:
eas build -p android --profile production
```

Tunggu antrian cloud (± 10–20 menit) → dapat **link unduhan APK** → install di HP
karyawan (izinkan "install dari sumber tidak dikenal").

## Arah server

| Profil | Server |
| :--- | :--- |
| Default APK | `https://absensi.serayu.id` (server kantor) |
| Demo/staging | Ubah dari app: layar login → **Pengaturan server** → isi `https://absensi.masamune.my.id` |

Alamat tersimpan per perangkat — tidak perlu build ulang saat pindah server.

## Checklist server agar mobile berfungsi

- [x] Plugin `bearer` Better Auth aktif (`src/lib/auth/index.ts`)
- [ ] Server produksi HTTPS (`absensi.serayu.id`) — lihat [docs/05-deployment.md](../docs/05-deployment.md)
- [ ] `BETTER_AUTH_URL` + `BETTER_AUTH_TRUSTED_ORIGINS` di-set di server
- [ ] Akun karyawan sudah dibuat (via admin atau kode pendaftaran di web)

## Catatan penting

- **Login & absen dilakukan dari APK build**, bukan Expo Go (Expo Go tidak punya izin background location & foreground service).
- Foto dikompres di app (maks lebar 1200 px, JPEG q0.8) sebelum dikirim sebagai base64 — sesuai kontrak API (maks 5 MB).
- Waktu absen dicatat **server**, bukan jam HP.
- Jika kontrak API berubah di web, perbarui juga `src/api/types.ts` di sini.
