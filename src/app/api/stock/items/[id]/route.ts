import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { stockItems } from '@/lib/db/schema';
import { forbiddenResponse, getApiSession, unauthorizedResponse, badRequestResponse } from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { isStockManager } from '@/lib/roles';
import { getStockItemById } from '@/lib/stock';
import { saveStockPhoto } from '@/lib/storage/local-fs';
import { UpdateStockItemSchema } from '@/types/api';
import { errorJson, internalError, isUniqueViolation, validationError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** GET /api/stock/items/[id] — detail barang + stok berjalan. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const item = await getStockItemById(params.id, scope.popId);
    if (!item) return errorJson('NOT_FOUND', 'Barang tidak ditemukan', 404);
    return NextResponse.json(item);
  } catch (error) {
    return internalError(error, 'GET /api/stock/items/[id]');
  }
}

/** PATCH /api/stock/items/[id] — ubah barang (+ ganti foto opsional). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isStockManager(session.user.role)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
    const popId = scope.popId;

    const parsed = UpdateStockItemSchema.safeParse(await req.json());
    if (!parsed.success) return validationError(parsed.error.flatten());
    const input = parsed.data;

    const existing = await getStockItemById(params.id, popId);
    if (!existing) return errorJson('NOT_FOUND', 'Barang tidak ditemukan', 404);

    const patch: Partial<typeof stockItems.$inferInsert> = { updatedAt: new Date() };
    if (input.code !== undefined) patch.code = input.code.trim();
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.unit !== undefined) patch.unit = input.unit.trim();
    if (input.openingStock !== undefined) patch.openingStock = input.openingStock;
    if (input.minStock !== undefined) patch.minStock = input.minStock;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.photoBase64) patch.photoUrl = await saveStockPhoto(input.photoBase64);

    try {
      await db.update(stockItems).set(patch).where(eq(stockItems.id, params.id));
    } catch (err) {
      if (isUniqueViolation(err)) return errorJson('DUPLICATE', 'Kode barang sudah dipakai', 409);
      throw err;
    }

    return NextResponse.json(await getStockItemById(params.id, popId));
  } catch (error) {
    return internalError(error, 'PATCH /api/stock/items/[id]');
  }
}

/**
 * DELETE /api/stock/items/[id] — nonaktifkan barang (soft delete).
 * Riwayat pergerakan tetap tersimpan.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isStockManager(session.user.role)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const existing = await getStockItemById(params.id, scope.popId);
    if (!existing) return errorJson('NOT_FOUND', 'Barang tidak ditemukan', 404);

    await db
      .update(stockItems)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(stockItems.id, params.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    return internalError(error, 'DELETE /api/stock/items/[id]');
  }
}
