import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession, isSuperAdmin } from '@/lib/auth/utils';
import { PopManager } from '@/components/features/admin/PopManager';

export const metadata: Metadata = {
  title: 'Kelola POP',
};

export default async function AdminPopsPage() {
  const session = await getServerSession();
  if (!isSuperAdmin(session)) {
    redirect('/admin');
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PopManager />
    </div>
  );
}
