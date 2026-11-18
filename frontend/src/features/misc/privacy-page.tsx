// Privacy notice for visitor analytics: a passive page (linked from the footer), never a pop-up.
import * as React from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/misc';
import { analyticsConfigured, browserAsksNotToTrack, isAnalyticsOptedOut, setAnalyticsOptOut } from '@/lib/analytics';
import { Switch } from '@/components/ui/controls';
import { useAuth, roleHome } from '@/providers/auth-provider';

export function PrivacyPage() {
  useDocumentTitle('Privacy');
  const { profile } = useAuth();
  const [on, setOn] = React.useState(() => !isAnalyticsOptedOut());
  const dnt = browserAsksNotToTrack();
  const configured = analyticsConfigured();

  return (
    <div className="text-[14px] leading-6 text-ink">
      <div className="mb-4 grid size-12 place-items-center rounded-[14px] bg-primary-soft text-primary">
        <ShieldCheck className="size-6" />
      </div>
      <h1 className="font-display text-[22px] font-semibold leading-8">Privacy</h1>
      <p className="mt-1 text-sm text-muted">How CampusHub measures visits, and how to turn it off.</p>

      <h2 className="mt-6 font-semibold">What we measure</h2>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted">
        <li>Which pages are opened and when. The address is recorded without anything after a “?”, and record numbers are left out.</li>
        <li>How you arrived: a search engine, a link from another site, or directly.</li>
        <li>Your browser, device type and screen-size range.</li>
        <li>Your approximate country, worked out on our server from your network address. The full address isn’t kept.</li>
        <li>A random code stored in this browser, so a second visit counts as a returning visitor rather than a new one.</li>
      </ul>

      <h2 className="mt-5 font-semibold">What we don’t</h2>
      <p className="mt-1.5 text-muted">
        No names, email addresses or anything you type. No advertising, and nothing is sold or shared. Visits aren’t linked
        to your account. The data is used only by the team that runs CampusHub, to keep it working well, and is deleted
        after 13 months.
      </p>

      <h2 className="mt-5 font-semibold">Your choice</h2>
      {dnt ? (
        <p className="mt-1.5 text-muted">Your browser asks sites not to track you (Do Not Track or Global Privacy Control), so CampusHub doesn’t measure your visits.</p>
      ) : !configured ? (
        <p className="mt-1.5 text-muted">Visit measurement is not switched on for this site.</p>
      ) : (
        <label className="mt-2 flex items-center justify-between gap-4 rounded-[12px] border border-border px-4 py-3">
          <span>
            <span className="block font-medium">Measure my visits on this device</span>
            <span className="block text-[12.5px] text-muted">Turning this off also forgets this browser’s random code.</span>
          </span>
          <Switch
            checked={on}
            onCheckedChange={(v) => {
              setAnalyticsOptOut(!v);
              setOn(v);
            }}
            aria-label="Measure my visits on this device"
          />
        </label>
      )}

      <h2 className="mt-5 font-semibold">Security</h2>
      <p className="mt-1.5 text-muted">
        Separately, sign-in attempts and requests to CampusHub’s servers are logged to detect and stop attacks. That can’t
        be switched off, and it is used for nothing else.
      </p>

      <Link
        to={profile ? roleHome(profile.role) : '/login'}
        className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline"
      >
        <ArrowLeft className="size-4" /> Back to CampusHub
      </Link>
    </div>
  );
}
