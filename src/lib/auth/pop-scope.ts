import { NextResponse } from 'next/server';
import type { Session } from './index';
import { forbiddenResponse } from './utils';

export type PopScope = { popId: string } | { popId: null };

/**
 * Menentukan popId yang berlaku untuk request ini.
 * - administrator/employee/dst: SELALU popId milik akun sendiri — tidak bisa
 *   dioverride lewat query param (mencegah IDOR lintas-POP).
 * - super_admin: popId dari query param `?popId=` bila super_admin sedang
 *   "masuk" ke satu POP tertentu (lewat POP switcher); tanpa param, popId
 *   null (mode global — hanya untuk endpoint yang eksplisit mendukung itu,
 *   mis. GET /api/pops).
 */
export function resolvePopScope(
  session: Session,
  req: Request
): PopScope | { error: NextResponse } {
  if (session.user.role === 'super_admin') {
    const url = new URL(req.url);
    const popId = url.searchParams.get('popId');
    return popId ? { popId } : { popId: null };
  }
  if (!session.user.popId) {
    return { error: forbiddenResponse() };
  }
  return { popId: session.user.popId };
}
