import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { scheduleParticipants, user } from '@/lib/db/schema';
import { ROLE_ORDER, SCHEDULABLE_ROLES } from '@/lib/schedule/roles';
import type { TechnicianTeam } from '@/types/api';

export interface ScheduleParticipant {
  id: string;
  name: string;
  role: string;
  image: string | null;
  technicianTeam: TechnicianTeam | null;
}

/** Urutan tampil: kelompok role dulu (admin → NOC → teknisi), lalu nama. */
const roleOrderSql = sql`CASE ${user.role} WHEN 'admin' THEN ${ROLE_ORDER.admin} WHEN 'noc' THEN ${ROLE_ORDER.noc} WHEN 'teknisi' THEN ${ROLE_ORDER.teknisi} ELSE 99 END`;

/**
 * Daftar karyawan yang muncul di grid jadwal & jadi kandidat piket.
 *
 * Bila administrator sudah mengatur daftar peserta, itulah yang dipakai
 * (apa pun role-nya). Bila belum pernah diatur, kembali ke perilaku lama:
 * semua karyawan ber-role terjadwal — supaya instalasi yang sudah berjalan
 * tidak tiba-tiba kehilangan grid jadwalnya.
 */
export async function listScheduleParticipants(popId: string): Promise<{
  users: ScheduleParticipant[];
  configured: boolean;
}> {
  // "chosen" HARUS diperiksa per-POP (join ke user), bukan global — kalau
  // tidak, POP lain yang sudah mengatur peserta akan membuat POP ini juga
  // dianggap "configured" walau daftar pesertanya sendiri masih kosong.
  const chosen = await db
    .select({ userId: scheduleParticipants.userId })
    .from(scheduleParticipants)
    .innerJoin(user, eq(user.id, scheduleParticipants.userId))
    .where(eq(user.popId, popId));

  const columns = {
    id: user.id,
    name: user.name,
    role: user.role,
    image: user.image,
    technicianTeam: user.technicianTeam,
  };

  const rows =
    chosen.length > 0
      ? await db
          .select(columns)
          .from(user)
          .where(
            and(
              eq(user.popId, popId),
              inArray(
                user.id,
                chosen.map((c) => c.userId)
              )
            )
          )
          .orderBy(roleOrderSql, asc(user.name))
      : await db
          .select(columns)
          .from(user)
          .where(and(eq(user.popId, popId), inArray(user.role, [...SCHEDULABLE_ROLES])))
          .orderBy(roleOrderSql, asc(user.name));

  return {
    users: rows.map((r) => ({
      ...r,
      technicianTeam: (r.technicianTeam as TechnicianTeam | null) ?? null,
    })),
    configured: chosen.length > 0,
  };
}
