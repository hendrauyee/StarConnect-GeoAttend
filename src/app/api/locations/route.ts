import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { attendanceRecords, liveLocations, locationTrails, user } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { UpdateLocationSchema } from '@/types/api';
import { haversineDistance } from '@/lib/geo/distance';
import {
  OPEN_SESSION_WINDOW_HOURS,
  TRAIL_MAX_ACCURACY_M,
  TRAIL_MIN_DISTANCE_M,
  TRAIL_MIN_INTERVAL_MS,
} from '@/lib/constants';

export const dynamic = 'force-dynamic';

/** Toleransi jam perangkat yang berjalan lebih cepat dari server (ms). */
const CLOCK_SKEW_TOLERANCE_MS = 120_000;

/**
 * POST /api/locations — karyawan mengirim posisi miliknya.
 *
 * Menerima dua bentuk payload (lihat UpdateLocationSchema): satu titik
 * (app lama) atau batch `points` (app ≥ 1.6.0). Titik yang lolos saringan
 * anti-jitter disimpan sebagai jejak (location_trails), dan titik terakhir
 * selalu memperbarui posisi live.
 *
 * Hanya diterima bila pengguna sedang dalam sesi kerja terbuka.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const body = await req.json();
    const parsed = UpdateLocationSchema.safeParse(body);
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

    // Hanya lacak pengguna yang sedang hadir. Memakai JENDELA BERGULIR, bukan
    // "sejak tengah malam": sesi kerja bisa menembus tengah malam (Shift 2
    // masuk 22:00 pulang 02:00), dan dengan startOfDay pelacakannya mati tepat
    // pukul 00:00 karena clock-in-nya terhitung "kemarin".
    const sessionWindowStart = new Date(
      Date.now() - OPEN_SESSION_WINDOW_HOURS * 60 * 60 * 1000
    );
    const lastRecords = await db
      .select({ type: attendanceRecords.type, timestamp: attendanceRecords.timestamp })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.userId, session.user.id),
          gte(attendanceRecords.timestamp, sessionWindowStart)
        )
      )
      .orderBy(desc(attendanceRecords.timestamp))
      .limit(1);

    const openSession = lastRecords[0];
    if (openSession?.type !== 'clock_in') {
      return NextResponse.json(
        {
          code: 'NOT_CLOCKED_IN',
          message: 'Pelacakan hanya aktif saat Anda berstatus hadir',
          timestamp: new Date().toISOString(),
        },
        { status: 409 }
      );
    }

    const input = parsed.data;
    const now = Date.now();

    // Payload lama dibungkus jadi batch satu titik dengan waktu terima server.
    const incoming = input.points ?? [
      {
        latitude: input.latitude!,
        longitude: input.longitude!,
        accuracyMeters: input.accuracyMeters,
        isMocked: undefined,
        recordedAt: new Date().toISOString(),
      },
    ];

    const points = incoming
      .map((p) => ({ ...p, at: new Date(p.recordedAt) }))
      .filter(
        (p) =>
          !Number.isNaN(p.at.getTime()) &&
          // Jam perangkat bisa salah atau dimanipulasi: tolak titik dari masa
          // depan dan titik yang mendahului absen masuk sesi ini.
          p.at.getTime() <= now + CLOCK_SKEW_TOLERANCE_MS &&
          p.at.getTime() >= openSession.timestamp.getTime() &&
          (p.accuracyMeters == null || p.accuracyMeters <= TRAIL_MAX_ACCURACY_M)
      )
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    if (points.length === 0) {
      return NextResponse.json({ success: true, received: 0, stored: 0 });
    }

    // Titik acuan diambil dari database, bukan hanya dari batch ini, agar
    // saringan anti-jitter tetap bekerja lintas pengiriman.
    const [lastTrail] = await db
      .select({
        latitude: locationTrails.latitude,
        longitude: locationTrails.longitude,
        recordedAt: locationTrails.recordedAt,
      })
      .from(locationTrails)
      .where(
        and(
          eq(locationTrails.userId, session.user.id),
          gte(locationTrails.recordedAt, openSession.timestamp)
        )
      )
      .orderBy(desc(locationTrails.recordedAt))
      .limit(1);

    let previous = lastTrail
      ? {
          latitude: Number(lastTrail.latitude),
          longitude: Number(lastTrail.longitude),
          time: lastTrail.recordedAt.getTime(),
        }
      : null;

    const toInsert: (typeof locationTrails.$inferInsert)[] = [];
    for (const p of points) {
      if (previous) {
        const moved = haversineDistance(
          previous.latitude,
          previous.longitude,
          p.latitude,
          p.longitude
        );
        // Perpindahan lebih kecil dari setengah radius akurasi tidak bisa
        // dibedakan dari derau GPS. Titik tetap disimpan bila sudah lewat
        // TRAIL_MIN_INTERVAL_MS — itulah heartbeat "masih di sini" yang
        // kemudian membentuk titik berhenti pada peta riwayat.
        const noiseFloor = Math.max(TRAIL_MIN_DISTANCE_M, (p.accuracyMeters ?? 0) / 2);
        const elapsed = p.at.getTime() - previous.time;
        if (moved < noiseFloor && elapsed < TRAIL_MIN_INTERVAL_MS) continue;
      }

      toInsert.push({
        userId: session.user.id,
        recordedAt: p.at,
        latitude: String(p.latitude),
        longitude: String(p.longitude),
        accuracyMeters: p.accuracyMeters != null ? String(p.accuracyMeters) : null,
        isMocked: p.isMocked ?? false,
      });
      previous = { latitude: p.latitude, longitude: p.longitude, time: p.at.getTime() };
    }

    let stored = 0;
    if (toInsert.length > 0) {
      const inserted = await db
        .insert(locationTrails)
        .values(toInsert)
        // Idempoten: batch yang dikirim ulang setelah timeout jaringan tidak
        // menghasilkan titik ganda.
        .onConflictDoNothing({
          target: [locationTrails.userId, locationTrails.recordedAt],
        })
        // returning() hanya mengembalikan baris yang BENAR-BENAR masuk, jadi
        // angka `stored` tetap jujur saat batch dikirim ulang.
        .returning({ id: locationTrails.id });
      stored = inserted.length;
    }

    // Posisi live SELALU diperbarui dari titik terakhir batch, walau semua
    // titik tersaring (karyawan diam): updatedAt harus maju agar marker di
    // live map tetap berstatus "live", bukan "terakhir diketahui".
    const latest = points[points.length - 1];
    const liveValues = {
      latitude: String(latest.latitude),
      longitude: String(latest.longitude),
      accuracyMeters: latest.accuracyMeters != null ? String(latest.accuracyMeters) : null,
      updatedAt: new Date(),
    };
    await db
      .insert(liveLocations)
      .values({ userId: session.user.id, ...liveValues })
      .onConflictDoUpdate({ target: liveLocations.userId, set: liveValues });

    return NextResponse.json({ success: true, received: points.length, stored });
  } catch (error) {
    console.error('POST /api/locations error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * GET /api/locations — posisi live seluruh karyawan (administrator saja).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const rows = await db
      .select({
        userId: liveLocations.userId,
        latitude: liveLocations.latitude,
        longitude: liveLocations.longitude,
        accuracyMeters: liveLocations.accuracyMeters,
        updatedAt: liveLocations.updatedAt,
        userName: user.name,
        role: user.role,
        userImage: user.image,
      })
      .from(liveLocations)
      .innerJoin(user, eq(liveLocations.userId, user.id))
      .where(eq(user.popId, scope.popId));

    return NextResponse.json({
      data: rows.map((row) => ({
        userId: row.userId,
        userName: row.userName ?? 'Pengguna terhapus',
        userAvatar: row.userImage,
        role: row.role ?? 'employee',
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accuracyMeters: row.accuracyMeters ? Number(row.accuracyMeters) : null,
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('GET /api/locations error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
