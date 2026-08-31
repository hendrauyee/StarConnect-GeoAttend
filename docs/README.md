# Dokumentasi GeoAttend

Dokumentasi lengkap aplikasi absensi GeoAttend (StarConnect).

| Dokumen | Isi | Untuk Siapa |
| :--- | :--- | :--- |
| [01 — Gambaran Umum](01-overview.md) | Visi, fitur, arsitektur, tech stack, struktur proyek | Semua |
| [02 — Referensi API](02-api.md) | Seluruh endpoint, request/response, kode error | Developer (web & mobile) |
| [03 — Database](03-database.md) | Skema tabel, relasi, alur migrasi | Developer |
| [04 — Aturan Bisnis](04-business-rules.md) | Role & izin, aturan absensi, telat/lembur, live tracking | Semua |
| [05 — Deployment](05-deployment.md) | Setup dev, produksi, Proxmox VM vs LXC, HTTPS, backup | DevOps/Admin sistem |
| [06 — Panduan Pengguna](06-user-guide.md) | Cara pakai untuk karyawan & administrator | Pengguna akhir |
| [07 — Integrasi Mobile](07-mobile-integration.md) | Kontrak API & rencana awal integrasi mobile | Developer mobile |
| [08 — Aplikasi Mobile](08-mobile-app.md) | Dokumentasi teknis aplikasi mobile Android yang sudah dibangun | Developer mobile |

## Panduan siap cetak (PDF)

| Dokumen | Isi | Untuk Siapa |
| :--- | :--- | :--- |
| **[Panduan Lengkap GeoAttend v1.8](panduan-lengkap.html)** ⭐ | 24 bab: karyawan (pemasangan, absen, **lembur urgent**, **layar utama aplikasi**, jadwal, piket, tim jaga malam, izin) **dan** administrator (setup, peta live, kelola jadwal, rekap + **ekspor Excel**, riwayat lokasi, **stok gudang**, pemeliharaan) | Karyawan & Administrator |
| [Panduan Mobile](Panduan-Mobile-GeoAttend.pdf) | Panduan aplikasi mobile versi lama (v1.4) — digantikan panduan lengkap | Karyawan |
| [Panduan Update](Panduan-Update-GeoAttend.pdf) | Instruksi pembaruan aplikasi ke v1.5 | Karyawan |

> **PDF perlu dicetak ulang.** Sumber isinya `panduan-lengkap.html` sudah v1.8,
> tetapi `Panduan-Lengkap-GeoAttend.pdf` di repo masih hasil cetakan v1.6 —
> PDF di sini dibuat manual, bukan lewat skrip. Cara mencetak ulang: buka
> [panduan-lengkap.html](panduan-lengkap.html) di browser → Ctrl+P → ukuran
> **A4**, margin **default**, aktifkan *Background graphics* → Simpan sebagai
> PDF, timpa berkas lama.

**Mulai cepat (development):** lihat [README utama](../README.md).
