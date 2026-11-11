import * as React from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { VenueSummary } from '@campushub/shared';
import { isApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/controls';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { useVenue } from '@/features/venues/api';
import { BookingForm } from './booking-form';
import { useBooking } from './api';

function FormSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Skeleton className="h-[640px] rounded-[14px] lg:col-span-7" />
      <Skeleton className="hidden h-[380px] rounded-[14px] lg:col-span-5 lg:block" />
    </div>
  );
}

export function NewBookingPage() {
  useDocumentTitle('New booking request');
  const [params] = useSearchParams();
  const venueId = params.get('venueId') ?? undefined;
  const venue = useVenue(venueId);
  const settings = usePublicSettings();

  const header = <PageHeader title="New booking request" description="Choose a time that's free — pending requests and approved bookings both hold their slot." breadcrumb={[{ label: 'Venues', to: '/venues' }, { label: 'New booking' }]} />;

  if (settings.isLoading || (venueId && venue.isLoading)) {
    return (
      <div>
        {header}
        <FormSkeleton />
      </div>
    );
  }
  if (venueId && venue.isError) {
    const notFound = isApiError(venue.error) && venue.error.status === 404;
    return (
      <div>
        {header}
        <div className="card">
          {notFound ? (
            <EmptyState
              title="This venue is no longer accepting bookings."
              message="It may have been deactivated or removed."
              action={
                <Button asChild>
                  <Link to="/venues">Browse venues</Link>
                </Button>
              }
            />
          ) : (
            <ErrorState onRetry={() => venue.refetch()} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <BookingForm
        mode="create"
        venue={venue.data ?? null}
        allowChangeVenue
        initial={{
          venueId: venueId ?? '',
          date: params.get('date') ?? '',
          startTime: params.get('start') ?? '',
          endTime: params.get('end') ?? '',
          purpose: params.get('purpose') ?? '',
          expectedAttendees: null,
        }}
      />
    </div>
  );
}

export function EditBookingPage() {
  const { bookingId } = useParams();
  const booking = useBooking(bookingId);
  useDocumentTitle('Edit booking');
  const b = booking.data;

  React.useEffect(() => {
    if (b && !b.permissions.canEdit) toast('This booking can no longer be changed.');
  }, [b]);

  if (booking.isLoading) return <FormSkeleton />;
  if (booking.isError) {
    return isApiError(booking.error) && booking.error.status === 404 ? (
      <div className="card">
        <EmptyState title="Booking not found" message="It may have been removed, or you may not have access." action={<Button asChild><Link to="/bookings">My bookings</Link></Button>} />
      </div>
    ) : (
      <ErrorState onRetry={() => booking.refetch()} />
    );
  }
  if (!b!.permissions.canEdit) return <Navigate to={`/bookings/${b!.id}`} replace />;

  const venue: VenueSummary = {
    id: b!.venue.id,
    name: b!.venue.name,
    venueType: b!.venue.venueType,
    building: b!.venue.building,
    locationDetails: b!.venue.locationDetails,
    capacity: b!.venue.capacity,
    amenities: [],
    imageUrl: null,
    imageThumbUrl: null,
    isActive: b!.venue.isActive,
  };

  return (
    <div>
      <PageHeader
        title="Edit booking"
        description={<span className="font-mono text-[13px]">{b!.reference}</span>}
        breadcrumb={[{ label: 'My bookings', to: '/bookings' }, { label: b!.reference, to: `/bookings/${b!.id}` }, { label: 'Edit' }]}
      />
      {b!.status === 'approved' ? (
        <Alert variant="warning" className="mb-5" title="This booking is approved">
          Saving changes to this approved booking sends it back for approval. It keeps its time slot while it waits.
        </Alert>
      ) : (
        <Alert variant="info" className="mb-5">
          Changes keep your request in the review queue.
        </Alert>
      )}
      <BookingForm
        key={b!.version}
        mode="edit"
        booking={b!}
        venue={venue}
        allowChangeVenue={false}
        initial={{
          venueId: b!.venue.id,
          date: b!.date,
          startTime: b!.startTime,
          endTime: b!.endTime,
          purpose: b!.purpose,
          expectedAttendees: b!.expectedAttendees,
        }}
      />
    </div>
  );
}
