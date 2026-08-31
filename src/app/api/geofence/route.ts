import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { geofences } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { UpdateGeofenceSchema, type GeofenceResponse } from '@/types/api';

export const dynamic = 'force-dynamic';

function toResponse(row: typeof geofences.$inferSelect): GeofenceResponse {
  return {
    id: row.id,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusMeters: Number(row.radiusMeters),
    isActive: row.isActive,
  };
}

/** GET /api/geofence — ambil konfigurasi geofence aktif. */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const rows = await db
      .select()
      .from(geofences)
      .where(and(eq(geofences.isActive, true), eq(geofences.popId, scope.popId)))
      .limit(1);

    if (!rows[0]) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Geofence belum dikonfigurasi', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }

    return NextResponse.json(toResponse(rows[0]));
  } catch (error) {
    console.error('GET /api/geofence error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/** PUT /api/geofence — update (atau buat) konfigurasi geofence. Admin saja. */
export async function PUT(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const body = await req.json();
    const parsed = UpdateGeofenceSchema.safeParse(body);
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
    const existing = await db
      .select({ id: geofences.id })
      .from(geofences)
      .where(and(eq(geofences.isActive, true), eq(geofences.popId, scope.popId)))
      .limit(1);

    let result;
    if (existing[0]) {
      result = await db
        .update(geofences)
        .set({
          name: input.name,
          latitude: String(input.latitude),
          longitude: String(input.longitude),
          radiusMeters: String(input.radiusMeters),
          isActive: input.isActive,
          updatedAt: new Date(),
        })
        .where(eq(geofences.id, existing[0].id))
        .returning();
    } else {
      result = await db
        .insert(geofences)
        .values({
          popId: scope.popId,
          name: input.name,
          latitude: String(input.latitude),
          longitude: String(input.longitude),
          radiusMeters: String(input.radiusMeters),
          isActive: input.isActive,
        })
        .returning();
    }

    return NextResponse.json(toResponse(result[0]));
  } catch (error) {
    console.error('PUT /api/geofence error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
