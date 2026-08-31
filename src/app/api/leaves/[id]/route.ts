import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leaveRequests, user } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  isSuperAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/auth/utils';
import { ReviewLeaveSchema } from '@/types/api';
import { notifyRequesterLeaveReviewed } from '@/lib/push/events';

export const dynamic = 'force-dynamic';

function notFoundResponse() {
  return NextResponse.json(
    {
      code: 'NOT_FOUND',
      message: 'Pengajuan tidak ditemukan',
      timestamp: new Date().toISOString(),
    },
    { status: 404 }
  );
}

/**
 * PATCH /api/leaves/[id] — setujui / tolak pengajuan (administrator saja).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const body = await req.json();
    const parsed = ReviewLeaveSchema.safeParse(body);
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

    if (!isSuperAdmin(session)) {
      const [owner] = await db
        .select({ popId: user.popId })
        .from(leaveRequests)
        .innerJoin(user, eq(user.id, leaveRequests.userId))
        .where(eq(leaveRequests.id, params.id))
        .limit(1);
      if (!owner || owner.popId !== session.user.popId) return notFoundResponse();
    }

    const updated = await db
      .update(leaveRequests)
      .set({
        status: parsed.data.status,
        reviewedBy: session.user.id,
        reviewedAt: new Date(),
        reviewNote: parsed.data.reviewNote?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(leaveRequests.id, params.id))
      .returning({
        id: leaveRequests.id,
        status: leaveRequests.status,
        userId: leaveRequests.userId,
        type: leaveRequests.type,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        reviewNote: leaveRequests.reviewNote,
      });

    if (updated.length === 0) return notFoundResponse();

    const leave = updated[0];
    // Administrator yang memutuskan pengajuannya sendiri tidak perlu
    // dikabari hasil keputusannya sendiri.
    if (leave.userId !== session.user.id) {
      notifyRequesterLeaveReviewed({
        requesterId: leave.userId,
        type: leave.type,
        startDate: leave.startDate,
        endDate: leave.endDate,
        approved: leave.status === 'approved',
        reviewNote: leave.reviewNote,
        leaveId: leave.id,
      });
    }

    return NextResponse.json({ data: { id: leave.id, status: leave.status } });
  } catch (error) {
    console.error('PATCH /api/leaves/[id] error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/leaves/[id] — batalkan pengajuan.
 * Karyawan: hanya miliknya sendiri, dan hanya yang masih pending atau penanda libur.
 * Administrator: bebas menghapus.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const rows = await db
      .select({
        id: leaveRequests.id,
        userId: leaveRequests.userId,
        type: leaveRequests.type,
        status: leaveRequests.status,
        userPopId: user.popId,
      })
      .from(leaveRequests)
      .innerJoin(user, eq(user.id, leaveRequests.userId))
      .where(eq(leaveRequests.id, params.id))
      .limit(1);

    const leave = rows[0];
    if (!leave) return notFoundResponse();

    if (!isAdmin(session)) {
      const isOwner = leave.userId === session.user.id;
      const cancellable = leave.status === 'pending' || leave.type === 'libur';
      if (!isOwner || !cancellable) return forbiddenResponse();
    } else if (!isSuperAdmin(session) && leave.userPopId !== session.user.popId) {
      return notFoundResponse();
    }

    await db.delete(leaveRequests).where(eq(leaveRequests.id, params.id));

    return NextResponse.json({ data: { id: leave.id } });
  } catch (error) {
    console.error('DELETE /api/leaves/[id] error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
