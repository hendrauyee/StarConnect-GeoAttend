import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { scheduleEntries } from '@/lib/db/schema';
import { getApiSession, unauthorizedResponse, badRequestResponse } from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import type { DayRosterMember, DayRosterResponse, ScheduleShift } from '@/types/api';
import { listScheduleParticipants } from '@/lib/schedule/participants';
import { appToday } from '@/lib/time';

export const dynamic = 'force-dynamic';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/schedules/today?date=YYYY-MM-DD — roster "siapa shift berapa" satu hari.
 *
 * Boleh dibaca semua user login (bukan hanya administrator): isinya sebatas
 * nama + shift pada satu tanggal, setara dengan /api/piket yang sudah terbuka,
 * dan memang perlu diketahui rekan satu tim. Grid sebulan penuh tetap
 * administrator-only lewat GET /api/schedules.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const raw = req.nextUrl.searchParams.get('date');
    if (raw && !DATE_REGEX.test(raw)) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'Format tanggal harus yyyy-MM-dd',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }
    // Tanpa parameter → hari ini menurut WIB (bukan TZ host, yang di produksi UTC).
    const date = raw ?? appToday();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const { users } = await listScheduleParticipants(scope.popId);
    if (users.length === 0) {
      return NextResponse.json({ date, members: [] } satisfies DayRosterResponse);
    }

    const rows = await db
      .select({ userId: scheduleEntries.userId, shift: scheduleEntries.shift })
      .from(scheduleEntries)
      .where(
        and(
          eq(scheduleEntries.date, date),
          inArray(
            scheduleEntries.userId,
            users.map((u) => u.id)
          )
        )
      );

    const shiftByUser = new Map(rows.map((r) => [r.userId, r.shift as ScheduleShift]));
    const members: DayRosterMember[] = users.map((u) => ({
      userId: u.id,
      name: u.name,
      role: u.role,
      image: u.image,
      shift: shiftByUser.get(u.id) ?? null,
    }));

    return NextResponse.json({ date, members } satisfies DayRosterResponse);
  } catch (error) {
    console.error('GET /api/schedules/today error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
