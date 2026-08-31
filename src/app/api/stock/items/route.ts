import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { stockItems } from '@/lib/db/schema';
import { forbiddenResponse, getApiSession, unauthorizedResponse, badRequestResponse } from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { isStockManager } from '@/lib/roles';
import { getStockItems, getStockItemById } from '@/lib/stock';
import { saveStockPhoto } from '@/lib/storage/local-fs';
import { CreateStockItemSchema } from '@/types/api';
import { errorJson, internalError, isUniqueViolation, validationError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stock/items
 * Query: ?categoryId=<uuid>&search=<teks>&includeInactive=1
 * Default hanya barang aktif. Stok berjalan sudah terhitung.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const params = req.nextUrl.searchParams;
    const data = await getStockItems({
      popId: scope.popId,
      activeOnly: params.get('includeInactive') !== '1',
      categoryId: params.get('categoryId') ?? undefined,
      search: params.get('search')?.trim() || undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return internalError(error, 'GET /api/stock/items');
  }
}

/** POST /api/stock/items — tambah barang (+ foto opsional). */
export async function POST(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();
    if (!isStockManager(session.user.role)) return forbiddenResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
    const popId = scope.popId;

    const parsed = CreateStockItemSchema.safeParse(await req.json());
    if (!parsed.success) return validationError(parsed.error.flatten());
    const input = parsed.data;

    const photoUrl = input.photoBase64 ? await saveStockPhoto(input.photoBase64) : null;

    try {
      const [row] = await db
        .insert(stockItems)
        .values({
          popId,
          code: input.code.trim(),
          name: input.name.trim(),
          categoryId: input.categoryId ?? null,
          unit: input.unit?.trim() || 'pcs',
          openingStock: input.openingStock ?? 0,
          minStock: input.minStock ?? 0,
          photoUrl,
        })
        .returning({ id: stockItems.id });

      const created = await getStockItemById(row.id, popId);
      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      if (isUniqueViolation(err)) return errorJson('DUPLICATE', 'Kode barang sudah dipakai', 409);
      throw err;
    }
  } catch (error) {
    return internalError(error, 'POST /api/stock/items');
  }
}
