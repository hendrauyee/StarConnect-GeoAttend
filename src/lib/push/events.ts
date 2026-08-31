import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
import {
  dispatchPush,
  sendPushToAdministrators,
  sendPushToUsers,
  type PushResult,
} from '@/lib/push';
import { getLeaveTypeLabel } from '@/lib/leaves';

/**
 * Susunan kalimat tiap notifikasi, terkumpul di satu berkas.
 *
 * Semua teks dirakit di server supaya kata-katanya bisa diubah lewat deploy web
 * biasa — app mobile tidak punya OTA, jadi apa pun yang ditulis di sisi klien
 * baru berubah setelah karyawan memasang APK baru.
 *
 * Field `data` dipakai app untuk membuka layar yang tepat saat notifikasi
 * disentuh. Nilainya harus string semua (payload FCM tidak menerima nested).
 */

const BULAN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

/**
 * "2026-08-12" → "12 Agu 2026". Diurai manual dari string, bukan lewat `Date`:
 * proses server berjalan pada TZ=UTC dan tanggal ini adalah tanggal WIB, jadi
 * membungkusnya jadi `Date` cuma menambah peluang meleset sehari.
 */
function formatTanggal(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const bulan = BULAN[Number(month) - 1];
  if (!bulan) return isoDate;
  return `${Number(day)} ${bulan} ${year}`;
}

/** "12 Agu 2026" atau "12–14 Agu 2026" bila rentangnya lebih dari sehari. */
function formatRentang(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatTanggal(startDate);
  return `${formatTanggal(startDate)} – ${formatTanggal(endDate)}`;
}

/**
 * Pengajuan izin/cuti baru masuk dan menunggu keputusan administrator.
 *
 * Tidak dipanggil untuk `type: 'libur'` — penanda libur langsung berstatus
 * `approved` (self-service), tidak ada yang perlu diputuskan.
 */
export function notifyAdminLeaveSubmitted(input: {
  requesterId: string;
  requesterPopId: string;
  requesterName: string;
  type: string;
  startDate: string;
  endDate: string;
  leaveId: string;
}): void {
  dispatchPush(
    () =>
      sendPushToAdministrators(
        {
          title: `Pengajuan ${getLeaveTypeLabel(input.type)} baru`,
          body: `${input.requesterName} — ${formatRentang(input.startDate, input.endDate)}. Menunggu persetujuan.`,
          data: { kind: 'leave_request', id: input.leaveId },
        },
        { popId: input.requesterPopId, exceptUserId: input.requesterId }
      ),
    `notifikasi izin baru (${input.leaveId})`
  );
}

/**
 * Hasil keputusan atas pengajuan izin/cuti, dikirim ke pengaju.
 *
 * Catatan penolakan ikut disertakan bila ada — tanpa itu pengaju hanya tahu
 * "ditolak" dan tetap harus membuka app untuk mencari sebabnya.
 */
export function notifyRequesterLeaveReviewed(input: {
  requesterId: string;
  type: string;
  startDate: string;
  endDate: string;
  approved: boolean;
  reviewNote: string | null;
  leaveId: string;
}): void {
  const label = getLeaveTypeLabel(input.type);
  const rentang = formatRentang(input.startDate, input.endDate);

  dispatchPush(
    () =>
      sendPushToUsers([input.requesterId], {
        title: input.approved ? `${label} disetujui` : `${label} ditolak`,
        body: input.approved
          ? `${rentang} — pengajuan Anda disetujui administrator.`
          : `${rentang} — ${input.reviewNote ?? 'ditolak administrator.'}`,
        data: { kind: 'leave_result', id: input.leaveId },
      }),
    `notifikasi hasil izin (${input.leaveId})`
  );
}

/**
 * Rekan tujuan menolak permintaan tukar — pengaju diberi tahu.
 *
 * Ini akhir dari alurnya: pengajuan langsung berstatus `rejected` tanpa pernah
 * sampai ke administrator, jadi kalau pengaju tidak diberi tahu di sini, tidak
 * ada lagi kesempatan lain.
 */
export function notifyRequesterSwapPeerRejected(input: {
  requesterId: string;
  targetName: string;
  kind: string;
  date: string;
  targetDate: string | null;
  reviewNote: string | null;
  swapId: string;
}): void {
  const isLibur = input.kind === 'libur';
  const tanggal =
    isLibur && input.targetDate
      ? `${formatTanggal(input.date)} ↔ ${formatTanggal(input.targetDate)}`
      : formatTanggal(input.date);

  dispatchPush(
    () =>
      sendPushToUsers([input.requesterId], {
        title: isLibur ? 'Tukar libur ditolak rekan' : 'Tukar shift ditolak rekan',
        body: `${input.targetName} menolak — ${tanggal}${input.reviewNote ? `. ${input.reviewNote}` : '.'}`,
        data: { kind: 'swap_result', id: input.swapId },
      }),
    `notifikasi penolakan rekan (${input.swapId})`
  );
}

/**
 * Keputusan administrator atas tukar shift/libur — dikirim ke **kedua** pihak.
 *
 * Rekan ikut diberi tahu, bukan hanya pengaju: kalau disetujui, jadwal rekan
 * ikut berubah. Orang yang jadwalnya berpindah wajib tahu tanpa harus memeriksa
 * sendiri.
 */
export function notifyPartiesSwapReviewed(input: {
  requesterId: string;
  targetId: string;
  approved: boolean;
  kind: string;
  date: string;
  targetDate: string | null;
  reviewNote: string | null;
  swapId: string;
}): void {
  const isLibur = input.kind === 'libur';
  const jenis = isLibur ? 'Tukar libur' : 'Tukar shift';
  const tanggal =
    isLibur && input.targetDate
      ? `${formatTanggal(input.date)} ↔ ${formatTanggal(input.targetDate)}`
      : formatTanggal(input.date);

  dispatchPush(
    () =>
      sendPushToUsers([input.requesterId, input.targetId], {
        title: input.approved ? `${jenis} disetujui` : `${jenis} ditolak`,
        body: input.approved
          ? `${tanggal} — jadwal sudah diperbarui.`
          : `${tanggal} — ${input.reviewNote ?? 'ditolak administrator.'}`,
        data: { kind: 'swap_result', id: input.swapId },
      }),
    `notifikasi hasil tukar (${input.swapId})`
  );
}

/**
 * Rekan tujuan diminta menyetujui tukar shift / tukar libur.
 *
 * Ini pemberitahuan ke SATU orang, bukan ke administrator. Alur tukar berhenti
 * total menunggu rekan menekan setuju — tanpa notifikasi, satu-satunya cara dia
 * tahu adalah kebetulan membuka layar Jadwal.
 */
export function notifyPeerSwapRequested(input: {
  requesterName: string;
  targetId: string;
  kind: string;
  date: string;
  targetDate: string | null;
  requesterShift: string;
  targetShift: string;
  swapId: string;
}): void {
  const isLibur = input.kind === 'libur';
  const tanggal =
    isLibur && input.targetDate
      ? `${formatTanggal(input.date)} ↔ ${formatTanggal(input.targetDate)}`
      : formatTanggal(input.date);

  dispatchPush(
    () =>
      sendPushToUsers([input.targetId], {
        title: isLibur ? 'Permintaan tukar hari libur' : 'Permintaan tukar shift',
        body: `${input.requesterName} mengajak tukar — ${tanggal}. Menunggu persetujuan Anda.`,
        data: { kind: 'swap_peer', id: input.swapId },
      }),
    `notifikasi permintaan tukar ke rekan (${input.swapId})`
  );
}

/**
 * Pengajuan tukar naik ke meja administrator.
 *
 * Sengaja BUKAN saat pengajuan dibuat: alurnya dua tahap (`pending_peer` →
 * rekan setuju → `pending_admin`). Kalau dikirim sejak awal, administrator
 * dapat notifikasi untuk sesuatu yang bisa saja ditolak rekan dan tidak pernah
 * sampai ke mejanya.
 */
export function notifyAdminSwapAwaitingReview(input: {
  requesterId: string;
  requesterPopId: string;
  targetId: string;
  kind: string;
  date: string;
  targetDate: string | null;
  swapId: string;
}): void {
  const isLibur = input.kind === 'libur';
  const tanggal =
    isLibur && input.targetDate
      ? `${formatTanggal(input.date)} ↔ ${formatTanggal(input.targetDate)}`
      : formatTanggal(input.date);

  dispatchPush(async () => {
    // Nama diambil di dalam task, bukan di route: pencarian ini tidak boleh
    // menambah waktu tunggu respons rekan yang baru menekan "setuju".
    const rows = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [input.requesterId, input.targetId]));

    const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? 'Pengguna terhapus';

    return sendPushToAdministrators(
      {
        title: isLibur ? 'Tukar hari libur menunggu persetujuan' : 'Tukar shift menunggu persetujuan',
        body: `${nameOf(input.requesterId)} ↔ ${nameOf(input.targetId)} — ${tanggal}. Rekan sudah setuju.`,
        data: { kind: 'shift_swap', id: input.swapId },
      },
      { popId: input.requesterPopId }
    );
  }, `notifikasi tukar shift (${input.swapId})`);
}

/**
 * Pengingat "shift mulai sebentar lagi", dikirim ke satu karyawan.
 *
 * Berbeda dari notifikasi lain di berkas ini: mengembalikan Promise dan TIDAK
 * memakai [[dispatchPush]]. Pemanggilnya bukan API route yang harus balas
 * cepat, melainkan proses terjadwal yang keburu mati sebelum pengiriman selesai
 * kalau hasilnya tidak ditunggu.
 *
 * Sisa menit ditulis apa adanya, bukan dipatok "15 menit": pemeriksa berjalan
 * per beberapa menit sehingga pengiriman nyata bisa jatuh di menit ke-13 atau
 * ke-11, dan angka yang tidak cocok dengan jam di layar HP bikin karyawan
 * ragu pada jam shiftnya sendiri.
 */
export function notifyShiftStartingSoon(input: {
  userId: string;
  shiftNumber: number;
  startTime: string;
  minutesUntilStart: number;
  /** Role-nya cuma punya satu shift kerja — menyebut nomornya cuma bikin bingung. */
  soleShift: boolean;
}): Promise<PushResult> {
  const label = input.soleShift ? 'Shift' : `Shift ${input.shiftNumber}`;

  return sendPushToUsers([input.userId], {
    title: `${label} mulai ${input.startTime}`,
    body: `${input.minutesUntilStart} menit lagi. Jangan lupa absen masuk setibanya di lokasi.`,
    data: { kind: 'shift_reminder', shift: String(input.shiftNumber) },
  });
}
