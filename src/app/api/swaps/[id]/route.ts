import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { scheduleEntries, shiftSwapRequests, user } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  isSuperAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/auth/utils';
import { ReviewSwapSchema } from '@/types/api';
import {
  notifyAdminSwapAwaitingReview,
  notifyPartiesSwapReviewed,
  notifyRequesterSwapPeerRejected,
} from '@/lib/push/events';

export const dynamic = 'force-dynamic';

function notFound() {
  return NextResponse.json(
    { code: 'NOT_FOUND', message: 'Pengajuan tukar tidak ditemukan', timestamp: new Date().toISOString() },
    { status: 404 }
  );
}

function conflict(message: string) {
  return NextResponse.json(
    { code: 'INVALID_STATE', message, timestamp: new Date().toISOString() },
    { status: 409 }
  );
}

/**
 * PATCH /api/swaps/[id] — aksi pada pengajuan tukar shift.
 * - peer_accept / peer_reject: hanya rekan tujuan, saat status pending_peer.
 * - approve / reject: hanya administrator, saat status pending_admin.
 *   approve → entri jadwal kedua orang ditukar (transaksi).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const body = await req.json();
    const parsed = ReviewSwapSchema.safeParse(body);
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

    const { action, reviewNote } = parsed.data;
    const [swap] = await db
      .select()
      .from(shiftSwapRequests)
      .where(eq(shiftSwapRequests.id, params.id))
      .limit(1);
    if (!swap) return notFound();

    const note = reviewNote?.trim() || null;

    // --- Persetujuan rekan tujuan ---
    if (action === 'peer_accept' || action === 'peer_reject') {
      if (swap.targetId !== session.user.id) return forbiddenResponse();
      if (swap.status !== 'pending_peer') return conflict('Pengajuan sudah tidak menunggu responsmu');

      const updated = await db
        .update(shiftSwapRequests)
        .set({
          status: action === 'peer_accept' ? 'pending_admin' : 'rejected',
          reviewNote: action === 'peer_reject' ? note : swap.reviewNote,
          peerRespondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(shiftSwapRequests.id, params.id))
        .returning({ id: shiftSwapRequests.id, status: shiftSwapRequests.status });

      // Baru sekarang administrator diberi tahu — bukan saat pengajuan dibuat.
      // Sebelum rekan setuju, pengajuan belum tentu pernah sampai ke mejanya.
      if (updated[0].status === 'pending_admin') {
        notifyAdminSwapAwaitingReview({
          requesterId: swap.requesterId,
          requesterPopId: session.user.popId ?? '',
          targetId: swap.targetId,
          kind: swap.kind,
          date: swap.date,
          targetDate: swap.targetDate,
          swapId: swap.id,
        });
      } else {
        // Penolakan rekan mengakhiri alur — pengajuan tidak pernah sampai ke
        // administrator, jadi ini satu-satunya kesempatan memberi tahu pengaju.
        notifyRequesterSwapPeerRejected({
          requesterId: swap.requesterId,
          targetName: session.user.name,
          kind: swap.kind,
          date: swap.date,
          targetDate: swap.targetDate,
          reviewNote: note,
          swapId: swap.id,
        });
      }

      return NextResponse.json({ data: updated[0] });
    }

    // --- Persetujuan administrator ---
    if (!isAdmin(session)) return forbiddenResponse();
    if (!isSuperAdmin(session)) {
      const [requesterRow] = await db
        .select({ popId: user.popId })
        .from(user)
        .where(eq(user.id, swap.requesterId))
        .limit(1);
      if (!requesterRow || requesterRow.popId !== session.user.popId) return notFound();
    }
    if (swap.status !== 'pending_admin') {
      return conflict('Pengajuan belum disetujui rekan atau sudah diproses');
    }

    if (action === 'reject') {
      const updated = await db
        .update(shiftSwapRequests)
        .set({
          status: 'rejected',
          reviewedBy: session.user.id,
          reviewedAt: new Date(),
          reviewNote: note,
          updatedAt: new Date(),
        })
        .where(eq(shiftSwapRequests.id, params.id))
        .returning({ id: shiftSwapRequests.id, status: shiftSwapRequests.status });

      notifyPartiesSwapReviewed({
        requesterId: swap.requesterId,
        targetId: swap.targetId,
        approved: false,
        kind: swap.kind,
        date: swap.date,
        targetDate: swap.targetDate,
        reviewNote: note,
        swapId: swap.id,
      });

      return NextResponse.json({ data: updated[0] });
    }

    // action === 'approve' → tulis entri jadwal (transaksi), setelah cek jadwal tak berubah
    const isLibur = swap.kind === 'libur';
    const dates = isLibur && swap.targetDate ? [swap.date, swap.targetDate] : [swap.date];

    if (isLibur && !swap.targetDate) {
      return conflict('Pengajuan tukar libur tidak punya tanggal rekan; ajukan ulang');
    }

    const current = await db
      .select({
        userId: scheduleEntries.userId,
        date: scheduleEntries.date,
        shift: scheduleEntries.shift,
      })
      .from(scheduleEntries)
      .where(
        and(
          inArray(scheduleEntries.date, dates),
          inArray(scheduleEntries.userId, [swap.requesterId, swap.targetId])
        )
      );
    const shiftAt = (userId: string, date: string) =>
      current.find((c) => c.userId === userId && c.date === date)?.shift ?? null;

    /** Entri yang akan ditulis bila pengajuan disetujui. */
    let writes: { userId: string; date: string; shift: string }[];

    if (isLibur) {
      const dateA = swap.date; // libur pengaju
      const dateB = swap.targetDate!; // libur rekan
      // requesterShift = shift rekan di A (yang diambil alih pengaju),
      // targetShift = shift pengaju di B (yang diambil alih rekan).
      const unchanged =
        shiftAt(swap.requesterId, dateA) === 'libur' &&
        shiftAt(swap.targetId, dateA) === swap.requesterShift &&
        shiftAt(swap.targetId, dateB) === 'libur' &&
        shiftAt(swap.requesterId, dateB) === swap.targetShift;
      if (!unchanged) {
        return conflict('Jadwal sudah berubah sejak pengajuan; tukar tidak bisa diterapkan');
      }

      writes = [
        { userId: swap.requesterId, date: dateA, shift: swap.requesterShift },
        { userId: swap.targetId, date: dateA, shift: 'libur' },
        { userId: swap.requesterId, date: dateB, shift: 'libur' },
        { userId: swap.targetId, date: dateB, shift: swap.targetShift },
      ];
    } else {
      if (
        shiftAt(swap.requesterId, swap.date) !== swap.requesterShift ||
        shiftAt(swap.targetId, swap.date) !== swap.targetShift
      ) {
        return conflict('Jadwal sudah berubah sejak pengajuan; tukar tidak bisa diterapkan');
      }
      // requester dapat shift target, target dapat shift requester
      writes = [
        { userId: swap.requesterId, date: swap.date, shift: swap.targetShift },
        { userId: swap.targetId, date: swap.date, shift: swap.requesterShift },
      ];
    }

    await db.transaction(async (tx) => {
      for (const w of writes) {
        await tx
          .insert(scheduleEntries)
          .values(w)
          .onConflictDoUpdate({
            target: [scheduleEntries.userId, scheduleEntries.date],
            set: { shift: w.shift, updatedAt: new Date() },
          });
      }
      await tx
        .update(shiftSwapRequests)
        .set({
          status: 'approved',
          reviewedBy: session.user.id,
          reviewedAt: new Date(),
          reviewNote: note,
          updatedAt: new Date(),
        })
        .where(eq(shiftSwapRequests.id, params.id));
    });

    // Dikirim SETELAH transaksi berhasil — kalau penulisan jadwal gagal, tidak
    // boleh ada yang terlanjur dikabari jadwalnya berubah.
    notifyPartiesSwapReviewed({
      requesterId: swap.requesterId,
      targetId: swap.targetId,
      approved: true,
      kind: swap.kind,
      date: swap.date,
      targetDate: swap.targetDate,
      reviewNote: note,
      swapId: swap.id,
    });

    return NextResponse.json({ data: { id: swap.id, status: 'approved' } });
  } catch (error) {
    console.error('PATCH /api/swaps/[id] error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/swaps/[id] — batalkan pengajuan.
 * Pengaju: miliknya sendiri selama belum disetujui. Administrator: bebas.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const [swap] = await db
      .select({
        id: shiftSwapRequests.id,
        requesterId: shiftSwapRequests.requesterId,
        status: shiftSwapRequests.status,
        requesterPopId: user.popId,
      })
      .from(shiftSwapRequests)
      .innerJoin(user, eq(user.id, shiftSwapRequests.requesterId))
      .where(eq(shiftSwapRequests.id, params.id))
      .limit(1);
    if (!swap) return notFound();

    if (!isAdmin(session)) {
      const isOwner = swap.requesterId === session.user.id;
      const cancellable = swap.status === 'pending_peer' || swap.status === 'pending_admin';
      if (!isOwner || !cancellable) return forbiddenResponse();
    } else if (!isSuperAdmin(session) && swap.requesterPopId !== session.user.popId) {
      return notFound();
    }

    await db.delete(shiftSwapRequests).where(eq(shiftSwapRequests.id, params.id));
    return NextResponse.json({ data: { id: swap.id } });
  } catch (error) {
    console.error('DELETE /api/swaps/[id] error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
