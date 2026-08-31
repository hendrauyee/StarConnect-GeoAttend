import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db';
import { leaveRequests, user } from '@/lib/db/schema';
import { getApiSession, isAdmin, unauthorizedResponse, badRequestResponse } from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { CreateLeaveSchema, type LeaveRequestResponse } from '@/types/api';
import { rangesOverlap } from '@/lib/leaves';
import { appToday } from '@/lib/time';
import { notifyAdminLeaveSubmitted } from '@/lib/push/events';

export const dynamic = 'force-dynamic';

const reviewer = alias(user, 'reviewer');

type LeaveRow = {
  leave: typeof leaveRequests.$inferSelect;
  userName: string | null;
  userRole: string | null;
  reviewerName: string | null;
};

function toResponse(row: LeaveRow): LeaveRequestResponse {
  const { leave } = row;
  return {
    id: leave.id,
    userId: leave.userId,
    userName: row.userName ?? 'Pengguna terhapus',
    userRole: row.userRole ?? 'employee',
    type: leave.type as LeaveRequestResponse['type'],
    startDate: leave.startDate,
    endDate: leave.endDate,
    reason: leave.reason,
    status: leave.status as LeaveRequestResponse['status'],
    reviewedByName: row.reviewerName,
    reviewNote: leave.reviewNote,
    createdAt: leave.createdAt.toISOString(),
  };
}

/**
 * GET /api/leaves
 * Query: ?userId=<id|self>&from=yyyy-MM-dd&to=yyyy-MM-dd&status=pending|approved|rejected
 * Karyawan non-admin hanya bisa melihat pengajuan miliknya sendiri.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const params = req.nextUrl.searchParams;
    let userId = params.get('userId');
    if (userId === 'self') userId = session.user.id;
    if (!isAdmin(session)) userId = session.user.id;

    const conditions = [];
    if (userId) conditions.push(eq(leaveRequests.userId, userId));

    // Admin/super_admin melihat daftar (bukan satu userId spesifik): batasi ke POP aktif
    if (isAdmin(session) && !userId) {
      const scope = resolvePopScope(session, req);
      if ('error' in scope) return scope.error;
      if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
      conditions.push(eq(user.popId, scope.popId));
    }

    const status = params.get('status');
    if (status) conditions.push(eq(leaveRequests.status, status));

    // Filter rentang: pengajuan yang tumpang-tindih dengan [from, to]
    const from = params.get('from');
    const to = params.get('to');
    if (from) conditions.push(gte(leaveRequests.endDate, from));
    if (to) conditions.push(lte(leaveRequests.startDate, to));

    const rows = await db
      .select({
        leave: leaveRequests,
        userName: user.name,
        userRole: user.role,
        reviewerName: reviewer.name,
      })
      .from(leaveRequests)
      .leftJoin(user, eq(leaveRequests.userId, user.id))
      .leftJoin(reviewer, eq(leaveRequests.reviewedBy, reviewer.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(leaveRequests.createdAt))
      .limit(500);

    return NextResponse.json({ data: rows.map(toResponse) });
  } catch (error) {
    console.error('GET /api/leaves error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leaves — buat pengajuan izin / tandai libur.
 * - sakit/izin/cuti → status 'pending' (menunggu persetujuan administrator)
 * - libur → status 'approved' langsung, hanya boleh untuk HARI INI (self-service)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const body = await req.json();
    const parsed = CreateLeaveSchema.safeParse(body);
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
    const today = appToday();

    if (input.type === 'libur') {
      // Libur = penanda hari ini saja, langsung tercatat
      if (input.startDate !== today || input.endDate !== today) {
        return NextResponse.json(
          {
            code: 'INVALID_LEAVE_DATE',
            message: 'Penanda libur hanya berlaku untuk hari ini',
            timestamp: new Date().toISOString(),
          },
          { status: 422 }
        );
      }
    } else if (input.startDate < today) {
      return NextResponse.json(
        {
          code: 'INVALID_LEAVE_DATE',
          message: 'Tanggal izin tidak boleh di masa lalu',
          timestamp: new Date().toISOString(),
        },
        { status: 422 }
      );
    }

    // Cek tumpang-tindih dengan pengajuan aktif (pending/approved)
    const existing = await db
      .select({
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.userId, session.user.id),
          inArray(leaveRequests.status, ['pending', 'approved']),
          gte(leaveRequests.endDate, input.startDate),
          lte(leaveRequests.startDate, input.endDate)
        )
      )
      .limit(1);

    if (
      existing.length > 0 &&
      rangesOverlap(input.startDate, input.endDate, existing[0].startDate, existing[0].endDate)
    ) {
      return NextResponse.json(
        {
          code: 'LEAVE_OVERLAP',
          message: 'Sudah ada pengajuan izin/libur pada rentang tanggal tersebut',
          timestamp: new Date().toISOString(),
        },
        { status: 409 }
      );
    }

    const inserted = await db
      .insert(leaveRequests)
      .values({
        userId: session.user.id,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason?.trim() || null,
        status: input.type === 'libur' ? 'approved' : 'pending',
      })
      .returning();

    // Penanda 'libur' langsung approved (self-service) — tidak ada yang perlu
    // diputuskan, jadi administrator tidak perlu diganggu.
    if (inserted[0].status === 'pending') {
      notifyAdminLeaveSubmitted({
        requesterId: session.user.id,
        requesterPopId: session.user.popId ?? '',
        requesterName: session.user.name,
        type: inserted[0].type,
        startDate: inserted[0].startDate,
        endDate: inserted[0].endDate,
        leaveId: inserted[0].id,
      });
    }

    return NextResponse.json(
      toResponse({
        leave: inserted[0],
        userName: session.user.name,
        userRole: session.user.role ?? 'employee',
        reviewerName: null,
      }),
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/leaves error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
