import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { attendanceRecords, geofences, user } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  isSuperAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/auth/utils';
import { ReviewOvertimeSchema } from '@/types/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/attendance/[id] — detail satu record absensi.
 * Karyawan hanya boleh mengakses record miliknya sendiri.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const rows = await db
      .select({
        record: attendanceRecords,
        userName: user.name,
        userImage: user.image,
        userPopId: user.popId,
        geofenceName: geofences.name,
      })
      .from(attendanceRecords)
      .leftJoin(user, eq(attendanceRecords.userId, user.id))
      .leftJoin(geofences, eq(attendanceRecords.geofenceId, geofences.id))
      .where(eq(attendanceRecords.id, params.id))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Record tidak ditemukan', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }

    const isOwnRecord = row.record.userId === session.user.id;
    const isSamePopAdmin = isAdmin(session) && row.userPopId === session.user.popId;
    if (!isOwnRecord && !isSamePopAdmin && !isSuperAdmin(session)) {
      return forbiddenResponse();
    }

    return NextResponse.json({
      id: row.record.id,
      userId: row.record.userId,
      userName: row.userName ?? 'Pengguna terhapus',
      userAvatar: row.userImage,
      type: row.record.type,
      kind: row.record.kind ?? 'shift',
      overtimeStatus: row.record.overtimeStatus,
      reviewNote: row.record.reviewNote,
      timestamp: row.record.timestamp.toISOString(),
      latitude: Number(row.record.latitude),
      longitude: Number(row.record.longitude),
      accuracyMeters: row.record.accuracyMeters ? Number(row.record.accuracyMeters) : null,
      photoUrl: row.record.photoUrl,
      isWithinGeofence: row.record.isWithinGeofence,
      distanceFromCenter: row.record.distanceFromCenter
        ? Number(row.record.distanceFromCenter)
        : 0,
      geofenceName: row.geofenceName,
      notes: row.record.notes,
    });
  } catch (error) {
    console.error('GET /api/attendance/[id] error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/attendance/[id] — verifikasi SESI LEMBUR (administrator saja).
 * `id` harus record PEMBUKA sesi lembur (clock_in, kind='lembur'), karena di
 * situlah status verifikasi satu sesi disimpan. Hanya sesi 'approved' yang
 * dihitung sebagai jam lembur di rekap.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const body = await req.json();
    const parsed = ReviewOvertimeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'Data tidak valid',
          details: parsed.error.flatten(),
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const rows = await db
      .select({
        id: attendanceRecords.id,
        type: attendanceRecords.type,
        kind: attendanceRecords.kind,
        userPopId: user.popId,
      })
      .from(attendanceRecords)
      .leftJoin(user, eq(attendanceRecords.userId, user.id))
      .where(eq(attendanceRecords.id, params.id))
      .limit(1);

    const record = rows[0];
    if (!record) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Record tidak ditemukan', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }
    if (!isSuperAdmin(session) && record.userPopId !== session.user.popId) {
      return forbiddenResponse();
    }
    if (record.kind !== 'lembur' || record.type !== 'clock_in') {
      return NextResponse.json(
        {
          code: 'NOT_OVERTIME_SESSION',
          message: 'Record ini bukan awal sesi lembur',
          timestamp: new Date().toISOString(),
        },
        { status: 422 }
      );
    }

    const updated = await db
      .update(attendanceRecords)
      .set({
        overtimeStatus: parsed.data.action === 'approve' ? 'approved' : 'rejected',
        reviewedBy: session.user.id,
        reviewNote: parsed.data.reviewNote?.trim() || null,
      })
      .where(eq(attendanceRecords.id, params.id))
      .returning({
        id: attendanceRecords.id,
        overtimeStatus: attendanceRecords.overtimeStatus,
      });

    return NextResponse.json({ data: updated[0] });
  } catch (error) {
    console.error('PATCH /api/attendance/[id] error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
