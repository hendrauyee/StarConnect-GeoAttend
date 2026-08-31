import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  attendanceRecords,
  leaveRequests,
  liveLocations,
  locationTrails,
  user,
} from '@/lib/db/schema';
import {
  getApiSession,
  isAdmin,
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
} from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { ResetDataSchema } from '@/types/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/reset — reset data (administrator saja, wajib konfirmasi "RESET").
 * SELALU dibatasi ke POP aktif (administrator: POP miliknya; super_admin: POP
 * yang sedang dipilih lewat ?popId=) — tidak boleh menyentuh POP lain.
 * scope "attendance": hapus semua record absensi + posisi live + jejak lokasi
 * milik POP ini. File foto TIDAK ikut dihapus (disimpan flat, bukan per-POP —
 * menghapusnya akan turut menghapus foto POP lain).
 * scope "users": hapus semua pengguna POP ini KECUALI administrator/super_admin.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
    const popId = scope.popId;

    const body = await req.json();
    const parsed = ResetDataSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'Konfirmasi reset tidak valid',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const popUsers = await db.select({ id: user.id }).from(user).where(eq(user.popId, popId));
    const popUserIds = popUsers.map((u) => u.id);

    if (parsed.data.scope === 'attendance') {
      if (popUserIds.length > 0) {
        await db.transaction(async (tx) => {
          await tx.delete(liveLocations).where(inArray(liveLocations.userId, popUserIds));
          // Jejak lokasi ikut dihapus — tanpa ini riwayat perjalanan tetap ada
          // sementara absensinya sudah hilang (data yatim yang tak bisa dibuka).
          await tx.delete(locationTrails).where(inArray(locationTrails.userId, popUserIds));
          await tx.delete(leaveRequests).where(inArray(leaveRequests.userId, popUserIds));
          await tx.delete(attendanceRecords).where(inArray(attendanceRecords.userId, popUserIds));
        });
      }
      return NextResponse.json({
        success: true,
        message:
          'Semua data absensi, izin, dan jejak lokasi POP ini berhasil dihapus (file foto tidak ikut dihapus)',
      });
    }

    // scope === 'users': hapus semua non-administrator/super_admin DI POP INI
    // (cascade: accounts, sessions, attendance, live location ikut terhapus)
    const deleted = await db
      .delete(user)
      .where(and(eq(user.popId, popId), notInArray(user.role, ['administrator', 'super_admin'])))
      .returning({ id: user.id });

    return NextResponse.json({
      success: true,
      message: `${deleted.length} pengguna non-administrator di POP ini berhasil dihapus`,
    });
  } catch (error) {
    console.error('POST /api/admin/reset error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
