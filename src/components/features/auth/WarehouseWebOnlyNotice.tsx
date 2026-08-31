'use client';

import { useRouter } from 'next/navigation';
import { LogOut, Warehouse } from 'lucide-react';
import { signOut } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';

/**
 * Layar penolakan untuk akun Admin Gudang bila diakses dari domain absensi.
 * Akun gudang hanya boleh dipakai lewat stok.serayu.id.
 */
export function WarehouseWebOnlyNotice() {
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
        <Warehouse className="h-8 w-8" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-bold tracking-tight text-text-primary">Akun Admin Gudang</h1>
      <p className="max-w-sm text-sm text-text-secondary">
        Akun ini hanya bisa dipakai di <b className="text-text-primary">stok.serayu.id</b> —
        bukan di halaman absensi maupun aplikasi mobile.
      </p>
      <Button variant="outline" onClick={handleSignOut}>
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Keluar
      </Button>
    </main>
  );
}
