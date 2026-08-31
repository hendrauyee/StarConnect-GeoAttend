/**
 * Seed database: membuat super_admin + POP pertama + admin POP + geofence
 * default. Idempotent — aman dijalankan ulang (juga dipakai untuk backfill
 * pop_id pada instalasi lama yang sudah punya data sebelum multi-tenant).
 * Jalankan: npm run db:seed
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'superadmin@geoattend.local';
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'SuperAdmin12345';
const SUPER_ADMIN_NAME = process.env.SEED_SUPER_ADMIN_NAME ?? 'Super Admin';

const DEFAULT_POP_CODE = process.env.SEED_DEFAULT_POP_CODE ?? 'DEFAULT';
const DEFAULT_POP_NAME = process.env.SEED_DEFAULT_POP_NAME ?? 'POP Default';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@geoattend.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin12345';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Administrator';

async function main() {
  // Import dinamis setelah env dimuat
  const { auth } = await import('../src/lib/auth');
  const { db } = await import('../src/lib/db');
  const { user, geofences, shiftSettings, pops } = await import('../src/lib/db/schema');
  const { DEFAULT_SHIFTS } = await import('../src/lib/constants');
  const { eq, isNull } = await import('drizzle-orm');

  // Buat user + credential account langsung lewat internal adapter Better
  // Auth (bukan auth.api.signUpEmail) — sama seperti POST /api/users, supaya
  // TIDAK butuh kode pendaftaran (seed = pembuatan internal, bukan self-signup).
  const ctx = await auth.$context;
  async function createUserDirect(name: string, email: string, password: string) {
    const createdUser = await ctx.internalAdapter.createUser({ name, email, emailVerified: false });
    const hashedPassword = await ctx.password.hash(password);
    await ctx.internalAdapter.linkAccount({
      userId: createdUser.id,
      providerId: 'credential',
      accountId: createdUser.id,
      password: hashedPassword,
    });
    return createdUser;
  }

  // 0. Buat super_admin bila belum ada (tidak terikat POP manapun)
  const existingSuperAdmin = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, SUPER_ADMIN_EMAIL))
    .limit(1);

  if (existingSuperAdmin.length === 0) {
    await createUserDirect(SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await db
      .update(user)
      .set({ role: 'super_admin' })
      .where(eq(user.email, SUPER_ADMIN_EMAIL));
    console.log(`✔ Super Admin dibuat: ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`);
  } else {
    await db
      .update(user)
      .set({ role: 'super_admin' })
      .where(eq(user.email, SUPER_ADMIN_EMAIL));
    console.log(`• Super Admin sudah ada: ${SUPER_ADMIN_EMAIL}`);
  }

  // 1. Pastikan POP Default ada (juga jadi tujuan backfill data lama pra-multi-tenant)
  const existingPop = await db
    .select({ id: pops.id })
    .from(pops)
    .where(eq(pops.code, DEFAULT_POP_CODE))
    .limit(1);

  const defaultPopId =
    existingPop[0]?.id ??
    (
      await db
        .insert(pops)
        .values({ name: DEFAULT_POP_NAME, code: DEFAULT_POP_CODE })
        .returning({ id: pops.id })
    )[0].id;

  if (existingPop.length === 0) {
    console.log(`✔ ${DEFAULT_POP_NAME} dibuat`);
  } else {
    console.log(`• ${DEFAULT_POP_NAME} sudah ada`);
  }

  // 2. Buat admin POP Default bila belum ada
  const existingAdmin = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, ADMIN_EMAIL))
    .limit(1);

  if (existingAdmin.length === 0) {
    await createUserDirect(ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD);
    await db
      .update(user)
      .set({ role: 'administrator', popId: defaultPopId })
      .where(eq(user.email, ADMIN_EMAIL));
    console.log(`✔ Administrator dibuat: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } else {
    // Pastikan akun seed selalu ber-role administrator & terikat POP Default
    await db
      .update(user)
      .set({ role: 'administrator', popId: defaultPopId })
      .where(eq(user.email, ADMIN_EMAIL));
    console.log(`• Administrator sudah ada: ${ADMIN_EMAIL}`);
  }

  // 2b. Backfill: pengguna lama lainnya (karyawan/teknisi pra-multi-tenant)
  // yang belum punya popId & bukan super_admin → masuk POP Default.
  const backfilledUsers = await db
    .update(user)
    .set({ popId: defaultPopId })
    .where(isNull(user.popId))
    .returning({ id: user.id, role: user.role });
  const nonSuperAdminBackfilled = backfilledUsers.filter((u) => u.role !== 'super_admin');
  if (nonSuperAdminBackfilled.length > 0) {
    console.log(`✔ ${nonSuperAdminBackfilled.length} akun lama di-backfill ke ${DEFAULT_POP_NAME}`);
  }
  // super_admin tidak boleh punya popId — kembalikan ke null bila ikut ter-update di atas
  await db
    .update(user)
    .set({ popId: null })
    .where(eq(user.role, 'super_admin'));

  // 3. Buat geofence default bila belum ada; backfill popId geofence lama
  const existingGeofence = await db.select({ id: geofences.id }).from(geofences).limit(1);

  if (existingGeofence.length === 0) {
    await db.insert(geofences).values({
      popId: defaultPopId,
      name: 'Kantor Pusat',
      latitude: process.env.NEXT_PUBLIC_DEFAULT_LAT ?? '-6.2087634',
      longitude: process.env.NEXT_PUBLIC_DEFAULT_LNG ?? '106.8455990',
      radiusMeters: process.env.DEFAULT_GEOFENCE_RADIUS_M ?? '100',
      isActive: true,
    });
    console.log('✔ Geofence default dibuat (radius 100m)');
  } else {
    await db.update(geofences).set({ popId: defaultPopId }).where(isNull(geofences.popId));
    console.log('• Geofence sudah ada (popId di-backfill bila kosong)');
  }

  // 4. Buat jam kerja SOP default bila belum ada; backfill popId shift lama
  const existingShifts = await db.select({ id: shiftSettings.id }).from(shiftSettings).limit(1);

  if (existingShifts.length === 0) {
    await db.insert(shiftSettings).values(
      DEFAULT_SHIFTS.map((shift) => ({
        popId: defaultPopId,
        role: shift.role,
        shiftNumber: shift.shiftNumber,
        startTime: shift.startTime,
        endTime: shift.endTime,
      }))
    );
    console.log('✔ Jam kerja SOP default dibuat (admin/noc 2 shift, teknisi 1 shift)');
  } else {
    await db.update(shiftSettings).set({ popId: defaultPopId }).where(isNull(shiftSettings.popId));
    console.log('• Jam kerja SOP sudah ada (popId di-backfill bila kosong)');
  }

  console.log('Seed selesai.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed gagal:', err);
  process.exit(1);
});
