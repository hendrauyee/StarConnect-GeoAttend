import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { piketAssignments, user } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { UpsertPiketSchema, MarkPiketDoneSchema, type PiketAssignment } from '@/types/api';
import { monthDates } from '@/lib/schedule/rotation';
import { appMonth } from '@/lib/time';
import { listScheduleParticipants } from '@/lib/schedule/participants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/piket?month=YYYY-MM — jadwal piket sebulan (semua user login boleh baca).
 * Daftar `users` (kandidat piket) hanya disertakan untuk administrator.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
    const popId = scope.popId;

    const month = req.nextUrl.searchParams.get('month') ?? appMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Format bulan harus yyyy-MM', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    const dates = monthDates(month);
    const start = dates[0];
    const end = dates[dates.length - 1];

    const rows = await db
      .select({
        date: piketAssignments.date,
        userId: piketAssignments.userId,
        userName: user.name,
        userImage: user.image,
        done: piketAssignments.done,
      })
      .from(piketAssignments)
      .leftJoin(user, eq(piketAssignments.userId, user.id))
      .where(
        and(
          eq(piketAssignments.popId, popId),
          gte(piketAssignments.date, start),
          lte(piketAssignments.date, end)
        )
      );

    const assignments: PiketAssignment[] = rows.map((r) => ({
      date: r.date,
      userId: r.userId,
      userName: r.userName ?? 'Pengguna terhapus',
      userImage: r.userImage ?? null,
      done: r.done,
    }));

    // Kandidat piket = peserta jadwal shift (dikelola administrator)
    const users = isAdmin(session) ? (await listScheduleParticipants(popId)).users : [];

    return NextResponse.json({ users, assignments });
  } catch (error) {
    console.error('GET /api/piket error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/piket — simpan jadwal piket sebulan (administrator).
 * Upsert per tanggal; bila petugas berubah, penanda `done` di-reset.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
    const popId = scope.popId;

    const body = await req.json();
    const parsed = UpsertPiketSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Data tidak valid', details: parsed.error.flatten(), timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    const { month, assignments } = parsed.data;
    const dates = monthDates(month);
    const validDates = new Set(dates);

    const schedulableIds = new Set(
      (await listScheduleParticipants(popId)).users.map((u) => u.id)
    );

    // Dedupe per tanggal; abaikan tanggal luar bulan / user non-jadwal
    const dedup = new Map<string, string>();
    for (const a of assignments) {
      if (!validDates.has(a.date) || !schedulableIds.has(a.userId)) continue;
      dedup.set(a.date, a.userId);
    }

    const existing = await db
      .select({ date: piketAssignments.date, userId: piketAssignments.userId })
      .from(piketAssignments)
      .where(
        and(
          eq(piketAssignments.popId, popId),
          gte(piketAssignments.date, dates[0]),
          lte(piketAssignments.date, dates[dates.length - 1])
        )
      );
    const existingMap = new Map(existing.map((e) => [e.date, e.userId]));

    await db.transaction(async (tx) => {
      // Hapus tanggal yang tak lagi ada di payload (POP ini saja)
      const removed = existing.filter((e) => !dedup.has(e.date)).map((e) => e.date);
      if (removed.length > 0) {
        await tx
          .delete(piketAssignments)
          .where(and(eq(piketAssignments.popId, popId), inArray(piketAssignments.date, removed)));
      }
      // Upsert
      for (const [date, userId] of Array.from(dedup.entries())) {
        if (existingMap.get(date) === userId) continue; // tak berubah
        await tx
          .insert(piketAssignments)
          .values({ popId, date, userId, done: false })
          .onConflictDoUpdate({
            target: [piketAssignments.popId, piketAssignments.date],
            set: { userId, done: false, doneAt: null, updatedAt: new Date() },
          });
      }
    });

    return NextResponse.json({ data: { month, saved: dedup.size } });
  } catch (error) {
    console.error('PUT /api/piket error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/piket — tandai piket sudah/belum dilakukan.
 * Hanya petugas hari itu atau administrator.
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!session.user.popId) return forbiddenResponse();

    const body = await req.json();
    const parsed = MarkPiketDoneSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Data tidak valid', details: parsed.error.flatten(), timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    const { date, done } = parsed.data;
    const [assignment] = await db
      .select({ userId: piketAssignments.userId })
      .from(piketAssignments)
      .where(and(eq(piketAssignments.popId, session.user.popId), eq(piketAssignments.date, date)))
      .limit(1);
    if (!assignment) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Belum ada jadwal piket tanggal itu', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }
    if (assignment.userId !== session.user.id && !isAdmin(session)) return forbiddenResponse();

    await db
      .update(piketAssignments)
      .set({ done, doneAt: done ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(piketAssignments.popId, session.user.popId), eq(piketAssignments.date, date)));

    return NextResponse.json({ data: { date, done } });
  } catch (error) {
    console.error('PATCH /api/piket error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
