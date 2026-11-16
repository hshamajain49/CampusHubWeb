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
    const { rerender } = render(<StatusBadge status="confirmed" />);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    rerender(<StatusBadge status="completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    rerender(<StatusBadge status="expired" />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('StatusBadge shows the place in the queue for queued bookings only', () => {
    const { rerender } = render(<StatusBadge status="queued" queuePosition={3} />);
    expect(screen.getByText('In Queue')).toBeInTheDocument();
    expect(screen.getByText('· #3')).toBeInTheDocument();
    rerender(<StatusBadge status="confirmed" queuePosition={3} />);
    expect(screen.queryByText('· #3')).not.toBeInTheDocument();
  });
});
