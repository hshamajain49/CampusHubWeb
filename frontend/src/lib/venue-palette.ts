// Deterministic venue banner palettes (§19.2): hash = fold(codeUnits, 0, (h, c) => (h*31 + c) & 0x7fffffff).
export const VENUE_PALETTES: [string, string][] = [
  ['#1E3A8A', '#0D9488'],
  ['#3730A3', '#6D28D9'],
  ['#0F766E', '#15803D'],
  ['#1D4ED8', '#0891B2'],
  ['#B45309', '#DC2626'],
  ['#334155', '#1E3A8A'],
];

export function venueHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff;
  return h;
}

export function venuePalette(id: string): [string, string] {
  return VENUE_PALETTES[venueHash(id) % VENUE_PALETTES.length]!;
}

export function venueGradient(id: string): string {
  const [a, b] = venuePalette(id);
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}
