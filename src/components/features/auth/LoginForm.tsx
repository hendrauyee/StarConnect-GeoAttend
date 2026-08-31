'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { signIn, signOut } from '@/lib/auth/client';
import { isWarehouseOnly } from '@/lib/roles';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Brand } from '@/lib/brand';

interface LoginFormProps {
  brand?: Brand;
  title?: string;
  subtitle?: string;
}

export function LoginForm({
  brand = 'geoattend',
  title = 'Selamat datang kembali',
  subtitle = 'Masuk untuk mulai absensi hari ini',
}: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const expired = searchParams.get('reason') === 'expired';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const { data, error: authError } = await signIn.email({ email, password });

    setIsLoading(false);
    if (authError) {
      setError('Email atau kata sandi salah');
      return;
    }

    const role = (data?.user as { role?: string } | undefined)?.role;
    // Akun Admin Gudang hanya boleh di domain stok — batalkan sesi bila login dari absensi.
    if (isWarehouseOnly(role) && brand !== 'stok') {
      await signOut();
      setError('Akun Admin Gudang hanya bisa masuk lewat stok.serayu.id');
      return;
    }

    toast.success('Berhasil masuk');
    // Domain stok → dashboard stok. Selain itu: administrator → panel admin, lainnya → absensi.
    const target = brand === 'stok' ? '/stock' : role === 'administrator' ? '/admin' : '/checkin';
    router.push(target);
    router.refresh();
  };

  return (
    <Card className="shadow-elevated">
      <CardHeader>
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {expired && (
          <Alert variant="warning" className="mb-4">
            Sesi Anda berakhir. Silakan masuk kembali.
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="nama@perusahaan.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Kata Sandi</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}

          <Button type="submit" size="lg" isLoading={isLoading} className="mt-2 w-full">
            {isLoading ? 'Memproses...' : 'Masuk'}
          </Button>
        </form>

        <p className="mt-5 border-t border-border/70 pt-4 text-center text-sm text-text-secondary">
          Belum punya akun?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Daftar di sini
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
