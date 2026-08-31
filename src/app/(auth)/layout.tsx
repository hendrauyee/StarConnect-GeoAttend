import {
  ArrowLeftRight,
  CalendarClock,
  Camera,
  MapPin,
  PackageSearch,
  ShieldCheck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { getAppSettings } from '@/lib/settings';
import { getServerBrand } from '@/lib/brand.server';
import { brandConfig, type Brand } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface Hero {
  gradient: string;
  markIcon: LucideIcon;
  headline: string;
  tagline: string;
  mobileTagline: string;
  subtext: string; // kelas warna teks pendukung di atas gradien
  subtextDim: string; // varian redup (opacity) — kelas literal utuh untuk Tailwind JIT
  highlights: { icon: LucideIcon; title: string; body: string }[];
}

const HERO: Record<Brand, Hero> = {
  geoattend: {
    gradient: 'from-blue-700 via-primary to-sky-500',
    markIcon: MapPin,
    headline: 'Absensi yang benar-benar bisa dipercaya.',
    tagline:
      'Lokasi, foto, dan waktu tercatat otomatis di setiap absen — tanpa mesin fingerprint, tanpa antre.',
    mobileTagline: 'Absensi dengan verifikasi lokasi & foto',
    subtext: 'text-blue-100',
    subtextDim: 'text-blue-100/80',
    highlights: [
      {
        icon: MapPin,
        title: 'Absen terverifikasi lokasi',
        body: 'Geofence memastikan absensi hanya sah bila dilakukan di dalam area kantor.',
      },
      {
        icon: Camera,
        title: 'Swafoto sebagai bukti',
        body: 'Setiap absen menyimpan foto, waktu, dan koordinat — tidak bisa dititipkan.',
      },
      {
        icon: CalendarClock,
        title: 'Shift, tukar jadwal & izin',
        body: 'Rotasi shift, pengajuan tukar jadwal, dan izin dikelola dalam satu tempat.',
      },
    ],
  },
  stok: {
    gradient: 'from-amber-600 via-orange-500 to-amber-500',
    markIcon: Warehouse,
    headline: 'Kelola stok gudang dengan rapi.',
    tagline:
      'Inventaris per kategori, barang masuk & keluar berfoto, dan riwayat lengkap — dalam satu dashboard.',
    mobileTagline: 'Inventaris & barang keluar-masuk gudang',
    subtext: 'text-amber-50',
    subtextDim: 'text-amber-50/80',
    highlights: [
      {
        icon: Warehouse,
        title: 'Inventaris lengkap',
        body: 'Semua barang per kategori dengan stok terkini serta status habis & menipis.',
      },
      {
        icon: ArrowLeftRight,
        title: 'Masuk & keluar berfoto',
        body: 'Setiap pergerakan stok tercatat lengkap dengan bukti foto.',
      },
      {
        icon: PackageSearch,
        title: 'Pantau cepat',
        body: 'Cari barang, lihat yang menipis, dan tinjau riwayat kapan saja.',
      },
    ],
  },
};

/** Logo aplikasi: gambar unggahan bila ada, selain itu ikon brand bawaan. */
function BrandMark({
  logoUrl,
  className,
  Icon,
}: {
  logoUrl: string | null;
  className: string;
  Icon: LucideIcon;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        aria-hidden="true"
        className={`${className} rounded-xl bg-white/90 object-contain p-1.5 shadow-elevated`}
      />
    );
  }
  return (
    <span
      className={`${className} flex items-center justify-center rounded-xl bg-white/15 text-white shadow-elevated ring-1 ring-white/25 backdrop-blur`}
    >
      <Icon className="h-[55%] w-[55%]" aria-hidden="true" />
    </span>
  );
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { appName, logoUrl } = await getAppSettings();
  const brand = getServerBrand();
  const cfg = brandConfig(brand, appName);
  const hero = HERO[brand];
  const year = new Date().getFullYear();

  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* ---- Panel brand (desktop saja) ---- */}
      <aside
        className={`relative hidden overflow-hidden bg-gradient-to-br ${hero.gradient} px-12 py-14 lg:flex lg:flex-col lg:justify-between xl:px-16`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -right-28 h-[28rem] w-[28rem] rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        <div className="relative flex items-center gap-3">
          <BrandMark logoUrl={logoUrl} className="h-11 w-11" Icon={hero.markIcon} />
          <p className="text-xl font-bold tracking-tight text-white">{cfg.name}</p>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white xl:text-[2.75rem]">
            {hero.headline}
          </h1>
          <p className={`mt-4 text-lg leading-relaxed ${hero.subtext}`}>{hero.tagline}</p>

          <ul className="mt-10 flex flex-col gap-6">
            {hero.highlights.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white ring-1 ring-white/20 backdrop-blur">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold text-white">{title}</p>
                  <p className={`mt-0.5 text-sm leading-relaxed ${hero.subtext}`}>{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className={`relative flex items-center gap-2 text-sm ${hero.subtextDim}`}>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          StarConnect · {year}
        </p>
      </aside>

      {/* ---- Panel form ---- */}
      <div
        className={`relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-gradient-to-br ${hero.gradient} p-4 lg:min-h-0 lg:bg-background lg:bg-none lg:p-8`}
      >
        {/* Dekorasi hanya untuk tampilan mobile (desktop pakai panel brand) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl lg:hidden"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-white/10 blur-3xl lg:hidden"
        />

        {/* Header brand — hanya di mobile/tablet */}
        <div className="relative mb-7 flex items-center gap-3 lg:hidden">
          <BrandMark logoUrl={logoUrl} className="h-12 w-12" Icon={hero.markIcon} />
          <div>
            <p className="text-2xl font-bold tracking-tight text-white">{cfg.name}</p>
            <p className={`text-xs ${hero.subtext}`}>{hero.mobileTagline}</p>
          </div>
        </div>

        <div className="relative w-full max-w-md animate-slide-up">{children}</div>

        <p className={`relative mt-8 text-center text-xs ${hero.subtextDim}`}>
          StarConnect · {year}
        </p>
      </div>
    </main>
  );
}
