# 08 — Aplikasi Mobile (Android)

Dokumentasi teknis aplikasi mobile GeoAttend yang **sudah dibangun** (React
Native + Expo). Berbeda dengan [07 — Integrasi Mobile](07-mobile-integration.md)
yang merupakan kontrak perencanaan, dokumen ini menjelaskan implementasi nyata di
folder [`mobile/`](../mobile/).

Backend tidak berubah: aplikasi mobile mengonsumsi REST API yang sama dengan web
([02 — Referensi API](02-api.md)).

---

## 1. Ringkasan

Aplikasi punya **dua kerangka yang terpisah penuh**, dipilih dari role saat login:

- **Karyawan** — absen masuk/pulang dengan verifikasi lokasi + foto, pelacakan
  posisi background selama jam kerja, jadwal shift, tukar shift, piket, izin,
  dan riwayat.
- **Administrator** — panel pengelolaan saja: persetujuan, peta posisi tim,
  kelola karyawan, stok. Tidak ada Absen, Riwayat, Jadwal, maupun Izin.
  Administrator tidak pernah absen dan tidak punya shift, jadi menu itu selalu
  kosong baginya.

Pemisahannya di level **navigator**, bukan menu yang disembunyikan satu per satu
di dalam layar: tab bar, isi beranda, dan daftar rute semuanya berbeda, dan
percabangan yang tersebar di banyak layar jauh lebih mudah bocor. Rute yang tidak
terdaftar tidak bisa dibuka sama sekali.

Sebagian fitur administrator tetap hanya di web — grid jadwal bulanan, hapus akun,
ganti kata sandi orang lain, backup/restore, dan setelan geofence.

Alasan utama versi native (bukan sekadar web di HP): **pelacakan lokasi
background**. Browser mematikan GPS saat layar mati/app di-background — native
dengan izin *background location* bisa terus mengirim posisi walau HP di saku.

---

## 2. Tech Stack

| Bagian | Pilihan |
| :--- | :--- |
| Framework | Expo SDK **57** (`expo ~57.0.10`) |
| Runtime | React Native **0.86.2**, React **19.2.3** |
| Bahasa | TypeScript ~6.0.3 (strict) |
| Navigasi | `@react-navigation/native` + `@react-navigation/bottom-tabs` |
| Lokasi | `expo-location` + `expo-task-manager` (task background) |
| Kamera & gambar | `expo-camera`, `expo-image-manipulator`, `expo-image-picker` |
| Penyimpanan | `expo-secure-store` (token), `@react-native-async-storage/async-storage` (alamat server) |
| Ikon | `lucide-react-native` |
| Build | EAS Build (cloud), distribusi APK internal |

> Catatan versi Expo: SDK 57 berubah cukup banyak. Selalu rujuk dokumen resmi
> berversi di <https://docs.expo.dev/versions/v57.0.0/> sebelum menulis kode
> (lihat [`mobile/AGENTS.md`](../mobile/AGENTS.md)).

---

## 3. Struktur Folder

```
mobile/
├── App.tsx                     # Root: provider + gate login/tab + tab navigator
├── index.ts                    # Entry — mendaftarkan App & task lokasi
├── app.json                    # Konfigurasi Expo (paket, izin, plugin, ikon)
├── eas.json                    # Profil build EAS (development/preview/production)
└── src/
    ├── api/
    │   ├── client.ts           # Fetch wrapper: base URL, bearer, Origin, error
    │   └── types.ts            # Tipe API (subset src/types/api.ts web)
    ├── auth/
    │   └── session.tsx         # SessionProvider: signIn/signUp/signOut/refresh
    ├── components/
    │   ├── ui.tsx              # Primitives: Button, Field, Card, Badge, Sheet, PhotoViewer
    │   ├── AppAlert.tsx        # Dialog bertema + appAlert() (pengganti Alert bawaan)
    │   ├── TabBar.tsx          # Tab bar mengambang + useTabBarSpace()
    │   ├── GeofenceMap.tsx     # Peta OSM via WebView (satu titik + area)
    │   └── TeamMap.tsx         # Peta OSM via WebView (banyak marker karyawan)
    ├── lib/
    │   ├── geo.ts             # Haversine, format jarak/tanggal/jam
    │   ├── keyboard.ts        # useKeyboardHeight (angkat isi di atas papan ketik)
    │   ├── recap.ts           # HTML rekap untuk cetak PDF
    │   ├── schedule.ts        # Label shift/bulan, meta status tukar, label role roster
    │   ├── session.ts         # deriveOpenSession (sesi absen terbuka)
    │   └── shifts.ts          # pickShift (shift default berdasar jam)
    ├── screens/
    │   ├── AuthScreen.tsx      # Masuk / Daftar (segmented) + setelan server
    │   ├── DashboardScreen.tsx # Ringkasan, roster hari ini per role, piket
    │   ├── CheckInScreen.tsx   # Absen: status lokasi + kamera + kirim
    │   ├── ScheduleScreen.tsx  # Jadwal shift, tukar shift, piket
    │   ├── LeavesScreen.tsx    # Izin & libur
    │   ├── ApprovalsScreen.tsx # Persetujuan izin & tukar shift (administrator)
    │   ├── TeamMapScreen.tsx   # Peta posisi tim live (administrator)
    │   ├── ManageUsersScreen.tsx # Kelola role & tim teknisi (administrator)
    │   ├── HistoryScreen.tsx   # Riwayat absensi & stok
    │   ├── StockScreen.tsx     # Katalog stok + catat masuk/keluar
    │   └── ProfileScreen.tsx   # Profil, foto, rekap PDF, keluar
    ├── push/
    │   ├── registration.ts    # Izin, ambil Expo push token, daftar/cabut ke server
    │   └── routing.ts         # Handler foreground + buka layar saat notif disentuh
    ├── theme.ts                # Token warna/spacing/radius (selaras DESIGN.md)
    └── tracking/
        └── locationTask.ts     # Task background pelacakan posisi + start/stop
```

---

## 4. Konfigurasi

### 4.1 `app.json` (Expo)

- **Identitas:** `name` GeoAttend, paket Android & bundle iOS
  `net.starconnect.geoattend`. Versi saat ini **1.13.0**.
- **Izin Android:** `CAMERA`, `ACCESS_COARSE/FINE/BACKGROUND_LOCATION`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `RECEIVE_BOOT_COMPLETED`,
  `WAKE_LOCK`, `POST_NOTIFICATIONS`.
- **Plugin:** `expo-secure-store`, `expo-camera`, `expo-location`
  (`isAndroidBackgroundLocationEnabled: true`, foreground service aktif),
  `expo-image-picker`, `expo-build-properties` (ProGuard + shrink resources di
  rilis), `expo-notifications` (ikon monokrom + warna merek).
- **EAS projectId** dan `owner: masamune21s-team` untuk build cloud.
- **`googleServicesFile`** menunjuk ke `./google-services.json` (wajib ada saat
  build, lihat §10).

### 4.2 `eas.json` (profil build)

| Profil | Tujuan | Catatan |
| :--- | :--- | :--- |
| `development` | Dev client | APK, `developmentClient: true` |
| `preview` | Uji internal | APK, hanya `arm64-v8a` (build lebih ringan) |
| `production` | Rilis karyawan | APK, `autoIncrement` versionCode, `arm64-v8a` |

Semua profil `distribution: internal` — APK dibagikan langsung (sideload),
bukan lewat Play Store.

---

## 5. Arsitektur Runtime

```
index.ts
  ├─ import './src/tracking/locationTask'   # DAFTARKAN task sebelum app jalan
  └─ registerRootComponent(App)

App.tsx
  └─ SafeAreaProvider → SessionProvider → NavigationContainer → Root
       Root:
         initializing        → spinner
         !user               → <AuthScreen/>     (belum login)
         role administrator  → <AdminTabs/>      Dashboard · Persetujuan · Peta Tim · Stok · Profil
                                + stack: KelolaKaryawan
         role lain           → <Tabs/>           Dashboard · Riwayat · Absen · Stok · Profil
                                + stack: Jadwal, Izin
```

Tab bar administrator **tanpa tombol mengambang**: tombol bundar di tengah hanya
digambar bila ada rute bernama `Absen`, dan ruang tembus pandang di atas bar
(`OVERHANG`) ikut ditiadakan agar tidak menyisakan celah kosong.

Penting: `locationTask.ts` **di-import di `index.ts`** agar
`TaskManager.defineTask` terdaftar sebelum React dirender — kalau tidak, task
background tak dikenali saat OS membangunkannya.

---

## 6. Lapisan API — [`src/api/client.ts`](../mobile/src/api/client.ts)

Satu fungsi `api<T>(path, init)` membungkus `fetch`:

- **Base URL** dapat dikonfigurasi. Default `https://absensi.serayu.id`,
  disimpan di AsyncStorage (`geoattend_server_url`), bisa diubah di layar login.
- **Token bearer** disimpan di SecureStore (`geoattend_auth_token`); dikirim
  sebagai `Authorization: Bearer <token>`.
- **Header `Origin`** diisi manual = URL server. React Native tidak mengirim
  `Origin` otomatis seperti browser, dan Better Auth menolak request tanpa Origin.
- **Refresh token:** bila respons memuat header `set-auth-token`, token tersimpan
  diperbarui otomatis.
- **Error seragam:** `ApiRequestError { message, status, code }`. Gagal jaringan →
  `status: 0`, `code: 'NETWORK_ERROR'`.

---

## 7. Autentikasi — [`src/auth/session.tsx`](../mobile/src/auth/session.tsx)

`SessionProvider` menyimpan `user`, `initializing`, dan aksi:

| Aksi | Endpoint | Keterangan |
| :--- | :--- | :--- |
| `signIn(serverUrl, email, password)` | `POST /api/auth/sign-in/email` | Simpan server + token, lalu `refresh()` |
| `signUp(serverUrl, { name, email, password, registrationCode })` | `POST /api/auth/sign-up/email` | Kode pendaftaran divalidasi server; `autoSignIn` → langsung dapat token |
| `signOut()` | `POST /api/auth/sign-out` | **Menghentikan tracking dulu**, hapus token |
| `refresh()` | `GET /api/auth/get-session` | Token 401 → paksa login ulang |

`signIn` & `signUp` berbagi satu helper `authenticate()` (login sesudah daftar
otomatis karena `autoSignIn` aktif di server).

Layar [`AuthScreen`](../mobile/src/screens/AuthScreen.tsx) memakai *segmented
control* Masuk/Daftar. Alamat server diubah lewat modal (draft terpisah agar bisa
dibatalkan) — hanya diperlukan bila server bukan default.

---

## 8. Peta Layar → Fungsi → Endpoint

| Layar | Fungsi utama | Endpoint |
| :--- | :--- | :--- |
| **Absen** ([CheckInScreen](../mobile/src/screens/CheckInScreen.tsx)) | **Jadwal hari ini** (Shift 1/2 atau Libur), status lokasi (jarak ke area), foto bukti, pilih shift (default ikut jadwal), kirim absen; mulai tracking saat masuk. Juga **Mulai/Selesai Lembur Urgent** untuk panggilan di luar shift | `GET /api/geofence`, `GET /api/attendance?today=true&userId=self`, `GET /api/shifts`, `GET /api/schedules?userId=self`, `POST /api/attendance` |
| **Jadwal** ([ScheduleScreen](../mobile/src/screens/ScheduleScreen.tsx)) | Lihat jadwal shift bulanan, ajukan/terima/tolak/batal tukar shift, tandai piket | `GET /api/schedules`, `GET /api/swaps`, `GET /api/swaps/candidates`, `POST/PATCH/DELETE /api/swaps`, `GET/PATCH /api/piket` |
| **Izin** ([LeavesScreen](../mobile/src/screens/LeavesScreen.tsx)) | Tandai libur hari ini (disembunyikan bila jadwal hari itu sudah Libur — otomatis masuk rekap), ajukan sakit/izin/cuti, batalkan pengajuan | `GET /api/leaves?userId=self`, `GET /api/schedules?userId=self`, `POST /api/leaves`, `DELETE /api/leaves/:id` |
| **Riwayat** ([HistoryScreen](../mobile/src/screens/HistoryScreen.tsx)) | Daftar absensi (masuk/pulang, jarak, dalam/luar area, catatan) | `GET /api/attendance?userId=self&limit=100` |
| **Profil** ([ProfileScreen](../mobile/src/screens/ProfileScreen.tsx)) | Foto avatar & sampul, **ubah nama**, **ganti kata sandi**, info server/versi, keluar | `POST /api/profile/avatar`, `POST /api/profile/cover`, `POST /api/auth/update-user`, `POST /api/auth/change-password`, `POST /api/auth/sign-out` |
| **Persetujuan** ([ApprovalsScreen](../mobile/src/screens/ApprovalsScreen.tsx)) — *administrator saja* | Antrean pengajuan yang menunggu keputusan: izin/cuti dan tukar shift. Setujui/tolak dengan catatan (wajib saat menolak) | `GET /api/leaves?status=pending`, `PATCH /api/leaves/:id`, `GET /api/swaps?status=pending_admin`, `PATCH /api/swaps/:id` |

| **Peta Tim** ([TeamMapScreen](../mobile/src/screens/TeamMapScreen.tsx)) — *administrator saja* | Posisi karyawan yang sedang hadir di peta + daftar; ambang live 6 menit, polling 15 detik saat layar aktif | `GET /api/locations`, `GET /api/geofence` |
| **Kelola Karyawan** ([ManageUsersScreen](../mobile/src/screens/ManageUsersScreen.tsx)) — *administrator saja* | Cari/filter akun, ubah role & tim jaga teknisi. Hapus akun & ganti sandi orang lain sengaja tetap di web | `GET /api/users`, `PATCH /api/users/:id` |

**Persetujuan** dan **Peta Tim** adalah tab tersendiri di kerangka administrator.
**Kelola Karyawan** dibuka dari daftar menu di Profil — jarang dipakai, jadi tidak
perlu menempati slot tab. Dashboard administrator juga memuat kartu ringkasan
antrean persetujuan (dengan jumlahnya) yang menuju tab yang sama.

Isi Dashboard menyesuaikan role: tombol absen, jadwal pribadi, dan baris aksi
cepat (Jadwal · Tukar Shift · Izin · Lembur) tidak dirender untuk administrator;
roster shift hari ini dan piket tetap tampil karena itu informasi tim. Kartu rekap
absensi pribadi di Profil juga disembunyikan — seluruh angkanya akan nol.

Layar **Persetujuan** juga dituju dari kartu di Dashboard yang hanya dirender bila
`user.role === 'administrator'` (lengkap dengan jumlah antrean), dan dari
notifikasi push yang disentuh. Sengaja **bukan** tab keenam: tab bar memakai
lima slot dengan tombol "Absen" mengambang di tengah, dan jumlah slot ganjil
itulah yang menjaga tombolnya tetap simetris.

---

## 9. Live Tracking — [`src/tracking/locationTask.ts`](../mobile/src/tracking/locationTask.ts)

### 9.1 Cara kerja

- Task `geoattend-live-tracking` didefinisikan via `TaskManager.defineTask`; tiap
  update mengirim `POST /api/locations` dengan lat/lng/akurasi.
- Berjalan sebagai **foreground service** dengan notifikasi persisten
  "Pelacakan posisi aktif selama jam kerja" (wajib Android untuk lokasi background).
- **Siklus hidup:** `startTracking()` dipanggil setelah absen **masuk**;
  `stopTracking()` setelah absen **pulang** atau logout. Task juga berhenti sendiri
  bila server menjawab `409 NOT_CLOCKED_IN` atau `401` (sudah pulang / sesi habis) —
  hemat baterai & privasi.
- `startTracking()` tidak pernah melempar error: bila izin background ditolak atau
  service gagal, absensi tetap tercatat, hanya pelacakan yang tidak aktif. Ada
  penanganan khusus Android 12+ (`waitUntilActive`) untuk mencegah force-close saat
  memulai foreground service tepat setelah kembali dari halaman Pengaturan.

### 9.2 Optimasi baterai & panas

Dua sumber panas diperbaiki (commit `f8259ba`):

**Tracking background** — opsi `startLocationUpdatesAsync` (disetel ulang di v1.6.0):
- `accuracy: Balanced` (~100 m via WiFi/seluler, GPS jarang menyala).
- `timeInterval: 60_000`, **`distanceInterval: 0`** — tanpa filter jarak, sehingga
  fix tetap datang walau karyawan diam total. Nilai lama (`25`) justru membuat HP
  yang diam berhenti melapor sama sekali: server kehilangan jejak dan marker di
  peta admin dianggap kedaluwarsa.
- **`deferredUpdatesInterval: 300_000`** (+ `deferredUpdatesDistance: 200`) — kunci
  hemat baterai: Android membatch posisi lalu mengirim sekaligus tiap ~5 menit,
  membiarkan radio tidur di antaranya. Panas berasal dari radio yang tak pernah
  *sleep*, bukan sekadar frekuensi fix. Efeknya heartbeat posisi ≈ 5 menit.
- **`pausesUpdatesAutomatically: false`** (iOS) — jeda otomatis menghentikan update
  saat pengguna diam, persis kebalikan dari heartbeat yang dibutuhkan.
- **Seluruh batch dikirim** ke `POST /api/locations` sebagai `{ points: [...] }`
  (maks 60/request), bukan hanya titik terakhir. Titik-titik itulah yang menjadi
  jejak perjalanan di fitur Riwayat Lokasi. `LocationObject.mocked` ikut dikirim
  sebagai `isMocked` untuk menandai aplikasi fake GPS (Android).

**GPS foreground** ([CheckInScreen](../mobile/src/screens/CheckInScreen.tsx)) —
`watchPositionAsync` akurasi tinggi hanya aktif saat layar Absen **fokus**
(`useIsFocused`). Tanpa ini, tab bawah menjaga layar tetap mounted sehingga GPS
menyala terus walau pengguna di tab lain. Cadence 10 dtk.

> Kompromi: posisi di peta live admin paling lambat ~5 menit — karena itu ambang
> "live" di web (`LIVE_FRESHNESS_MS`) adalah 6 menit. Bila admin butuh lebih
> real-time, turunkan `deferredUpdatesInterval` ke `120_000` dan `LIVE_FRESHNESS_MS`
> ke 3 menit, dengan konsekuensi ~2,5× lebih banyak wakeup radio.
>
> Bila ada keluhan panas setelah v1.6.0, tombol mundurnya adalah menaikkan
> `timeInterval` ke `120_000` — heartbeat tetap 5 menit karena ditentukan
> `deferredUpdatesInterval`, hanya jejak saat berkendara yang jadi lebih kasar.

---

## 10. Push Notification — [`src/push/`](../mobile/src/push/)

### 10.1 Jalur pengiriman

Server → **Expo Push Service** → FCM → perangkat. Server tidak menyimpan
kredensial Google: service account key FCM V1 tersimpan di **EAS**, dan Expo
yang bicara ke FCM atas nama aplikasi. Yang ada di repo hanya
[`google-services.json`](../mobile/google-services.json) — konfigurasi klien
yang memang ikut dibundel ke dalam APK, bukan rahasia.

### 10.2 Registrasi token — [`registration.ts`](../mobile/src/push/registration.ts)

- `registerPushToken()` dipanggil dari `refresh()` di
  [`session.tsx`](../mobile/src/auth/session.tsx) — jadi tiap app dibuka dan
  tiap sesi disegarkan, **bukan** sekali saat login. Expo bisa mengganti token
  kapan saja (pemulihan backup, clear data, reinstall); endpoint servernya
  upsert sehingga aman dipanggil berulang.
- Izin hanya diminta bila belum pernah diputuskan. Android tidak menampilkan
  dialog kedua kali setelah ditolak, jadi memanggil ulang hanya menghasilkan
  penolakan diam-diam — pengguna yang berubah pikiran mengaturnya dari setelan
  sistem, dan registrasi lolos pada pembukaan berikutnya.
- Channel Android `default` dibuat lebih dulu. Server mengirim
  `channelId: 'default'`; tanpa channel itu Android memakai channel cadangan
  tanpa suara yang tidak bisa diatur pengguna.
- Emulator dilewati (`Device.isDevice`) — tidak ada jalur FCM di sana.
- `unregisterPushToken()` dipanggil saat logout, **sebelum** token sesi dihapus
  (endpoint pencabutan butuh autentikasi). Tanpa ini HP terus menerima
  notifikasi milik pengguna sebelumnya.
- Sama seperti `startTracking()`, tidak ada fungsi di sini yang melempar: HP
  yang menolak izin tetap harus bisa dipakai absen seperti biasa.

### 10.3 Notifikasi disentuh — [`routing.ts`](../mobile/src/push/routing.ts)

- `setNotificationHandler` memaksa notifikasi tetap tampil saat app di
  foreground — kalau tidak, administrator yang kebetulan sedang membuka app
  justru melewatkan pengajuan yang baru masuk.
- `useNotificationRouting()` menangani **dua jalur**: app yang sudah berjalan
  (listener) dan app yang baru dinyalakan oleh sentuhan notifikasi
  (`getLastNotificationResponseAsync`). Jalur kedua yang paling sering terlewat,
  padahal justru itu yang biasa dilakukan pengguna.
- Pemetaan tujuan dari `data.kind` yang dikirim server **bergantung role**,
  karena kedua kerangka punya rute yang berbeda dan menavigasi ke rute yang
  tidak terdaftar tidak melakukan apa-apa:

  | `data.kind` | Penerima | Tujuan |
  | :--- | :--- | :--- |
  | `leave_request` | administrator | tab **Persetujuan** → Izin & Cuti |
  | `shift_swap` | administrator | tab **Persetujuan** → Tukar Shift |
  | `swap_peer` | karyawan | layar **Jadwal** |
  | `swap_result` | karyawan | layar **Jadwal** |
  | `leave_result` | karyawan | layar **Izin** |
  | `shift_reminder` | karyawan | tab **Absen** |

- `swap_peer` / `swap_result` sengaja **tidak** memakai parameter `openSwap`:
  parameter itu membuka form pengajuan baru, sedangkan penerima justru perlu
  melihat permintaan atau hasil yang sudah ada.
- `kind` yang tidak dikenal tidak merusak apa pun: notifikasinya tetap masuk dan
  terbaca, sentuhannya hanya membuka app tanpa berpindah layar. Itu yang membuat
  penambahan pemicu baru di server aman untuk HP yang belum di-update.
- Efeknya keluar lebih dulu bila `role` belum termuat: saat app dinyalakan oleh
  notifikasi, sesi belum siap pada render pertama. Penandaan "sudah ditangani"
  dilakukan **sesudah** pemeriksaan itu supaya notifikasinya tidak hangus.

---

## 11. Tema & Komponen UI

- [`theme.ts`](../mobile/src/theme.ts): token `colors`/`spacing`/`radius` yang
  selaras dengan web (Tailwind slate + blue) — lihat [DESIGN.md](../DESIGN.md).
- [`components/ui.tsx`](../mobile/src/components/ui.tsx): primitives `Button`
  (varian primary/outline/destructive/success/warning, loading), `Field`,
  `PasswordField` (toggle mata), `Card`, `Badge`. Halaman hanya menyusun primitives.

### 10.1 Popup — semuanya bertema, tanpa `Alert` bawaan

`Alert.alert` bawaan sistem **tidak dipakai lagi** (dulu 51 pemanggilan): gayanya
Android mentah dan berbeda jauh dari kartu/sheet di sekitarnya. Penggantinya
[`components/AppAlert.tsx`](../mobile/src/components/AppAlert.tsx):

```tsx
appAlert('Gagal menyimpan', e.message);              // bentuknya meniru Alert.alert
appAlert('Keluar?', 'Pelacakan dihentikan.', [       // tombol
  { text: 'Batal', style: 'cancel' },
  { text: 'Keluar', style: 'destructive', onPress: signOut },
]);
showAppAlert({ title, content: <View>…</View>, buttons });  // isi berstruktur
```

- **Imperatif, bukan hook** — dipanggil dari dalam `.catch()` dan callback
  non-komponen. `AppAlertHost` dipasang sekali di `App.tsx`.
- **Nada** (ikon + warna) ditebak dari judul: berakhiran `✓`/"Tersimpan" → sukses
  hijau, "Gagal…" → merah, ≥2 tombol → konfirmasi biru. Bisa dipaksa lewat
  argumen keempat. Penebakan ini disengaja agar puluhan pemanggilan lama tak
  perlu disunting satu-satu.
- **Tombol ditumpuk penuh lebar**, pilihan aman (`style: 'cancel'`) diletakkan
  **paling bawah** — ketukan refleks dekat ibu jari jatuh ke pilihan tanpa akibat.
- **Antrean**: dua pesan berurutan tidak saling menimpa, termasuk pola
  "konfirmasi → simpan → pesan sukses" yang muncul setelah `await`.
- **Selalu di atas sheet**: modalnya baru tampil saat ada pesan, jadi jendelanya
  ditambahkan paling akhir dan tidak tenggelam di bawah bottom sheet/kamera.

Popup lain: `Sheet` (bottom sheet form), `PhotoViewer` (foto layar penuh, ketuk
untuk tutup), dan modal kamera layar penuh.

### 10.2 Papan ketik & tepi layar

Dua jebakan Android modern yang sudah ditangani — keduanya berakar pada layar
**edge-to-edge**, di mana jendela **tidak lagi menyusut** saat papan ketik muncul
sehingga `adjustResize` tak berefek:

- **Isi bottom sheet** diangkat sendiri setinggi papan ketik via
  [`lib/keyboard.ts`](../mobile/src/lib/keyboard.ts) (`useKeyboardHeight`). Sheet
  mengukur sendiri berapa banyak jendela sudah menyusut dan hanya mengangkat
  sisanya, jadi tidak dobel terangkat di perangkat yang jendelanya memang
  menyusut.
- **Layar biasa** (Absen, Login) memakai `KeyboardAvoidingView behavior="padding"`
  di **kedua** platform. Jangan kembalikan `behavior={undefined}` untuk Android —
  itu artinya "tidak melakukan apa pun" dan formnya kembali tertutup.
- **Tab bar** mengambang di atas isi layar (`position: absolute`) dengan jalur
  tembus pandang tempat tombol Absen naik. Karena itu setiap layar tab menambah
  jarak aman bawah lewat `useTabBarSpace()` — tinggi bar dilaporkan sendiri ke
  navigator, tidak ditebak. Ruang tombol Absen tetap berupa **padding transparan**
  (bukan margin negatif) karena Android memotong anak yang keluar batas induk.

---

## 12. Build & Rilis (EAS)

Server produksi (web) dideploy terpisah — lihat [05 — Deployment](05-deployment.md).
Bagian ini khusus APK.

```bash
cd mobile
# Login sekali (interaktif)
npx eas-cli login

# Build rilis (APK, versionCode auto-naik). --no-wait = tak menunggu di terminal.
EAS_BUILD_NO_EXPO_GO_WARNING=true \
  npx eas-cli build --platform android --profile production --non-interactive --no-wait

# Pantau
npx eas-cli build:list --platform android --limit 3
npx eas-cli build:view <BUILD_ID>
```

- **Versi:** naikkan `version` di `app.json` untuk rilis fitur; `versionCode`
  dinaikkan otomatis oleh EAS (`autoIncrement`).
- **Keystore:** dikelola EAS (remote). APK memakai keystore yang sama, jadi bisa
  menimpa instalasi lama tanpa uninstall.
- **Distribusi:** APK internal — unduh dari halaman build Expo lalu bagikan
  langsung ke karyawan.
- **Tidak ada OTA** (`expo-updates` tidak dipasang): setiap perubahan kode mobile
  **wajib build APK baru**. Deploy server tidak mengubah apa pun di aplikasi.
- **Ukuran arsip unggahan:** `eas build` menyalin seluruh direktori git root dan
  hanya membaca **`.gitignore` root** — `.gitignore` bersarang diabaikan. Karena
  itu `/mobile/android` diulang di `.gitignore` root; tanpa itu folder prebuild
  ±1,5 GB ikut terunggah (dulu arsipnya 395 MB, sekarang 3,4 MB). Periksa dengan
  `npx eas-cli build:inspect --platform android --stage archive --output <dir>`.
  `.easignore` sengaja **tidak** dipakai karena berkas itu *mengganti*
  `.gitignore`, sehingga aturan baru di sana tak lagi dipatuhi EAS.
- **`expo doctor`** dijalankan otomatis di awal build; peringatan versi patch
  tidak menggagalkan build, tapi rapikan berkala dengan `npx expo install --fix`.
- **iOS:** belum disiapkan (butuh akun Apple Developer berbayar + kredensial
  interaktif). Konfigurasi `app.json` sudah siap bila nanti diaktifkan.
- **Estimasi antre:** build Android free tier bisa ~4 jam dari submit sampai selesai.

---

## 13. Batasan yang Diketahui

- **Input tanggal** (izin & tukar shift) masih manual `YYYY-MM-DD`, belum date
  picker native.
- **Ubah email** tetap hanya lewat administrator (nama & kata sandi kini bisa dari
  profil mobile).
- **Pengingat absen terjadwal** belum ada. Push notification sudah jalan (§10),
  tapi baru untuk kejadian yang butuh keputusan administrator — belum ada
  penjadwal yang mengingatkan karyawan absen masuk/pulang.
- **iOS** belum dibangun (lihat §12).
