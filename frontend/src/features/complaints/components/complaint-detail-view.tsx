// One complaint detail layout for the three viewers (§8.3 CU03, CS03, CA02). The API's `permissions` decide which
// actions appear, so the page never offers something the server would refuse.
import * as React from 'react';
import { Link } from 'react-router';
import {
  ArrowRightLeft,
  Building2,
  CalendarClock,
  CheckCheck,
  Clock,
  Flag,
  FlagOff,
  Hash,
  Mail,
  MapPin,
  MoreHorizontal,
  RotateCcw,
  ScrollText,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  UserRound,
  Wrench,
  XCircle,
} from 'lucide-react';
import { CLOSURE_TYPE_LABELS, type Complaint } from '@campushub/shared';
import { formatTimestamp } from '@/lib/format';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menus';
import { RoleBadge } from '@/components/common/badges';
import { InfoRow, PageHeader, SectionCard } from '@/components/common/layout-bits';
import { CategoryTile, ComplaintFlags, ComplaintProgress, ComplaintStatusBadge, ComplaintTimeline } from './complaint-visuals';
import { PhotoGallery } from './photo-gallery';
import {
  ApproveDialog,
  CloseDialog,
  CompleteWorkDialog,
  DismissReassignmentDialog,
  ReassignDialog,
  RejectDialog,
  ReopenDialog,
  ReporterReopenDialog,
  RequestReassignmentDialog,
  StartWorkDialog,
  WithdrawDialog,
} from './complaint-dialogs';
import type { ComplaintScope } from '../api';

type DialogName =
  | 'approve'
  | 'reject'
  | 'withdraw'
  | 'reporterReopen'
  | 'start'
  | 'complete'
  | 'reopen'
  | 'requestReassignment'
  | 'reassign'
  | 'dismiss'
  | 'close';

interface Action {
  key: string;
  label: string;
  icon: React.ReactNode;
  variant: 'default' | 'outline' | 'destructive-outline' | 'success';
  onClick?: () => void;
  to?: string;
  disabled?: boolean;
}

const dateTime = (iso: string, tz: string) => formatTimestamp(iso, tz);

/** Status explanation (§8.3 CU03 table), worded for the viewer. */
function StatusCallout({ c, scope, tz }: { c: Complaint; scope: ComplaintScope; tz: string }) {
  const dept = c.department.name;
  const reporterView = scope === 'reporter';
  switch (c.status) {
    case 'pending_review':
      return <Alert variant="warning">{reporterView ? `Waiting for the ${dept} to pick this up.` : `New in the ${dept} queue. Nobody has started work yet.`}</Alert>;
    case 'in_progress':
      return (
        <Alert variant="info" icon={<Wrench />}>
          The {dept} is working on it.
          {c.handledBy && <span className="block font-semibold">Handled by {c.handledBy.fullName}</span>}
        </Alert>
      );
    case 'awaiting_confirmation':
      return reporterView ? null : (
        <Alert variant="info" icon={<ThumbsUp />} title={`Waiting for ${c.reporter.fullName} to approve`}>
          {c.autoResolveAt && <>If they don't respond by {dateTime(c.autoResolveAt, tz)}, it will be marked resolved automatically.</>}
        </Alert>
      );
    case 'resolved':
      return (
        <Alert variant="success">
          {reporterView ? 'This issue has been resolved. Thanks for reporting it!' : c.autoResolved ? 'Resolved automatically — the reporter did not respond.' : 'Resolved — approved by the reporter.'}
          {!reporterView && c.reporterReopenUntil && new Date(c.reporterReopenUntil) > new Date() && (
            <span className="block">The reporter can reopen it until {dateTime(c.reporterReopenUntil, tz)}.</span>
          )}
        </Alert>
      );
    case 'withdrawn':
      return (
        <Alert variant="info" icon={<Undo2 />}>
          {reporterView ? 'You withdrew' : `${c.reporter.fullName} withdrew`} this complaint on {c.closedAt ? dateTime(c.closedAt, tz) : '—'}.
          {c.closureReason && <span className="block">Reason: {c.closureReason}</span>}
        </Alert>
      );
    case 'closed':
      return (
        <Alert variant="info" icon={<XCircle />} title={`Closed by the administrator — ${c.closureType ? CLOSURE_TYPE_LABELS[c.closureType] : ''}`}>
          <p className="whitespace-pre-line">{c.closureReason}</p>
        </Alert>
      );
  }
}

/** "Review the work" (CW-03) for the reporter while awaiting approval. */
function ReviewCard({ c, tz, onApprove, onReject }: { c: Complaint; tz: string; onApprove: () => void; onReject: () => void }) {
  return (
    <section className="rounded-[14px] border border-[#C9D5F2] bg-primary-soft/70 p-4 md:p-5" aria-labelledby="review-heading">
      <h2 id="review-heading" className="font-display text-[17px] font-semibold text-ink">
        Review the work
      </h2>
      <p className="mt-1 text-sm text-ink">The {c.department.name} says this is fixed. Is the issue resolved to your satisfaction?</p>
      {c.resolutionNote && (
        <blockquote className="mt-3 whitespace-pre-line rounded-[10px] border-l-[3px] border-primary bg-surface px-3 py-2 text-[13.5px] text-ink">
          {c.resolutionNote}
          {c.handledBy && <span className="mt-1 block text-[12px] text-muted">— {c.handledBy.fullName}</span>}
        </blockquote>
      )}
      {c.attachments.resolution.length > 0 && (
        <div className="mt-3">
          <PhotoGallery photos={c.attachments.resolution} label="Photos from the department" />
        </div>
      )}
      {c.autoResolveAt && (
        <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-muted">
          <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          If you don't respond by {dateTime(c.autoResolveAt, tz)}, it will be marked resolved automatically.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2 [&>*]:max-sm:flex-1">
        <Button onClick={onApprove}>
          <ThumbsUp /> Approve
        </Button>
        <Button variant="destructive-outline" onClick={onReject}>
          <ThumbsDown /> Not fixed yet
        </Button>
      </div>
    </section>
  );
}

export function ComplaintDetailView({
  c,
  scope,
  refetch,
  breadcrumb,
  extraActions = [],
  headerExtra,
  banner,
}: {
  c: Complaint;
  scope: ComplaintScope;
  refetch: () => void;
  breadcrumb: { label: string; to?: string }[];
  /** Admin-only extra actions (e.g. block the venue for maintenance). */
  extraActions?: Action[];
  headerExtra?: React.ReactNode;
  /** Shown above the layout (e.g. "Complaint submitted!"). */
  banner?: React.ReactNode;
}) {
  const me = useMe();
  const { data: settings } = usePublicSettings();
  const tz = settings?.campusTimezone ?? 'UTC';
  const [dialog, setDialog] = React.useState<DialogName | null>(null);
  const p = c.permissions;
  const isReporter = c.reporter.id === me.id;
  const reporterView = scope === 'reporter';
  const showReview = (reporterView || isReporter) && p.canApprove;

  // Primary + secondary actions by viewer (§5 CW-05 table, CW-06).
  const actions: Action[] = [];
  const open = (d: DialogName) => () => setDialog(d);
  // The reporter's review is the main action: also in the side card / sticky bar, not only in the review card.
  if (showReview) {
    actions.push({ key: 'approve', label: 'Approve the fix', icon: <ThumbsUp />, variant: 'default', onClick: open('approve') });
    actions.push({ key: 'reject', label: 'Not fixed yet', icon: <ThumbsDown />, variant: 'destructive-outline', onClick: open('reject') });
  }
  if (!reporterView) {
    if (p.canStart) actions.push({ key: 'start', label: 'Start work', icon: <Wrench />, variant: 'default', onClick: open('start') });
    if (p.canComplete) actions.push({ key: 'complete', label: 'Mark work done', icon: <CheckCheck />, variant: 'default', onClick: open('complete') });
    if (c.status === 'awaiting_confirmation' && !showReview)
      actions.push({ key: 'wait', label: `Waiting for ${c.reporter.fullName.split(' ')[0]} to approve`, icon: <Clock />, variant: 'outline', disabled: true });
    if (p.canReopen) actions.push({ key: 'reopen', label: 'Reopen', icon: <RotateCcw />, variant: 'outline', onClick: open('reopen') });
    if (p.canRequestReassignment)
      actions.push({ key: 'rr', label: 'Request reassignment', icon: <Flag />, variant: 'outline', onClick: open('requestReassignment') });
    if (p.canReassign) actions.push({ key: 'reassign', label: 'Reassign', icon: <ArrowRightLeft />, variant: 'outline', onClick: open('reassign') });
    if (scope === 'admin' && c.reassignmentRequested)
      actions.push({ key: 'dismiss', label: 'Dismiss reassignment request', icon: <FlagOff />, variant: 'outline', onClick: open('dismiss') });
    if (p.canClose) actions.push({ key: 'close', label: 'Close complaint', icon: <XCircle />, variant: 'destructive-outline', onClick: open('close') });
  } else if (p.canReopen) {
    actions.push({ key: 'rreopen', label: 'Not fixed? Reopen', icon: <RotateCcw />, variant: 'default', onClick: open('reporterReopen') });
  }
  if (p.canWithdraw && (reporterView || isReporter))
    actions.push({ key: 'withdraw', label: 'Withdraw complaint', icon: <Undo2 />, variant: 'destructive-outline', onClick: open('withdraw') });
  actions.push(...extraActions);

  const renderButton = (a: Action, extra = '') =>
    a.to ? (
      <Button key={a.key} variant={a.variant} size="lg" asChild className={extra}>
        <Link to={a.to}>
          {a.icon} {a.label}
        </Link>
      </Button>
    ) : (
      <Button key={a.key} variant={a.variant} size="lg" onClick={a.onClick} disabled={a.disabled} className={extra}>
        {a.icon} {a.label}
      </Button>
    );
  const finalNote = (
    <p className="rounded-[10px] bg-surface-muted px-3.5 py-3 text-[13px] text-muted">
      {c.status === 'withdrawn' || c.status === 'closed' ? 'This complaint is final and can no longer be changed.' : 'No actions right now.'}
    </p>
  );

  const reopenNotice =
    reporterView && c.status === 'resolved' && c.autoResolved && c.reporterReopenUntil && p.canReopen ? (
      <Alert variant="warning" title="Resolved automatically">
        Resolved automatically on {c.resolvedAt ? dateTime(c.resolvedAt, tz) : '—'} because we didn't hear back. Not fixed? You can reopen it until{' '}
        {dateTime(c.reporterReopenUntil, tz)}.
      </Alert>
    ) : null;

  const dialogProps = { c, onStale: refetch };
  const venueLink =
    c.venue && (scope === 'admin' ? `/admin/venues/${c.venue.id}` : c.venue.isActive && scope === 'reporter' ? `/venues/${c.venue.id}` : null);

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader title="Complaint details" breadcrumb={breadcrumb} className="mb-5" />
      {banner && <div className="mb-5">{banner}</div>}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="grid min-w-0 gap-5 lg:col-span-8">
          <section className="card p-4 md:p-5">
            <div className="flex flex-wrap items-start gap-3">
              <CategoryTile icon={c.category.icon} color={c.category.color} size={44} />
              <div className="min-w-0 flex-1">
                <h2 className="break-words font-display text-[19px] font-semibold leading-[26px] text-ink">{c.title}</h2>
                <p className="tabular mt-0.5 text-[13px] text-muted">
                  <span className="font-mono font-medium text-ink">{c.reference}</span> · {c.category.name} · Submitted {dateTime(c.createdAt, tz)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ComplaintStatusBadge status={c.status} />
                  <ComplaintFlags c={c} viewer={reporterView ? 'reporter' : scope} />
                  {headerExtra}
                </div>
              </div>
            </div>
            <ComplaintProgress status={c.status} viewer={reporterView ? 'reporter' : scope} className="mt-5" />
            <div className="mt-5 grid gap-3">
              <StatusCallout c={c} scope={scope} tz={tz} />
              {c.rejectedByReporter && c.rejectionReason && (
                <Alert variant="error" icon={<ThumbsDown />} title={reporterView ? 'You sent this back' : 'Reopened by the reporter'}>
                  <p className="whitespace-pre-line">{c.rejectionReason}</p>
                </Alert>
              )}
              {!reporterView && c.reassignmentRequested && (
                <Alert variant="warning" icon={<Flag />} title="Reassignment requested">
                  <p className="whitespace-pre-line">{c.reassignmentNote}</p>
                  {c.reassignmentSuggestedCategory && (
                    <p className="mt-1">
                      Suggested: {c.reassignmentSuggestedCategory.name} → {c.reassignmentSuggestedCategory.department.name}
                    </p>
                  )}
                </Alert>
              )}
              {reopenNotice}
            </div>
          </section>

          {showReview && <ReviewCard c={c} tz={tz} onApprove={open('approve')} onReject={open('reject')} />}

          {!reporterView && (
            <SectionCard title="Reported by">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {c.reporter.fullName} <RoleBadge role={c.reporter.role} />
                  </p>
                  <a href={`mailto:${c.reporter.email}`} className="mt-0.5 inline-flex items-center gap-1 break-all text-[13px] text-primary hover:underline">
                    <Mail className="size-3.5 shrink-0" /> {c.reporter.email}
                  </a>
                  {c.reporter.department && <p className="text-[12.5px] text-muted">{c.reporter.department}</p>}
                </div>
              </div>
            </SectionCard>
          )}

          <SectionCard title="Details" bodyClassName="grid gap-x-6 sm:grid-cols-2">
            <InfoRow icon={Tag} label="Category">
              {c.category.name}
            </InfoRow>
            <InfoRow icon={Building2} label="Assigned to">
              {c.department.name}
            </InfoRow>
            {c.venue && (
              <InfoRow icon={Building2} label="Venue">
                {venueLink ? (
                  <Link to={venueLink} className="font-semibold text-primary hover:underline">
                    {c.venue.name}
                  </Link>
                ) : (
                  c.venue.name
                )}
              </InfoRow>
            )}
            <InfoRow icon={MapPin} label="Location">
              {c.locationDetails ?? (c.venue ? '—' : 'Not specified')}
            </InfoRow>
            <InfoRow icon={UserRound} label="Handled by">
              {c.handledBy?.fullName ?? 'Not started yet'}
            </InfoRow>
            <InfoRow icon={Hash} label="Reference">
              <span className="font-mono">{c.reference}</span>
            </InfoRow>
            <InfoRow icon={CalendarClock} label="Submitted">
              <span className="tabular">{dateTime(c.createdAt, tz)}</span>
            </InfoRow>
            <InfoRow icon={Clock} label="Last updated">
              <span className="tabular">{dateTime(c.updatedAt, tz)}</span>
            </InfoRow>
          </SectionCard>

          {c.description && (
            <SectionCard title="Description">
              <p className="whitespace-pre-line break-words text-sm leading-6 text-ink">{c.description}</p>
            </SectionCard>
          )}

          {(c.attachments.report.length > 0 || (c.attachments.resolution.length > 0 && !showReview)) && (
            <SectionCard title="Photos" bodyClassName="grid gap-4">
              {c.attachments.report.length > 0 && (
                <div className="grid gap-2">
                  <p className="text-[13px] font-semibold text-ink">{reporterView ? 'Your photos' : 'Reported photos'}</p>
                  <PhotoGallery photos={c.attachments.report} label="Reported photos" onExpired={refetch} />
                </div>
              )}
              {c.attachments.resolution.length > 0 && !showReview && (
                <div className="grid gap-2">
                  <p className="text-[13px] font-semibold text-ink">Photos from the department</p>
                  <PhotoGallery photos={c.attachments.resolution} label="Photos from the department" onExpired={refetch} />
                </div>
              )}
            </SectionCard>
          )}

          <SectionCard
            title="Activity"
            action={
              scope === 'admin' ? (
                <Link to={`/admin/settings/audit-log?entityType=complaint&entityId=${c.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
                  <ScrollText className="size-3.5" /> View audit entries
                </Link>
              ) : undefined
            }
          >
            <ComplaintTimeline history={c.history} timeZone={tz} meId={me.id} />
          </SectionCard>
        </div>

        <aside className="hidden lg:col-span-4 lg:block">
          <div className="card sticky top-[88px] p-5">
            <p className="eyebrow mb-3">Actions</p>
            <div className="grid gap-2">{actions.length ? actions.map((a) => renderButton(a)) : finalNote}</div>
          </div>
        </aside>
      </div>

      {actions.length ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-3 backdrop-blur-[6px] safe-bottom lg:hidden">
          <div className="mx-auto flex max-w-[1200px] gap-2">
            {renderButton(actions[0]!, 'flex-1')}
            {actions.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="lg" className="w-12 px-0" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end">
                  {actions.slice(1).map((a) =>
                    a.to ? (
                      <DropdownMenuItem key={a.key} asChild>
                        <Link to={a.to}>
                          {a.icon} {a.label}
                        </Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem key={a.key} disabled={a.disabled} destructive={a.variant === 'destructive-outline'} onSelect={a.onClick}>
                        {a.icon} {a.label}
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-5 lg:hidden">{finalNote}</div>
      )}

      {/* Reporter actions always use the reporter endpoints (C05–C07, C30), also for an admin who filed it (CEC-24). */}
      <ApproveDialog {...dialogProps} scope="reporter" open={dialog === 'approve'} onOpenChange={(o) => !o && setDialog(null)} />
      <RejectDialog {...dialogProps} scope="reporter" open={dialog === 'reject'} onOpenChange={(o) => !o && setDialog(null)} />
      <WithdrawDialog {...dialogProps} scope="reporter" open={dialog === 'withdraw'} onOpenChange={(o) => !o && setDialog(null)} />
      <ReporterReopenDialog {...dialogProps} scope="reporter" open={dialog === 'reporterReopen'} onOpenChange={(o) => !o && setDialog(null)} />
      {scope !== 'reporter' && (
        <>
          <StartWorkDialog {...dialogProps} scope={scope} open={dialog === 'start'} onOpenChange={(o) => !o && setDialog(null)} />
          <CompleteWorkDialog {...dialogProps} scope={scope} open={dialog === 'complete'} onOpenChange={(o) => !o && setDialog(null)} />
          <ReopenDialog {...dialogProps} scope={scope} open={dialog === 'reopen'} onOpenChange={(o) => !o && setDialog(null)} />
          <RequestReassignmentDialog {...dialogProps} scope={scope} open={dialog === 'requestReassignment'} onOpenChange={(o) => !o && setDialog(null)} />
        </>
      )}
      {scope === 'admin' && (
        <>
          <ReassignDialog {...dialogProps} open={dialog === 'reassign'} onOpenChange={(o) => !o && setDialog(null)} />
          <DismissReassignmentDialog {...dialogProps} open={dialog === 'dismiss'} onOpenChange={(o) => !o && setDialog(null)} />
          <CloseDialog {...dialogProps} open={dialog === 'close'} onOpenChange={(o) => !o && setDialog(null)} />
        </>
      )}
    </div>
  );
}

export type { Action as ComplaintExtraAction };
