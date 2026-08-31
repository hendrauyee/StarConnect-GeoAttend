import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth, type Session } from './index';

/** Ambil session di Server Component / Server Action. */
export async function getServerSession(): Promise<Session | null> {
  return auth.api.getSession({ headers: headers() });
}

/** Ambil session dari Request di API route. */
export async function getApiSession(req: Request): Promise<Session | null> {
  return auth.api.getSession({ headers: req.headers });
}

export function unauthorizedResponse() {
  return NextResponse.json(
    {
      code: 'UNAUTHORIZED',
      message: 'Silakan login terlebih dahulu',
      timestamp: new Date().toISOString(),
    },
    { status: 401 }
  );
}

export function forbiddenResponse() {
  return NextResponse.json(
    {
      code: 'FORBIDDEN',
      message: 'Anda tidak memiliki akses untuk melakukan aksi ini',
      timestamp: new Date().toISOString(),
    },
    { status: 403 }
  );
}

export function badRequestResponse(message: string) {
  return NextResponse.json(
    { code: 'VALIDATION_ERROR', message, timestamp: new Date().toISOString() },
    { status: 400 }
  );
}

/**
 * Administrator = pengelola sistem SATU POP (akses penuh panel admin POP-nya),
 * ATAU super_admin (akses lintas-POP). Role 'admin' adalah role KERJA (staf
 * administrasi dengan SOP shift), bukan pengelola sistem — jangan tertukar.
 */
export function isAdmin(session: Session | null): boolean {
  return session?.user.role === 'administrator' || session?.user.role === 'super_admin';
}

/** super_admin = pengelola lintas-POP: membuat POP baru & admin pertamanya. */
export function isSuperAdmin(session: Session | null): boolean {
  return session?.user.role === 'super_admin';
}
