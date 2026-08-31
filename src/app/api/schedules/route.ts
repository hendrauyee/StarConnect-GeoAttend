import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { scheduleEntries } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { UpsertScheduleSchema, type ScheduleShift } from '@/types/api';
import { monthDates } from '@/lib/schedule/rotation';
import { appMonth } from '@/lib/time';
import { isShiftAllowedForRole } from '@/lib/schedule/roles';
import { listScheduleParticipants } from '@/lib/schedule/participants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/schedules?month=YYYY-MM&userId=self|<id>
 * - Administrator tanpa userId → grid penuh: daftar PESERTA jadwal + entri bulan.
 * - Karyawan / userId=self → hanya entri jadwal miliknya.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const params = req.nextUrl.searchParams;
    const month = params.get('month') ?? appMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Format bulan harus yyyy-MM', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    const admin = isAdmin(session);
    let targetUserId = params.get('userId');
    if (targetUserId === 'self') targetUserId = session.user.id;
    if (!admin) targetUserId = session.user.id;

    const dates = monthDates(month);
    const start = dates[0];
    const end = dates[dates.length - 1];

    // Daftar user hanya untuk tampilan grid administrator
    let participants: Awaited<ReturnType<typeof listScheduleParticipants>> = {
      users: [],
      configured: false,
    };
    if (admin && !targetUserId) {
      const scope = resolvePopScope(session, req);
      if ('error' in scope) return scope.error;
      if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
      participants = await listScheduleParticipants(scope.popId);
    }

    const entryConds = [gte(scheduleEntries.date, start), lte(scheduleEntries.date, end)];
    if (targetUserId) {
      entryConds.push(eq(scheduleEntries.userId, targetUserId));
    } else if (admin) {
      // Grid penuh: batasi ke peserta POP ini saja (bukan seluruh tabel lintas-POP)
      const ids = participants.users.map((u) => u.id);
      entryConds.push(ids.length > 0 ? inArray(scheduleEntries.userId, ids) : eq(scheduleEntries.userId, ''));
    }

    const entries = await db
      .select({
        userId: scheduleEntries.userId,
        date: scheduleEntries.date,
        shift: scheduleEntries.shift,
      })
      .from(scheduleEntries)
      .where(and(...entryConds));

    return NextResponse.json({
      users: participants.users,
      entries: entries.map((e) => ({ ...e, shift: e.shift as ScheduleShift })),
      participantsConfigured: participants.configured,
    });
  } catch (error) {
    console.error('GET /api/schedules error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/schedules — simpan jadwal satu bulan (administrator saja).
 * Semantik replace-bulan: entri bulan itu untuk user admin/noc diganti seluruhnya.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const body = await req.json();
    const parsed = UpsertScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          // Sebutkan sebab pastinya — pesan generik menyulitkan admin menebak
          // apa yang salah dari grid sebesar ini.
          message: `Data tidak valid: ${parsed.error.issues[0]?.message ?? 'periksa isian'}`,
          details: parsed.error.flatten(),
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const { month, entries } = parsed.data;
    const dates = monthDates(month);
    const start = dates[0];
    const end = dates[dates.length - 1];
    const validDates = new Set(dates);

    // Hanya peserta jadwal (POP ini) yang boleh disimpan
    const participants = await listScheduleParticipants(scope.popId);
    const roleByUser = new Map(participants.users.map((u) => [u.id, u.role]));

    // Dedupe (userId|date) — sel terakhir menang. Abaikan tanggal luar bulan,
    // bukan peserta jadwal, dan shift yang tidak berlaku bagi role tersebut
    // (mis. teknisi tidak punya Shift 2).
    const dedup = new Map<string, { userId: string; date: string; shift: ScheduleShift }>();
    for (const e of entries) {
      const role = roleByUser.get(e.userId);
      if (!validDates.has(e.date) || role === undefined) continue;
      if (!isShiftAllowedForRole(role, e.shift)) continue;
      dedup.set(`${e.userId}|${e.date}`, e);
    }
    const rows = Array.from(dedup.values());
    const schedulableIdList = participants.users.map((u) => u.id);
    if (schedulableIdList.length === 0) {
      return NextResponse.json({ data: { month, saved: 0 } });
    }

    await db.transaction(async (tx) => {
      // Replace-bulan hanya untuk peserta jadwal: entri karyawan yang sudah
      // dikeluarkan dari daftar peserta tidak ikut terhapus (tetap jadi
      // catatan riwayat pada halaman Jadwal Saya mereka).
      await tx
        .delete(scheduleEntries)
        .where(
          and(
            gte(scheduleEntries.date, start),
            lte(scheduleEntries.date, end),
            inArray(scheduleEntries.userId, schedulableIdList)
          )
        );
      if (rows.length > 0) {
        await tx.insert(scheduleEntries).values(
          rows.map((r) => ({ userId: r.userId, date: r.date, shift: r.shift }))
        );
      }
    });

    return NextResponse.json({ data: { month, saved: rows.length } });
  } catch (error) {
    console.error('PUT /api/schedules error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
