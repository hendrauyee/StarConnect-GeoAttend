import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  attendanceRecords,
  geofences,
  leaveRequests,
  scheduleEntries,
  shiftSettings,
  user,
} from '@/lib/db/schema';
import { getApiSession, isAdmin, isSuperAdmin, unauthorizedResponse } from '@/lib/auth/utils';
import { toAttendanceResponse } from '@/lib/attendance/serialize';
import { buildRecap, emptySummary, type RecapResponse } from '@/lib/reports/recap';
import { monthDates } from '@/lib/schedule/rotation';
import { appMonth, appToday, APP_UTC_OFFSET_MINUTES } from '@/lib/time';
import type { LeaveRequestResponse, ScheduleEntry, ScheduleShift } from '@/types/api';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** "+07:00" — penanda zona pada batas query, agar tidak bergantung TZ host. */
const TZ_SUFFIX = (() => {
  const sign = APP_UTC_OFFSET_MINUTES < 0 ? '-' : '+';
  const abs = Math.abs(APP_UTC_OFFSET_MINUTES);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
})();

/**
 * GET /api/reports/recap?month=YYYY-MM&userId=self|<id>
 *
 * Rekap absensi bulanan SATU karyawan — ringkasan + detail harian, dihitung
 * dengan modul yang sama seperti halaman Rekap Bulanan web. Dipakai aplikasi
 * mobile untuk kartu "Rekap Bulan Ini" dan unduhan PDF, supaya angkanya tidak
 * pernah beda dengan yang dilihat admin.
 *
 * Karyawan non-admin selalu dipaksa ke dirinya sendiri.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const params = req.nextUrl.searchParams;
    const month = params.get('month') ?? appMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'Format bulan harus yyyy-MM',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const requested = params.get('userId');
    const targetUserId =
      !isAdmin(session) || !requested || requested === 'self' ? session.user.id : requested;

    const [target] = await db
      .select({ id: user.id, name: user.name, role: user.role, popId: user.popId })
      .from(user)
      .where(eq(user.id, targetUserId))
      .limit(1);
    if (!target || (!isSuperAdmin(session) && targetUserId !== session.user.id && target.popId !== session.user.popId)) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }

    const dates = monthDates(month);
    const monthStart = dates[0];
    const monthEnd = dates[dates.length - 1];
    // Batas absensi memakai jam dinding WIB, bukan TZ host.
    const from = new Date(`${monthStart}T00:00:00${TZ_SUFFIX}`);
    const to = new Date(`${monthEnd}T23:59:59.999${TZ_SUFFIX}`);

    const [attendanceRows, shiftRows, leaveRows, entryRows] = await Promise.all([
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
        .where(
          and(
            eq(attendanceRecords.userId, targetUserId),
            gte(attendanceRecords.timestamp, from),
            lte(attendanceRecords.timestamp, to)
          )
        )
        .orderBy(asc(attendanceRecords.timestamp))
        .limit(1000),
      db
        .select({
          role: shiftSettings.role,
          shiftNumber: shiftSettings.shiftNumber,
          startTime: shiftSettings.startTime,
          endTime: shiftSettings.endTime,
        })
        .from(shiftSettings)
        .where(eq(shiftSettings.popId, target.popId ?? '')),
      db
        .select({ leave: leaveRequests })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.userId, targetUserId),
            eq(leaveRequests.status, 'approved'),
            gte(leaveRequests.endDate, monthStart),
            lte(leaveRequests.startDate, monthEnd)
          )
        ),
      db
        .select({
          userId: scheduleEntries.userId,
          date: scheduleEntries.date,
          shift: scheduleEntries.shift,
        })
        .from(scheduleEntries)
        .where(
          and(
            eq(scheduleEntries.userId, targetUserId),
            gte(scheduleEntries.date, monthStart),
            lte(scheduleEntries.date, monthEnd)
          )
        ),
    ]);

    const leaves: LeaveRequestResponse[] = leaveRows.map(({ leave }) => ({
      id: leave.id,
      userId: leave.userId,
      userName: target.name,
      userRole: target.role,
      type: leave.type as LeaveRequestResponse['type'],
      startDate: leave.startDate,
      endDate: leave.endDate,
      reason: leave.reason,
      status: leave.status as LeaveRequestResponse['status'],
      reviewedByName: null,
      reviewNote: leave.reviewNote,
      createdAt: leave.createdAt.toISOString(),
    }));

    const { rows, summaries } = buildRecap({
      records: attendanceRows.map(toAttendanceResponse),
      users: [target],
      shifts: shiftRows,
      leaves,
      scheduleEntries: entryRows.map(
        (e): ScheduleEntry => ({ ...e, shift: e.shift as ScheduleShift })
      ),
      monthStart,
      monthEnd,
      today: appToday(),
    });

    return NextResponse.json({
      month,
      user: target,
      summary: summaries[0] ?? emptySummary(target.id, target.name, target.role),
      rows,
    } satisfies RecapResponse);
  } catch (error) {
    return internalError(error, 'GET /api/reports/recap');
  }
}
