# 05 — Deployment

## A. Development (Windows/Mac/Linux)

```bash
npm install
docker compose up -d db        # PostgreSQL (Docker Desktop harus jalan)
npm run db:migrate
npm run db:seed                # admin@geoattend.local / Admin12345
npm run dev                    # http://localhost:3000
```

## B. Rekomendasi Proxmox: VM atau LXC?

Keduanya bisa — pilihan tergantung cara install:

| | **LXC + install native** (rekomendasi) | **VM + Docker Compose** |
| :--- | :--- | :--- |
| RAM idle | ± 400–700 MB | ± 1.5–2 GB (OS penuh) |
| Boot/restore | Detik | Menit |
| Backup vzdump | Sangat cepat (filesystem) | Lebih besar/lambat |
| Docker | ⚠️ Perlu nesting, rawan isu saat update kernel Proxmox — **tidak disarankan produksi** | ✅ Native, stabil |
| Kompleksitas setup | Install Node+Postgres manual (sekali) | `docker compose up`, selesai |

**Saran praktis:**
- **LXC (Debian 12, unprivileged)** + install **native** — paling efisien untuk aplikasi sekelas ini; cocok karena Anda sudah terbiasa kelola Proxmox. Jangan jalankan Docker di dalam LXC untuk produksi.
- Kalau ingin memakai `docker-compose.yml` yang sudah ada persis apa adanya → pakai **VM** (Debian/Ubuntu minimal).

**Spek minimal:** 2 vCPU, 2 GB RAM (LXC bisa 1 GB), disk 20 GB (foto tumbuh ± 100–300 KB/absen — pantau `uploads/`).

## C. Produksi di LXC (native, tanpa Docker)

```bash
# 1. LXC Debian 12, unprivileged, nesting off
apt update && apt install -y curl git nginx postgresql-16 # (atau postgresql dari repo pgdg)

# 2. Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs

# 3. Database
sudo -u postgres psql -c "CREATE USER geoattend WITH PASSWORD 'GANTI_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE geoattend OWNER geoattend;"

# 4. Aplikasi
git clone <repo> /opt/geoattend && cd /opt/geoattend
npm ci
cp .env.example .env.local     # isi DATABASE_URL, BETTER_AUTH_SECRET (openssl rand -base64 32), BETTER_AUTH_URL=https://domain-anda
npm run db:migrate && npm run db:seed
npm run build

# 5. Jalankan sebagai service (systemd)
cat > /etc/systemd/system/geoattend.service <<'EOF'
[Unit]
Description=GeoAttend
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/geoattend
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production
EnvironmentFile=-/opt/geoattend/.env.production

[Install]
WantedBy=multi-user.target
EOF
systemctl enable --now geoattend
```

> Catatan: `npm start` membaca `.env.local` via Next.js. Alternatif: salin nilai env ke `/opt/geoattend/.env.production` dan arahkan `EnvironmentFile`.

## D. Produksi dengan Docker (di VM)

```bash
export DB_PASSWORD=<kuat>
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
export APP_URL=https://absensi.serayu.id
docker compose --profile production up -d --build
```

Volume `pgdata` (database) dan `uploads` (foto) persisten — sertakan dalam backup.

## E. HTTPS — WAJIB

Kamera & GPS browser hanya berfungsi di `localhost` atau **HTTPS**. Opsi:

1. **Nginx + certbot** di depan port 3000:

```nginx
server {
  listen 443 ssl http2;
  server_name absensi.serayu.id;
  ssl_certificate     /etc/letsencrypt/live/absensi.../fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/absensi.../privkey.pem;
  client_max_body_size 10m;          # foto base64
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

2. Reverse proxy yang sudah ada (Nginx Proxy Manager/Traefik/Caddy) → arahkan ke IP:3000.

3. **Cloudflare Tunnel** (tanpa buka port): `cloudflared tunnel` → arahkan hostname ke `http://localhost:3000`.

Set `BETTER_AUTH_URL` ke URL HTTPS final — cookie `__Secure-` menuntut HTTPS di produksi.

> **PENTING (reverse proxy / tunnel):** Better Auth menolak login dari origin yang
> tidak dikenal (proteksi CSRF) — gejalanya login selalu "Email atau kata sandi salah".
> Daftarkan **semua** origin yang dipakai di `BETTER_AUTH_TRUSTED_ORIGINS` (dipisah koma):
>
> ```env
> BETTER_AUTH_URL=https://absensi.perusahaan.com
> BETTER_AUTH_TRUSTED_ORIGINS=https://absensi.perusahaan.com,http://localhost:3000
> ```

## F. Environment Variables

| Var | Wajib | Keterangan |
| :--- | :---: | :--- |
| `DATABASE_URL` | ✅ | `postgresql://user:pass@host:5432/geoattend` |
| `BETTER_AUTH_SECRET` | ✅ | `openssl rand -base64 32` — **unik per lingkungan** |
| `BETTER_AUTH_URL` | ✅ | URL publik aplikasi (untuk cookie/CSRF) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | | Origin tambahan yang boleh login (dipisah koma) — wajib bila diakses lebih dari satu origin (tunnel + localhost) |
| `SESSION_EXPIRY_DAYS` | | default 7 |
| `UPLOAD_DIR` | | default `./uploads` |
| `MAX_UPLOAD_SIZE_MB` | | default 5 |
| `NEXT_PUBLIC_DEFAULT_LAT/LNG` | | Pusat peta default |
| `SEED_ADMIN_EMAIL/PASSWORD/NAME` | | Kredensial seed (ganti di produksi!) |

## G. Operasional

- **Health check**: `GET /api/health` → pasang di Uptime Kuma (interval 30–60 detik)
- **Backup harian** (cron): `pg_dump` + rsync/tar folder `uploads/` → simpan keluar host; vzdump LXC/VM mingguan dari Proxmox
- **Pembersih jejak lokasi** (wajib, retensi 90 hari) — tanpa ini tabel `location_trails` tumbuh terus:

  ```bash
  cat > /etc/systemd/system/geoattend-cleanup-trails.service <<'EOF'
  [Unit]
  Description=GeoAttend - pembersih jejak lokasi (retensi 90 hari)
  After=network.target postgresql.service

  [Service]
  Type=oneshot
  WorkingDirectory=/opt/geoattend
  Environment=NODE_ENV=production
  EnvironmentFile=-/opt/geoattend/.env.production
  ExecStart=/usr/bin/npm run db:cleanup-trails
  EOF

  cat > /etc/systemd/system/geoattend-cleanup-trails.timer <<'EOF'
  [Unit]
  Description=Jalankan pembersih jejak lokasi tiap hari 03:15

  [Timer]
  OnCalendar=*-*-* 03:15:00
  Persistent=true

  [Install]
  WantedBy=timers.target
  EOF

  systemctl daemon-reload
  systemctl enable --now geoattend-cleanup-trails.timer
  systemctl list-timers | grep geoattend        # cek jadwal berikutnya
  journalctl -u geoattend-cleanup-trails -n 20  # cek hasil
  ```

  Docker: `15 3 * * * docker compose -f /opt/geoattend/docker-compose.yml exec -T app npm run db:cleanup-trails`.
  Catatan: `tsx` ada di devDependencies — deployment harus memakai `npm ci` (bukan `--omit=dev`), atau ganti `ExecStart` menjadi `npx tsx scripts/cleanup-trails.ts`.
- **Pengingat shift** (opsional) — push "shift mulai 15 menit lagi" ke karyawan
  yang belum absen. Tanpa timer ini fitur pengingat mati total; notifikasi
  lainnya (izin & tukar shift) tidak terpengaruh:

  ```bash
  cat > /etc/systemd/system/geoattend-shift-reminders.service <<'EOF'
  [Unit]
  Description=GeoAttend - pengingat shift 15 menit sebelum jam masuk
  After=network.target postgresql.service

  [Service]
  Type=oneshot
  User=geoattend
  WorkingDirectory=/opt/geoattend
  Environment=NODE_ENV=production
  ExecStart=/usr/bin/npm run push:shift-reminders
  EOF

  cat > /etc/systemd/system/geoattend-shift-reminders.timer <<'EOF'
  [Unit]
  Description=Periksa pengingat shift tiap 5 menit

  [Timer]
  OnCalendar=*:0/5
  # Tanpa Persistent: pengingat yang jendelanya sudah lewat tak berguna
  # dikirim susulan setelah server menyala kembali.
  Persistent=false

  [Install]
  WantedBy=timers.target
  EOF

  systemctl daemon-reload
  systemctl enable --now geoattend-shift-reminders.timer
  journalctl -u geoattend-shift-reminders -n 20   # cek hasil putaran terakhir
  ```

  **Jangan menyetel `TZ` pada unit ini.** Jam WIB dihitung di dalam kode lewat
  `@/lib/time`; `OnCalendar` boleh berjalan menurut UTC karena skripnya sendiri
  yang menentukan shift mana yang mulai sebentar lagi. Menyetel `TZ=Asia/Jakarta`
  justru merusak pembacaan kolom `timestamp` (lihat peringatan di `schema.ts`).

  Uji tanpa mengirim apa pun: `DRY_RUN=1 npm run push:shift-reminders`. Jendela
  15 menit itu sempit, jadi untuk memeriksa hasil penyaringan di luar jam
  tersebut lebarkan lead-nya:
  `DRY_RUN=1 SHIFT_REMINDER_LEAD_MINUTES=600 npm run push:shift-reminders`
  akan menampilkan nama siapa saja yang bakal diingatkan sepanjang sisa hari.
- **Update aplikasi**: `git pull && npm ci && npm run db:migrate && npm run build && systemctl restart geoattend` (atau rebuild image Docker). Migrasi bersifat additive sehingga aman dijalankan sebelum restart

  Yang bisa dilewati agar cepat: `npm ci` **hanya** bila `package.json`/lock
  berubah, dan `db:migrate` **hanya** bila ada berkas migrasi baru. Server lama
  tetap melayani sampai `restart`, jadi build boleh dijalankan saat jam kerja.
  Commit yang hanya menyentuh `mobile/` tidak memengaruhi build web sama sekali.

  > **Jalankan sebagai pengguna service, jangan root.** Bila `npm ci` gagal
  > dengan `EACCES … unlink .../node_modules/.bin/…`, berarti sebagian pohon
  > `node_modules` dimiliki `root` akibat pernah di-install sebagai root.
  > Perbaiki sekali: `chown -R geoattend:geoattend /opt/geoattend`, lalu ulangi
  > `npm ci` sebagai `geoattend`. `git` sebagai root di direktori itu juga
  > memicu peringatan *dubious ownership*.
- **Rollback**: checkout tag sebelumnya + restart; DB tidak perlu di-rollback (migrasi additive)
- **Log**: `journalctl -u geoattend -f` (native) atau `docker logs -f geoattend-app`

## H. Checklist Go-Live

- [ ] `BETTER_AUTH_SECRET` baru (bukan bawaan dev) & `DB_PASSWORD` kuat
- [ ] Ganti password akun seed `admin@geoattend.local`
- [ ] HTTPS aktif, `BETTER_AUTH_URL` = URL final (+ `BETTER_AUTH_TRUSTED_ORIGINS` bila multi-origin)
- [ ] Geofence & jam kerja SOP dikonfigurasi
- [ ] Kode pendaftaran dibuat di Pengaturan → General (atau biarkan kosong untuk menutup pendaftaran mandiri)
- [ ] Uji dari HP: kamera + GPS + absen + live tracking
- [ ] Backup otomatis DB + uploads terjadwal
- [ ] Timer pembersih jejak lokasi aktif (`systemctl list-timers | grep geoattend`)
- [ ] Timer pengingat shift aktif bila fitur dipakai (`geoattend-shift-reminders.timer`)
- [ ] Uptime monitor ke `/api/health`
