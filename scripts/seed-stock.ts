/**
 * Seed data awal stok gudang dari CSV (scripts/data/stock-seed.csv).
 * `opening_stock` diambil dari kolom "stok_akhir" (stok nyata saat migrasi).
 * Idempotent: aman dijalankan ulang sebelum go-live — barang di-upsert per kode.
 *
 * Jalankan: npm run db:seed-stock
 * Override ambang menipis default: STOCK_DEFAULT_MIN=0 npm run db:seed-stock
 */
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import path from 'path';

config({ path: '.env.local' });

const CSV_PATH = path.resolve(__dirname, 'data/stock-seed.csv');
const DEFAULT_MIN_STOCK = Number(process.env.STOCK_DEFAULT_MIN ?? 5);
/** POP tujuan import — default POP yang dibuat scripts/seed.ts. */
const TARGET_POP_CODE = process.env.STOCK_SEED_POP_CODE ?? 'DEFAULT';

/** Parser CSV minimal: mendukung field ber-tanda-kutip yang memuat koma. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i];
      if (inQuotes) {
        if (ch === '"') {
          if (rawLine[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    rows.push(fields.map((f) => f.trim()));
  }
  return rows;
}

async function main() {
  const { db } = await import('../src/lib/db');
  const { stockCategories, stockItems, pops } = await import('../src/lib/db/schema');
  const { and, eq } = await import('drizzle-orm');

  const [targetPop] = await db
    .select({ id: pops.id })
    .from(pops)
    .where(eq(pops.code, TARGET_POP_CODE))
    .limit(1);
  if (!targetPop) {
    throw new Error(`POP dengan code "${TARGET_POP_CODE}" tidak ditemukan — jalankan npm run db:seed dulu`);
  }
  const popId = targetPop.id;

  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const header = rows.shift();
  if (!header || header[0] !== 'kategori') {
    throw new Error(`Format CSV tak dikenal (header: ${header?.join(',')})`);
  }

  // 1. Kategori (unik per POP, urutan sesuai kemunculan pertama di CSV)
  const categoryOrder: string[] = [];
  for (const [kategori] of rows) {
    if (!categoryOrder.includes(kategori)) categoryOrder.push(kategori);
  }

  const categoryIdByName = new Map<string, string>();
  for (let i = 0; i < categoryOrder.length; i++) {
    const name = categoryOrder[i];
    const existing = await db
      .select({ id: stockCategories.id })
      .from(stockCategories)
      .where(and(eq(stockCategories.popId, popId), eq(stockCategories.name, name)))
      .limit(1);

    if (existing.length > 0) {
      categoryIdByName.set(name, existing[0].id);
      await db
        .update(stockCategories)
        .set({ sortOrder: i })
        .where(eq(stockCategories.id, existing[0].id));
    } else {
      const [inserted] = await db
        .insert(stockCategories)
        .values({ popId, name, sortOrder: i })
        .returning({ id: stockCategories.id });
      categoryIdByName.set(name, inserted.id);
    }
  }
  console.log(`✔ ${categoryOrder.length} kategori disiapkan`);

  // 2. Barang — opening_stock = stok_akhir (kolom terakhir)
  let inserted = 0;
  let updated = 0;
  for (const cols of rows) {
    const [kategori, kode, nama, , , , stokAkhir] = cols;
    const categoryId = categoryIdByName.get(kategori) ?? null;
    const openingStock = Number(stokAkhir);
    if (Number.isNaN(openingStock)) {
      throw new Error(`Stok akhir bukan angka untuk ${kode}: "${stokAkhir}"`);
    }

    const existing = await db
      .select({ id: stockItems.id })
      .from(stockItems)
      .where(and(eq(stockItems.popId, popId), eq(stockItems.code, kode)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(stockItems)
        .set({ name: nama, categoryId, openingStock, updatedAt: new Date() })
        .where(eq(stockItems.id, existing[0].id));
      updated++;
    } else {
      await db.insert(stockItems).values({
        popId,
        code: kode,
        name: nama,
        categoryId,
        openingStock,
        minStock: DEFAULT_MIN_STOCK,
        unit: 'pcs',
      });
      inserted++;
    }
  }

  console.log(`✔ Barang: ${inserted} baru, ${updated} diperbarui (min stok default ${DEFAULT_MIN_STOCK})`);
  console.log('Seed stok selesai.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed stok gagal:', err);
  process.exit(1);
});
