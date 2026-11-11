import * as React from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Power, PowerOff } from 'lucide-react';
import { isApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Pill } from '@/components/common/badges';
import { useAdminBreadcrumb } from '@/layouts/admin-layout';
import { useAdminVenue, useVenueMutations } from '../api';
import { VenueForm } from './venue-form';
import { PhotoCard, VenueDialogs, type VenueDialog } from './venue-dialogs';

export default function VenueEditPage() {
  const { venueId } = useParams();
  const q = useAdminVenue(venueId);
  const m = useVenueMutations();
  const [dialog, setDialog] = React.useState<VenueDialog>(null);
  useDocumentTitle(q.data ? `Edit ${q.data.name}` : 'Edit venue');
  useAdminBreadcrumb(q.data ? [{ label: 'Venues', to: '/admin/venues' }, { label: q.data.name, to: `/admin/venues/${q.data.id}` }, { label: 'Edit' }] : null);

  if (q.isLoading) return <Skeleton className="mx-auto h-[640px] max-w-[760px] rounded-[14px]" />;
  if (q.isError) {
    return isApiError(q.error) && q.error.status === 404 ? (
      <EmptyState title="Venue not found" action={<Button asChild><Link to="/admin/venues">Venues</Link></Button>} />
    ) : (
      <ErrorState onRetry={() => q.refetch()} />
    );
  }
  const v = q.data!;
  return (
    <div className="mx-auto grid max-w-[760px] gap-5">
      <PageHeader title="Edit venue" description={v.name} className="mb-0" />
      <section className="card flex flex-wrap items-center gap-3 p-4 md:p-5">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Status</p>
          <p className="mt-1 flex items-center gap-2 text-sm text-ink">
            This venue is {v.isActive ? <Pill tone="success">Active</Pill> : <Pill>Inactive</Pill>}
          </p>
        </div>
        {v.isActive ? (
          <Button variant="destructive-outline" onClick={() => setDialog('deactivate')}>
            <PowerOff /> Deactivate venue
          </Button>
        ) : (
          <Button onClick={() => setDialog('activate')}>
            <Power /> Activate venue
          </Button>
        )}
      </section>
      <PhotoCard venue={v} onRemove={() => setDialog('remove-photo')} />
      <VenueForm
        venue={v}
        submitLabel="Save changes"
        onSubmit={async (body) => {
          await m.update.mutateAsync({ id: v.id, body });
          toast.success('Venue updated.');
          return v.id;
        }}
      />
      <VenueDialogs venue={v} dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
