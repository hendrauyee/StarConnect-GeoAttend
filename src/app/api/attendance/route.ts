import { NextRequest, NextResponse } from 'next/server';
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { attendanceRecords, geofences, liveLocations, shiftSettings, user } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  unauthorizedResponse,
} from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { CreateAttendanceSchema, type AttendanceKind } from '@/types/api';
import { checkGeofence } from '@/lib/geo/validation';
import { pickShift } from '@/lib/shifts/calc';
import { OPEN_SESSION_WINDOW_HOURS } from '@/lib/constants';
import { saveAttendancePhoto, StorageError } from '@/lib/storage/local-fs';
import { toAttendanceResponse as toResponse } from '@/lib/attendance/serialize';

export const dynamic = 'force-dynamic';

/**
 * GET /api/attendance
 * Query: ?page=1&limit=20&userId=<id|self>&from=ISO&to=ISO&today=true
 * Karyawan hanya bisa melihat record miliknya sendiri.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const params = req.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get('page') ?? 1));
    const limit = Math.min(1000, Math.max(1, Number(params.get('limit') ?? 20)));

    let userId = params.get('userId');
    if (userId === 'self') userId = session.user.id;

    // Karyawan non-admin dipaksa hanya melihat record sendiri
    if (!isAdmin(session)) {
      userId = session.user.id;
    }

    const conditions = [];
    if (userId) conditions.push(eq(attendanceRecords.userId, userId));

    // Admin/super_admin melihat daftar (bukan satu userId spesifik): batasi ke
    // POP yang sedang aktif — karyawan sendiri (userId sudah pasti) tidak perlu
    // scoping tambahan karena sudah otomatis 1 POP lewat identitasnya sendiri.
    if (isAdmin(session) && !userId) {
      const scope = resolvePopScope(session, req);
      if ('error' in scope) return scope.error;
      if (scope.popId) conditions.push(eq(user.popId, scope.popId));
    }

    if (params.get('today') === 'true') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      conditions.push(gte(attendanceRecords.timestamp, startOfDay));
    } else {
      const from = params.get('from');
      const to = params.get('to');
      if (from) conditions.push(gte(attendanceRecords.timestamp, new Date(from)));
      if (to) conditions.push(lte(attendanceRecords.timestamp, new Date(to)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          record: attendanceRecords,
          userName: user.name,
          userImage: user.image,
          geofenceName: geofences.name,
        })
        .from(attendanceRecords)
        .leftJoin(user, eq(attendanceRecords.userId, user.id))
        .leftJoin(geofences, eq(attendanceRecords.geofenceId, geofences.id))
        .where(where)
        .orderBy(desc(attendanceRecords.timestamp))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ total: count() })
        .from(attendanceRecords)
        .leftJoin(user, eq(attendanceRecords.userId, user.id))
        .where(where),
    ]);

    const total = totalResult[0]?.total ?? 0;

    return NextResponse.json({
      data: rows.map(toResponse),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('GET /api/attendance error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * POST /api/attendance
 * Membuat record absensi baru dengan validasi geofence + foto.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const body = await req.json();
    const parsed = CreateAttendanceSchema.safeParse(body);
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

    const input = parsed.data;

    // Cek duplikasi: tidak boleh clock_in dua kali tanpa clock_out (dan sebaliknya).
    // Sesi kerja bisa menembus tengah malam (mis. Shift 2 masuk 15:00, pulang
    // 02:00 keesokan hari), jadi "record terakhir" dicari dalam JENDELA BERGULIR,
    // bukan "sejak tengah malam". Tanpa ini, absen pulang dini hari ditolak
    // (INVALID_SEQUENCE) dan lemburnya hilang.
    const sessionWindowStart = new Date(Date.now() - OPEN_SESSION_WINDOW_HOURS * 60 * 60 * 1000);
    const recentRecords = await db
      .select({
        type: attendanceRecords.type,
        kind: attendanceRecords.kind,
        shiftNumber: attendanceRecords.shiftNumber,
      })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.userId, session.user.id),
          gte(attendanceRecords.timestamp, sessionWindowStart)
        )
      )
      .orderBy(desc(attendanceRecords.timestamp))
      .limit(1);

    const lastRecord = recentRecords[0];
    const lastType = lastRecord?.type;
    if (input.type === 'clock_in' && lastType === 'clock_in') {
      return NextResponse.json(
        {
          code: 'DUPLICATE_CHECKIN',
          message: 'Anda sudah absen masuk dan belum absen pulang',
          timestamp: new Date().toISOString(),
        },
        { status: 409 }
      );
    }
    if (input.type === 'clock_out' && (lastType === undefined || lastType === 'clock_out')) {
      return NextResponse.json(
        {
          code: 'INVALID_SEQUENCE',
          message: 'Anda harus absen masuk terlebih dahulu',
          timestamp: new Date().toISOString(),
        },
        { status: 409 }
      );
    }

    // Jenis sesi ditentukan SERVER, bukan klien: absen pulang selalu mewarisi
    // jenis sesi yang sedang terbuka. Jadi sesi lembur pasti ditutup sebagai
    // lembur walau klien (mis. versi app lama) mengirim 'shift'.
    const openKind =
      lastType === 'clock_in' ? ((lastRecord.kind ?? 'shift') as AttendanceKind) : null;
    const kind: AttendanceKind = input.type === 'clock_out' ? openKind ?? input.kind : input.kind;
    const isOvertime = kind === 'lembur';

    // Lembur urgent = di luar jam shift & sering di lokasi pelanggan. Alasan
    // (gangguan/tiket) WAJIB karena lembur berujung ke perhitungan upah.
    if (isOvertime && input.type === 'clock_in' && !input.notes?.trim()) {
      return NextResponse.json(
        {
          code: 'OVERTIME_REASON_REQUIRED',
          message: 'Wajib isi alasan/gangguan yang ditangani untuk memulai lembur urgent',
          timestamp: new Date().toISOString(),
        },
        { status: 422 }
      );
    }

    // Tentukan shift yang dicatat:
    // - shiftNumber dari klien harus valid untuk role user
    // - clock_out tanpa shiftNumber mewarisi shift dari clock_in hari ini
    // - fallback: shift dengan jam masuk terdekat dari waktu sekarang
    // Sesi LEMBUR tidak punya shift sama sekali — memang di luar jadwal.
    const roleShifts = isOvertime
      ? []
      : await db
          .select({
            role: shiftSettings.role,
            shiftNumber: shiftSettings.shiftNumber,
            startTime: shiftSettings.startTime,
            endTime: shiftSettings.endTime,
          })
          .from(shiftSettings)
          .where(
            and(
              eq(shiftSettings.role, session.user.role ?? ''),
              eq(shiftSettings.popId, session.user.popId ?? '')
            )
          );

    let shiftNumber: number | null = null;
    if (roleShifts.length > 0) {
      if (input.shiftNumber != null) {
        if (!roleShifts.some((s) => s.shiftNumber === input.shiftNumber)) {
          return NextResponse.json(
            {
              code: 'INVALID_SHIFT',
              message: 'Shift yang dipilih tidak tersedia untuk role Anda',
              timestamp: new Date().toISOString(),
            },
            { status: 422 }
          );
        }
        shiftNumber = input.shiftNumber;
      } else if (input.type === 'clock_out' && lastRecord?.shiftNumber != null) {
        shiftNumber = lastRecord.shiftNumber;
      } else {
        shiftNumber = pickShift(new Date(), roleShifts)?.shiftNumber ?? null;
      }
    }

    // Validasi geofence — SELALU milik POP karyawan sendiri, bukan geofence
    // POP lain manapun (sebelumnya bug: `.limit(1)` global tanpa scoping).
    const activeGeofences = await db
      .select()
      .from(geofences)
      .where(and(eq(geofences.isActive, true), eq(geofences.popId, session.user.popId ?? '')))
      .limit(1);

    const geofence = activeGeofences[0]
      ? {
          id: activeGeofences[0].id,
          name: activeGeofences[0].name,
          latitude: Number(activeGeofences[0].latitude),
          longitude: Number(activeGeofences[0].longitude),
          radiusMeters: Number(activeGeofences[0].radiusMeters),
          isActive: activeGeofences[0].isActive,
        }
      : null;

    const check = checkGeofence(
      input.latitude,
      input.longitude,
      geofence,
      input.accuracyMeters ?? 0
    );

    // Absen MASUK & PULANG sama-sama boleh di luar area. Bila absen MASUK di luar
    // area (mis. teknisi langsung ke lapangan tanpa ke kantor), WAJIB isi alasan
    // (notes). Lokasi tetap dicatat (isWithinGeofence + jarak) untuk pelaporan.
    // Sesi LEMBUR dikecualikan: di luar area itu wajar (lokasi pelanggan/ODP),
    // dan alasannya sudah diwajibkan lebih dulu di atas.
    if (!isOvertime && input.type === 'clock_in' && geofence && !check.isInside && !input.notes?.trim()) {
      return NextResponse.json(
        {
          code: 'GEOFENCE_REASON_REQUIRED',
          message: `Anda di luar area absensi (jarak: ${Math.round(check.distanceMeters)}m). Wajib isi alasan absen masuk di luar kantor.`,
          details: { distance: `${Math.round(check.distanceMeters)}m` },
          timestamp: new Date().toISOString(),
        },
        { status: 422 }
      );
    }

    // Simpan foto
    const photoUrl = await saveAttendancePhoto(input.photoBase64);

    const inserted = await db
      .insert(attendanceRecords)
      .values({
        userId: session.user.id,
        type: input.type,
        kind,
        // Status verifikasi menempel di record PEMBUKA — mewakili satu sesi utuh
        overtimeStatus: isOvertime && input.type === 'clock_in' ? 'pending' : null,
        shiftNumber,
        latitude: String(input.latitude),
        longitude: String(input.longitude),
        accuracyMeters: input.accuracyMeters != null ? String(input.accuracyMeters) : null,
        photoUrl,
        geofenceId: check.geofenceId,
        isWithinGeofence: check.isInside,
        distanceFromCenter: String(check.distanceMeters),
        notes: input.notes ?? null,
        metadata: {
          userAgent: req.headers.get('user-agent') ?? undefined,
        },
      })
      .returning();

    // Sinkronkan posisi live: mulai lacak saat clock-in, hapus saat clock-out
    if (input.type === 'clock_in') {
      await db
        .insert(liveLocations)
        .values({
          userId: session.user.id,
          latitude: String(input.latitude),
          longitude: String(input.longitude),
          accuracyMeters: input.accuracyMeters != null ? String(input.accuracyMeters) : null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: liveLocations.userId,
          set: {
            latitude: String(input.latitude),
            longitude: String(input.longitude),
            accuracyMeters: input.accuracyMeters != null ? String(input.accuracyMeters) : null,
            updatedAt: new Date(),
          },
        });
    } else {
      await db.delete(liveLocations).where(eq(liveLocations.userId, session.user.id));
    }

    const record = inserted[0];
    return NextResponse.json(
      toResponse({
        record,
        userName: session.user.name,
        userImage: session.user.image ?? null,
        geofenceName: check.geofenceName,
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof StorageError) {
      return NextResponse.json(
        { code: `PHOTO_${error.code}`, message: error.message, timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }
    console.error('POST /api/attendance error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
