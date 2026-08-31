import { NextRequest, NextResponse } from 'next/server';
import { count, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { attendanceRecords, user } from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { getUploadsSizeBytes } from '@/lib/storage/local-fs';
import { APP_VERSION } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/** GET /api/admin/system-info — informasi sistem untuk tab General. */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    // Untuk super_admin tanpa ?popId= (mode global), tampilkan angka seluruh
    // sistem — administrator biasa selalu di-scope ke POP-nya sendiri.
    const popId = scope.popId;

    let dbVersion = 'tidak diketahui';
    let dbConnected = false;
    try {
      const result = await db.execute<{ version: string }>(sql`SELECT version()`);
      const rows = result as unknown as { version: string }[];
      dbVersion = rows[0]?.version?.split(' on ')[0] ?? 'PostgreSQL';
      dbConnected = true;
    } catch {
      // db down
    }

    const [userCount, recordCount, uploadsBytes] = await Promise.all([
      popId
        ? db.select({ total: count() }).from(user).where(eq(user.popId, popId))
        : db.select({ total: count() }).from(user),
      popId
        ? db
            .select({ total: count() })
            .from(attendanceRecords)
            .innerJoin(user, eq(attendanceRecords.userId, user.id))
            .where(eq(user.popId, popId))
        : db.select({ total: count() }).from(attendanceRecords),
      getUploadsSizeBytes(),
    ]);

    return NextResponse.json({
      appVersion: APP_VERSION,
      nextVersion: '14.2.15',
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
      uptimeSeconds: Math.floor(process.uptime()),
      db: { connected: dbConnected, version: dbVersion },
      counts: {
        users: userCount[0]?.total ?? 0,
        attendanceRecords: recordCount[0]?.total ?? 0,
        uploadsSizeBytes: uploadsBytes,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/system-info error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
