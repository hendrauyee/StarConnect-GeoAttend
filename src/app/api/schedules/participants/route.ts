import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { scheduleParticipants, user } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { UpdateScheduleParticipantsSchema, type TechnicianTeam } from '@/types/api';
import { listScheduleParticipants } from '@/lib/schedule/participants';
import { ROLE_ORDER } from '@/lib/schedule/roles';

export const dynamic = 'force-dynamic';

/**
 * GET /api/schedules/participants — kandidat + peserta jadwal saat ini
 * (administrator saja).
 *
 * `candidates` = seluruh karyawan (selain administrator) sehingga admin bebas
 * memasukkan siapa pun, dikelompokkan menurut role masing-masing.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
    const popId = scope.popId;

    const [candidates, current] = await Promise.all([
      db
        .select({
          id: user.id,
          name: user.name,
          role: user.role,
          image: user.image,
          technicianTeam: user.technicianTeam,
        })
        .from(user)
        .where(and(eq(user.popId, popId), ne(user.role, 'administrator')))
        .orderBy(
          sql`CASE ${user.role} WHEN 'admin' THEN ${ROLE_ORDER.admin} WHEN 'noc' THEN ${ROLE_ORDER.noc} WHEN 'teknisi' THEN ${ROLE_ORDER.teknisi} ELSE 99 END`,
          asc(user.name)
        ),
      listScheduleParticipants(popId),
    ]);

    return NextResponse.json({
      candidates: candidates.map((c) => ({
        ...c,
        technicianTeam: (c.technicianTeam as TechnicianTeam | null) ?? null,
      })),
      participantIds: current.users.map((u) => u.id),
      configured: current.configured,
    });
  } catch (error) {
    console.error('GET /api/schedules/participants error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/schedules/participants — tetapkan daftar peserta jadwal
 * (administrator saja). Semantik replace: daftar lama diganti seluruhnya.
 *
 * Karyawan yang dikeluarkan tidak lagi muncul di grid, tetapi entri jadwal
 * yang sudah tersimpan sengaja TIDAK dihapus — riwayat jadwal tetap utuh.
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
    const parsed = UpdateScheduleParticipantsSchema.safeParse(body);
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

    const requested = Array.from(new Set(parsed.data.userIds));

    // Hanya id yang benar-benar ada, MILIK POP INI, & bukan administrator yang disimpan
    const valid =
      requested.length > 0
        ? await db
            .select({ id: user.id })
            .from(user)
            .where(and(inArray(user.id, requested), eq(user.popId, popId)))
        : [];
    const validIds = valid.map((v) => v.id);

    // Peserta yang dihapus HANYA milik POP ini — bukan seluruh tabel
    // (sebelumnya bug: delete global akan menghapus peserta jadwal semua POP).
    const currentParticipantsOfPop = await db
      .select({ userId: scheduleParticipants.userId })
      .from(scheduleParticipants)
      .innerJoin(user, eq(user.id, scheduleParticipants.userId))
      .where(eq(user.popId, popId));
    const currentIdsOfPop = currentParticipantsOfPop.map((r) => r.userId);

    await db.transaction(async (tx) => {
      if (currentIdsOfPop.length > 0) {
        await tx.delete(scheduleParticipants).where(inArray(scheduleParticipants.userId, currentIdsOfPop));
      }
      if (validIds.length > 0) {
        await tx
          .insert(scheduleParticipants)
          .values(validIds.map((id) => ({ userId: id })));
      }
    });

    return NextResponse.json({ data: { saved: validIds.length } });
  } catch (error) {
    console.error('PUT /api/schedules/participants error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
