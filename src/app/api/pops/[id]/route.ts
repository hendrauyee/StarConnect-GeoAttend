import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { pops } from '@/lib/db/schema';
import {
  getApiSession,
  isSuperAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/auth/utils';

export const dynamic = 'force-dynamic';

const UpdatePopSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  isActive: z.boolean().optional(),
});

/** PATCH /api/pops/[id] — ubah POP (super_admin saja). Tidak ada DELETE — nonaktifkan saja (isActive). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isSuperAdmin(session)) return forbiddenResponse();

    const body = await req.json();
    const parsed = UpdatePopSchema.safeParse(body);
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

    const [updated] = await db
      .update(pops)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(pops.id, params.id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'POP tidak ditemukan', timestamp: new Date().toISOString() },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/pops/[id] error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
