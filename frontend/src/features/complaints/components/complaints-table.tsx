// Complaint list for staff (CS02) and admin (CA01, venue "Issues" tab): table on ≥ md, cards on < md (§16.5).
import { Link, useNavigate } from 'react-router';
import type { ComplaintSummary } from '@campushub/shared';
import { cn } from '@/lib/utils';
import { formatTimestamp, timeAgo } from '@/lib/format';
import { useIsDesktop } from '@/hooks/misc';
import { usePublicSettings } from '@/hooks/use-public-settings';
import { Tooltip } from '@/components/ui/menus';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { RoleBadge } from '@/components/common/badges';
import { CategoryTile, ComplaintCard, ComplaintFlags, ComplaintStatusBadge } from './complaint-visuals';

export function ComplaintsTable({ rows, viewer, linkTo }: { rows: ComplaintSummary[]; viewer: 'staff' | 'admin'; linkTo: (c: ComplaintSummary) => string }) {
  const navigate = useNavigate();
  // Nine columns don't fit a tablet: cards below lg (1024 px), the table from lg up.
  const wide = useIsDesktop();
  const { data: settings } = usePublicSettings();
  const tz = settings?.campusTimezone ?? 'UTC';

  if (!wide) {
    return (
      <ul className="stagger grid gap-3">
        {rows.map((c) => (
          <li key={c.id}>
            <ComplaintCard c={c} to={linkTo(c)} viewer={viewer} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <TableShell>
      <Table>
        <THead>
          <tr>
            <TH>Reference</TH>
            <TH>Issue</TH>
            {viewer === 'admin' && <TH>Department</TH>}
            <TH>Location</TH>
            <TH>Reporter</TH>
            <TH>Age</TH>
            <TH>Status</TH>
            <TH>Handler</TH>
            {viewer === 'admin' && <TH>Updated</TH>}
          </tr>
        </THead>
        <tbody>
          {rows.map((c) => (
            <TR key={c.id} onClick={() => navigate(linkTo(c))}>
              <TD className="whitespace-nowrap font-mono text-[12.5px]">
                <Link to={linkTo(c)} onClick={(e) => e.stopPropagation()} className="hover:underline">
                  {c.reference}
                </Link>
              </TD>
              <TD className="max-w-[240px]">
                <span className="flex items-center gap-2.5">
                  <CategoryTile icon={c.category.icon} color={c.category.color} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink" title={c.title}>
                      {c.title}
                    </span>
                    <span className="block truncate text-[12px] text-muted">{c.category.name}</span>
                  </span>
                </span>
              </TD>
              {viewer === 'admin' && (
                <TD className="max-w-[150px]">
                  <span className="block truncate text-ink" title={c.department.name}>
                    {c.department.name}
                  </span>
                </TD>
              )}
              <TD className="max-w-[150px]">
                <span className="block truncate text-muted" title={c.venue?.name ?? c.locationDetails ?? ''}>
                  {c.venue?.name ?? c.locationDetails ?? '—'}
                </span>
              </TD>
              <TD className="max-w-[170px]">
                <span className="block truncate font-medium text-ink" title={c.reporter?.fullName}>
                  {c.reporter?.fullName}
                </span>
                {c.reporter && <RoleBadge role={c.reporter.role} className="mt-0.5" />}
              </TD>
              <TD className={cn('tabular whitespace-nowrap', c.isOverdue ? 'font-semibold text-warning-text' : 'text-muted')}>
                <Tooltip content={formatTimestamp(c.createdAt, tz)}>
                  <span>{c.ageDays < 1 ? 'Today' : `${c.ageDays} d`}</span>
                </Tooltip>
              </TD>
              <TD>
                {/* Flex, not grid: the global `.grid` rule makes a grid's min-content 0, so the column would size to its
                    header and the badges would spill into Handler. */}
                <span className="flex flex-col items-start gap-1">
                  <ComplaintStatusBadge status={c.status} size="sm" />
                  <ComplaintFlags c={c} viewer={viewer} />
                </span>
              </TD>
              <TD className="max-w-[130px]">
                <span className="block truncate text-muted" title={c.handledBy?.fullName}>
                  {c.handledBy?.fullName ?? '—'}
                </span>
              </TD>
              {viewer === 'admin' && <TD className="whitespace-nowrap text-[13px] text-muted">{timeAgo(c.updatedAt)}</TD>}
            </TR>
          ))}
        </tbody>
      </Table>
    </TableShell>
  );
}
