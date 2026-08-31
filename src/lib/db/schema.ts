import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  numeric,
  boolean,
  jsonb,
  index,
  integer,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * PERINGATAN — proses server WAJIB berjalan pada TZ=UTC.
 *
 * Semua kolom `timestamp()` di bawah ini adalah `timestamp WITHOUT time zone`,
 * dan seluruh isinya sudah tertulis sebagai jam UTC. node-postgres menafsirkan
 * kolom semacam ini memakai TZ proses Node: menyetel TZ=Asia/Jakarta akan
 * membuat setiap pembacaan meleset 7 jam DAN menulis baris baru dengan jam WIB
 * — dua konvensi bercampur dalam satu kolom.
 *
 * Karena itu jangan menyetel TZ pada layanan (systemd/Docker). Kebutuhan "jam
 * dinding WIB" dipenuhi di level kode lewat `@/lib/time`, yang menghitung
 * tanggal/jam WIB tanpa bergantung pada TZ host.
 */

// ============================================
// Tabel Better Auth (user, session, account, verification)
// Nama export harus sesuai model Better Auth (singular),
// nama tabel SQL mengikuti PRD (plural).
// ============================================

export const user = pgTable('users', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  coverImage: text('cover_image'), // foto sampul profil (opsional)
  role: varchar('role', { length: 20 }).default('employee').notNull(), // 'super_admin' | 'administrator' | 'admin' | 'noc' | 'teknisi' | 'employee' | 'gudang'
  /**
   * Tim jaga lembur malam untuk role teknisi: 'ganjil' | 'genap' (null = belum
   * ditetapkan / bukan teknisi). Tim ganjil siaga pada tanggal ganjil, tim
   * genap pada tanggal genap.
   */
  technicianTeam: varchar('technician_team', { length: 10 }),
  /** POP (site) pemilik akun ini. NULL hanya untuk role 'super_admin' — tidak terikat satu POP. */
  popId: uuid('pop_id').references(() => pops.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const session = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    tokenIdx: index('sessions_token_idx').on(table.token),
  })
);

export const account = pgTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .references(() => user.id, { onDelete: 'cascade' })
    .notNull(),
  accountId: text('account_id').notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'), // hash password (scrypt via Better Auth)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const verification = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============================================
// Tabel Domain GeoAttend
// ============================================

/**
 * POP (Point of Presence) — satu kantor/site ISP yang berdiri sendiri:
 * karyawan, teknisi, admin, geofence, shift, jadwal, izin, live tracking, dan
 * stok gudangnya masing-masing terisolasi per POP.
 */
export const pops = pgTable('pops', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const geofences = pgTable('geofences', {
  id: uuid('id').defaultRandom().primaryKey(),
  popId: uuid('pop_id')
    .references(() => pops.id)
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
  longitude: numeric('longitude', { precision: 10, scale: 7 }).notNull(),
  radiusMeters: numeric('radius_meters', { precision: 6, scale: 2 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Jam kerja SOP per role. Satu role bisa punya beberapa shift
 * (mis. admin & noc: 2 shift; teknisi: 1 shift).
 */
export const shiftSettings = pgTable(
  'shift_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    popId: uuid('pop_id')
      .references(() => pops.id)
      .notNull(),
    role: varchar('role', { length: 20 }).notNull(), // 'admin' | 'noc' | 'teknisi'
    shiftNumber: integer('shift_number').notNull(),
    startTime: varchar('start_time', { length: 5 }).notNull(), // format "HH:mm"
    endTime: varchar('end_time', { length: 5 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    roleShiftUnique: uniqueIndex('shift_settings_pop_role_number_idx').on(
      table.popId,
      table.role,
      table.shiftNumber
    ),
  })
);

/**
 * Pengaturan aplikasi (key-value): app_name, app_logo, dll.
 */
export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Posisi live terakhir per pengguna (satu baris per user, di-upsert).
 * Diisi selama pengguna berstatus clock-in; dihapus saat clock-out.
 */
export const liveLocations = pgTable('live_locations', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
  longitude: numeric('longitude', { precision: 10, scale: 7 }).notNull(),
  accuracyMeters: numeric('accuracy_meters', { precision: 6, scale: 2 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Jejak lokasi (histori) selama sesi kerja — sumber data dialog "Riwayat
 * Lokasi" di rekap bulanan. Beda dari {@link liveLocations} yang hanya
 * menyimpan SATU posisi terkini per user: tabel ini append-only, satu baris
 * per titik GPS yang lolos saringan anti-jitter (lihat POST /api/locations).
 *
 * Data OPERASIONAL, bukan data absensi resmi: sengaja TIDAK ikut backup, dan
 * dibersihkan otomatis setelah TRAIL_RETENTION_DAYS hari lewat
 * scripts/cleanup-trails.ts.
 */
export const locationTrails = pgTable(
  'location_trails',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    /** Waktu fix GPS DI PERANGKAT (bukan waktu terima server) */
    recordedAt: timestamp('recorded_at').notNull(),
    latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
    longitude: numeric('longitude', { precision: 10, scale: 7 }).notNull(),
    accuracyMeters: numeric('accuracy_meters', { precision: 6, scale: 2 }),
    /** true bila perangkat melaporkan lokasi palsu (Android: LocationObject.mocked) */
    isMocked: boolean('is_mocked').default(false).notNull(),
    /** Waktu terima server — pembanding audit bila jam perangkat dimanipulasi */
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Kueri utama (jejak satu user dalam rentang sesi) SEKALIGUS kunci dedup:
    // batch yang dikirim ulang setelah gagal jaringan diabaikan lewat
    // onConflictDoNothing, jadi pengiriman ulang aman.
    userRecordedIdx: uniqueIndex('location_trails_user_recorded_idx').on(
      table.userId,
      table.recordedAt
    ),
    // Dipakai pembersih retensi (DELETE ... WHERE recorded_at < cutoff)
    recordedIdx: index('location_trails_recorded_idx').on(table.recordedAt),
  })
);

/**
 * Pengajuan izin (sakit/izin/cuti — perlu persetujuan administrator)
 * dan penanda libur (self-service dari halaman absensi, langsung approved).
 * Tanggal disimpan sebagai string "yyyy-MM-dd" (tanggal lokal, konsisten
 * dengan pengelompokan rekap harian).
 */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar('type', { length: 10 }).notNull(), // 'sakit'|'izin'|'cuti'|'telat'|'siang'|'remote'|'libur'
    startDate: varchar('start_date', { length: 10 }).notNull(), // "yyyy-MM-dd"
    endDate: varchar('end_date', { length: 10 }).notNull(),
    reason: text('reason'),
    status: varchar('status', { length: 10 }).default('pending').notNull(), // 'pending' | 'approved' | 'rejected'
    reviewedBy: text('reviewed_by').references(() => user.id),
    reviewedAt: timestamp('reviewed_at'),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userDateIdx: index('leave_requests_user_date_idx').on(table.userId, table.startDate),
    statusIdx: index('leave_requests_status_idx').on(table.status),
  })
);

/**
 * Jadwal shift per-karyawan (role admin & noc). Satu baris = shift seorang
 * karyawan pada satu tanggal, diisi administrator (grid bulanan + rotasi).
 * Tanggal disimpan "yyyy-MM-dd" (lokal), konsisten dengan leave_requests.
 */
export const scheduleEntries = pgTable(
  'schedule_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    date: varchar('date', { length: 10 }).notNull(), // "yyyy-MM-dd"
    shift: varchar('shift', { length: 10 }).notNull(), // '1' | '2' | 'libur'
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userDateUnique: uniqueIndex('schedule_entries_user_date_idx').on(table.userId, table.date),
    dateIdx: index('schedule_entries_date_idx').on(table.date),
  })
);

/**
 * Peserta jadwal shift: karyawan mana saja yang muncul di grid jadwal.
 *
 * Sebelumnya grid selalu menampilkan SEMUA karyawan ber-role terjadwal, jadi
 * karyawan yang tidak ikut rotasi tetap muncul dan tidak bisa dikeluarkan.
 * Bila tabel ini KOSONG, sistem kembali ke perilaku lama (semua role
 * terjadwal) supaya instalasi lama tetap jalan tanpa perlu setup.
 */
export const scheduleParticipants = pgTable('schedule_participants', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Pengajuan tukar shift antar karyawan (satu role, beda shift, tanggal ke depan).
 * Alur: pengaju → rekan (target) setuju → administrator setujui → jadwal ditukar.
 */
export const shiftSwapRequests = pgTable(
  'shift_swap_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requesterId: text('requester_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    targetId: text('target_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * 'shift' — tukar shift pada SATU tanggal (S1 ↔ S2, dipakai admin & NOC).
     * 'libur' — tukar HARI LIBUR pada DUA tanggal (dipakai teknisi yang hanya
     * punya S1 + libur, jadi tidak pernah bisa tukar shift di tanggal sama).
     */
    kind: varchar('kind', { length: 10 }).default('shift').notNull(),
    date: varchar('date', { length: 10 }).notNull(), // "yyyy-MM-dd" — tanggal pengaju
    /** Hanya untuk kind='libur': tanggal libur rekan tujuan. */
    targetDate: varchar('target_date', { length: 10 }),
    requesterShift: varchar('requester_shift', { length: 10 }).notNull(), // '1' | '2' | 'libur'
    targetShift: varchar('target_shift', { length: 10 }).notNull(),
    // 'pending_peer' | 'pending_admin' | 'approved' | 'rejected' | 'cancelled'
    status: varchar('status', { length: 20 }).default('pending_peer').notNull(),
    reason: text('reason'),
    peerRespondedAt: timestamp('peer_responded_at'),
    reviewedBy: text('reviewed_by').references(() => user.id),
    reviewedAt: timestamp('reviewed_at'),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    targetStatusIdx: index('shift_swap_target_status_idx').on(table.targetId, table.status),
    requesterIdx: index('shift_swap_requester_idx').on(table.requesterId),
    dateIdx: index('shift_swap_date_idx').on(table.date),
  })
);

/**
 * Piket kebersihan: satu karyawan bertugas ngepel per hari (bergiliran).
 * `done` ditandai oleh yang bertugas saat sudah melakukan piket.
 */
export const piketAssignments = pgTable(
  'piket_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Kolom langsung (bukan lewat join userId->user.popId): constraint unik
    // "satu petugas per tanggal" harus per-POP, jadi popId wajib ikut di index.
    popId: uuid('pop_id')
      .references(() => pops.id)
      .notNull(),
    date: varchar('date', { length: 10 }).notNull(), // "yyyy-MM-dd"
    userId: text('user_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    done: boolean('done').default(false).notNull(),
    doneAt: timestamp('done_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    dateUnique: uniqueIndex('piket_assignments_pop_date_idx').on(table.popId, table.date),
  })
);

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar('type', { length: 20 }).notNull(), // 'clock_in' | 'clock_out'
    /**
     * Jenis sesi: 'shift' (absen kerja biasa) | 'lembur' (lembur urgent di luar
     * shift, mis. teknisi dipanggil gangguan malam). Sesi lembur dihitung 100%
     * lembur — tanpa telat & pulang cepat, karena memang di luar jam shift.
     */
    kind: varchar('kind', { length: 10 }).default('shift').notNull(),
    /**
     * Status verifikasi admin untuk SESI lembur, disimpan di record PEMBUKA
     * (clock_in) dan mewakili satu sesi utuh. null untuk sesi shift biasa.
     * 'pending' | 'approved' | 'rejected' — hanya 'approved' yang masuk total jam.
     */
    overtimeStatus: varchar('overtime_status', { length: 10 }),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewNote: text('review_note'),
    shiftNumber: integer('shift_number'), // shift yang dipilih saat absen (null utk data lama / role tanpa shift)
    timestamp: timestamp('timestamp').defaultNow().notNull(),
    latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
    longitude: numeric('longitude', { precision: 10, scale: 7 }).notNull(),
    accuracyMeters: numeric('accuracy_meters', { precision: 6, scale: 2 }),
    photoUrl: text('photo_url').notNull(),
    geofenceId: uuid('geofence_id').references(() => geofences.id),
    isWithinGeofence: boolean('is_within_geofence').notNull(),
    distanceFromCenter: numeric('distance_from_center', { precision: 8, scale: 2 }), // meter
    notes: text('notes'),
    metadata: jsonb('metadata'), // Info device, browser, dll.
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userTimestampIdx: index('attendance_user_timestamp_idx').on(table.userId, table.timestamp),
    timestampIdx: index('attendance_timestamp_idx').on(table.timestamp),
  })
);

// ============================================
// Modul Stok Gudang (StarConnect Stock)
// ============================================

/**
 * Kategori barang gudang (KABEL, AKSESORIS TV, RATIO, dll).
 */
export const stockCategories = pgTable(
  'stock_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    popId: uuid('pop_id')
      .references(() => pops.id)
      .notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    popNameUnique: uniqueIndex('stock_categories_pop_name_idx').on(table.popId, table.name),
  })
);

/**
 * Master barang. `openingStock` = stok awal saat migrasi (diambil dari kolom
 * "Stok Akhir" sheet lama). Stok berjalan = openingStock + Σmasuk − Σkeluar
 * ± Σpenyesuaian (dihitung dari stock_movements, bukan disimpan).
 * `minStock` = ambang "menipis". `photoUrl` = foto barang (opsional).
 */
export const stockItems = pgTable(
  'stock_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    popId: uuid('pop_id')
      .references(() => pops.id)
      .notNull(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    categoryId: uuid('category_id').references(() => stockCategories.id),
    unit: varchar('unit', { length: 20 }).default('pcs').notNull(),
    photoUrl: text('photo_url'),
    openingStock: integer('opening_stock').default(0).notNull(),
    minStock: integer('min_stock').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    categoryIdx: index('stock_items_category_idx').on(table.categoryId),
    popIdx: index('stock_items_pop_idx').on(table.popId),
    popCodeUnique: uniqueIndex('stock_items_pop_code_idx').on(table.popId, table.code),
  })
);

/**
 * Buku besar pergerakan stok. Satu baris = satu barang masuk/keluar/penyesuaian,
 * dengan foto bukti. Sumber kebenaran untuk menghitung stok berjalan.
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Disimpan langsung (bukan lewat join itemId->stockItems.popId) supaya
    // query buku besar tidak perlu join tambahan.
    popId: uuid('pop_id')
      .references(() => pops.id)
      .notNull(),
    itemId: uuid('item_id')
      .references(() => stockItems.id, { onDelete: 'cascade' })
      .notNull(),
    type: varchar('type', { length: 10 }).notNull(), // 'masuk' | 'keluar' | 'adjust'
    quantity: integer('quantity').notNull(),
    photoUrl: text('photo_url'),
    note: text('note'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    itemIdx: index('stock_movements_item_idx').on(table.itemId),
    createdAtIdx: index('stock_movements_created_at_idx').on(table.createdAt),
    popIdx: index('stock_movements_pop_idx').on(table.popId),
  })
);

/**
 * Token push notification per PERANGKAT (Expo Push Token).
 *
 * Token jadi primary key, bukan pasangan (user, token). Sebabnya: satu HP bisa
 * berganti pemilik — karyawan logout, rekannya login di HP yang sama. Token
 * Expo tetap sama karena melekat ke instalasi app, bukan ke akun. Dengan token
 * sebagai PK, registrasi ulang cukup meng-upsert `user_id` sehingga notifikasi
 * ikut pindah; kalau PK-nya gabungan, HP itu akan menerima notifikasi milik
 * dua orang sekaligus.
 *
 * Baris dihapus saat logout, dan otomatis saat Expo menjawab
 * `DeviceNotRegistered` (app di-uninstall / token dicabut).
 */
export const pushTokens = pgTable(
  'push_tokens',
  {
    token: text('token').primaryKey(),
    userId: text('user_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    platform: varchar('platform', { length: 10 }).notNull(), // 'android' | 'ios'
    /** Versi app saat token didaftarkan — untuk melacak HP yang belum di-update. */
    appVersion: varchar('app_version', { length: 20 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** Disegarkan tiap app mendaftarkan ulang token (tiap buka app). */
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('push_tokens_user_idx').on(table.userId),
  })
);

/**
 * Catatan pengingat shift yang SUDAH dikirim — satu baris per (karyawan,
 * tanggal, shift).
 *
 * Pengirimnya adalah timer yang berjalan tiap beberapa menit, jadi jendela
 * "15 menit sebelum mulai" tersentuh beberapa kali berturut-turut. Tanpa
 * catatan ini karyawan menerima notifikasi yang sama tiga-empat kali. Kunci
 * gabungan yang jadi primary key membuat pengiriman ganda mustahil bahkan bila
 * dua proses timer kebetulan tumpang-tindih: yang kedua kalah di `INSERT`.
 *
 * Tanggalnya tanggal WIB ("yyyy-MM-dd"), sama seperti jadwal & izin — bukan
 * turunan `sent_at` yang berjam UTC.
 */
export const shiftReminders = pgTable(
  'shift_reminders',
  {
    userId: text('user_id')
      .references(() => user.id, { onDelete: 'cascade' })
      .notNull(),
    date: varchar('date', { length: 10 }).notNull(), // "yyyy-MM-dd" WIB
    shiftNumber: integer('shift_number').notNull(),
    sentAt: timestamp('sent_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.date, table.shiftNumber] }),
    // Dipakai pembersih retensi (DELETE ... WHERE date < cutoff)
    dateIdx: index('shift_reminders_date_idx').on(table.date),
  })
);
