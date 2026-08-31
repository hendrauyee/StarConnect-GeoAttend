import { NextRequest, NextResponse } from 'next/server';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { pops, user } from '@/lib/db/schema';
import {
  getApiSession,
  isSuperAdmin,
  unauthorizedResponse,
  forbiddenResponse,
} from '@/lib/auth/utils';

export const dynamic = 'force-dynamic';

const CreatePopSchema = z.object({
  name: z.string().min(1).max(255),
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Kode hanya boleh huruf, angka, - dan _'),
});

/** GET /api/pops — daftar semua POP beserta jumlah karyawan (super_admin saja). */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isSuperAdmin(session)) return forbiddenResponse();

    const rows = await db
      .select({
        id: pops.id,
        name: pops.name,
        code: pops.code,
        isActive: pops.isActive,
        createdAt: pops.createdAt,
        employeeCount: sql<number>`count(${user.id})::int`,
      })
      .from(pops)
      .leftJoin(user, eq(user.popId, pops.id))
      .groupBy(pops.id)
      .orderBy(asc(pops.name));

    return NextResponse.json({
      data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    });
  } catch (error) {
    console.error('GET /api/pops error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/** POST /api/pops — buat POP baru (super_admin saja). Admin pertamanya dibuat terpisah lewat POST /api/users. */
export async function POST(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isSuperAdmin(session)) return forbiddenResponse();

    const body = await req.json();
    const parsed = CreatePopSchema.safeParse(body);
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

    try {
      const [created] = await db
        .insert(pops)
        .values({ name: parsed.data.name, code: parsed.data.code })
        .returning();
      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { code: 'POP_ALREADY_EXISTS', message: 'Kode POP sudah dipakai', timestamp: new Date().toISOString() },
          { status: 409 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('POST /api/pops error:', error);
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan sistem', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
