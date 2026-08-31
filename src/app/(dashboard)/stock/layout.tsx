'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/auth/client';
import { isStockManager } from '@/lib/roles';
import { useBrand } from '@/components/providers/BrandProvider';
import { STOCK_NAV } from '@/components/features/stock/stock-nav';

export default function StockLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const brand = useBrand();
  const { data: session } = useSession();
  const canManage = isStockManager(session?.user.role);
  const navItems = STOCK_NAV.filter((n) => canManage || !n.adminOnly);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight text-text-primary">Stok Gudang</h1>
        <p className="text-sm text-text-secondary">Kelola inventaris, barang masuk & keluar.</p>
      </div>

      {/* Sub-tab hanya saat diakses dari dalam GeoAttend. Pada shell stok
          (stok.serayu.id), navigasi sudah disediakan sidebar. */}
      {brand !== 'stok' && (
        <nav
          aria-label="Navigasi stok"
          className="flex gap-1 overflow-x-auto border-b border-border/70 pb-px"
        >
          {navItems.map((tab) => {
            const isActive = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}

      <div>{children}</div>
    </div>
  );
}
