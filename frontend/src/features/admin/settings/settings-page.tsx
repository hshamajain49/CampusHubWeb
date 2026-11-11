import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { CircleCheck, CircleDashed, Info, RotateCcw, Save, ScrollText, X } from 'lucide-react';
import { DOMAIN_RE, REMINDER_LEADS, TIME_STEPS, buildTimeOptions, formatDuration, type Settings } from '@campushub/shared';
import { ApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/menus';
import { Field } from '@/components/common/form-field';
import { PageHeader, SectionCard } from '@/components/common/layout-bits';
import { ErrorState } from '@/components/common/states';
import { useAdminSettings, useUpdateSettings } from '../api';

type Draft = Partial<Settings>;
const DAY_TIMES = buildTimeOptions('00:00', '23:55', 5);

function useTabForm(settings: Settings, keys: (keyof Settings)[]) {
  const pick = React.useCallback(() => Object.fromEntries(keys.map((k) => [k, settings[k]])) as Draft, [settings, keys]);
  const [draft, setDraft] = React.useState<Draft>(pick);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  React.useEffect(() => setDraft(pick()), [pick]);
  const original = pick();
  const changed = keys.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(original[k]));
  const update = useUpdateSettings();
  const save = async () => {
    setErrors({});
    setFormError(null);
    try {
      await update.mutateAsync(Object.fromEntries(changed.map((k) => [k, draft[k]])));
      toast.success('Settings saved. New rules apply to new requests and changes.');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && Object.keys(e.fieldErrors).length) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.split('.')[0]!, v[0]!])));
      } else setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => ({ ...e, [k as string]: '' }));
  };
  return { draft, set, errors, formError, changed, save, saving: update.isPending, reset: () => setDraft(pick()) };
}

function Actions({ f }: { f: ReturnType<typeof useTabForm> }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
      <Button variant="outline" disabled={!f.changed.length || f.saving} onClick={f.reset}>
        <RotateCcw /> Reset
      </Button>
      <Button disabled={!f.changed.length} loading={f.saving} onClick={() => void f.save()}>
        <Save /> Save changes
      </Button>
    </div>
  );
}

function NumberField({ label, hint, value, onChange, error, unit, echo, min, max }: { label: string; hint: string; value: number; onChange: (v: number) => void; error?: string; unit?: string; echo?: string; min: number; max: number }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(p) => (
        <div className="flex items-center gap-2">
          <Input
            {...p}
            inputMode="numeric"
            className="tabular max-w-[140px]"
            value={Number.isFinite(value) ? String(value) : ''}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, '').slice(0, 6);
              onChange(d === '' ? NaN : Math.min(Number(d), max * 10));
            }}
            aria-valuemin={min}
            aria-valuemax={max}
          />
          {unit && <span className="text-[13px] text-muted">{unit}</span>}
          {echo && <span className="tabular rounded-full bg-surface-muted px-2 py-0.5 text-[12px] font-semibold text-muted">= {echo}</span>}
        </div>
      )}
    </Field>
  );
}

const RULE_KEYS: (keyof Settings)[] = [
  'operatingHoursStart',
  'operatingHoursEnd',
  'timeStepMinutes',
  'minDurationMinutes',
  'maxDurationMinutes',
  'maxAdvanceDays',
  'minLeadTimeMinutes',
  'cancellationCutoffMinutes',
  'modificationCutoffMinutes',
  'maxPendingPerUser',
];

function BookingRulesTab({ s }: { s: Settings }) {
  const f = useTabForm(s, RULE_KEYS);
  const d = f.draft as Settings;
  const echo = (m: number) => (Number.isFinite(m) && m > 0 ? formatDuration(m) : undefined);
  return (
    <SectionCard>
      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Opening time" hint="Earliest booking start; calendars start here." error={f.errors.operatingHoursStart}>
            {(p) => <Select id={p.id} value={d.operatingHoursStart} onValueChange={(v) => f.set('operatingHoursStart', v)} options={DAY_TIMES.map((t) => ({ value: t, label: t }))} className="tabular" />}
          </Field>
          <Field label="Closing time" hint="Latest booking end." error={f.errors.operatingHoursEnd}>
            {(p) => <Select id={p.id} value={d.operatingHoursEnd} onValueChange={(v) => f.set('operatingHoursEnd', v)} options={DAY_TIMES.map((t) => ({ value: t, label: t }))} className="tabular" />}
          </Field>
          <Field label="Time step" hint="Start and end times use this minute granularity." error={f.errors.timeStepMinutes}>
            {(p) => (
              <Select id={p.id} value={String(d.timeStepMinutes)} onValueChange={(v) => f.set('timeStepMinutes', Number(v))} options={TIME_STEPS.map((t) => ({ value: String(t), label: `${t} minutes` }))} />
            )}
          </Field>
          <NumberField label="Max pending requests per member" hint="Simultaneous pending requests allowed." value={d.maxPendingPerUser} onChange={(v) => f.set('maxPendingPerUser', v)} error={f.errors.maxPendingPerUser} min={1} max={100} />
          <NumberField label="Minimum duration" hint="Shortest allowed booking." unit="minutes" echo={echo(d.minDurationMinutes)} value={d.minDurationMinutes} onChange={(v) => f.set('minDurationMinutes', v)} error={f.errors.minDurationMinutes} min={5} max={1440} />
          <NumberField label="Maximum duration" hint="Longest allowed booking." unit="minutes" echo={echo(d.maxDurationMinutes)} value={d.maxDurationMinutes} onChange={(v) => f.set('maxDurationMinutes', v)} error={f.errors.maxDurationMinutes} min={5} max={1440} />
          <NumberField label="Maximum advance" hint="Latest bookable date is today + this many days." unit="days" value={d.maxAdvanceDays} onChange={(v) => f.set('maxAdvanceDays', v)} error={f.errors.maxAdvanceDays} min={1} max={730} />
          <NumberField label="Minimum lead time" hint="Bookings must start later than now + this." unit="minutes" echo={echo(d.minLeadTimeMinutes)} value={d.minLeadTimeMinutes} onChange={(v) => f.set('minLeadTimeMinutes', v)} error={f.errors.minLeadTimeMinutes} min={0} max={20160} />
          <NumberField label="Cancellation cut-off" hint="Members may cancel an approved booking until start − this." unit="minutes before start" echo={echo(d.cancellationCutoffMinutes)} value={d.cancellationCutoffMinutes} onChange={(v) => f.set('cancellationCutoffMinutes', v)} error={f.errors.cancellationCutoffMinutes} min={0} max={20160} />
          <NumberField label="Modification cut-off" hint="Members may edit until start − this." unit="minutes before start" echo={echo(d.modificationCutoffMinutes)} value={d.modificationCutoffMinutes} onChange={(v) => f.set('modificationCutoffMinutes', v)} error={f.errors.modificationCutoffMinutes} min={0} max={20160} />
        </div>
        {f.formError && <Alert variant="error">{f.formError}</Alert>}
        <Actions f={f} />
      </div>
    </SectionCard>
  );
}

function RegistrationTab({ s }: { s: Settings }) {
  const f = useTabForm(s, ['selfRegistrationEnabled', 'allowedEmailDomains']);
  const d = f.draft as Settings;
  const [domain, setDomain] = React.useState('');
  const [domainError, setDomainError] = React.useState<string | null>(null);
  const addDomain = () => {
    const v = domain.trim().toLowerCase().replace(/^@/, '');
    if (!v) return;
    if (!DOMAIN_RE.test(v)) return setDomainError('Enter a domain like college.edu');
    if (d.allowedEmailDomains.length >= 20) return setDomainError('Add at most 20 domains');
    if (!d.allowedEmailDomains.includes(v)) f.set('allowedEmailDomains', [...d.allowedEmailDomains, v]);
    setDomain('');
    setDomainError(null);
  };
  return (
    <SectionCard>
      <div className="grid gap-5">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold text-ink">Allow students to self-register</span>
            <span className="block text-[12.5px] text-muted">Shows "Create an account" on the sign-in page.</span>
          </span>
          <Switch checked={d.selfRegistrationEnabled} onCheckedChange={(c) => f.set('selfRegistrationEnabled', c)} />
        </label>
        <Field label="Allowed email domains" hint="Leave empty to allow any email address." error={domainError ?? f.errors.allowedEmailDomains}>
          {(p) => (
            <div className="flex gap-2">
              <Input
                {...p}
                placeholder="college.edu"
                autoCapitalize="none"
                value={domain}
                onChange={(e) => {
                  setDomainError(null);
                  setDomain(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addDomain();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addDomain}>
                Add
              </Button>
            </div>
          )}
        </Field>
        {d.allowedEmailDomains.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {d.allowedEmailDomains.map((x) => (
              <span key={x} className="chip inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-[12.5px] font-semibold text-primary">
                @{x}
                <button type="button" aria-label={`Remove ${x}`} onClick={() => f.set('allowedEmailDomains', d.allowedEmailDomains.filter((y) => y !== x))} className="rounded-full p-0.5 hover:bg-primary/10">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {f.formError && <Alert variant="error">{f.formError}</Alert>}
        <Actions f={f} />
      </div>
    </SectionCard>
  );
}

function ChannelLine({ label, status }: { label: string; status: string }) {
  const ok = status === 'configured';
  const dev = status === 'console' || status === 'file';
  return (
    <li className="flex items-center gap-2 text-[13px]">
      {ok || dev ? <CircleCheck className="size-4 text-success" /> : <CircleDashed className="size-4 text-subtle" />}
      <span className="font-semibold text-ink">{label}:</span>
      <span className="text-muted">{ok ? 'configured' : dev ? `development (${status})` : 'not configured'}</span>
    </li>
  );
}

function NotificationsTab({ s }: { s: Settings }) {
  const f = useTabForm(s, ['emailNotificationsEnabled', 'emailDailyLimit', 'reminderLeadMinutes']);
  const d = f.draft as Settings;
  return (
    <SectionCard>
      <div className="grid gap-5">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold text-ink">Send notification emails</span>
            <span className="block text-[12.5px] text-muted">Password-reset emails are always sent.</span>
          </span>
          <Switch checked={d.emailNotificationsEnabled} onCheckedChange={(c) => f.set('emailNotificationsEnabled', c)} />
        </label>
        <NumberField
          label="Daily email limit"
          hint="Brevo's free plan allows 300 emails a day. Password-reset emails are always sent and count towards it."
          value={d.emailDailyLimit}
          onChange={(v) => f.set('emailDailyLimit', v)}
          error={f.errors.emailDailyLimit}
          min={0}
          max={300}
        />
        <p className="tabular -mt-2 text-[12.5px] text-muted">
          Sent today: {s.emailUsageToday.sent} · Skipped (limit): {s.emailUsageToday.skipped} · Password resets: {s.emailUsageToday.authSent}
        </p>
        <Field label="Booking reminder" hint="Approved bookings get a reminder this long before they start." error={f.errors.reminderLeadMinutes}>
          {(p) => (
            <Select
              id={p.id}
              className="max-w-[260px]"
              value={String(d.reminderLeadMinutes)}
              onValueChange={(v) => f.set('reminderLeadMinutes', Number(v))}
              options={REMINDER_LEADS.map((m) => ({ value: String(m), label: m === 0 ? 'Off' : `${formatDuration(m)} before start` }))}
            />
          )}
        </Field>
        <div className="rounded-[12px] bg-surface-muted p-4">
          <p className="eyebrow mb-2">Channels</p>
          <ul className="grid gap-1.5">
            <ChannelLine label="Email" status={s.channels.email} />
            <ChannelLine label="Push" status={s.channels.push} />
            <ChannelLine label="Live updates" status={s.channels.realtime} />
            <ChannelLine label="Venue photos" status={s.channels.images} />
          </ul>
        </div>
        {f.formError && <Alert variant="error">{f.formError}</Alert>}
        <Actions f={f} />
      </div>
    </SectionCard>
  );
}

function InstitutionTab({ s }: { s: Settings }) {
  const f = useTabForm(s, ['institutionName', 'supportEmail']);
  const d = f.draft as Settings;
  return (
    <SectionCard>
      <div className="grid gap-5">
        <Field label="Institution name" hint="Shown in the header, emails and PDF confirmations." error={f.errors.institutionName}>
          {(p) => <Input {...p} maxLength={150} value={d.institutionName} onChange={(e) => f.set('institutionName', e.target.value)} />}
        </Field>
        <Field label="Support email" optional hint="Shown in the footer and on PDFs." error={f.errors.supportEmail}>
          {(p) => <Input {...p} type="email" value={d.supportEmail ?? ''} onChange={(e) => f.set('supportEmail', e.target.value || null)} />}
        </Field>
        <Field
          label="Campus timezone"
          labelAction={
            <Tooltip content="Set during installation. Changing it requires a maintenance procedure (§30.13).">
              <button type="button" aria-label="About the campus timezone" className="text-muted">
                <Info className="size-4" />
              </button>
            </Tooltip>
          }
          hint="Set during installation. Changing it requires a maintenance procedure (§30.13)."
        >
          {(p) => <Input {...p} readOnly value={s.campusTimezone} />}
        </Field>
        {f.formError && <Alert variant="error">{f.formError}</Alert>}
        <Actions f={f} />
      </div>
    </SectionCard>
  );
}

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'booking-rules';
  const q = useAdminSettings();
  return (
    <div className="mx-auto max-w-[880px]">
      <PageHeader
        title="System settings"
        description={q.data?.updatedBy ? `Last changed by ${q.data.updatedBy.fullName}` : undefined}
        actions={
          <Button variant="outline" asChild>
            <Link to="/admin/settings/audit-log">
              <ScrollText /> View audit log
            </Link>
          </Button>
        }
      />
      {q.isLoading ? (
        <Skeleton className="h-[520px] rounded-[14px]" />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <Tabs value={tab} onValueChange={(t) => setParams(t === 'booking-rules' ? {} : { tab: t }, { replace: true })}>
          <TabsList className="mb-5">
            <TabsTrigger value="booking-rules">Booking rules</TabsTrigger>
            <TabsTrigger value="registration">Registration & access</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="institution">Institution</TabsTrigger>
          </TabsList>
          <TabsContent value="booking-rules" className="outline-none">
            <BookingRulesTab s={q.data!} />
          </TabsContent>
          <TabsContent value="registration" className="outline-none">
            <RegistrationTab s={q.data!} />
          </TabsContent>
          <TabsContent value="notifications" className="outline-none">
            <NotificationsTab s={q.data!} />
          </TabsContent>
          <TabsContent value="institution" className="outline-none">
            <InstitutionTab s={q.data!} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
