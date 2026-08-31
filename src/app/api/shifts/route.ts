import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { shiftSettings } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { UpsertShiftsSchema } from '@/types/api';

export const dynamic = 'force-dynamic';

/** GET /api/shifts — daftar konfigurasi jam kerja SOP per role. */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const rows = await db
      .select({
        id: shiftSettings.id,
        role: shiftSettings.role,
        shiftNumber: shiftSettings.shiftNumber,
        startTime: shiftSettings.startTime,
        endTime: shiftSettings.endTime,
      })
      .from(shiftSettings)
      .where(eq(shiftSettings.popId, scope.popId))
      .orderBy(asc(shiftSettings.role), asc(shiftSettings.shiftNumber));

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('GET /api/shifts error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/shifts — ganti seluruh konfigurasi shift (admin saja).
 * Body: { shifts: [{ role, shiftNumber, startTime, endTime }] }
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
    const parsed = UpsertShiftsSchema.safeParse(body);
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

    const result = await db.transaction(async (tx) => {
      // Hanya hapus shift POP INI — bukan seluruh tabel (sebelumnya bug: hapus
      // global akan menghapus jam kerja SOP semua POP lain).
      await tx.delete(shiftSettings).where(eq(shiftSettings.popId, popId));
      return tx
        .insert(shiftSettings)
        .values(
          parsed.data.shifts.map((shift) => ({
            popId,
            role: shift.role,
            shiftNumber: shift.shiftNumber,
            startTime: shift.startTime,
            endTime: shift.endTime,
          }))
        )
        .returning({
          id: shiftSettings.id,
          role: shiftSettings.role,
          shiftNumber: shiftSettings.shiftNumber,
          startTime: shiftSettings.startTime,
          endTime: shiftSettings.endTime,
        });
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('PUT /api/shifts error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
