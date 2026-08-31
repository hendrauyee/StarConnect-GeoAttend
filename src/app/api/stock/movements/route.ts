import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { stockItems, stockMovements } from '@/lib/db/schema';
import { getApiSession, unauthorizedResponse, badRequestResponse } from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { getItemCurrentStock, getStockMovements, toMovementResponse } from '@/lib/stock';
import { saveStockPhoto } from '@/lib/storage/local-fs';
import { CreateStockMovementSchema, type PaginatedResponse, type StockMovementResponse } from '@/types/api';
import { errorJson, internalError, validationError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stock/movements
 * Query: ?itemId=&type=masuk|keluar|adjust&from=yyyy-MM-dd&to=yyyy-MM-dd&page=&limit=
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const p = req.nextUrl.searchParams;
    const limit = Math.min(200, Math.max(1, Number(p.get('limit') ?? 50)));
    const page = Math.max(1, Number(p.get('page') ?? 1));

    const { data, total } = await getStockMovements({
      popId: scope.popId,
      itemId: p.get('itemId') ?? undefined,
      type: p.get('type') ?? undefined,
      from: p.get('from') ?? undefined,
      to: p.get('to') ?? undefined,
      page,
      limit,
    });

    const response: PaginatedResponse<StockMovementResponse> = {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
    return NextResponse.json(response);
  } catch (error) {
    return internalError(error, 'GET /api/stock/movements');
  }
}

/** POST /api/stock/movements — catat barang masuk/keluar/penyesuaian (+ foto). */
export async function POST(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');
    const popId = scope.popId;

    const parsed = CreateStockMovementSchema.safeParse(await req.json());
    if (!parsed.success) return validationError(parsed.error.flatten());
    const input = parsed.data;

    const [item] = await db
      .select({ id: stockItems.id, code: stockItems.code, name: stockItems.name })
      .from(stockItems)
      .where(and(eq(stockItems.id, input.itemId), eq(stockItems.popId, popId)))
      .limit(1);
    if (!item) return errorJson('NOT_FOUND', 'Barang tidak ditemukan', 404);

    // Barang keluar tidak boleh melebihi stok yang tersedia
    if (input.type === 'keluar') {
      const current = (await getItemCurrentStock(input.itemId, popId)) ?? 0;
      if (input.quantity > current) {
        return errorJson('STOCK_INSUFFICIENT', `Stok tidak cukup (tersisa ${current})`, 422, {
          currentStock: current,
        });
      }
    }

    const photoUrl = input.photoBase64 ? await saveStockPhoto(input.photoBase64) : null;

    const [mv] = await db
      .insert(stockMovements)
      .values({
        popId,
        itemId: input.itemId,
        type: input.type,
        quantity: input.quantity,
        note: input.note?.trim() || null,
        photoUrl,
        createdBy: session.user.id,
      })
      .returning();

    return NextResponse.json(
      toMovementResponse({
        mv,
        itemCode: item.code,
        itemName: item.name,
        byName: session.user.name,
      }),
      { status: 201 }
    );
  } catch (error) {
    return internalError(error, 'POST /api/stock/movements');
  }
}
