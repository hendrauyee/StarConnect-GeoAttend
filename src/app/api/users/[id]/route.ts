import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { auth } from '@/lib/auth';
import {
  getApiSession,
  isAdmin,
  isSuperAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/auth/utils';
import { UpdateUserSchema } from '@/types/api';

export const dynamic = 'force-dynamic';

function notFoundResponse() {
  return NextResponse.json(
    { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan', timestamp: new Date().toISOString() },
    { status: 404 }
  );
}

/** PATCH /api/users/[id] — update role/nama pengguna (admin saja, POP sendiri). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    if (!isSuperAdmin(session)) {
      const [target] = await db.select({ popId: user.popId }).from(user).where(eq(user.id, params.id)).limit(1);
      if (!target || target.popId !== session.user.popId) return notFoundResponse();
    }

    const body = await req.json();
    const parsed = UpdateUserSchema.safeParse(body);
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

    // Administrator tidak boleh menurunkan role dirinya sendiri (mencegah lockout)
    if (
      params.id === session.user.id &&
      parsed.data.role !== undefined &&
      parsed.data.role !== 'administrator'
    ) {
      return NextResponse.json(
        {
          code: 'SELF_DEMOTION',
          message: 'Anda tidak dapat menurunkan role akun sendiri',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const { password, ...userFields } = parsed.data;

    // Tim jaga hanya berlaku untuk teknisi: pindah role otomatis mengosongkannya
    // agar tidak ada anggota tim "hantu" yang bukan teknisi lagi.
    if (userFields.role !== undefined && userFields.role !== 'teknisi') {
      userFields.technicianTeam = null;
    }

    let updated;
    try {
      updated = await db
        .update(user)
        .set({ ...userFields, updatedAt: new Date() })
        .where(eq(user.id, params.id))
        .returning({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          image: user.image,
          technicianTeam: user.technicianTeam,
        });
    } catch (error) {
      // Pelanggaran unique constraint email
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { code: 'EMAIL_TAKEN', message: 'Email sudah terdaftar', timestamp: new Date().toISOString() },
          { status: 409 }
        );
      }
      throw error;
    }

    if (!updated[0]) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Pengguna tidak ditemukan', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }

    // Reset password oleh administrator (hash via Better Auth)
    if (password) {
      const ctx = await auth.$context;
      const hashed = await ctx.password.hash(password);
      await ctx.internalAdapter.updatePassword(params.id, hashed);
    }

    return NextResponse.json(updated[0]);
  } catch (error) {
    console.error('PATCH /api/users/[id] error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/** DELETE /api/users/[id] — hapus pengguna (admin saja). */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isAdmin(session)) return forbiddenResponse();

    if (params.id === session.user.id) {
      return NextResponse.json(
        {
          code: 'SELF_DELETION',
          message: 'Anda tidak dapat menghapus akun sendiri',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    if (!isSuperAdmin(session)) {
      const [target] = await db.select({ popId: user.popId }).from(user).where(eq(user.id, params.id)).limit(1);
      if (!target || target.popId !== session.user.popId) return notFoundResponse();
    }

    const deleted = await db
      .delete(user)
      .where(eq(user.id, params.id))
      .returning({ id: user.id });

    if (!deleted[0]) return notFoundResponse();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/users/[id] error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
