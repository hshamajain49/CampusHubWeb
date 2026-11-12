// CA02 Complaint details (admin). Coordination with venue booking: a complaint about a venue can block that venue for
// maintenance in one step (the existing block dialog, pre-filled), so nobody books a room that is being repaired.
import * as React from 'react';
import { CalendarOff } from 'lucide-react';
import { useAdminBreadcrumb } from '@/layouts/admin-layout';
import { ComplaintDetailView } from '@/features/complaints/components/complaint-detail-view';
import { ComplaintDetailLoader } from '@/features/complaints/complaint-pages';
import { isOpenComplaintStatus } from '@campushub/shared';
import { BlockDialog } from '../blocks/block-dialog';

export default function AdminComplaintDetailPage() {
  const [block, setBlock] = React.useState<{ venueId: string; reason: string } | null>(null);
  useAdminBreadcrumb([{ label: 'All complaints', to: '/admin/complaints' }, { label: 'Details' }]);
  return (
    <>
      <ComplaintDetailLoader
        scope="admin"
        backTo="/admin/complaints"
        backLabel="All complaints"
        notFound="It may have been removed."
        render={(c, refetch) => (
          <ComplaintDetailView
            c={c}
            scope="admin"
            refetch={refetch}
            breadcrumb={[{ label: 'All complaints', to: '/admin/complaints' }, { label: c.reference }]}
            extraActions={
              c.venue?.isActive && isOpenComplaintStatus(c.status)
                ? [
                    {
                      key: 'block',
                      label: 'Block venue for maintenance',
                      icon: <CalendarOff />,
                      variant: 'outline',
                      onClick: () => setBlock({ venueId: c.venue!.id, reason: `${c.reference}: ${c.title}` }),
                    },
                  ]
                : []
            }
          />
        )}
      />
      <BlockDialog open={!!block} onOpenChange={(o) => !o && setBlock(null)} initial={block ?? undefined} lockVenue />
    </>
  );
}
