import type { RecapResponse, RecapRow } from '../api/types';

/**
 * Penyajian rekap absensi bulanan di aplikasi.
 *
 * Angkanya TIDAK dihitung ulang di sini — semuanya datang jadi dari
 * GET /api/reports/recap, yang memakai modul perhitungan yang sama dengan
 * halaman Rekap Bulanan web. Modul ini hanya soal format & tata letak PDF.
 */

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const ROLE_LABELS: Record<string, string> = {
  administrator: 'Administrator',
  admin: 'Admin (Staf)',
  noc: 'NOC',
  teknisi: 'Teknisi',
  employee: 'Karyawan',
};

const LEAVE_LABELS: Record<string, string> = {
  sakit: 'Sakit',
  izin: 'Izin',
  cuti: 'Cuti',
  telat: 'Telat',
  siang: 'Masuk Siang',
  remote: 'Kerja Remote',
  libur: 'Libur',
};

/** 90 → "1j 30m", 45 → "45m", 0 → "-" (samakan dengan web). */
export function formatMinutes(total: number): string {
  if (total <= 0) return '-';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}j`;
  return `${hours}j ${minutes}m`;
}

/** Sama seperti formatMinutes, tapi 0 tetap "0m" — untuk kartu statistik. */
export function formatMinutesCompact(total: number): string {
  if (total <= 0) return '0m';
  return formatMinutes(total);
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** "2026-08" → "Agustus 2026". */
export function monthTitle(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return `${MONTH_NAMES[mon - 1]} ${year}`;
}

/** "2026-08-01" → "01 Agu 2026". */
function longDate(date: string): string {
  const [year, mon, day] = date.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTH_NAMES[mon - 1].slice(0, 3)} ${year}`;
}

function keterangan(row: RecapRow): string {
  if (row.kind === 'lembur') return 'Lembur Urgent';
  if (row.leaveType) return LEAVE_LABELS[row.leaveType] ?? row.leaveType;
  return 'Hadir';
}

const OVERTIME_STATUS_LABEL: Record<string, string> = {
  pending: 'Belum diverifikasi',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};

/** Cegah nama/keterangan merusak markup PDF. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Nama berkas PDF, mis. "rekap_2026-08_misbakhul-munir.pdf". */
export function recapFileName(recap: RecapResponse): string {
  const slug = recap.user.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `rekap_${recap.month}${slug ? `_${slug}` : ''}.pdf`;
}

/**
 * Rakit HTML satu halaman untuk dicetak jadi PDF (expo-print).
 * Tata letaknya mengikuti PDF web: ringkasan dulu, lalu detail harian.
 */
export function buildRecapHtml(recap: RecapResponse, printedAt: string): string {
  const s = recap.summary;
  const summaryPairs: [string, string][] = [
    ['Hari Hadir', String(s.presentDays)],
    ['Sakit', s.sakitDays > 0 ? String(s.sakitDays) : '-'],
    ['Izin', s.izinDays > 0 ? String(s.izinDays) : '-'],
    ['Cuti', s.cutiDays > 0 ? String(s.cutiDays) : '-'],
    ['Libur', s.liburDays > 0 ? String(s.liburDays) : '-'],
    ['Total Telat', formatMinutes(s.totalLateMinutes)],
    ['Total Lembur', formatMinutes(s.totalOvertimeMinutes)],
    [
      'Lembur Urgent',
      s.overtimeUrgentMinutes > 0
        ? `${formatMinutes(s.overtimeUrgentMinutes)} (${s.overtimeUrgentCount}x)`
        : '-',
    ],
    ['Total Pulang Cepat', formatMinutes(s.totalEarlyLeaveMinutes)],
  ];

  const summaryCells = summaryPairs
    .map(
      ([label, value]) =>
        `<div class="stat"><span class="stat-label">${escapeHtml(label)}</span>` +
        `<span class="stat-value">${escapeHtml(value)}</span></div>`
    )
    .join('');

  const detailRows =
    recap.rows.length === 0
      ? `<tr><td colspan="9" class="empty">Belum ada catatan absensi pada bulan ini</td></tr>`
      : recap.rows
          .map((row) => {
            const status = row.overtimeStatus
              ? OVERTIME_STATUS_LABEL[row.overtimeStatus] ?? row.overtimeStatus
              : '-';
            return `<tr>
              <td>${longDate(row.date)}</td>
              <td>${escapeHtml(keterangan(row))}</td>
              <td class="c">${status}</td>
              <td class="c">${row.shiftNumber != null ? row.shiftNumber : '-'}</td>
              <td class="c">${row.clockInTime ?? '-'}</td>
              <td class="c">${row.clockOutTime ?? '-'}</td>
              <td class="c late">${formatMinutes(row.lateMinutes)}</td>
              <td class="c ot">${formatMinutes(row.overtimeMinutes)}</td>
              <td class="c early">${formatMinutes(row.earlyLeaveMinutes)}</td>
            </tr>`;
          })
          .join('');

  const pendingNote =
    s.overtimeUrgentPending > 0
      ? `<p class="note">${s.overtimeUrgentPending} sesi lembur urgent masih menunggu verifikasi admin — belum masuk total.</p>`
      : '';

  return `<html>
  <head><meta charset="utf-8" /><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #0F172A; margin: 0; padding: 28px 26px; font-size: 11px; }
    h1 { font-size: 17px; margin: 0 0 3px; }
    h2 { font-size: 12.5px; margin: 22px 0 8px; }
    .sub { color: #64748B; font-size: 10.5px; margin: 0; }
    .ident { margin: 14px 0 0; padding: 10px 12px; background: #EFF6FF; border-radius: 8px; }
    .ident strong { font-size: 13px; }
    .ident span { color: #64748B; }
    .stats { display: flex; flex-wrap: wrap; gap: 6px; }
    .stat { flex: 1 1 30%; border: 1px solid #E2E8F0; border-radius: 8px; padding: 7px 9px; }
    .stat-label { display: block; color: #64748B; font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; }
    .stat-value { display: block; font-size: 14px; font-weight: 700; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #2563EB; color: #FFF; font-size: 9.5px; text-align: left; padding: 6px 5px; font-weight: 600; }
    td { border-bottom: 1px solid #E2E8F0; padding: 5px; font-size: 10px; }
    .c { text-align: center; }
    .late { color: #DC2626; }
    .ot { color: #16A34A; }
    .early { color: #D97706; }
    .empty { text-align: center; color: #64748B; padding: 18px; }
    .note { color: #D97706; font-size: 10px; margin: 8px 0 0; }
    .foot { margin-top: 18px; color: #94A3B8; font-size: 9px; }
  </style></head>
  <body>
    <h1>Rekap Absensi — ${escapeHtml(monthTitle(recap.month))}</h1>
    <p class="sub">Dicetak ${escapeHtml(printedAt)}</p>
    <div class="ident">
      <strong>${escapeHtml(recap.user.name)}</strong><br />
      <span>${escapeHtml(roleLabel(recap.user.role))}</span>
    </div>

    <h2>Ringkasan Bulan Ini</h2>
    <div class="stats">${summaryCells}</div>
    ${pendingNote}

    <h2>Detail Harian</h2>
    <table>
      <thead><tr>
        <th>Tanggal</th><th>Keterangan</th><th class="c">Status Lembur</th><th class="c">Shift</th>
        <th class="c">Masuk</th><th class="c">Pulang</th><th class="c">Telat</th>
        <th class="c">Lembur</th><th class="c">Pulang Cepat</th>
      </tr></thead>
      <tbody>${detailRows}</tbody>
    </table>

    <p class="foot">
      Lembur = datang lebih awal / pulang lebih larut dari jam shift. Lembur urgent
      (panggilan di luar shift) dihitung terpisah dan baru masuk total setelah
      disetujui admin. Dibuat otomatis oleh GeoAttend · StarConnect.
    </p>
  </body>
</html>`;
}
