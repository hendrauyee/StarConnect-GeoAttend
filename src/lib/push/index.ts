import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pushTokens, user } from '@/lib/db/schema';

/**
 * Lapisan transport push notification (Expo Push Service).
 *
 * Isi pesan dirakit di SERVER, bukan di app — app mobile tidak punya OTA, jadi
 * kalau teks notifikasi ditentukan di sisi klien setiap perubahan kata butuh
 * APK baru. Lihat [[src/lib/push/events.ts]] untuk susunan kalimatnya.
 *
 * Kredensial FCM tidak ada di sini: service account key tersimpan di EAS, dan
 * Expo yang bicara ke FCM atas nama aplikasi. Server cukup tahu Expo push token.
 */

export type PushPayload = {
  /**
   * Opsional. Tanpa judul, Android memakai nama aplikasi sebagai kepala
   * notifikasi — lebih rapi untuk pengumuman satu kalimat daripada judul
   * karangan yang mengulang isinya.
   */
  title?: string;
  body: string;
  /** Dibaca app untuk membuka layar yang tepat saat notifikasi disentuh. */
  data?: Record<string, string>;
};

export type PushResult = {
  /** Jumlah notifikasi yang diterima Expo untuk dikirim. */
  sent: number;
  /** Token mati yang dibersihkan dari basis data pada percobaan ini. */
  removed: number;
};

/**
 * `EXPO_ACCESS_TOKEN` opsional. Tanpa itu push tetap jalan, tapi siapa pun yang
 * tahu token perangkat bisa mengirim notifikasi ke HP karyawan. Setelah fitur
 * ini dipakai produksi, buat token di expo.dev → Access tokens dan aktifkan
 * "Enhanced Security for Push Notifications".
 */
const expo = new Expo(
  process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : {}
);

async function forgetTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.delete(pushTokens).where(inArray(pushTokens.token, tokens));
}

/**
 * Kirim satu pesan ke seluruh perangkat milik `userIds`.
 *
 * Tidak pernah melempar untuk kegagalan pengiriman: satu chunk yang gagal
 * dicatat lalu dilewati, chunk berikutnya tetap dicoba. Pemanggil di API route
 * WAJIB memakai [[dispatchPush]] supaya kegagalan push tidak pernah membatalkan
 * aksi yang sebenarnya (pengajuan izin harus tetap tersimpan meski Expo down).
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<PushResult> {
  const targets = Array.from(new Set(userIds)).filter(Boolean);
  if (targets.length === 0) return { sent: 0, removed: 0 };

  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(inArray(pushTokens.userId, targets));

  const valid: string[] = [];
  const stale: string[] = [];
  for (const row of rows) {
    if (Expo.isExpoPushToken(row.token)) valid.push(row.token);
    else stale.push(row.token);
  }

  if (valid.length === 0) {
    await forgetTokens(stale);
    return { sent: 0, removed: stale.length };
  }

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data,
  }));

  let sent = 0;
  for (const chunk of expo.chunkPushNotifications(messages)) {
    let tickets: ExpoPushTicket[];
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      console.error('[push] satu chunk gagal dikirim:', error);
      continue;
    }

    // Tiket sejajar indeks dengan pesan dalam chunk. Aman karena tiap pesan di
    // sini punya satu `to` berupa string — bukan array yang bisa dipecah SDK.
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'ok') {
        sent += 1;
        return;
      }
      const token = chunk[i]?.to as string | undefined;
      console.warn(`[push] ditolak (${ticket.details?.error ?? 'tanpa kode'}): ${ticket.message}`);
      if (ticket.details?.error === 'DeviceNotRegistered' && token) stale.push(token);
    });
  }

  await forgetTokens(stale);
  return { sent, removed: stale.length };
}

/**
 * Kirim ke semua pengelola sistem (role `administrator`) SATU POP, bukan role
 * kerja `admin` — lihat catatan di [[src/lib/auth/utils.ts]] `isAdmin`.
 *
 * `popId` WAJIB diisi agar notifikasi tidak bocor lintas-POP (administrator
 * POP lain tidak perlu tahu pengajuan izin/lembur/swap POP lain).
 * `exceptUserId` dipakai agar administrator yang mengajukan sesuatu untuk
 * dirinya sendiri tidak menerima notifikasi tentang aksinya sendiri.
 */
export async function sendPushToAdministrators(
  payload: PushPayload,
  options: { popId: string; exceptUserId?: string }
): Promise<PushResult> {
  const conditions = [eq(user.role, 'administrator'), eq(user.popId, options.popId)];
  if (options.exceptUserId) conditions.push(ne(user.id, options.exceptUserId));

  const admins = await db
    .select({ id: user.id })
    .from(user)
    .where(and(...conditions));

  return sendPushToUsers(
    admins.map((a) => a.id),
    payload
  );
}

/**
 * Jalankan pengiriman tanpa menahan respons API dan tanpa pernah melempar.
 *
 * Notifikasi adalah efek samping: kalau Expo lambat atau mati, pengajuan izin
 * tetap harus tersimpan dan HTTP 201 tetap harus balik cepat.
 */
export function dispatchPush(task: () => Promise<unknown>, context: string): void {
  try {
    void task().catch((error) => console.error(`[push] ${context}:`, error));
  } catch (error) {
    console.error(`[push] ${context}:`, error);
  }
}
