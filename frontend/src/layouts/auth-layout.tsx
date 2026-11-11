import { Outlet } from 'react-router';
import { CalendarCheck2, FileCheck2, Search } from 'lucide-react';
import { Logo, Wordmark } from '@/components/common/brand';
import { usePublicSettings } from '@/hooks/use-public-settings';

// A stylised week of slot bars — the product's motif — drawn once on the brand panel.
const WEEK: { day: string; slots: [number, number, 'booked' | 'hold' | 'mine' | 'blocked'][] }[] = [
  { day: 'Mon', slots: [[8, 26, 'booked'], [40, 62, 'hold']] },
  { day: 'Tue', slots: [[14, 30, 'mine'], [58, 86, 'booked']] },
  { day: 'Wed', slots: [[0, 100, 'blocked']] },
  { day: 'Thu', slots: [[22, 44, 'booked'], [50, 64, 'hold'], [72, 92, 'booked']] },
  { day: 'Fri', slots: [[6, 18, 'hold'], [34, 70, 'mine']] },
];
const SLOT_STYLE: Record<string, React.CSSProperties> = {
  booked: { background: 'rgba(255,255,255,0.82)' },
  hold: { background: 'repeating-linear-gradient(135deg, rgba(245,158,11,0.95) 0 5px, rgba(245,158,11,0.55) 5px 10px)' },
  mine: { background: '#5EEAD4' },
  blocked: {
    background:
      'repeating-linear-gradient(45deg, rgba(255,255,255,0.28) 0 1.5px, transparent 1.5px 7px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.28) 0 1.5px, transparent 1.5px 7px)',
  },
};

function WeekIllustration() {
  return (
    <div aria-hidden className="rounded-[18px] border border-white/12 bg-white/[0.06] p-5 backdrop-blur-[2px]">
      <div className="mb-4 flex items-center justify-between text-[12px] font-semibold text-white/70">
        <span>This week · Seminar Hall A</span>
        <span className="tabular">08:00 – 20:00</span>
      </div>
      <div className="grid gap-3">
        {WEEK.map((row, r) => (
          <div key={row.day} className="flex items-center gap-3">
            <span className="w-8 text-[11px] font-bold uppercase tracking-[0.6px] text-white/55">{row.day}</span>
            <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-white/[0.09]">
              {row.slots.map(([s, e, kind], i) => (
                <span
                  key={i}
                  className="motion-safe-only absolute inset-y-0 rounded-full"
                  style={{
                    left: `${s}%`,
                    width: `${e - s}%`,
                    transformOrigin: 'left center',
                    animation: `slot-grow 520ms var(--ease-out) ${180 + r * 70 + i * 40}ms backwards`,
                    ...SLOT_STYLE[kind],
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-white/65">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full" style={SLOT_STYLE.booked} />Booked</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full" style={SLOT_STYLE.hold} />On hold</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full" style={SLOT_STYLE.mine} />Yours</span>
      </div>
    </div>
  );
}

const BENEFITS = [
  { icon: Search, text: 'Find a free venue in seconds' },
  { icon: CalendarCheck2, text: 'Track every request in one place' },
  { icon: FileCheck2, text: 'Approved bookings with downloadable confirmation' },
];

export function AuthLayout() {
  const { data } = usePublicSettings();
  const institution = data?.institutionName ?? 'CampusHub';
  return (
    <div className="flex min-h-dvh bg-background">
      <aside
        className="relative hidden w-[45%] max-w-[640px] flex-col justify-between overflow-hidden px-12 py-10 text-white lg:flex"
        style={{ background: 'linear-gradient(150deg, #1B2F6E 0%, #1E3A8A 38%, #155E75 78%, #0F766E 100%)' }}
      >
        <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full border-[56px] border-white/[0.05]" />
        <span aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 size-[420px] rounded-full bg-[#0D9488]/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <Logo size={44} className="shadow-[0_8px_24px_rgba(0,0,0,0.25)]" />
          <div>
            <Wordmark invert className="text-[20px]" />
            <p className="mt-1 text-[13px] font-medium text-white/65">Venue Booking</p>
          </div>
        </div>
        <div className="relative my-10">
          <h1 className="font-display text-[30px] font-bold leading-9 tracking-[-0.5px]">Your campus, simplified.</h1>
          <p className="mt-3 max-w-[420px] text-[15px] leading-6 text-white/75">
            Request halls, labs and spaces in a few steps, and see every decision as it happens.
          </p>
          <ul className="mt-7 grid gap-3.5">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-[14.5px] text-white/90">
                <span className="grid size-8 place-items-center rounded-[10px] bg-white/10">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <div className="mt-10 max-w-[460px]">
            <WeekIllustration />
          </div>
        </div>
        <p className="relative text-[12px] text-white/50">
          © {new Date().getFullYear()} {institution}
        </p>
      </aside>

      <main id="main" className="flex flex-1 flex-col">
        <div className="flex items-center gap-2.5 px-4 pt-6 lg:hidden">
          <Logo size={36} />
          <Wordmark />
        </div>
        <div className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
          <div className="page-enter w-full max-w-[420px]">
            <div className="card p-6 sm:p-8">
              <Outlet />
            </div>
          </div>
        </div>
        <p className="pb-6 text-center text-[12px] text-subtle lg:hidden">
          © {new Date().getFullYear()} {institution}
        </p>
      </main>
    </div>
  );
}
