// COMPLAINT_REGISTRATION_SPEC.md §19 CFT-01, 02, 04 (tracker), 09: complaint building blocks.
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComplaintAttachment, ComplaintCategory, ComplaintHistoryEntry } from '@campushub/shared';
import { CategoryPicker, RoutingHint } from './category-picker';
import { PhotoUploader } from './photo-uploader';
import { Lightbox } from './photo-gallery';
import { ComplaintProgress, ComplaintStatusBadge, ComplaintTimeline } from './complaint-visuals';

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const cat = (id: string, name: string, dept: string): ComplaintCategory => ({
  id,
  slug: id,
  name,
  description: null,
  icon: 'zap',
  color: '#E09B10',
  department: { id: `d-${id}`, name: dept },
  sortOrder: 10,
  isActive: true,
});
const CATS = [cat('electrical', 'Electrical', 'Electrical Department'), cat('plumbing', 'Plumbing', 'Plumbing Department'), cat('it', 'IT/Network', 'IT Department')];

function PickerHarness({ onChange }: { onChange: (id: string) => void }) {
  const [value, setValue] = React.useState<string | null>(null);
  const selected = CATS.find((c) => c.id === value);
  return (
    <>
      <CategoryPicker
        categories={CATS}
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange(id);
        }}
      />
      {selected && <RoutingHint department={selected.department.name} />}
    </>
  );
}

describe('CFT-01 CategoryPicker', () => {
  it('is a radiogroup with arrow-key navigation and shows the routing hint', async () => {
    const onChange = vi.fn();
    render(<PickerHarness onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'What kind of issue is it?' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute('tabindex', '0'); // roving focus starts on the first card
    await userEvent.click(radios[0]!);
    expect(screen.getByText('Electrical Department', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/Will be sent to/)).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('plumbing');
    expect(screen.getByRole('radio', { name: /Plumbing/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Plumbing/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('it'); // wraps around
  });
});

describe('CFT-02 PhotoUploader', () => {
  const file = (name: string, type = 'image/jpeg') => new File([new Uint8Array(1024)], name, { type });

  it('compresses, enforces the 3-photo limit, removes, and pre-checks the type', async () => {
    const compress = vi.fn(async (f: File) => f);
    const onChange = vi.fn();
    const { container } = render(<PhotoUploader onChange={onChange} compress={compress} />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');

    await userEvent.upload(input, [file('a.jpg'), file('b.png', 'image/png')]);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([expect.any(File), expect.any(File)], false));
    expect(compress).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/^2\/3/)).toBeInTheDocument();

    await userEvent.upload(input, [file('c.webp', 'image/webp'), file('d.jpg')]); // only one more fits
    await waitFor(() => expect(screen.getByText(/^3\/3/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^add/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 2' }));
    await waitFor(() => expect(screen.getByText(/^2\/3/)).toBeInTheDocument());
    await waitFor(() => expect(onChange.mock.lastCall![0]).toHaveLength(2));
    expect(URL.revokeObjectURL).toHaveBeenCalled();

    // HEIC is refused before upload, with the spec's message (CEC-05).
    await userEvent.upload(input, [file('photo.heic', 'image/heic')], { applyAccept: false });
    expect(await screen.findByRole('alert')).toHaveTextContent('Only JPEG, PNG and WebP photos are supported.');
  });

  it('reports busy while a photo is still compressing', async () => {
    let finish: (f: File) => void = () => undefined;
    const compress = vi.fn(() => new Promise<File>((r) => (finish = r)));
    const onChange = vi.fn();
    const { container } = render(<PhotoUploader onChange={onChange} compress={compress} />);
    await userEvent.upload(container.querySelector('input[type=file]') as HTMLInputElement, file('a.jpg'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([], true));
    finish(file('a.jpg'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([expect.any(File)], false));
  });
});

describe('tracker, badge and timeline', () => {
  it('CFT-04: the 4-step tracker announces the current step; withdrawn/closed show a stopped bar', () => {
    const { rerender } = render(<ComplaintProgress status="awaiting_confirmation" />);
    expect(screen.getByRole('list', { name: 'Progress: step 3 of 4, Your review' })).toBeInTheDocument();
    rerender(<ComplaintProgress status="awaiting_confirmation" viewer="staff" />);
    expect(screen.getByText('Reporter review')).toBeInTheDocument();
    rerender(<ComplaintProgress status="withdrawn" />);
    expect(screen.getByText(/Stopped — withdrawn/)).toBeInTheDocument();
    rerender(<ComplaintStatusBadge status="awaiting_confirmation" />);
    expect(screen.getByText('Awaiting Approval')).toBeInTheDocument();
  });

  it('timeline labels events with names resolved by the API', () => {
    const h = (id: number, eventType: ComplaintHistoryEntry['eventType'], extra: Partial<ComplaintHistoryEntry> = {}): ComplaintHistoryEntry => ({
      id,
      eventType,
      fromStatus: null,
      toStatus: 'pending_review',
      actor: { id: 'u1', fullName: 'Ravi Kumar', role: 'department_staff' },
      note: null,
      changes: {},
      createdAt: '2026-11-10T04:20:00.000Z',
      ...extra,
    });
    render(
      <ComplaintTimeline
        timeZone="Asia/Kolkata"
        meId="me"
        history={[
          h(1, 'submitted', { actor: { id: 'me', fullName: 'Priya', role: 'student' } }),
          h(2, 'reassigned', { changes: { department: { fromName: 'Electrical Department', toName: 'Plumbing Department' } } }),
          h(3, 'auto_resolved', { actor: null }),
          h(4, 'rejected', { actor: { id: 'me', fullName: 'Priya', role: 'student' }, note: 'Still noisy' }),
        ]}
      />,
    );
    expect(screen.getByText('Complaint submitted')).toBeInTheDocument();
    expect(screen.getByText('Moved from Electrical Department to Plumbing Department')).toBeInTheDocument();
    expect(screen.getByText('Resolved automatically')).toBeInTheDocument();
    expect(screen.getByText('Sent back by you')).toBeInTheDocument();
    expect(screen.getByText('Still noisy')).toBeInTheDocument();
  });
});

describe('CFT-09 Lightbox', () => {
  const photo = (i: number): ComplaintAttachment => ({
    id: `p${i}`,
    kind: 'report',
    url: `https://files.example/p${i}.webp`,
    thumbUrl: `https://files.example/p${i}_thumb.webp`,
    width: 800,
    height: 600,
    sizeBytes: 1000,
    expiresAt: '2026-11-12T10:00:00.000Z',
    createdAt: '2026-11-12T09:50:00.000Z',
  });

  function Harness() {
    const [index, setIndex] = React.useState<number | null>(1);
    return (
      <MemoryRouter>
        <button type="button">outside</button>
        <Lightbox photos={[photo(1), photo(2), photo(3)]} index={index} onIndex={setIndex} />
        <span data-testid="index">{String(index)}</span>
      </MemoryRouter>
    );
  }

  it('shows "2 of 3", moves with arrow keys and buttons, and closes on Escape', async () => {
    render(<Harness />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 of 3')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Photo 2 of 3' })).toHaveAttribute('src', 'https://files.example/p2.webp');
    await userEvent.keyboard('{ArrowRight}');
    expect(within(dialog).getByText('3 of 3')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(dialog).getByText('1 of 3')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Previous photo' }));
    expect(within(dialog).getByText('3 of 3')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('index')).toHaveTextContent('null');
  });
});
