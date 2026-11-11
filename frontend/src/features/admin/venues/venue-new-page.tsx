import { toast } from 'sonner';
import { useDocumentTitle } from '@/hooks/misc';
import { PageHeader } from '@/components/common/layout-bits';
import { useAdminBreadcrumb } from '@/layouts/admin-layout';
import { useVenueMutations } from '../api';
import { VenueForm } from './venue-form';

export default function VenueNewPage() {
  useDocumentTitle('Add venue');
  useAdminBreadcrumb([{ label: 'Venues', to: '/admin/venues' }, { label: 'New' }]);
  const m = useVenueMutations();
  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader title="Add venue" description="New venues are created active. You can add a photo once the venue exists." />
      <VenueForm
        submitLabel="Create venue"
        onSubmit={async (body) => {
          const v = await m.create.mutateAsync(body);
          toast.success('Venue created.');
          return v.id;
        }}
      />
    </div>
  );
}
