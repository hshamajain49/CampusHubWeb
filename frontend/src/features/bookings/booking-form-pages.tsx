import * as React from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { VenueSummary } from '@campushub/shared';
import { isApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { useMe } from '@/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/controls';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { useVenue } from '@/features/venues/api';
import { BookingForm } from './booking-form';
import { useBooking } from './api';
import { useBookingPaths } from './paths';

function FormSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Skeleton className="h-[640px] rounded-[14px] lg:col-span-7" />
      <Skeleton className="hidden h-[380px] rounded-[14px] lg:col-span-5 lg:block" />
    </div>
  );
}

export function NewBookingPage() {
  const paths = useBookingPaths();
  const me = useMe();
  useDocumentTitle('Book a venue');
  const [params] = useSearchParams();
  const venueId = params.get('venueId') ?? undefined;
  const venue = useVenue(venueId);
  const settings = usePublicSettings();

  const header = <PageHeader title="Book a venue" description="A free time is confirmed instantly. A booked time puts you in the queue for it." breadcrumb={[{ label: 'Venues', to: paths.venues }, { label: 'New booking' }]} />;

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
                  <Link to={paths.venues}>Browse venues</Link>
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
          multiDay: !!params.get('endDate'),
          endDate: params.get('endDate') ?? '',
          startTime: params.get('start') ?? '',
          endTime: params.get('end') ?? '',
          purpose: params.get('purpose') ?? '',
          expectedAttendees: null,
          idNumber: me.lastIdNumber ?? '',
        }}
      />
    </div>
  );
}

export function EditBookingPage() {
  const paths = useBookingPaths();
  const me = useMe();
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
        <EmptyState title="Booking not found" message="It may have been removed, or you may not have access." action={<Button asChild><Link to={paths.list}>My bookings</Link></Button>} />
      </div>
    ) : (
      <ErrorState onRetry={() => booking.refetch()} />
    );
  }
  if (!b!.permissions.canEdit) return <Navigate to={paths.detail(b!.id)} replace />;

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
        breadcrumb={[{ label: 'My bookings', to: paths.list }, { label: b!.reference, to: paths.detail(b!.id) }, { label: 'Edit' }]}
      />
      {b!.status === 'confirmed' ? (
        <Alert variant="info" className="mb-5" title="Your booking is confirmed">
          You can move it to another free time. If the new time is already booked, nothing changes and you keep this slot.
        </Alert>
      ) : (
        <Alert variant="warning" className="mb-5" title={`You're #${b!.queuePosition ?? '?'} in the queue`}>
          Moving to a free time confirms it straight away. Moving to another booked time puts you at the back of that queue.
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
          multiDay: b!.days > 1,
          endDate: b!.days > 1 ? b!.endDate : '',
          startTime: b!.startTime,
          endTime: b!.endTime,
          purpose: b!.purpose,
          expectedAttendees: b!.expectedAttendees,
          idNumber: b!.idNumber ?? me.lastIdNumber ?? '',
        }}
      />
    </div>
  );
}
