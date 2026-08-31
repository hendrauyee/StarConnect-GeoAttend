import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { attendanceRecords, geofences, locationTrails, user } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  isSuperAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/auth/utils';
import { toAttendanceResponse } from '@/lib/attendance/serialize';
import { buildWorkSessions } from '@/lib/attendance/sessions';
import { detectStops } from '@/lib/geo/stops';
import { haversineDistance } from '@/lib/geo/distance';
import {
  OPEN_SESSION_WINDOW_HOURS,
  TRAIL_MAX_POINTS,
  TRAIL_MIN_DISTANCE_M,
  TRAIL_RENDER_MAX_POINTS,
} from '@/lib/constants';
import type { TrailPointResponse } from '@/types/api';

export const dynamic = 'force-dynamic';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { code, message, timestamp: new Date().toISOString() },
    { status }
  );
}

/**
 * Turunkan kerapatan titik agar peta tetap responsif. Titik pertama & terakhir
 * selalu dipertahankan supaya rute tidak terlihat terpotong di ujungnya.
 */
function thinPoints(points: TrailPointResponse[], max: number): TrailPointResponse[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const thinned = points.filter((_, index) => index % step === 0);
  const last = points[points.length - 1];
  if (thinned[thinned.length - 1] !== last) thinned.push(last);
  return thinned;
}

/**
 * GET /api/locations/trail — riwayat jejak lokasi satu SESI kerja.
 * Query: ?userId=<id|self>&date=yyyy-MM-dd[&clockInAt=<ISO>]
 *
 * Administrator saja: jejak perjalanan adalah data pribadi karyawan.
 *
 * `clockInAt` menentukan sesi secara tepat bila seorang karyawan punya lebih
 * dari satu sesi pada tanggal yang sama (Shift 1 dan Shift 2), sekaligus
 * membuat pemilihan sesi tidak bergantung pada zona waktu server.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const params = req.nextUrl.searchParams;
    const rawUserId = params.get('userId');
    const userId = rawUserId === 'self' ? session.user.id : rawUserId;
    const date = params.get('date');
    const clockInAt = params.get('clockInAt');

    if (!userId || !date || !DATE_REGEX.test(date)) {
      return errorResponse(
        'VALIDATION_ERROR',
        'Parameter userId dan date (yyyy-MM-dd) wajib diisi',
        400
      );
    }

    if (!isSuperAdmin(session)) {
      const [target] = await db.select({ popId: user.popId }).from(user).where(eq(user.id, userId)).limit(1);
      if (!target || target.popId !== session.user.popId) {
        return errorResponse('NOT_FOUND', 'Pengguna tidak ditemukan', 404);
      }
    }

    // Sesi bisa melintasi tengah malam di kedua arah, jadi ambil absensi
    // ±22 jam di sekitar tanggal — bukan sekadar 00:00–23:59. Kelonggaran ini
    // sekaligus menyerap selisih zona waktu antara peramban dan server.
    const windowMs = OPEN_SESSION_WINDOW_HOURS * 60 * 60 * 1000;
    const dayStart = new Date(`${date}T00:00:00`);
    if (Number.isNaN(dayStart.getTime())) {
      return errorResponse('VALIDATION_ERROR', 'Tanggal tidak valid', 400);
    }
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        record: attendanceRecords,
        userName: user.name,
        userImage: user.image,
        geofenceName: geofences.name,
      })
      .from(attendanceRecords)
      .leftJoin(user, eq(attendanceRecords.userId, user.id))
      .leftJoin(geofences, eq(attendanceRecords.geofenceId, geofences.id))
      .where(
        and(
          eq(attendanceRecords.userId, userId),
          gte(attendanceRecords.timestamp, new Date(dayStart.getTime() - windowMs)),
          lte(attendanceRecords.timestamp, new Date(dayEnd.getTime() + windowMs))
        )
      )
      .orderBy(asc(attendanceRecords.timestamp));

    const sessions = buildWorkSessions(rows.map(toAttendanceResponse));
    const target =
      (clockInAt ? sessions.find((s) => s.clockIn?.timestamp === clockInAt) : undefined) ??
      sessions.find((s) => s.date === date);

    if (!target) {
      return errorResponse(
        'SESSION_NOT_FOUND',
        'Tidak ada sesi kerja pada tanggal tersebut',
        404
      );
    }

    // Rentang jejak = sesi kerja. Bila karyawan belum absen pulang, batasi
    // sampai sekarang (atau akhir jendela sesi, mana yang lebih dulu).
    const from = target.clockIn ? new Date(target.clockIn.timestamp) : dayStart;
    const to = target.clockOut
      ? new Date(target.clockOut.timestamp)
      : new Date(Math.min(Date.now(), from.getTime() + windowMs));

    const trailRows = await db
      .select({
        latitude: locationTrails.latitude,
        longitude: locationTrails.longitude,
        accuracyMeters: locationTrails.accuracyMeters,
        isMocked: locationTrails.isMocked,
        recordedAt: locationTrails.recordedAt,
      })
      .from(locationTrails)
      .where(
        and(
          eq(locationTrails.userId, userId),
          gte(locationTrails.recordedAt, from),
          lte(locationTrails.recordedAt, to)
        )
      )
      .orderBy(asc(locationTrails.recordedAt))
      .limit(TRAIL_MAX_POINTS);

    const points: TrailPointResponse[] = trailRows.map((row) => ({
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracyMeters: row.accuracyMeters ? Number(row.accuracyMeters) : null,
      isMocked: row.isMocked,
      recordedAt: row.recordedAt.toISOString(),
    }));

    // Segmen di bawah ambang jitter tidak dijumlahkan: titik heartbeat saat
    // karyawan DIAM bisa bergeser puluhan meter tanpa orangnya berpindah, dan
    // tanpa saringan ini jarak tempuh jadi jauh lebih besar dari kenyataan.
    let totalDistanceMeters = 0;
    for (let i = 1; i < points.length; i++) {
      const segment = haversineDistance(
        points[i - 1].latitude,
        points[i - 1].longitude,
        points[i].latitude,
        points[i].longitude
      );
      if (segment >= TRAIL_MIN_DISTANCE_M) totalDistanceMeters += segment;
    }

    // Deteksi berhenti dijalankan pada data PENUH, penipisan baru sesudahnya.
    const stops = detectStops(points);
    const rendered = thinPoints(points, TRAIL_RENDER_MAX_POINTS);

    return NextResponse.json({
      data: {
        userId,
        userName: rows[0]?.userName ?? 'Pengguna terhapus',
        date: target.date,
        shiftNumber: target.shiftNumber,
        sessionStart: target.clockIn?.timestamp ?? null,
        sessionEnd: target.clockOut?.timestamp ?? null,
        clockIn: target.clockIn,
        clockOut: target.clockOut,
        points: rendered,
        stops,
        totalDistanceMeters: Math.round(totalDistanceMeters),
        truncated: trailRows.length >= TRAIL_MAX_POINTS,
        thinned: rendered.length < points.length,
      },
    });
  } catch (error) {
    console.error('GET /api/locations/trail error:', error);
    return errorResponse('INTERNAL_ERROR', 'Terjadi kesalahan sistem', 500);
  }
}
