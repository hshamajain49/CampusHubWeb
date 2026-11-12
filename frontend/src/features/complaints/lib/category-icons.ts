// Category icon allow-list → Lucide components, and the category colour treatment (§16.2): the colour is used only for
// the icon (darkened 22 %, Flutter "onTint") on a 12 % tint; text stays in neutral tokens, so contrast never depends on it.
import {
  AirVent,
  Armchair,
  BrickWall,
  Bus,
  CircleHelp,
  Droplets,
  Ellipsis,
  Fan,
  Lightbulb,
  Lock,
  Monitor,
  Printer,
  ShieldAlert,
  SprayCan,
  Trash2,
  Trees,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryIcon } from '@campushub/shared';

export const CATEGORY_ICON_COMPONENTS: Record<CategoryIcon, LucideIcon> = {
  zap: Zap,
  droplets: Droplets,
  wifi: Wifi,
  armchair: Armchair,
  'spray-can': SprayCan,
  'brick-wall': BrickWall,
  ellipsis: Ellipsis,
  wrench: Wrench,
  lightbulb: Lightbulb,
  fan: Fan,
  'air-vent': AirVent,
  'trash-2': Trash2,
  'shield-alert': ShieldAlert,
  bus: Bus,
  trees: Trees,
  utensils: Utensils,
  monitor: Monitor,
  printer: Printer,
  lock: Lock,
  'circle-help': CircleHelp,
};

export function categoryIcon(icon: string): LucideIcon {
  return CATEGORY_ICON_COMPONENTS[icon as CategoryIcon] ?? CircleHelp;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(/^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '64748b', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Icon colour: the category colour darkened by 22 %. */
export function onTint(hex: string): string {
  const [r, g, b] = rgb(hex).map((c) => Math.round(c * 0.78));
  return `rgb(${r} ${g} ${b})`;
}

/** Tile background: the category colour at 12 % opacity. */
export function tint(hex: string, alpha = 0.12): string {
  const [r, g, b] = rgb(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}
