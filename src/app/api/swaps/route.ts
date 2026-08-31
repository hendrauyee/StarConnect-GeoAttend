import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db';
import { leaveRequests, scheduleEntries, shiftSwapRequests, user } from '@/lib/db/schema';
import { getApiSession, isAdmin, unauthorizedResponse, badRequestResponse } from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { CreateSwapSchema, type SwapKind, type SwapRequestResponse, type SwapStatus } from '@/types/api';
import { appToday } from '@/lib/time';
import { notifyPeerSwapRequested } from '@/lib/push/events';

export const dynamic = 'force-dynamic';

const requester = alias(user, 'requester');
const target = alias(user, 'target');
const reviewer = alias(user, 'swap_reviewer');

const ACTIVE_STATUSES = ['pending_peer', 'pending_admin'];

type SwapRow = {
  swap: typeof shiftSwapRequests.$inferSelect;
  requesterName: string | null;
  targetName: string | null;
  reviewerName: string | null;
};

function toResponse(row: SwapRow): SwapRequestResponse {
  const { swap } = row;
  return {
    id: swap.id,
    kind: (swap.kind as SwapKind) ?? 'shift',
    requesterId: swap.requesterId,
    requesterName: row.requesterName ?? 'Pengguna terhapus',
    targetId: swap.targetId,
    targetName: row.targetName ?? 'Pengguna terhapus',
    date: swap.date,
    targetDate: swap.targetDate,
    requesterShift: swap.requesterShift,
    targetShift: swap.targetShift,
    status: swap.status as SwapStatus,
    reason: swap.reason,
    reviewedByName: row.reviewerName,
    reviewNote: swap.reviewNote,
    createdAt: swap.createdAt.toISOString(),
  };
}

/**
 * GET /api/swaps?status=<status>
 * - Administrator: semua (opsional filter status).
 * - Karyawan: hanya yang melibatkan dirinya (sebagai pengaju atau rekan tujuan).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const status = req.nextUrl.searchParams.get('status');
    const conditions = [];
    if (!isAdmin(session)) {
      conditions.push(
        or(
          eq(shiftSwapRequests.requesterId, session.user.id),
          eq(shiftSwapRequests.targetId, session.user.id)
        )
      );
    } else {
      const scope = resolvePopScope(session, req);
      if ('error' in scope) return scope.error;
      if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
      conditions.push(eq(requester.popId, scope.popId));
    }
    if (status) conditions.push(eq(shiftSwapRequests.status, status));

    const rows = await db
      .select({
        swap: shiftSwapRequests,
        requesterName: requester.name,
        targetName: target.name,
        reviewerName: reviewer.name,
      })
      .from(shiftSwapRequests)
      .leftJoin(requester, eq(shiftSwapRequests.requesterId, requester.id))
      .leftJoin(target, eq(shiftSwapRequests.targetId, target.id))
      .leftJoin(reviewer, eq(shiftSwapRequests.reviewedBy, reviewer.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(shiftSwapRequests.createdAt))
      .limit(500);

    return NextResponse.json({ data: rows.map(toResponse) });
  } catch (error) {
    console.error('GET /api/swaps error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * POST /api/swaps — ajukan tukar dengan rekan satu role, untuk tanggal ke depan.
 *
 * - kind='shift': satu tanggal, kedua orang terjadwal shift BERBEDA (S1 ↔ S2).
 * - kind='libur': dua tanggal, saling menukar hari libur. Yang melepas libur
 *   mengambil alih shift rekannya di tanggal itu, jadi jumlah orang di S1 dan S2
 *   tiap hari tetap sama persis — cuma bertukar orang. Berlaku untuk semua role:
 *   teknisi (yang memang tidak pernah bisa tukar shift) maupun admin & NOC.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const body = await req.json();
    const parsed = CreateSwapSchema.safeParse(body);
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

    const { date, targetDate, targetUserId, reason } = parsed.data;
    const kind: SwapKind = parsed.data.kind ?? 'shift';
    const selfId = session.user.id;
    const today = appToday();

    const fail = (code: string, message: string, statusCode = 422) =>
      NextResponse.json({ code, message, timestamp: new Date().toISOString() }, { status: statusCode });

    if (targetUserId === selfId) return fail('INVALID_SWAP', 'Tidak bisa menukar dengan diri sendiri');
    if (date <= today) return fail('INVALID_SWAP_DATE', 'Tukar hanya untuk tanggal ke depan');

    // Rekan tujuan harus ada, satu role, DAN satu POP (mencegah tukar shift
    // lintas-POP walau kebetulan role-nya sama)
    const [targetUser] = await db
      .select({ id: user.id, name: user.name, role: user.role })
      .from(user)
      .where(and(eq(user.id, targetUserId), eq(user.popId, session.user.popId ?? '')))
      .limit(1);
    if (!targetUser) return fail('NOT_FOUND', 'Rekan tidak ditemukan', 404);
    if (targetUser.role !== session.user.role) {
      return fail('INVALID_SWAP', 'Rekan harus dari role yang sama');
    }

    // Tanggal yang tersentuh pengajuan ini (libur menyentuh dua tanggal)
    const dates = kind === 'libur' ? [date, targetDate!] : [date];

    if (kind === 'libur') {
      if (targetDate! <= today) {
        return fail('INVALID_SWAP_DATE', 'Tukar hanya untuk tanggal ke depan');
      }
      if (targetDate === date) {
        return fail('INVALID_SWAP', 'Tanggal libur kamu dan rekan tidak boleh sama');
      }
    }

    // Jadwal kedua orang pada semua tanggal yang tersentuh
    const sched = await db
      .select({
        userId: scheduleEntries.userId,
        date: scheduleEntries.date,
        shift: scheduleEntries.shift,
      })
      .from(scheduleEntries)
      .where(
        and(
          inArray(scheduleEntries.date, dates),
          inArray(scheduleEntries.userId, [selfId, targetUserId])
        )
      );
    const shiftAt = (userId: string, d: string) =>
      sched.find((s) => s.userId === userId && s.date === d)?.shift ?? null;

    let requesterShift: string;
    let targetShift: string;

    if (kind === 'libur') {
      // Tanggal A = libur pengaju: pengaju libur, rekan masuk
      if (shiftAt(selfId, date) !== 'libur') {
        return fail('NOT_LIBUR', 'Kamu tidak terjadwal libur pada tanggal itu');
      }
      const peerShiftOnA = shiftAt(targetUserId, date);
      if (peerShiftOnA !== '1' && peerShiftOnA !== '2') {
        return fail('NO_SHIFT', 'Rekan tidak terjadwal masuk pada tanggal libur kamu');
      }
      // Tanggal B = libur rekan: rekan libur, pengaju masuk
      if (shiftAt(targetUserId, targetDate!) !== 'libur') {
        return fail('NOT_LIBUR', 'Rekan tidak terjadwal libur pada tanggal itu');
      }
      const myShiftOnB = shiftAt(selfId, targetDate!);
      if (myShiftOnB !== '1' && myShiftOnB !== '2') {
        return fail('NO_SHIFT', 'Kamu tidak terjadwal masuk pada tanggal libur rekan');
      }
      // Yang melepas libur MENGAMBIL ALIH shift rekannya di tanggal itu, sehingga
      // komposisi S1/S2 tiap hari tidak berubah — cuma orangnya yang bertukar.
      requesterShift = peerShiftOnA;
      targetShift = myShiftOnB;
    } else {
      const myShift = shiftAt(selfId, date);
      const tgtShift = shiftAt(targetUserId, date);
      if (myShift !== '1' && myShift !== '2') {
        return fail('NO_SHIFT', 'Kamu tidak terjadwal shift pada tanggal itu');
      }
      if (tgtShift !== '1' && tgtShift !== '2') {
        return fail('NO_SHIFT', 'Rekan tidak terjadwal shift pada tanggal itu');
      }
      if (myShift === tgtShift) {
        return fail('SAME_SHIFT', 'Rekan harus punya shift yang berbeda');
      }
      requesterShift = myShift;
      targetShift = tgtShift;
    }

    // Izin/cuti yang sudah disetujui pada tanggal terkait bikin hasil tukar mustahil dijalani
    const sortedDates = [...dates].sort();
    const leaves = await db
      .select({
        userId: leaveRequests.userId,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.status, 'approved'),
          inArray(leaveRequests.userId, [selfId, targetUserId]),
          lte(leaveRequests.startDate, sortedDates[sortedDates.length - 1]),
          gte(leaveRequests.endDate, sortedDates[0])
        )
      );
    const clash = leaves.find((l) => dates.some((d) => d >= l.startDate && d <= l.endDate));
    if (clash) {
      return fail(
        'LEAVE_EXISTS',
        clash.userId === selfId
          ? 'Kamu punya izin/cuti disetujui pada tanggal itu'
          : 'Rekan punya izin/cuti disetujui pada tanggal itu',
        409
      );
    }

    // Tidak boleh ada pengajuan aktif yang menyangkut salah satu pihak di tanggal mana pun
    const conflict = await db
      .select({ id: shiftSwapRequests.id })
      .from(shiftSwapRequests)
      .where(
        and(
          inArray(shiftSwapRequests.status, ACTIVE_STATUSES),
          or(
            inArray(shiftSwapRequests.date, dates),
            inArray(shiftSwapRequests.targetDate, dates)
          ),
          or(
            inArray(shiftSwapRequests.requesterId, [selfId, targetUserId]),
            inArray(shiftSwapRequests.targetId, [selfId, targetUserId])
          )
        )
      )
      .limit(1);
    if (conflict.length > 0) {
      return fail('SWAP_EXISTS', 'Sudah ada pengajuan tukar aktif untuk tanggal ini', 409);
    }

    const inserted = await db
      .insert(shiftSwapRequests)
      .values({
        kind,
        requesterId: selfId,
        targetId: targetUserId,
        date,
        targetDate: kind === 'libur' ? targetDate! : null,
        requesterShift,
        targetShift,
        status: 'pending_peer',
        reason: reason?.trim() || null,
      })
      .returning();

    // Rekan tujuan, bukan administrator: selama status masih pending_peer,
    // yang ditunggu adalah persetujuan rekan. Administrator baru diberi tahu
    // setelah rekan setuju (lihat PATCH /api/swaps/[id]).
    notifyPeerSwapRequested({
      requesterName: session.user.name,
      targetId: targetUserId,
      kind: inserted[0].kind,
      date: inserted[0].date,
      targetDate: inserted[0].targetDate,
      requesterShift: inserted[0].requesterShift,
      targetShift: inserted[0].targetShift,
      swapId: inserted[0].id,
    });

    return NextResponse.json(
      toResponse({
        swap: inserted[0],
        requesterName: session.user.name,
        targetName: targetUser.name,
        reviewerName: null,
      }),
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/swaps error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
