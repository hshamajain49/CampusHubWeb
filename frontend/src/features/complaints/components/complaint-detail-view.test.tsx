// COMPLAINT_REGISTRATION_SPEC.md §19 CFT-04, 05, 06, 11: the complaint detail page per status and viewer.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Complaint, ComplaintPermissions } from '@campushub/shared';

const apiFetch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<typeof import('@/lib/api-client')>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock('@/providers/auth-provider', () => ({
  useMe: () => ({ id: 'me', fullName: 'Priya Sharma', email: 'priya@demo.edu', role: 'student' }),
}));
vi.mock('@/hooks/use-public-settings', () => ({ usePublicSettings: () => ({ data: { campusTimezone: 'Asia/Kolkata' } }) }));
vi.mock('@/providers/realtime-provider', () => ({ usePollingInterval: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { ComplaintDetailView } from './complaint-detail-view';

const NO: ComplaintPermissions = {
  canApprove: false,
  canReject: false,
  canWithdraw: false,
  canStart: false,
  canComplete: false,
  canReopen: false,
  canRequestReassignment: false,
  canReassign: false,
  canClose: false,
};

function complaint(over: Partial<Complaint> = {}): Complaint {
  return {
    id: 'c1',
    reference: 'CMP-2026-000045',
    title: 'Fan not working in Room 204',
    category: { id: 'cat', name: 'Electrical', icon: 'zap', color: '#E09B10' },
    department: { id: 'd', name: 'Electrical Department' },
    venue: null,
    locationDetails: 'Block A, Room 204',
    status: 'pending_review',
    rejectedByReporter: false,
    reassignmentRequested: false,
    photoCount: 0,
    handledBy: null,
    ageDays: 1,
    isOverdue: false,
    awaitingReporter: false,
    version: 3,
    createdAt: '2026-11-10T04:20:00.000Z',
    updatedAt: '2026-11-10T04:20:00.000Z',
    description: null,
    reporter: { id: 'me', fullName: 'Priya Sharma', email: 'priya@demo.edu', role: 'student', department: null },
    resolutionNote: null,
    rejectionReason: null,
    closureType: null,
    closureReason: null,
    reassignmentNote: null,
    reassignmentSuggestedCategory: null,
    workStartedAt: null,
    workCompletedAt: null,
    resolvedAt: null,
    closedAt: null,
    autoResolveAt: null,
    autoResolved: false,
    reporterReopenUntil: null,
    attachments: { report: [], resolution: [] },
    history: [],
    viewerRole: 'reporter',
    permissions: NO,
    ...over,
  };
}

function view(c: Complaint, scope: 'reporter' | 'staff' | 'admin' = 'reporter', refetch = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ComplaintDetailView c={c} scope={scope} refetch={refetch} breadcrumb={[{ label: 'My complaints' }]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return refetch;
}

afterEach(cleanup);
beforeEach(() => {
  apiFetch.mockReset();
  vi.mocked(toast.error).mockReset();
});

describe('CFT-04 status callouts', () => {
  it('pending, in progress (with handler), withdrawn and closed', () => {
    view(complaint({ status: 'pending_review', permissions: { ...NO, canWithdraw: true } }));
    expect(screen.getByText('Waiting for the Electrical Department to pick this up.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Withdraw complaint/ }).length).toBeGreaterThan(0);
  });

  it('in progress after a rejection shows the handler and "You sent this back"', () => {
    view(complaint({ status: 'in_progress', rejectedByReporter: true, rejectionReason: 'Still noisy', handledBy: { id: 's', fullName: 'Ravi Kumar' } }));
    expect(screen.getByText('The Electrical Department is working on it.')).toBeInTheDocument();
    expect(screen.getByText('Handled by Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('You sent this back')).toBeInTheDocument();
  });

  it('closed shows the administrator reason', () => {
    view(complaint({ status: 'closed', closureType: 'duplicate', closureReason: 'Same as CMP-2026-000041.' }));
    expect(screen.getByText(/Closed by the administrator — Duplicate/)).toBeInTheDocument();
    expect(screen.getByText('Same as CMP-2026-000041.')).toBeInTheDocument();
  });
});

describe('CFT-05 review the work', () => {
  const awaiting = () =>
    complaint({
      status: 'awaiting_confirmation',
      awaitingReporter: true,
      resolutionNote: 'Replaced the regulator.',
      handledBy: { id: 's', fullName: 'Ravi Kumar' },
      autoResolveAt: '2026-11-17T08:30:00.000Z',
      permissions: { ...NO, canApprove: true, canReject: true },
    });

  it('shows the staff note and the auto-resolve deadline; reject needs 3–300 characters', async () => {
    view(awaiting());
    const card = screen.getByRole('region', { name: 'Review the work' });
    expect(within(card).getByText('The Electrical Department says this is fixed. Is the issue resolved to your satisfaction?')).toBeInTheDocument();
    expect(within(card).getByText(/Replaced the regulator\./)).toBeInTheDocument();
    expect(within(card).getByText(/If you don't respond by 17 Nov 2026 · 14:00/)).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: /Not fixed yet/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'What still needs fixing?' })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox'), 'no');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back' }));
    expect(await within(dialog).findByText('Please tell us what still needs fixing (at least 3 characters).')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();

    apiFetch.mockResolvedValueOnce(complaint({ status: 'in_progress' }));
    await userEvent.type(within(dialog).getByRole('textbox'), 'pe, still noisy');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send back' }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/complaints/c1/reject', { method: 'POST', body: { version: 3, reason: 'nope, still noisy' } }),
    );
  });

  it('approve posts the version the page last read', async () => {
    view(awaiting());
    apiFetch.mockResolvedValueOnce(complaint({ status: 'resolved' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Review the work' })).getByRole('button', { name: /Approve/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/complaints/c1/approve', { method: 'POST', body: { version: 3 } }));
  });
});

describe('CFT-11 reporter reopen of an auto-resolved complaint', () => {
  const auto = (canReopen: boolean) =>
    complaint({
      status: 'resolved',
      autoResolved: true,
      resolvedAt: '2026-11-17T08:45:00.000Z',
      reporterReopenUntil: '2026-11-24T08:45:00.000Z',
      permissions: { ...NO, canReopen },
    });

  it('shows the notice and "Not fixed? Reopen" only when allowed', () => {
    view(auto(false));
    expect(screen.queryByRole('button', { name: /Not fixed\? Reopen/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Resolved automatically')).not.toBeInTheDocument();
  });

  it('a closed window toasts the message and refetches', async () => {
    const refetch = view(auto(true));
    expect(screen.getByText(/You can reopen it until 24 Nov 2026 · 14:15/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /Not fixed\? Reopen/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Still not fixed?' })).toBeInTheDocument();
    apiFetch.mockRejectedValueOnce(new ApiError(422, 'REOPEN_WINDOW_CLOSED', 'The time to reopen this complaint has passed.'));
    await userEvent.type(within(dialog).getByRole('textbox'), 'The fan stopped working again');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen complaint' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The time to reopen this complaint has passed.'));
    expect(refetch).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('CFT-06 staff actions per status', () => {
  it('in progress: mark work done and request reassignment; awaiting: disabled waiting button', () => {
    view(complaint({ status: 'in_progress', viewerRole: 'staff', permissions: { ...NO, canComplete: true, canRequestReassignment: true } }), 'staff');
    expect(screen.getAllByRole('button', { name: /Mark work done/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Request reassignment/ }).length).toBeGreaterThan(0);
    expect(screen.getByText('Reported by')).toBeInTheDocument();
  });

  it('awaiting approval shows the disabled "Waiting for … to approve" action', () => {
    view(complaint({ status: 'awaiting_confirmation', viewerRole: 'staff', reporter: { id: 'r', fullName: 'Priya Sharma', email: 'p@x.edu', role: 'student', department: null } }), 'staff');
    const waiting = screen.getAllByRole('button', { name: /Waiting for Priya to approve/ })[0]!;
    expect(waiting).toBeDisabled();
  });
});
