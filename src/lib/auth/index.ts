import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { getRegistrationCode } from '@/lib/settings';

const SESSION_EXPIRY_DAYS = Number(process.env.SESSION_EXPIRY_DAYS ?? 7);

/**
 * Origin tambahan yang diizinkan mengakses endpoint auth (dipisah koma),
 * mis. domain Cloudflare Tunnel + http://localhost:3000 untuk akses lokal.
 */
const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  ...(trustedOrigins.length > 0 && { trustedOrigins }),
  secret: process.env.BETTER_AUTH_SECRET,
  // Bearer token untuk aplikasi mobile (header `set-auth-token` saat login,
  // lalu kirim `Authorization: Bearer <token>` di request berikutnya)
  plugins: [bearer()],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  hooks: {
    /**
     * Pendaftaran wajib menyertakan kode pendaftaran yang dibuat administrator
     * (Pengaturan → General). Validasi di server agar tidak bisa di-bypass.
     */
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return;

      // Bootstrap: akun PERTAMA (database kosong) boleh dibuat tanpa kode —
      // dipakai seed / instalasi baru. Setelah ada user, kode wajib.
      const anyUser = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
      if (anyUser.length === 0) return;

      const expected = await getRegistrationCode();
      if (!expected) {
        throw new APIError('FORBIDDEN', {
          message:
            'Pendaftaran ditutup. Hubungi administrator untuk mendapatkan kode pendaftaran.',
        });
      }

      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const provided =
        typeof body.registrationCode === 'string' ? body.registrationCode.trim() : '';
      if (provided !== expected) {
        throw new APIError('FORBIDDEN', {
          message: 'Kode pendaftaran salah. Minta kode yang benar dari administrator.',
        });
      }
    }),
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'employee',
        input: false, // role tidak boleh di-set dari form register
      },
      coverImage: {
        type: 'string',
        required: false,
        input: false, // di-set via endpoint /api/profile/cover
      },
      technicianTeam: {
        type: 'string',
        required: false,
        input: false, // di-set administrator dari halaman Jadwal
      },
      popId: {
        type: 'string',
        required: false,
        input: false, // NULL untuk super_admin; di-set server saat pembuatan user
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * SESSION_EXPIRY_DAYS,
    updateAge: 60 * 60 * 24, // sliding window: refresh setiap 1 hari aktivitas
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
  },
});

export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session['user'];
