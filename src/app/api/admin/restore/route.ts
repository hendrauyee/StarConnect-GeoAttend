import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  account,
  appSettings,
  attendanceRecords,
  geofences,
  leaveRequests,
  liveLocations,
  pops,
  session as sessionTable,
  shiftSettings,
  user,
  verification,
} from '@/lib/db/schema';
import {
  getApiSession,
  isSuperAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/auth/utils';
import { RestoreBackupSchema } from '@/types/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Row = Record<string, unknown>;

const str = (row: Row, key: string) => String(row[key] ?? '');
const strOrNull = (row: Row, key: string) => (row[key] == null ? null : String(row[key]));
const bool = (row: Row, key: string) => Boolean(row[key]);
const num = (row: Row, key: string) => Number(row[key] ?? 0);
const date = (row: Row, key: string) => new Date(String(row[key] ?? new Date().toISOString()));
const dateOrNull = (row: Row, key: string) => (row[key] == null ? null : new Date(String(row[key])));

/** Insert bertahap agar payload besar tidak melebihi batas parameter Postgres. */
async function insertChunks<T>(
  insertFn: (rows: T[]) => Promise<unknown>,
  rows: T[],
  chunkSize = 200
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await insertFn(rows.slice(i, i + chunkSize));
  }
}

/**
 * POST /api/admin/restore — pulihkan seluruh data dari file backup JSON.
 * PERINGATAN: menghapus SEMUA data di SEMUA POP saat ini (termasuk session —
 * semua pengguna harus login ulang). Foto tidak ikut dipulihkan (file terpisah).
 *
 * super_admin SAJA — bukan administrator POP: operasi ini menghapus+menulis
 * ulang seluruh tabel lintas-POP dalam satu transaksi, jadi tidak bisa
 * dibatasi ke satu POP tanpa turut menghapus data POP lain.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isSuperAdmin(session)) return forbiddenResponse();

    const body = await req.json();
    const parsed = RestoreBackupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'File backup tidak valid atau versinya tidak didukung',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const { data } = parsed.data;

    // Pastikan backup memuat minimal satu administrator/super_admin (anti-lockout)
    const hasAdministrator = data.users.some((row) =>
      ['administrator', 'super_admin'].includes(String(row.role))
    );
    if (!hasAdministrator) {
      return NextResponse.json(
        {
          code: 'NO_ADMINISTRATOR',
          message: 'Backup tidak memuat akun administrator — restore dibatalkan',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const popRows = (data.pops ?? []).map((row) => ({
      id: str(row, 'id'),
      name: str(row, 'name'),
      code: str(row, 'code'),
      isActive: bool(row, 'isActive'),
      createdAt: date(row, 'createdAt'),
      updatedAt: date(row, 'updatedAt'),
    }));

    const users = data.users.map((row) => ({
      id: str(row, 'id'),
      name: str(row, 'name'),
      email: str(row, 'email'),
      emailVerified: bool(row, 'emailVerified'),
      image: strOrNull(row, 'image'),
      coverImage: strOrNull(row, 'coverImage'),
      role: str(row, 'role') || 'employee',
      popId: strOrNull(row, 'popId'),
      createdAt: date(row, 'createdAt'),
      updatedAt: date(row, 'updatedAt'),
    }));

    const accounts = data.accounts.map((row) => ({
      id: str(row, 'id'),
      userId: str(row, 'userId'),
      accountId: str(row, 'accountId'),
      providerId: str(row, 'providerId'),
      accessToken: strOrNull(row, 'accessToken'),
      refreshToken: strOrNull(row, 'refreshToken'),
      idToken: strOrNull(row, 'idToken'),
      accessTokenExpiresAt: dateOrNull(row, 'accessTokenExpiresAt'),
      refreshTokenExpiresAt: dateOrNull(row, 'refreshTokenExpiresAt'),
      scope: strOrNull(row, 'scope'),
      password: strOrNull(row, 'password'),
      createdAt: date(row, 'createdAt'),
      updatedAt: date(row, 'updatedAt'),
    }));

    const geofenceRows = data.geofences.map((row) => ({
      id: str(row, 'id'),
      popId: str(row, 'popId'),
      name: str(row, 'name'),
      latitude: str(row, 'latitude'),
      longitude: str(row, 'longitude'),
      radiusMeters: str(row, 'radiusMeters'),
      isActive: bool(row, 'isActive'),
      createdAt: date(row, 'createdAt'),
      updatedAt: date(row, 'updatedAt'),
    }));

    const shiftRows = data.shiftSettings.map((row) => ({
      id: str(row, 'id'),
      popId: str(row, 'popId'),
      role: str(row, 'role'),
      shiftNumber: num(row, 'shiftNumber'),
      startTime: str(row, 'startTime'),
      endTime: str(row, 'endTime'),
      createdAt: date(row, 'createdAt'),
      updatedAt: date(row, 'updatedAt'),
    }));

    const recordRows = data.attendanceRecords.map((row) => ({
      id: str(row, 'id'),
      userId: str(row, 'userId'),
      type: str(row, 'type'),
      shiftNumber: row.shiftNumber == null ? null : num(row, 'shiftNumber'),
      timestamp: date(row, 'timestamp'),
      latitude: str(row, 'latitude'),
      longitude: str(row, 'longitude'),
      accuracyMeters: strOrNull(row, 'accuracyMeters'),
      photoUrl: str(row, 'photoUrl'),
      geofenceId: strOrNull(row, 'geofenceId'),
      isWithinGeofence: bool(row, 'isWithinGeofence'),
      distanceFromCenter: strOrNull(row, 'distanceFromCenter'),
      notes: strOrNull(row, 'notes'),
      metadata: row.metadata ?? null,
      createdAt: date(row, 'createdAt'),
    }));

    const settingRows = (data.appSettings ?? []).map((row) => ({
      key: str(row, 'key'),
      value: str(row, 'value'),
      updatedAt: date(row, 'updatedAt'),
    }));

    const leaveRows = (data.leaveRequests ?? []).map((row) => ({
      id: str(row, 'id'),
      userId: str(row, 'userId'),
      type: str(row, 'type'),
      startDate: str(row, 'startDate'),
      endDate: str(row, 'endDate'),
      reason: strOrNull(row, 'reason'),
      status: str(row, 'status') || 'pending',
      reviewedBy: strOrNull(row, 'reviewedBy'),
      reviewedAt: dateOrNull(row, 'reviewedAt'),
      reviewNote: strOrNull(row, 'reviewNote'),
      createdAt: date(row, 'createdAt'),
      updatedAt: date(row, 'updatedAt'),
    }));

    await db.transaction(async (tx) => {
      // Hapus semua data (urutan menghormati foreign key)
      await tx.delete(liveLocations);
      await tx.delete(leaveRequests);
      await tx.delete(attendanceRecords);
      await tx.delete(sessionTable);
      await tx.delete(verification);
      await tx.delete(account);
      await tx.delete(user);
      await tx.delete(geofences);
      await tx.delete(shiftSettings);
      await tx.delete(appSettings);
      await tx.delete(pops);

      // Pulihkan dari backup (pops dulu — geofences/shiftSettings/users mereferensikannya)
      if (popRows.length > 0) await insertChunks((rows) => tx.insert(pops).values(rows), popRows);
      if (users.length > 0) await insertChunks((rows) => tx.insert(user).values(rows), users);
      if (accounts.length > 0)
        await insertChunks((rows) => tx.insert(account).values(rows), accounts);
      if (geofenceRows.length > 0)
        await insertChunks((rows) => tx.insert(geofences).values(rows), geofenceRows);
      if (shiftRows.length > 0)
        await insertChunks((rows) => tx.insert(shiftSettings).values(rows), shiftRows);
      if (recordRows.length > 0)
        await insertChunks((rows) => tx.insert(attendanceRecords).values(rows), recordRows);
      if (settingRows.length > 0)
        await insertChunks((rows) => tx.insert(appSettings).values(rows), settingRows);
      if (leaveRows.length > 0)
        await insertChunks((rows) => tx.insert(leaveRequests).values(rows), leaveRows);
    });

    return NextResponse.json({
      success: true,
      restored: {
        users: users.length,
        attendanceRecords: recordRows.length,
        geofences: geofenceRows.length,
        shiftSettings: shiftRows.length,
      },
      message: 'Restore berhasil. Semua pengguna harus login ulang.',
    });
  } catch (error) {
    console.error('POST /api/admin/restore error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Restore gagal — data lama tetap utuh (transaksi dibatalkan)', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
