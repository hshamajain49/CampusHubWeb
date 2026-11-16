// Suggestion box (Super Admin): read what members sent, reply, and mark each one reviewed.
import * as React from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Check, Lightbulb, MessageSquareReply, RotateCcw, Search } from 'lucide-react';
import type { AdminSuggestion, SuggestionStatus } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/format';
import { patchParams } from '@/lib/search-params';
import { useDebouncedValue, useDocumentTitle } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pagination, Segmented } from '@/components/common/small';
import { RoleBadge } from '@/components/common/badges';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { SuggestionStatusPill } from '@/features/suggestions/suggestion-status';
import { useAdminSuggestions, useReviewSuggestion } from '@/features/suggestions/api';

const REPLY_MAX = 1000;

function ReplyDialog({ s, onOpenChange }: { s: AdminSuggestion | null; onOpenChange: (open: boolean) => void }) {
  const review = useReviewSuggestion();
  const [reply, setReply] = React.useState('');
  React.useEffect(() => {
    if (s) setReply(s.adminResponse ?? '');
  }, [s]);
  return (
    <ConfirmDialog
      open={!!s}
      onOpenChange={onOpenChange}
      size="lg"
      title="Reply to suggestion"
      description={s ? `“${s.subject}”${s.author ? ` from ${s.author.fullName}` : ''}. The reply is shown to them in their suggestion box.` : undefined}
      confirmLabel="Save and mark reviewed"
      confirmDisabled={reply.length > REPLY_MAX}
      onConfirm={async () => {
        await review.mutateAsync({ id: s!.id, status: 'reviewed', response: reply.trim() || null });
        toast.success('Reply saved.');
      }}
    >
      <Field label="Reply" optional hint={`${reply.length.toLocaleString('en-IN')} / ${REPLY_MAX.toLocaleString('en-IN')}. Leave it empty to remove the reply.`}>
        {(p) => <Textarea {...p} rows={5} autoGrow maxRows={12} value={reply} onChange={(e) => setReply(e.target.value)} />}
      </Field>
    </ConfirmDialog>
  );
}

function SuggestionCard({ s, onReply }: { s: AdminSuggestion; onReply: () => void }) {
  const review = useReviewSuggestion();
  const setStatus = (status: SuggestionStatus) =>
    review.mutate(
      { id: s.id, status },
      {
        onSuccess: () => toast.success(status === 'reviewed' ? 'Marked as reviewed.' : 'Marked as new.'),
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.'),
      },
    );
  return (
    <li className={cn('card grid gap-3 p-4 md:p-5', s.status === 'new' && 'border-l-[3px] border-l-primary')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-[15px] font-semibold text-ink">{s.subject}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            {s.author ? (
              <>
                <span className="font-semibold text-ink">{s.author.fullName}</span>
                <RoleBadge role={s.author.role} />
                <span className="min-w-0 break-all">{s.author.email}</span>
              </>
            ) : (
              <span>Deleted user</span>
            )}
            <span aria-hidden>·</span>
            <span title={new Date(s.createdAt).toLocaleString()}>{timeAgo(s.createdAt)}</span>
          </p>
        </div>
        <SuggestionStatusPill s={s} />
      </div>
      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-5 text-ink">{s.message}</p>
      {s.adminResponse && (
        <div className="rounded-[10px] border border-border bg-surface-muted p-3">
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <MessageSquareReply className="size-3.5" aria-hidden /> Your reply{s.reviewedBy ? ` (${s.reviewedBy.fullName})` : ''}
          </p>
          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-5 text-ink">{s.adminResponse}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onReply}>
          <MessageSquareReply /> {s.adminResponse ? 'Edit reply' : 'Reply'}
        </Button>
        {s.status === 'new' ? (
          <Button size="sm" variant="outline" loading={review.isPending} onClick={() => setStatus('reviewed')}>
            <Check /> Mark reviewed
          </Button>
        ) : (
          <Button size="sm" variant="ghost" loading={review.isPending} onClick={() => setStatus('new')}>
            <RotateCcw /> Mark as new
          </Button>
        )}
      </div>
    </li>
  );
}

export default function AdminSuggestionsPage() {
  useDocumentTitle('Suggestion box');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const dq = useDebouncedValue(q.trim(), 300);
  const [replying, setReplying] = React.useState<AdminSuggestion | null>(null);
  const status = (params.get('status') ?? 'all') as 'all' | SuggestionStatus;
  const page = Number(params.get('page') || 1);
  const pageSize = Number(params.get('pageSize') || 20);
  const list = useAdminSuggestions({ status: status === 'all' ? undefined : status, q: params.get('q') || undefined, page, pageSize });
  const set = (patch: Record<string, string | null>, resetPage = true) => setParams(patchParams(params, patch, resetPage), { replace: true });
  React.useEffect(() => {
    if (dq !== (params.get('q') ?? '')) set({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const counts = list.data?.meta.statusCounts;
  const filtered = status !== 'all' || !!params.get('q');

  return (
    <div>
      <PageHeader title="Suggestion box" description="Ideas sent by students and staff. New ones are listed first." />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Segmented
          aria-label="Filter by status"
          value={status}
          onChange={(v) => set({ status: v === 'all' ? null : v })}
          options={[
            { value: 'all' as const, label: 'All', count: counts?.all },
            { value: 'new' as const, label: 'New', count: counts?.new },
            { value: 'reviewed' as const, label: 'Reviewed', count: counts?.reviewed },
          ]}
        />
        <div className="relative md:w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label="Search suggestions" placeholder="Subject, text or sender" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
      </div>
      {list.isLoading ? (
        <div className="grid gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : list.isError ? (
        <div className="card">
          <ErrorState onRetry={() => list.refetch()} />
        </div>
      ) : list.data!.data.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Lightbulb}
            title={filtered ? 'No suggestions match.' : 'No suggestions yet.'}
            message={filtered ? 'Try another filter or search.' : 'Suggestions sent from the suggestion box will appear here.'}
          />
        </div>
      ) : (
        <div className={cn(list.isPlaceholderData && 'opacity-60 transition-opacity duration-150')}>
          <ul className="grid gap-3">
            {list.data!.data.map((s) => (
              <SuggestionCard key={s.id} s={s} onReply={() => setReplying(s)} />
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={list.data!.meta.total}
            onPage={(p) => set({ page: String(p) }, false)}
            onPageSize={(n) => set({ pageSize: String(n) })}
            pageSizes={[20, 50, 100]}
          />
        </div>
      )}
      <ReplyDialog s={replying} onOpenChange={(o) => !o && setReplying(null)} />
    </div>
  );
}
