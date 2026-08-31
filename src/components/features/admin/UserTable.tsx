'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Search, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { UserProfile } from '@/types/api';
import { useSession } from '@/lib/auth/client';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/ui/avatar';

const BASE_ROLE_OPTIONS: { value: UserProfile['role']; label: string }[] = [
  { value: 'employee', label: 'Karyawan' },
  { value: 'teknisi', label: 'Teknisi' },
  { value: 'noc', label: 'NOC' },
  { value: 'admin', label: 'Admin (staf)' },
  { value: 'gudang', label: 'Admin Gudang (web stok)' },
  { value: 'administrator', label: 'Administrator (sistem)' },
];
/** super_admin hanya boleh dipilih/dilihat oleh viewer yang sudah super_admin. */
const SUPER_ADMIN_OPTION = { value: 'super_admin' as const, label: 'Super Admin (lintas-POP)' };

const EMPTY_NEW_USER = {
  name: '',
  email: '',
  password: '',
  role: 'employee' as UserProfile['role'],
  popId: '',
};

interface PopOption {
  id: string;
  name: string;
}

async function fetchUsers(search: string, popId: string | null): Promise<{ data: UserProfile[] }> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (popId) params.set('popId', popId);
  const res = await fetch(`/api/users?${params}`);
  if (!res.ok) throw new Error('Gagal memuat daftar pengguna');
  return res.json();
}

async function fetchPops(): Promise<{ data: PopOption[] }> {
  const res = await fetch('/api/pops');
  if (!res.ok) throw new Error('Gagal memuat daftar POP');
  return res.json();
}

export function UserTable() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user.role === 'super_admin';
  const activePopId = useSearchParams().get('popId');
  const roleOptions = isSuperAdmin ? [...BASE_ROLE_OPTIONS, SUPER_ADMIN_OPTION] : BASE_ROLE_OPTIONS;

  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newUser, setNewUser] = useState({ ...EMPTY_NEW_USER, popId: activePopId ?? '' });
  const [editTarget, setEditTarget] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '' });

  const needsPopSelection = isSuperAdmin && !activePopId;

  const { data, isLoading } = useQuery({
    queryKey: ['users', search, activePopId],
    queryFn: () => fetchUsers(search, activePopId),
    enabled: !needsPopSelection,
  });

  const { data: popsData } = useQuery({
    queryKey: ['pops'],
    queryFn: fetchPops,
    enabled: isSuperAdmin,
  });
  const popOptions = popsData?.data ?? [];

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserProfile['role'] }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? 'Gagal mengubah role');
      return body;
    },
    onSuccess: () => {
      toast.success('Role berhasil diubah');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? 'Gagal menghapus pengguna');
      return body;
    },
    onSuccess: () => {
      toast.success('Pengguna berhasil dihapus');
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createUser = useMutation({
    mutationFn: async (input: typeof EMPTY_NEW_USER) => {
      // popId hanya dikirim untuk super_admin — administrator biasa tidak
      // boleh mengirim field ini sama sekali (server memaksa popId miliknya
      // sendiri; zod menolak string kosong bila field ini ikut terkirim).
      const { popId, ...rest } = input;
      const body: Record<string, unknown> = { ...rest };
      if (isSuperAdmin && popId) body.popId = popId;

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody?.message ?? 'Gagal membuat pengguna');
      return resBody as UserProfile;
    },
    onSuccess: (created) => {
      toast.success(`Akun ${created.name} berhasil dibuat`);
      setAddOpen(false);
      setNewUser({ ...EMPTY_NEW_USER, popId: activePopId ?? '' });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const editUser = useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id: string;
      name: string;
      email: string;
      password?: string;
    }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? 'Gagal menyimpan perubahan');
      return body as UserProfile;
    },
    onSuccess: () => {
      toast.success('Data pengguna tersimpan');
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (newUser.password.length < 8) {
      toast.error('Kata sandi minimal 8 karakter');
      return;
    }
    if (isSuperAdmin && !newUser.popId) {
      toast.error('Pilih POP tujuan akun ini');
      return;
    }
    createUser.mutate(newUser);
  };

  const openEdit = (target: UserProfile) => {
    setEditTarget(target);
    setEditForm({ name: target.name, email: target.email, password: '' });
  };

  const handleEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    if (editForm.password.length > 0 && editForm.password.length < 8) {
      toast.error('Kata sandi baru minimal 8 karakter');
      return;
    }
    editUser.mutate({
      id: editTarget.id,
      name: editForm.name,
      email: editForm.email,
      password: editForm.password.length > 0 ? editForm.password : undefined,
    });
  };

  const users = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="Cari nama atau email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Cari pengguna"
          />
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Tambah Pengguna
        </Button>
      </div>

      {needsPopSelection ? (
        <p className="py-10 text-center text-sm text-text-secondary">
          Pilih POP dulu lewat menu &quot;Kelola POP&quot; untuk melihat/menambah penggunanya
        </p>
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : users.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-secondary">
          Tidak ada pengguna ditemukan
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-secondary">
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === session?.user.id;
                return (
                  <tr
                    key={user.id}
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-background"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={user.image}
                          name={user.name}
                          className="h-9 w-9"
                          textClassName="text-xs"
                          preview
                        />
                        <span className="font-medium text-text-primary">
                          {user.name}
                          {isSelf && (
                            <Badge variant="secondary" className="ml-2">
                              Anda
                            </Badge>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary">{user.email}</td>
                    <td className="px-4 py-2.5">
                      <Select
                        value={user.role}
                        disabled={isSelf || updateRole.isPending}
                        onChange={(e) =>
                          updateRole.mutate({
                            id: user.id,
                            role: e.target.value as UserProfile['role'],
                          })
                        }
                        aria-label={`Role untuk ${user.name}`}
                        className="h-9 w-auto min-w-[11rem]"
                      >
                        {roleOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(user)}
                          aria-label={`Edit ${user.name}`}
                          className="text-text-secondary hover:text-primary"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isSelf}
                          onClick={() => setDeleteTarget(user)}
                          aria-label={`Hapus ${user.name}`}
                          className="text-text-secondary hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog tambah pengguna */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Tambah Pengguna Baru">
        <form onSubmit={handleCreate} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nu-name">Nama Lengkap</Label>
            <Input
              id="nu-name"
              value={newUser.name}
              onChange={(e) => setNewUser((u) => ({ ...u, name: e.target.value }))}
              placeholder="Budi Santoso"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nu-email">Email</Label>
            <Input
              id="nu-email"
              type="email"
              value={newUser.email}
              onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
              placeholder="nama@perusahaan.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nu-password">Kata Sandi Awal</Label>
            <PasswordInput
              id="nu-password"
              value={newUser.password}
              onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
              placeholder="Minimal 8 karakter"
              required
            />
            <p className="text-xs text-text-secondary">
              Berikan kata sandi ini ke karyawan yang bersangkutan
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nu-role">Role</Label>
            <Select
              id="nu-role"
              value={newUser.role}
              onChange={(e) =>
                setNewUser((u) => ({ ...u, role: e.target.value as UserProfile['role'] }))
              }
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          {isSuperAdmin && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nu-pop">POP</Label>
              <Select
                id="nu-pop"
                value={newUser.popId}
                onChange={(e) => setNewUser((u) => ({ ...u, popId: e.target.value }))}
                required
              >
                <option value="" disabled>
                  Pilih POP...
                </option>
                {popOptions.map((pop) => (
                  <option key={pop.id} value={pop.id}>
                    {pop.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Batal
            </Button>
            <Button
              type="submit"
              isLoading={createUser.isPending}
              disabled={
                newUser.name.trim().length === 0 ||
                newUser.email.trim().length === 0 ||
                newUser.password.length === 0 ||
                (isSuperAdmin && !newUser.popId)
              }
            >
              Buat Akun
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog edit pengguna */}
      <Dialog
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title={`Edit ${editTarget?.name ?? 'Pengguna'}`}
      >
        <form onSubmit={handleEdit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eu-name">Nama Lengkap</Label>
            <Input
              id="eu-name"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eu-email">Email (username login)</Label>
            <Input
              id="eu-email"
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eu-password">Kata Sandi Baru</Label>
            <PasswordInput
              id="eu-password"
              value={editForm.password}
              onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Kosongkan bila tidak diubah"
            />
            <p className="text-xs text-text-secondary">
              Isi hanya bila ingin me-reset kata sandi pengguna ini
            </p>
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
              Batal
            </Button>
            <Button
              type="submit"
              isLoading={editUser.isPending}
              disabled={editForm.name.trim().length === 0 || editForm.email.trim().length === 0}
            >
              Simpan
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog konfirmasi hapus */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Hapus Pengguna"
      >
        <p className="text-sm text-text-secondary">
          Yakin ingin menghapus <strong>{deleteTarget?.name}</strong>? Semua riwayat
          absensinya juga akan terhapus. Aksi ini tidak dapat dibatalkan.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Batal
          </Button>
          <Button
            variant="destructive"
            isLoading={deleteUser.isPending}
            onClick={() => deleteTarget && deleteUser.mutate(deleteTarget.id)}
          >
            Hapus
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
