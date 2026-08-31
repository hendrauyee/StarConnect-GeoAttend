import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { stockCategories, stockItems, stockMovements, user } from '@/lib/db/schema';
import type {
  StockItemResponse,
  StockMovementResponse,
  StockOverviewResponse,
  StockStatus,
} from '@/types/api';

/**
 * Delta stok dari buku besar: masuk (+), keluar (−), adjust (± sesuai tanda quantity).
 * Dipakai sebagai agregat SUM di banyak query.
 */
const DELTA_SQL = sql<number>`sum(case when ${stockMovements.type} = 'masuk' then ${stockMovements.quantity} when ${stockMovements.type} = 'keluar' then -${stockMovements.quantity} else ${stockMovements.quantity} end)`;

export function computeStatus(currentStock: number, minStock: number): StockStatus {
  if (currentStock <= 0) return 'habis';
  if (currentStock <= minStock) return 'menipis';
  return 'aman';
}

type ItemRow = {
  item: typeof stockItems.$inferSelect;
  categoryName: string | null;
  delta: number | string | null;
  lastAt: Date | string | null;
};

function toItemResponse(row: ItemRow): StockItemResponse {
  const { item } = row;
  const currentStock = item.openingStock + Number(row.delta ?? 0);
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    categoryId: item.categoryId,
    categoryName: row.categoryName,
    unit: item.unit,
    photoUrl: item.photoUrl,
    openingStock: item.openingStock,
    minStock: item.minStock,
    currentStock,
    status: computeStatus(currentStock, item.minStock),
    isActive: item.isActive,
    lastMovementAt: row.lastAt ? new Date(row.lastAt).toISOString() : null,
    createdAt: item.createdAt.toISOString(),
  };
}

export interface StockItemQuery {
  id?: string;
  popId: string;
  activeOnly?: boolean;
  categoryId?: string;
  search?: string;
}

/** Daftar barang beserta stok berjalan (terhitung), diurut per kategori lalu nama. */
export async function getStockItems(opts: StockItemQuery): Promise<StockItemResponse[]> {
  const mv = db
    .select({
      itemId: stockMovements.itemId,
      delta: DELTA_SQL.as('delta'),
      lastAt: sql<Date>`max(${stockMovements.createdAt})`.as('last_at'),
    })
    .from(stockMovements)
    .groupBy(stockMovements.itemId)
    .as('mv');

  const conditions = [eq(stockItems.popId, opts.popId)];
  if (opts.id) conditions.push(eq(stockItems.id, opts.id));
  if (opts.activeOnly) conditions.push(eq(stockItems.isActive, true));
  if (opts.categoryId) conditions.push(eq(stockItems.categoryId, opts.categoryId));
  if (opts.search) {
    const q = `%${opts.search}%`;
    conditions.push(or(ilike(stockItems.name, q), ilike(stockItems.code, q))!);
  }

  const rows = await db
    .select({
      item: stockItems,
      categoryName: stockCategories.name,
      delta: mv.delta,
      lastAt: mv.lastAt,
    })
    .from(stockItems)
    .leftJoin(stockCategories, eq(stockItems.categoryId, stockCategories.id))
    .leftJoin(mv, eq(mv.itemId, stockItems.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(stockCategories.sortOrder, stockItems.name);

  return rows.map(toItemResponse);
}

/** Satu barang beserta stok berjalan. `null` bila tidak ada / bukan milik POP ini. */
export async function getStockItemById(id: string, popId: string): Promise<StockItemResponse | null> {
  const [item] = await getStockItems({ id, popId });
  return item ?? null;
}

/** Stok berjalan satu barang. `null` bila barang tidak ada / bukan milik POP ini. */
export async function getItemCurrentStock(itemId: string, popId: string): Promise<number | null> {
  const [row] = await db
    .select({ opening: stockItems.openingStock, delta: DELTA_SQL })
    .from(stockItems)
    .leftJoin(stockMovements, eq(stockMovements.itemId, stockItems.id))
    .where(and(eq(stockItems.id, itemId), eq(stockItems.popId, popId)))
    .groupBy(stockItems.id);

  if (!row) return null;
  return row.opening + Number(row.delta ?? 0);
}

type MovementRow = {
  mv: typeof stockMovements.$inferSelect;
  itemCode: string | null;
  itemName: string | null;
  byName: string | null;
};

export function toMovementResponse(row: MovementRow): StockMovementResponse {
  const { mv } = row;
  return {
    id: mv.id,
    itemId: mv.itemId,
    itemCode: row.itemCode ?? '—',
    itemName: row.itemName ?? 'Barang terhapus',
    type: mv.type as StockMovementResponse['type'],
    quantity: mv.quantity,
    photoUrl: mv.photoUrl,
    note: mv.note,
    createdByName: row.byName,
    createdAt: mv.createdAt.toISOString(),
  };
}

export interface MovementQuery {
  popId: string;
  itemId?: string;
  type?: string;
  from?: string; // yyyy-MM-dd
  to?: string; // yyyy-MM-dd
  page?: number;
  limit?: number;
}

export async function getStockMovements(
  opts: MovementQuery
): Promise<{ data: StockMovementResponse[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));

  const conditions = [eq(stockMovements.popId, opts.popId)];
  if (opts.itemId) conditions.push(eq(stockMovements.itemId, opts.itemId));
  if (opts.type) conditions.push(eq(stockMovements.type, opts.type));
  if (opts.from) conditions.push(gte(stockMovements.createdAt, new Date(`${opts.from}T00:00:00`)));
  if (opts.to) conditions.push(lte(stockMovements.createdAt, new Date(`${opts.to}T23:59:59.999`)));
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      mv: stockMovements,
      itemCode: stockItems.code,
      itemName: stockItems.name,
      byName: user.name,
    })
    .from(stockMovements)
    .leftJoin(stockItems, eq(stockMovements.itemId, stockItems.id))
    .leftJoin(user, eq(stockMovements.createdBy, user.id))
    .where(where)
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockMovements)
    .where(where);

  return { data: rows.map(toMovementResponse), total: Number(count) };
}

/** Ringkasan untuk halaman Overview. `from`/`to` membatasi total masuk/keluar. */
export async function getStockOverview(
  popId: string,
  from: string,
  to: string
): Promise<StockOverviewResponse> {
  const items = await getStockItems({ popId, activeOnly: true });

  const totalItems = items.length;
  const totalStock = items.reduce((s, i) => s + i.currentStock, 0);
  const outOfStockCount = items.filter((i) => i.status === 'habis').length;
  const lowStockCount = items.filter((i) => i.status === 'menipis').length;
  const lowStockItems = items
    .filter((i) => i.status !== 'aman')
    .sort((a, b) => a.currentStock - b.currentStock)
    .slice(0, 20);

  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T23:59:59.999`);
  const [flow] = await db
    .select({
      totalIn: sql<number>`coalesce(sum(${stockMovements.quantity}) filter (where ${stockMovements.type} = 'masuk'), 0)::int`,
      totalOut: sql<number>`coalesce(sum(${stockMovements.quantity}) filter (where ${stockMovements.type} = 'keluar'), 0)::int`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.popId, popId),
        gte(stockMovements.createdAt, fromDate),
        lte(stockMovements.createdAt, toDate)
      )
    );

  const recentRows = await db
    .select({
      mv: stockMovements,
      itemCode: stockItems.code,
      itemName: stockItems.name,
      byName: user.name,
    })
    .from(stockMovements)
    .leftJoin(stockItems, eq(stockMovements.itemId, stockItems.id))
    .leftJoin(user, eq(stockMovements.createdBy, user.id))
    .where(eq(stockMovements.popId, popId))
    .orderBy(desc(stockMovements.createdAt))
    .limit(10);

  return {
    totalItems,
    totalStock,
    totalIn: Number(flow?.totalIn ?? 0),
    totalOut: Number(flow?.totalOut ?? 0),
    lowStockCount,
    outOfStockCount,
    period: { from, to },
    recentMovements: recentRows.map(toMovementResponse),
    lowStockItems,
  };
}
