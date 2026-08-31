/**
 * Identitas aplikasi berdasarkan domain (satu app, dua wajah):
 * - `geoattend` → absensi.serayu.id (dan tunnel dev)
 * - `stok`      → stok.serayu.id
 *
 * Modul ini MURNI (tanpa next/headers) agar aman dipakai di client & middleware.
 * Untuk resolusi di Server Component, pakai `getServerBrand()` dari `brand.server`.
 */
export type Brand = 'geoattend' | 'stok';

const STOCK_HOSTS = (process.env.NEXT_PUBLIC_STOCK_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Tentukan brand dari hostname (mis. "stok.serayu.id"). */
export function resolveBrand(host: string | null | undefined): Brand {
  const h = (host ?? '').toLowerCase().split(':')[0];
  if (!h) return 'geoattend';
  if (h.startsWith('stok.') || h.startsWith('stock.')) return 'stok';
  if (STOCK_HOSTS.includes(h)) return 'stok';
  return 'geoattend';
}

export interface BrandConfig {
  brand: Brand;
  /** Nama yang tampil di sidebar/login/header. */
  name: string;
  /** Halaman awal setelah login untuk pengguna biasa. */
  home: string;
  loginTitle: string;
  loginSubtitle: string;
}

const STOCK_NAME = process.env.NEXT_PUBLIC_STOCK_APP_NAME ?? 'StarConnect · Stok';

/** Konfigurasi tampilan per brand. `geoattendName` = appName dari pengaturan. */
export function brandConfig(brand: Brand, geoattendName = 'GeoAttend'): BrandConfig {
  if (brand === 'stok') {
    return {
      brand,
      name: STOCK_NAME,
      home: '/stock',
      loginTitle: 'Kelola Stok Gudang',
      loginSubtitle: 'Masuk untuk mengelola inventaris & barang keluar-masuk',
    };
  }
  return {
    brand,
    name: geoattendName,
    home: '/checkin',
    loginTitle: 'Selamat datang kembali',
    loginSubtitle: 'Masuk untuk mulai absensi hari ini',
  };
}
