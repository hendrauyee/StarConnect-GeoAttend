import { NextRequest, NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  account,
  appSettings,
  attendanceRecords,
  geofences,
  leaveRequests,
  pops,
  shiftSettings,
  user,
} from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  isSuperAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/auth/utils';
import { APP_VERSION } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/backup?popId=<uuid> — ekspor data aplikasi sebagai JSON.
 * - administrator: SELALU dibatasi ke POP miliknya sendiri (popId di query
 *   diabaikan) — mencegah kebocoran data POP lain lewat backup, termasuk
 *   password hash di tabel accounts.
 * - super_admin TANPA ?popId=: backup GLOBAL seluruh POP (mis. sebelum
 *   maintenance sistem). DENGAN ?popId=: backup satu POP saja.
 *
 * Catatan: file foto (uploads/) TIDAK termasuk — backup folder tersebut terpisah.
 * Session & verifikasi sengaja tidak diekspor (ephemeral). Jejak lokasi
 * (location_trails) juga sengaja tidak diekspor: data operasional berumur 90
 * hari, bukan data absensi resmi — membesarkan file backup tanpa manfaat
 * pemulihan.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const popId = isSuperAdmin(session)
      ? req.nextUrl.searchParams.get('popId')
      : session.user.popId;

    const [popRows, users] = await Promise.all([
      popId ? db.select().from(pops).where(eq(pops.id, popId)) : db.select().from(pops),
      popId ? db.select().from(user).where(eq(user.popId, popId)) : db.select().from(user),
    ]);
    const userIds = users.map((u) => u.id);

    const [accounts, geofenceRows, shiftRows, recordRows, settingRows, leaveRows] =
      await Promise.all([
        userIds.length > 0
          ? db.select().from(account).where(inArray(account.userId, userIds))
          : popId
            ? []
            : db.select().from(account),
        popId ? db.select().from(geofences).where(eq(geofences.popId, popId)) : db.select().from(geofences),
        popId
          ? db.select().from(shiftSettings).where(eq(shiftSettings.popId, popId))
          : db.select().from(shiftSettings),
        userIds.length > 0
          ? db.select().from(attendanceRecords).where(inArray(attendanceRecords.userId, userIds))
          : popId
            ? []
            : db.select().from(attendanceRecords),
        // Pengaturan aplikasi (nama/logo/kode pendaftaran) bersifat GLOBAL, bukan
        // milik satu POP — hanya ikut backup global (super_admin, tanpa popId).
        popId ? Promise.resolve([]) : db.select().from(appSettings),
        userIds.length > 0
          ? db.select().from(leaveRequests).where(inArray(leaveRequests.userId, userIds))
          : popId
            ? []
            : db.select().from(leaveRequests),
      ]);

    const backup = {
      version: 1 as const,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        pops: popRows,
        users,
        accounts,
        geofences: geofenceRows,
        shiftSettings: shiftRows,
        attendanceRecords: recordRows,
        appSettings: settingRows,
        leaveRequests: leaveRows,
      },
    };

    const filename = `geoattend-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/backup error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
