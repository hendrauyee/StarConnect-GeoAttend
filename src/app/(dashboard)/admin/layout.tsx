import { redirect } from 'next/navigation';
import { getServerSession, isAdmin } from '@/lib/auth/utils';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  if (!isAdmin(session)) {
    redirect('/checkin');
  }

  return <>{children}</>;
}
