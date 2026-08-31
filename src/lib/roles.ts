/**
 * Helper peran (murni — aman di client & server).
 *
 * Peran:
 * - `administrator` : pengelola sistem (akses penuh).
 * - `admin`,`noc`,`teknisi` : peran kerja (punya shift/absensi).
 * - `employee` : belum ditetapkan.
 * - `gudang` : Admin Gudang — web stok saja (lihat [[isWarehouseOnly]]).
 */
export const WAREHOUSE_ROLE = 'gudang';

/** Boleh kelola master stok (inventory): administrator sistem, super_admin, & admin gudang. */
export function isStockManager(role?: string | null): boolean {
  return role === 'administrator' || role === 'super_admin' || role === WAREHOUSE_ROLE;
}

/**
 * Akun web-only stok: hanya boleh login lewat stok.serayu.id —
 * tidak boleh masuk ke absensi (web) maupun aplikasi mobile.
 */
export function isWarehouseOnly(role?: string | null): boolean {
  return role === WAREHOUSE_ROLE;
}

/** Boleh mengajukan izin Remote (kerja jarak jauh): admin staf & NOC saja. */
export function canRequestRemote(role?: string | null): boolean {
  return role === 'admin' || role === 'noc';
}
