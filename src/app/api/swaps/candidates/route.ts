import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { scheduleEntries, user } from '@/lib/db/schema';
import { getApiSession, unauthorizedResponse } from '@/lib/auth/utils';
import { appToday } from '@/lib/time';
import type { SwapCandidate } from '@/types/api';

export const dynamic = 'force-dynamic';

/** Berapa jauh ke depan hari libur rekan ikut ditawarkan. */
const LIBUR_HORIZON_DAYS = 90;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * GET /api/swaps/candidates?date=YYYY-MM-DD&kind=shift|libur
 *
 * - kind='shift' (default): rekan satu role yang terjadwal shift BEDA pada tanggal itu.
 * - kind='libur': `date` adalah hari libur pengaju. Yang dikembalikan adalah
 *   pasangan (rekan, tanggal libur rekan) yang bisa ditukar — rekan masuk pada
 *   hari libur pengaju, dan pengaju masuk pada hari libur rekan. `shift` =
 *   shift rekan yang akan diambil alih pengaju; `targetShift` = kebalikannya.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const date = req.nextUrl.searchParams.get('date');
    const kind = req.nextUrl.searchParams.get('kind') === 'libur' ? 'libur' : 'shift';
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Parameter date (yyyy-MM-dd) wajib', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }

    const role = session.user.role ?? '';

    // Shift pengaju pada tanggal itu
    const [mine] = await db
      .select({ shift: scheduleEntries.shift })
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.userId, session.user.id), eq(scheduleEntries.date, date)))
      .limit(1);
    const requesterShift = mine?.shift ?? null;

    if (kind === 'libur') {
      if (requesterShift !== 'libur') {
        return NextResponse.json({ requesterShift, candidates: [] });
      }

      // Rekan satu role yang MASUK pada hari libur pengaju. Shift mereka di
      // tanggal itu adalah shift yang akan diambil alih pengaju.
      const peers = await db
        .select({ id: user.id, name: user.name, shift: scheduleEntries.shift })
        .from(scheduleEntries)
        .innerJoin(user, eq(scheduleEntries.userId, user.id))
        .where(
          and(
            eq(scheduleEntries.date, date),
            eq(user.role, role),
            eq(user.popId, session.user.popId ?? ''),
            ne(user.id, session.user.id),
            inArray(scheduleEntries.shift, ['1', '2'])
          )
        );
      if (peers.length === 0) {
        return NextResponse.json({ requesterShift, candidates: [] });
      }

      // Jendela tanggal yang ditawarkan: besok s/d horizon
      const from = addDays(appToday(), 1);
      const to = addDays(appToday(), LIBUR_HORIZON_DAYS);
      const peerIds = peers.map((p) => p.id);

      const nearbyEntries = await db
        .select({
          userId: scheduleEntries.userId,
          date: scheduleEntries.date,
          shift: scheduleEntries.shift,
        })
        .from(scheduleEntries)
        .where(
          and(
            gte(scheduleEntries.date, from),
            lte(scheduleEntries.date, to),
            inArray(scheduleEntries.userId, [...peerIds, session.user.id])
          )
        );

      // Tanggal-tanggal pengaju MASUK (beserta shiftnya) — hanya itu yang bisa
      // ditukar jadi libur, dan shift itulah yang nanti diambil alih rekan.
      const myShiftByDate = new Map(
        nearbyEntries
          .filter((w) => w.userId === session.user.id && (w.shift === '1' || w.shift === '2'))
          .map((w) => [w.date, w.shift])
      );

      const peerById = new Map(peers.map((p) => [p.id, p]));
      const candidates: SwapCandidate[] = nearbyEntries
        .filter(
          (w) =>
            w.shift === 'libur' &&
            w.userId !== session.user.id &&
            w.date !== date &&
            myShiftByDate.has(w.date)
        )
        .map((w) => ({
          id: w.userId,
          name: peerById.get(w.userId)?.name ?? '',
          shift: peerById.get(w.userId)!.shift, // shift rekan di tanggal libur pengaju
          targetDate: w.date,
          targetShift: myShiftByDate.get(w.date)!, // shift pengaju di tanggal libur rekan
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.targetDate!.localeCompare(b.targetDate!));

      return NextResponse.json({ requesterShift, candidates });
    }

    // --- Mode shift (satu tanggal, S1 ↔ S2) ---
    if (requesterShift !== '1' && requesterShift !== '2') {
      return NextResponse.json({ requesterShift: null, candidates: [] });
    }

    const rows = await db
      .select({ id: user.id, name: user.name, shift: scheduleEntries.shift })
      .from(scheduleEntries)
      .innerJoin(user, eq(scheduleEntries.userId, user.id))
      .where(
        and(
          eq(scheduleEntries.date, date),
          eq(user.role, role),
          eq(user.popId, session.user.popId ?? ''),
          ne(user.id, session.user.id),
          inArray(scheduleEntries.shift, ['1', '2']),
          ne(scheduleEntries.shift, requesterShift)
        )
      )
      .orderBy(user.name);

    const candidates: SwapCandidate[] = rows.map((r) => ({ id: r.id, name: r.name, shift: r.shift }));
    return NextResponse.json({ requesterShift, candidates });
  } catch (error) {
    console.error('GET /api/swaps/candidates error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
