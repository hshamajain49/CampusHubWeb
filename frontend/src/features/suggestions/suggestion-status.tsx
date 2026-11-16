import type { Suggestion } from '@campushub/shared';
import { Pill } from '@/components/common/badges';

export function SuggestionStatusPill({ s }: { s: Pick<Suggestion, 'status'> }) {
  return s.status === 'reviewed' ? <Pill tone="success">Reviewed</Pill> : <Pill tone="primary">New</Pill>;
}
