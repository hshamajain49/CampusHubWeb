// CA04 Departments & categories (§8.3, CW-06 step 4). Deactivating a department is refused while it still has active
// categories, open complaints or active staff; the dialog then lists what blocks it (CEC-19).
import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Building2, MoreHorizontal, Pencil, Plus, Power, PowerOff, Tags } from 'lucide-react';
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  type AdminComplaintCategory,
  type CategoryIcon,
  type ServiceDepartment,
} from '@campushub/shared';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import { useDocumentTitle } from '@/hooks/misc';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/menus';
import { Table, TableShell, TD, TH, THead, TR } from '@/components/ui/table';
import { Pill } from '@/components/common/badges';
import { PageHeader } from '@/components/common/layout-bits';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Field } from '@/components/common/form-field';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { categoryIcon, onTint, tint } from '@/features/complaints/lib/category-icons';
import { useAdminCategories, useServiceDepartments, useSetupMutation } from '@/features/complaints/api';

const StatusPill = ({ active }: { active: boolean }) => (active ? <Pill tone="success">Active</Pill> : <Pill>Inactive</Pill>);

function RowMenu({ label, items }: { label: string; items: { label: string; icon: React.ReactNode; onSelect: () => void; destructive?: boolean }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {items.map((it) => (
          <DropdownMenuItem key={it.label} destructive={it.destructive} onSelect={it.onSelect}>
            {it.icon} {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─────────────────────────── departments ───────────────────────────
function DepartmentDialog({ dept, open, onOpenChange }: { dept: ServiceDepartment | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSetupMutation<ServiceDepartment>('service-departments');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  React.useEffect(() => {
    if (open) {
      setName(dept?.name ?? '');
      setDescription(dept?.description ?? '');
      setError(undefined);
    }
  }, [open, dept]);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={dept ? 'Edit department' : 'Add department'}
      confirmLabel={dept ? 'Save' : 'Add department'}
      onConfirm={async () => {
        const n = name.trim();
        if (n.length < 2 || n.length > 100) {
          setError('Name must be 2–100 characters');
          throw new Error('Please check the name.');
        }
        try {
          await save.mutateAsync({ id: dept?.id, body: { name: n, description: description.trim() || null } });
          toast.success(dept ? 'Department saved.' : 'Department added.');
        } catch (err) {
          if (err instanceof ApiError && err.code === 'DEPARTMENT_NAME_TAKEN') setError(err.message);
          throw err;
        }
      }}
    >
      <Field label="Name" error={error}>
        {(p) => <Input {...p} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="e.g. Security Office" />}
      </Field>
      <Field label="Description" optional hint={<span className="tabular">{description.length}/300</span>}>
        {(p) => <Textarea {...p} rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Locks, access cards, CCTV" />}
      </Field>
    </ConfirmDialog>
  );
}

function DepartmentsTab() {
  const depts = useServiceDepartments();
  const save = useSetupMutation<ServiceDepartment>('service-departments');
  const [editing, setEditing] = React.useState<ServiceDepartment | null | 'new'>(null);
  const [blocked, setBlocked] = React.useState<{ dept: ServiceDepartment; counts: ServiceDepartment['counts'] } | null>(null);

  const toggle = async (d: ServiceDepartment) => {
    try {
      await save.mutateAsync({ id: d.id, body: { isActive: !d.isActive } });
      toast.success(d.isActive ? 'Department deactivated.' : 'Department activated.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DEPARTMENT_IN_USE') setBlocked({ dept: d, counts: err.details });
      else toast.error(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus /> Add department
        </Button>
      </div>
      {depts.isLoading ? (
        <Skeleton className="h-64 rounded-[14px]" />
      ) : depts.isError ? (
        <div className="card">
          <ErrorState onRetry={() => depts.refetch()} />
        </div>
      ) : (
        <TableShell>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Categories</TH>
                <TH>Staff</TH>
                <TH>Open complaints</TH>
                <TH>Status</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {depts.data!.map((d) => (
                <TR key={d.id}>
                  <TD className="max-w-[280px]">
                    <span className="block truncate font-semibold text-ink">{d.name}</span>
                    {d.description && <span className="block truncate text-[12px] text-muted">{d.description}</span>}
                  </TD>
                  <TD className="tabular">{d.counts.activeCategories}</TD>
                  <TD className="tabular">
                    <Link to={`/admin/users?role=department_staff&serviceDepartmentId=${d.id}`} className="font-semibold text-primary hover:underline">
                      {d.counts.activeStaff}
                    </Link>
                  </TD>
                  <TD className="tabular">
                    <Link to={`/admin/complaints?departmentId=${d.id}`} className="font-semibold text-primary hover:underline">
                      {d.counts.openComplaints}
                    </Link>
                  </TD>
                  <TD>
                    <StatusPill active={d.isActive} />
                  </TD>
                  <TD>
                    <RowMenu
                      label={`Actions for ${d.name}`}
                      items={[
                        { label: 'Edit', icon: <Pencil />, onSelect: () => setEditing(d) },
                        d.isActive
                          ? { label: 'Deactivate', icon: <PowerOff />, onSelect: () => void toggle(d), destructive: true }
                          : { label: 'Activate', icon: <Power />, onSelect: () => void toggle(d) },
                      ]}
                    />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableShell>
      )}
      <DepartmentDialog dept={editing === 'new' ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={!!blocked}
        onOpenChange={(o) => !o && setBlocked(null)}
        title={`${blocked?.dept.name ?? 'This department'} is still in use`}
        description="Move or deactivate its categories, resolve or reassign its open complaints, and reassign its staff first."
        confirmLabel="OK"
        hideCancel
        onConfirm={() => undefined}
      >
        {blocked && (
          <ul className="grid gap-1.5 text-sm">
            <li>
              <Link to="/admin/complaint-setup?tab=categories" className="text-primary hover:underline" onClick={() => setBlocked(null)}>
                {blocked.counts.activeCategories} active categor{blocked.counts.activeCategories === 1 ? 'y' : 'ies'}
              </Link>
            </li>
            <li>
              <Link to={`/admin/complaints?departmentId=${blocked.dept.id}`} className="text-primary hover:underline">
                {blocked.counts.openComplaints} open complaint{blocked.counts.openComplaints === 1 ? '' : 's'}
              </Link>
            </li>
            <li>
              <Link to={`/admin/users?role=department_staff&serviceDepartmentId=${blocked.dept.id}`} className="text-primary hover:underline">
                {blocked.counts.activeStaff} active staff account{blocked.counts.activeStaff === 1 ? '' : 's'}
              </Link>
            </li>
          </ul>
        )}
      </ConfirmDialog>
    </div>
  );
}

// ─────────────────────────── categories ───────────────────────────
export function CategoryChipPreview({ name, icon, color, department }: { name: string; icon: string; color: string; department?: string }) {
  const Icon = categoryIcon(icon);
  return (
    <span className="inline-flex max-w-full items-center gap-2.5 rounded-[12px] border border-border bg-surface p-2 pr-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-[9px]" style={{ background: tint(color), color: onTint(color) }} aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-semibold text-ink">{name || 'Category name'}</span>
        {department && <span className="block truncate text-[11.5px] text-muted">{department}</span>}
      </span>
    </span>
  );
}

function CategoryDialog({ cat, open, onOpenChange }: { cat: AdminComplaintCategory | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const depts = useServiceDepartments();
  const save = useSetupMutation<AdminComplaintCategory>('complaint-categories');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [icon, setIcon] = React.useState<CategoryIcon>('circle-help');
  const [color, setColor] = React.useState<string>(CATEGORY_COLORS[0]);
  const [departmentId, setDepartmentId] = React.useState('');
  const [sortOrder, setSortOrder] = React.useState('100');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!open) return;
    setName(cat?.name ?? '');
    setDescription(cat?.description ?? '');
    setIcon(cat?.icon ?? 'circle-help');
    setColor(cat?.color ?? CATEGORY_COLORS[0]);
    setDepartmentId(cat?.department.id ?? '');
    setSortOrder(String(cat?.sortOrder ?? 100));
    setErrors({});
  }, [open, cat]);
  const activeDepts = (depts.data ?? []).filter((d) => d.isActive || d.id === cat?.department.id);
  const dept = depts.data?.find((d) => d.id === departmentId);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={cat ? 'Edit category' : 'Add category'}
      confirmLabel={cat ? 'Save' : 'Add category'}
      onConfirm={async () => {
        const e: Record<string, string> = {};
        const n = name.trim();
        if (n.length < 2 || n.length > 60) e.name = 'Name must be 2–60 characters';
        if (!departmentId) e.departmentId = 'Choose a department';
        const order = Number(sortOrder);
        if (!Number.isInteger(order) || order < 0 || order > 999) e.sortOrder = 'Use 0–999';
        setErrors(e);
        if (Object.keys(e).length) throw new Error('Please check the highlighted fields.');
        try {
          await save.mutateAsync({ id: cat?.id, body: { name: n, description: description.trim() || null, icon, color, departmentId, sortOrder: order } });
          toast.success(cat ? 'Category saved.' : 'Category added.');
        } catch (err) {
          if (err instanceof ApiError && (err.code === 'CATEGORY_NAME_TAKEN' || err.code === 'DEPARTMENT_INACTIVE')) {
            setErrors({ [err.code === 'CATEGORY_NAME_TAKEN' ? 'name' : 'departmentId']: err.message });
          }
          throw err;
        }
      }}
    >
      <div className="grid gap-1.5">
        <p className="text-[12px] font-medium text-muted">Preview</p>
        <CategoryChipPreview name={name.trim()} icon={icon} color={color} department={dept?.name} />
      </div>
      <Field label="Name" error={errors.name} hint={cat ? `Slug: ${cat.slug} (can't change)` : 'The slug is generated from the name.'}>
        {(p) => <Input {...p} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Security" />}
      </Field>
      <Field label="Description" optional hint={<span className="tabular">{description.length}/200</span>}>
        {(p) => <Input {...p} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <div className="grid gap-1.5">
        <p className="text-[13px] font-semibold text-ink">Icon</p>
        <div role="radiogroup" aria-label="Icon" className="grid grid-cols-10 gap-1.5 max-sm:grid-cols-5">
          {CATEGORY_ICONS.map((i) => {
            const Icon = categoryIcon(i);
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={icon === i}
                aria-label={i.replace(/-/g, ' ')}
                onClick={() => setIcon(i)}
                className={cn(
                  'press grid size-9 place-items-center rounded-[9px] border transition-colors duration-150',
                  icon === i ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:bg-surface-muted',
                )}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-1.5">
        <p className="text-[13px] font-semibold text-ink">Colour</p>
        <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn('press size-8 rounded-full ring-offset-2 transition-shadow duration-150', color === c ? 'ring-2 ring-ink' : 'ring-0')}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Department" error={errors.departmentId}>
          {(p) => (
            <Select
              id={p.id}
              invalid={!!errors.departmentId}
              value={departmentId}
              onValueChange={setDepartmentId}
              placeholder="Choose a department"
              options={activeDepts.map((d) => ({ value: d.id, label: d.name, disabled: !d.isActive }))}
            />
          )}
        </Field>
        <Field label="Sort order" error={errors.sortOrder}>
          {(p) => <Input {...p} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/\D/g, '').slice(0, 3))} />}
        </Field>
      </div>
      {cat && departmentId !== cat.department.id && (
        <Alert variant="info">Existing complaints keep their department. Reassign them individually if needed.</Alert>
      )}
    </ConfirmDialog>
  );
}

function CategoriesTab() {
  const cats = useAdminCategories();
  const save = useSetupMutation<AdminComplaintCategory>('complaint-categories');
  const [editing, setEditing] = React.useState<AdminComplaintCategory | null | 'new'>(null);
  const toggle = async (c: AdminComplaintCategory) => {
    try {
      await save.mutateAsync({ id: c.id, body: { isActive: !c.isActive } });
      toast.success(c.isActive ? 'Category deactivated.' : 'Category activated.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  };
  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus /> Add category
        </Button>
      </div>
      {cats.isLoading ? (
        <Skeleton className="h-64 rounded-[14px]" />
      ) : cats.isError ? (
        <div className="card">
          <ErrorState onRetry={() => cats.refetch()} />
        </div>
      ) : cats.data!.length === 0 ? (
        <div className="card">
          <EmptyState icon={Tags} title="No categories yet." />
        </div>
      ) : (
        <TableShell>
          <Table>
            <THead>
              <tr>
                <TH className="w-16">Order</TH>
                <TH>Category</TH>
                <TH>Department</TH>
                <TH>Open complaints</TH>
                <TH>Status</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {cats.data!.map((c) => (
                <TR key={c.id}>
                  <TD className="tabular text-muted">{c.sortOrder}</TD>
                  <TD className="max-w-[280px]">
                    <CategoryChipPreview name={c.name} icon={c.icon} color={c.color} />
                  </TD>
                  <TD className="max-w-[220px]">
                    <span className="block truncate">{c.department.name}</span>
                    {c.department.isActive === false && <span className="text-[12px] text-warning-text">Department inactive</span>}
                  </TD>
                  <TD className="tabular">
                    <Link to={`/admin/complaints?categoryId=${c.id}`} className="font-semibold text-primary hover:underline">
                      {c.counts.openComplaints}
                    </Link>
                    <span className="text-[12px] text-muted"> / {c.counts.totalComplaints} total</span>
                  </TD>
                  <TD>
                    <StatusPill active={c.isActive} />
                  </TD>
                  <TD>
                    <RowMenu
                      label={`Actions for ${c.name}`}
                      items={[
                        { label: 'Edit', icon: <Pencil />, onSelect: () => setEditing(c) },
                        c.isActive
                          ? { label: 'Deactivate', icon: <PowerOff />, onSelect: () => void toggle(c), destructive: true }
                          : { label: 'Activate', icon: <Power />, onSelect: () => void toggle(c) },
                      ]}
                    />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableShell>
      )}
      <CategoryDialog cat={editing === 'new' ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </div>
  );
}

export default function ComplaintSetupPage() {
  useDocumentTitle('Departments & categories');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'categories' ? 'categories' : 'departments';
  return (
    <div>
      <PageHeader title="Departments & categories" description="Categories decide which service department receives a complaint." />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'departments' ? {} : { tab: v }, { replace: true })}>
        <TabsList className="mb-5">
          <TabsTrigger value="departments">
            <Building2 className="size-4" /> Departments
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Tags className="size-4" /> Categories
          </TabsTrigger>
        </TabsList>
        <TabsContent value="departments">
          <DepartmentsTab />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
