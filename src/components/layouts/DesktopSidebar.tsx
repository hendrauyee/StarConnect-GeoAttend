'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Camera,
  ClipboardCheck,
  FileSpreadsheet,
  LayoutDashboard,
  Map,
  MapPin,
  Settings,
  User,
  Users,
  Warehouse,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_NAME, APP_VERSION } from '@/lib/constants';

interface DesktopSidebarProps {
  isAdmin: boolean;
  isSuperAdmin?: boolean;
  appName?: string;
  logoUrl?: string | null;
}

export function DesktopSidebar({
  isAdmin,
  isSuperAdmin = false,
  appName = APP_NAME,
  logoUrl,
}: DesktopSidebarProps) {
  const pathname = usePathname();

  const mainItems = [
    { href: '/checkin', label: 'Absensi', icon: Camera },
    { href: '/schedule', label: 'Jadwal Saya', icon: CalendarRange },
    { href: '/stock', label: 'Stok Gudang', icon: Warehouse },
    { href: '/history', label: 'Riwayat', icon: CalendarDays },
    { href: '/profile', label: 'Profil', icon: User },
  ];

  const adminItems = [
    { href: '/admin', label: 'Overview', icon: LayoutDashboard },
    { href: '/admin/live-map', label: 'Peta Live', icon: Map },
    { href: '/admin/reports', label: 'Rekap Bulanan', icon: FileSpreadsheet },
    { href: '/admin/leaves', label: 'Persetujuan Izin', icon: ClipboardCheck },
    { href: '/admin/schedule', label: 'Jadwal Shift', icon: CalendarClock },
    { href: '/admin/users', label: 'Pengguna', icon: Users },
    { href: '/admin/settings', label: 'Pengaturan', icon: Settings },
    ...(isSuperAdmin ? [{ href: '/admin/pops', label: 'Kelola POP', icon: Building2 }] : []),
  ];

  const renderItem = (item: { href: string; label: string; icon: typeof Camera }) => {
    const isActive =
      item.href === '/stock' ? pathname.startsWith('/stock') : pathname === item.href;
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
          isActive
            ? 'bg-primary-subtle font-semibold text-primary'
            : 'font-medium text-text-secondary hover:bg-secondary hover:text-text-primary'
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={isActive ? 2.25 : 2} />
        {item.label}
      </Link>
    );
  };

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border/70 bg-surface md:flex">
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border/70 px-5">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className="h-9 w-9 rounded-md object-contain"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-white shadow-sm">
            <MapPin className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <span className="truncate text-lg font-bold tracking-tight text-text-primary">
          {appName}
        </span>
      </div>

      <nav
        aria-label="Navigasi utama"
        className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
      >
        {isAdmin ? (
          // Administrator: panel admin di atas (paling sering dipakai),
          // menu absensi pribadi di bawah
          <>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary/80">
              Admin
            </p>
            {adminItems.map(renderItem)}
            <p className="mt-5 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary/80">
              Pribadi
            </p>
            {mainItems.map(renderItem)}
          </>
        ) : (
          mainItems.map(renderItem)
        )}
      </nav>

      <p className="shrink-0 border-t border-border/70 px-5 py-3 text-[11px] text-text-secondary/70">
        {appName} v{APP_VERSION} · StarConnect
      </p>
    </aside>
  );
}
