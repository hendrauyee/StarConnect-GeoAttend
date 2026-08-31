import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  ApiRequestError,
  loadApiState,
  setServerUrl,
  setToken,
  getToken,
} from '../api/client';
import type { SessionUser } from '../api/types';
import { stopTracking } from '../tracking/locationTask';
import { registerPushToken, unregisterPushToken } from '../push/registration';

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  /** Kode dari administrator — divalidasi di server (hook Better Auth). */
  registrationCode: string;
}

interface SessionContextValue {
  user: SessionUser | null;
  initializing: boolean;
  signIn: (serverUrl: string, email: string, password: string) => Promise<void>;
  signUp: (serverUrl: string, input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface GetSessionResponse {
  session: { id: string } | null;
  user: SessionUser | null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const data = await api<GetSessionResponse | null>('/api/auth/get-session');
      setUser(data?.user ?? null);
      if (!data?.user) await setToken(null);
      // Tanpa await: token push tidak boleh menahan tampilnya layar utama.
      // Aman dipanggil berulang — endpoint server bersifat upsert.
      else void registerPushToken();
    } catch (err) {
      // Token kedaluwarsa/dicabut → paksa login ulang; error jaringan → biarkan
      if (err instanceof ApiRequestError && err.status === 401) {
        await setToken(null);
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadApiState();
      await refresh();
      setInitializing(false);
    })();
  }, [refresh]);

  /**
   * Kirim kredensial ke endpoint auth lalu simpan token sesi.
   * Dipakai bersama oleh sign-in & sign-up (keduanya mengembalikan sesi
   * karena `autoSignIn` aktif di server).
   */
  const authenticate = useCallback(
    async (serverUrl: string, path: string, payload: Record<string, string>) => {
      await setServerUrl(serverUrl);
      await setToken(null);

      const res = await api<{ token?: string; user?: SessionUser }>(path, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Token dari header set-auth-token sudah disimpan oleh api();
      // fallback: sebagian versi Better Auth juga menaruhnya di body.
      if (!getToken() && res.token) {
        await setToken(res.token);
      }
      if (!getToken()) {
        throw new ApiRequestError(
          'Berhasil tapi token tidak diterima — pastikan server versi terbaru.',
          500
        );
      }
      // Akun Admin Gudang hanya untuk web stok.serayu.id — tolak di mobile.
      if (res.user?.role === 'gudang') {
        await setToken(null);
        throw new ApiRequestError(
          'Akun Admin Gudang hanya bisa dipakai di web stok.serayu.id, bukan aplikasi mobile.',
          403,
          'WAREHOUSE_WEB_ONLY'
        );
      }
      await refresh();
    },
    [refresh]
  );

  const signIn = useCallback(
    (serverUrl: string, email: string, password: string) =>
      authenticate(serverUrl, '/api/auth/sign-in/email', { email, password }),
    [authenticate]
  );

  const signUp = useCallback(
    (serverUrl: string, input: SignUpInput) =>
      authenticate(serverUrl, '/api/auth/sign-up/email', {
        name: input.name.trim(),
        email: input.email.trim(),
        password: input.password,
        registrationCode: input.registrationCode.trim(),
      }),
    [authenticate]
  );

  const signOut = useCallback(async () => {
    await stopTracking().catch(() => undefined);
    // Dicabut SEBELUM token sesi dihapus — endpoint pencabutan butuh
    // autentikasi. Kalau dilewati, HP ini terus menerima notifikasi milik
    // pengguna yang baru saja keluar.
    await unregisterPushToken();
    await api('/api/auth/sign-out', { method: 'POST', body: '{}' }).catch(() => undefined);
    await setToken(null);
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, initializing, signIn, signUp, signOut, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession harus dipakai di dalam SessionProvider');
  return ctx;
}
