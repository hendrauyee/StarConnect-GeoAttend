import { NextRequest, NextResponse } from 'next/server';
import { getApiSession, unauthorizedResponse, badRequestResponse } from '@/lib/auth/utils';
import { resolvePopScope } from '@/lib/auth/pop-scope';
import { getStockOverview } from '@/lib/stock';
import { appMonthStart, appToday } from '@/lib/time';
import { internalError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stock/overview?from=yyyy-MM-dd&to=yyyy-MM-dd
 * Ringkasan dashboard stok. Default periode = bulan berjalan.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getApiSession(req);
    if (!session) return unauthorizedResponse();

    const scope = resolvePopScope(session, req);
    if ('error' in scope) return scope.error;
    if (!scope.popId) return badRequestResponse('Pilih POP terlebih dahulu');

    const params = req.nextUrl.searchParams;
    const from = params.get('from') ?? appMonthStart();
    const to = params.get('to') ?? appToday();

    const overview = await getStockOverview(scope.popId, from, to);
    return NextResponse.json(overview);
  } catch (error) {
    return internalError(error, 'GET /api/stock/overview');
  }
}
