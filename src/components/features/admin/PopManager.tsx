'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

interface Pop {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  employeeCount: number;
  createdAt: string;
}

const EMPTY_NEW_POP = { name: '', code: '' };
const EMPTY_NEW_ADMIN = { name: '', email: '', password: '' };

async function fetchPops(): Promise<{ data: Pop[] }> {
  const res = await fetch('/api/pops');
  if (!res.ok) throw new Error('Gagal memuat daftar POP');
  return res.json();
}

export function PopManager() {
  const queryClient = useQueryClient();
  const [addPopOpen, setAddPopOpen] = useState(false);
  const [newPop, setNewPop] = useState(EMPTY_NEW_POP);
  const [adminTarget, setAdminTarget] = useState<Pop | null>(null);
  const [newAdmin, setNewAdmin] = useState(EMPTY_NEW_ADMIN);

  const { data, isLoading } = useQuery({ queryKey: ['pops'], queryFn: fetchPops });
  const pops = data?.data ?? [];

  const createPop = useMutation({
    mutationFn: async (input: typeof EMPTY_NEW_POP) => {
      const res = await fetch('/api/pops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? 'Gagal membuat POP');
      return body as Pop;
    },
    onSuccess: (created) => {
      toast.success(`POP "${created.name}" berhasil dibuat`);
      setAddPopOpen(false);
      setNewPop(EMPTY_NEW_POP);
      queryClient.invalidateQueries({ queryKey: ['pops'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createAdmin = useMutation({
    mutationFn: async (input: typeof EMPTY_NEW_ADMIN & { popId: string }) => {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, role: 'administrator' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? 'Gagal membuat admin');
      return body;
    },
    onSuccess: (created) => {
      toast.success(`Admin "${created.name}" berhasil dibuat untuk ${adminTarget?.name}`);
      setAdminTarget(null);
      setNewAdmin(EMPTY_NEW_ADMIN);
      queryClient.invalidateQueries({ queryKey: ['pops'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleCreatePop = (e: FormEvent) => {
    e.preventDefault();
    createPop.mutate(newPop);
  };

  const handleCreateAdmin = (e: FormEvent) => {
    e.preventDefault();
    if (newAdmin.password.length < 8) {
      toast.error('Kata sandi minimal 8 karakter');
      return;
    }
    if (!adminTarget) return;
    createAdmin.mutate({ ...newAdmin, popId: adminTarget.id });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Kelola POP</h1>
          <p className="text-sm text-text-secondary">
            Setiap POP punya karyawan, teknisi, admin, geofence, dan shift sendiri-sendiri.
          </p>
        </div>
        <Button onClick={() => setAddPopOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Buat POP
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : pops.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-secondary">Belum ada POP dibuat</p>
      ) : (
        <div className="flex flex-col gap-3">
          {pops.map((pop) => (
            <div
              key={pop.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-card"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-subtle text-primary">
                  <Building2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary">{pop.name}</span>
                    <Badge variant="secondary">{pop.code}</Badge>
                    {!pop.isActive && <Badge variant="destructive">Nonaktif</Badge>}
                  </div>
                  <p className="flex items-center gap-1 text-xs text-text-secondary">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    {pop.employeeCount} pengguna
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setAdminTarget(pop)}>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Tambah Admin
                </Button>
                <Link
                  href={`/admin/users?popId=${pop.id}`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  Kelola Pengguna
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog buat POP */}
      <Dialog open={addPopOpen} onClose={() => setAddPopOpen(false)} title="Buat POP Baru">
        <form onSubmit={handleCreatePop} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-name">Nama POP</Label>
            <Input
              id="np-name"
              value={newPop.name}
              onChange={(e) => setNewPop((p) => ({ ...p, name: e.target.value }))}
              placeholder="POP Bandung"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-code">Kode</Label>
            <Input
              id="np-code"
              value={newPop.code}
              onChange={(e) => setNewPop((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
              placeholder="BDG"
              required
            />
            <p className="text-xs text-text-secondary">Kode singkat unik, mis. BDG, JKT-01</p>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddPopOpen(false)}>
              Batal
            </Button>
            <Button
              type="submit"
              isLoading={createPop.isPending}
              disabled={newPop.name.trim().length === 0 || newPop.code.trim().length === 0}
            >
              Buat POP
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog tambah admin pertama POP */}
      <Dialog
        open={adminTarget !== null}
        onClose={() => setAdminTarget(null)}
        title={`Tambah Admin — ${adminTarget?.name ?? ''}`}
      >
        <form onSubmit={handleCreateAdmin} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="na-name">Nama Lengkap</Label>
            <Input
              id="na-name"
              value={newAdmin.name}
              onChange={(e) => setNewAdmin((a) => ({ ...a, name: e.target.value }))}
              placeholder="Budi Santoso"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="na-email">Email</Label>
            <Input
              id="na-email"
              type="email"
              value={newAdmin.email}
              onChange={(e) => setNewAdmin((a) => ({ ...a, email: e.target.value }))}
              placeholder="admin@pop.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="na-password">Kata Sandi Awal</Label>
            <PasswordInput
              id="na-password"
              value={newAdmin.password}
              onChange={(e) => setNewAdmin((a) => ({ ...a, password: e.target.value }))}
              placeholder="Minimal 8 karakter"
              required
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAdminTarget(null)}>
              Batal
            </Button>
            <Button
              type="submit"
              isLoading={createAdmin.isPending}
              disabled={
                newAdmin.name.trim().length === 0 ||
                newAdmin.email.trim().length === 0 ||
                newAdmin.password.length === 0
              }
            >
              Buat Admin
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
