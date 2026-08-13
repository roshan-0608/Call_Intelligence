import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * A single headline number. Not a chart: one value has no shape to plot, so it
 * gets a large figure, a label, and at most one line of context.
 */
export interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  /** Applied to the figure only, for status-coloured values. */
  valueClassName?: string;
}

export function StatTile({ label, value, hint, icon: Icon, valueClassName }: StatTileProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}
      </div>
      <p className={cn('mt-2 text-2xl font-semibold tracking-tight', valueClassName)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function StatTileSkeleton() {
  return (
    <Card className="p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-24" />
    </Card>
  );
}
