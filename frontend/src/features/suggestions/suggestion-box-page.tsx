// Suggestion box (members): send an idea to the administrator and see their replies.
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Lightbulb, MessageSquareReply, Send } from 'lucide-react';
import { suggestionCreateBody, type Suggestion, type SuggestionCreateBody } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import { timeAgo } from '@/lib/format';
import { useDocumentTitle } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/controls';
import { Field } from '@/components/common/form-field';
import { PageHeader, SectionCard } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pagination } from '@/components/common/small';
import { useCreateSuggestion, useMySuggestions } from './api';
import { SuggestionStatusPill } from './suggestion-status';

const MESSAGE_MAX = 2000;

function SuggestionForm() {
  const create = useCreateSuggestion();
  const [formError, setFormError] = React.useState<string | null>(null);
  const form = useForm<SuggestionCreateBody>({ resolver: zodResolver(suggestionCreateBody), mode: 'onTouched', defaultValues: { subject: '', message: '' } });
  const { errors, isSubmitting } = form.formState;
  const length = form.watch('message').length;

  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await create.mutateAsync(v);
      form.reset();
      toast.success('Thanks! Your suggestion was sent.');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && Object.keys(e.fieldErrors).length) {
        for (const [f, msgs] of Object.entries(e.fieldErrors)) form.setError(f as keyof SuggestionCreateBody, { message: msgs[0] });
        return;
      }
      setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  });

  return (
    <SectionCard title="New suggestion">
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {formError && <Alert variant="error">{formError}</Alert>}
        <Field label="Subject" error={errors.subject?.message}>
          {(p) => <Input {...p} maxLength={120} placeholder="e.g. More charging points in the library" {...form.register('subject')} />}
        </Field>
        <Field
          label="Your suggestion"
          error={errors.message?.message}
          hint={<span className={cn(length > MESSAGE_MAX && 'text-destructive-text')}>{`${length.toLocaleString('en-IN')} / ${MESSAGE_MAX.toLocaleString('en-IN')}`}</span>}
        >
          {(p) => <Textarea {...p} rows={6} autoGrow maxRows={14} placeholder="What should change, and why would it help?" {...form.register('message')} />}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={isSubmitting}>
            <Send /> Send suggestion
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function SuggestionItem({ s }: { s: Suggestion }) {
  return (
    <li className="grid gap-2 px-4 py-4 md:px-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-[15px] font-semibold text-ink">{s.subject}</h3>
        <SuggestionStatusPill s={s} />
      </div>
      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-5 text-muted">{s.message}</p>
      <p className="text-[12px] text-subtle" title={new Date(s.createdAt).toLocaleString()}>
        Sent {timeAgo(s.createdAt).toLowerCase()}
      </p>
      {s.adminResponse && (
        <div className="mt-1 rounded-[10px] border border-border bg-surface-muted p-3">
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <MessageSquareReply className="size-3.5" aria-hidden /> Reply from {s.reviewedBy?.fullName ?? 'the administrator'}
          </p>
          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-5 text-ink">{s.adminResponse}</p>
        </div>
      )}
    </li>
  );
}

export function SuggestionBoxPage() {
  useDocumentTitle('Suggestion box');
  const [page, setPage] = React.useState(1);
  const list = useMySuggestions(page);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Suggestion box"
        description="Ideas to improve the campus, its venues or this app. The administrator reads every suggestion and may reply here."
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <SuggestionForm />
        <SectionCard title="Your suggestions" bodyClassName="p-0 md:p-0">
          {list.isLoading ? (
            <div className="grid gap-2 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : list.isError ? (
            <ErrorState compact onRetry={() => list.refetch()} />
          ) : list.data!.data.length === 0 ? (
            <EmptyState compact icon={Lightbulb} title="No suggestions yet." message="Your suggestions and any replies will appear here." />
          ) : (
            <div className={cn(list.isPlaceholderData && 'opacity-60 transition-opacity duration-150')}>
              <ul className="divide-y divide-border">
                {list.data!.data.map((s) => (
                  <SuggestionItem key={s.id} s={s} />
                ))}
              </ul>
              <Pagination className="px-4 pb-4" page={page} pageSize={20} total={list.data!.meta.total} onPage={setPage} />
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
