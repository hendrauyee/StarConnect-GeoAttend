import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** Alamat server default — server kantor. Bisa diganti di layar login. */
export const DEFAULT_SERVER_URL = 'https://absensi.serayu.id';

const SERVER_URL_KEY = 'geoattend_server_url';
const TOKEN_KEY = 'geoattend_auth_token';

let serverUrl: string = DEFAULT_SERVER_URL;
let token: string | null = null;
let loaded = false;

/** Muat alamat server + token tersimpan. Aman dipanggil berulang. */
export async function loadApiState(): Promise<void> {
  if (loaded) return;
  const [storedUrl, storedToken] = await Promise.all([
    AsyncStorage.getItem(SERVER_URL_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
  ]);
  if (storedUrl) serverUrl = storedUrl;
  token = storedToken;
  loaded = true;
}

export function getServerUrl(): string {
  return serverUrl;
}

/** Normalisasi + simpan alamat server (tambah https:// bila tanpa skema). */
export async function setServerUrl(url: string): Promise<string> {
  let normalized = url.trim().replace(/\/+$/, '');
  if (normalized && !/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  if (!normalized) normalized = DEFAULT_SERVER_URL;
  serverUrl = normalized;
  await AsyncStorage.setItem(SERVER_URL_KEY, normalized);
  return normalized;
}

export function getToken(): string | null {
  return token;
}

export async function setToken(value: string | null): Promise<void> {
  token = value;
  if (value) {
    await SecureStore.setItemAsync(TOKEN_KEY, value);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

/** Ubah path relatif dari server jadi URL absolut (null bila kosong). */
export function toAbsoluteUrl(path?: string | null): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : `${serverUrl}${path}`;
}

/** Header untuk <Image> — endpoint /api/uploads butuh bearer token. */
export function authImageHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${token ?? ''}` };
}

export class ApiRequestError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Fetch wrapper: base URL + bearer token + parsing error seragam.
 * Header `set-auth-token` dari Better Auth otomatis memperbarui token tersimpan.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  await loadApiState();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // React Native tidak mengirim header Origin otomatis (beda dengan browser) —
    // Better Auth menolak request tanpa Origin ("Missing or null Origin").
    Origin: serverUrl,
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${serverUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiRequestError(
      'Tidak dapat terhubung ke server. Periksa koneksi internet / alamat server.',
      0,
      'NETWORK_ERROR'
    );
  }

  const refreshed = res.headers.get('set-auth-token');
  if (refreshed && refreshed !== token) {
    await setToken(refreshed);
  }

  const body = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiRequestError(
      (body as { message?: string } | null)?.message ?? `Kesalahan server (${res.status})`,
      res.status,
      (body as { code?: string } | null)?.code
    );
  }

  return body as T;
}
