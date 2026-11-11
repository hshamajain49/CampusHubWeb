// Shared state components: empty, error (with retry) and status badges.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusBadge } from './badges';
import { EmptyState, ErrorState } from './states';

describe('state components', () => {
  it('EmptyState shows its title, message and action', () => {
    render(<EmptyState title="No upcoming bookings" message="Book a venue to see it here." action={<a href="/venues">Browse venues</a>} />);
    expect(screen.getByRole('heading', { name: 'No upcoming bookings' })).toBeInTheDocument();
    expect(screen.getByText('Book a venue to see it here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse venues' })).toHaveAttribute('href', '/venues');
  });

  it('ErrorState retries on click', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Couldn't load bookings." onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('StatusBadge labels every status in words, not just colour', () => {
    const { rerender } = render(<StatusBadge status="pending" />);
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
    rerender(<StatusBadge status="approved" />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    rerender(<StatusBadge status="rejected" />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });
});
