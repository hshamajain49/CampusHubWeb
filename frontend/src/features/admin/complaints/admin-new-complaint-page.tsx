// CA03 New complaint (admin as reporter, [SRC] universal filing): the same form as CU02, through the same C02 endpoint.
import { useSearchParams } from 'react-router';
import { useDocumentTitle } from '@/hooks/misc';
import { PageHeader } from '@/components/common/layout-bits';
import { ComplaintForm } from '@/features/complaints/components/complaint-form';

export default function AdminNewComplaintPage() {
  useDocumentTitle('New complaint');
  const [params] = useSearchParams();
  return (
    <div>
      <PageHeader title="New complaint" breadcrumb={[{ label: 'All complaints', to: '/admin/complaints' }, { label: 'New complaint' }]} className="mx-auto max-w-[760px]" />
      <ComplaintForm initialVenueId={params.get('venueId')} detailPath={(id) => `/admin/complaints/${id}`} cancelTo="/admin/complaints" />
    </div>
  );
}
