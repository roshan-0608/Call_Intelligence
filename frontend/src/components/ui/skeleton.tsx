import { cn } from '@/lib/utils';

/**
 * Loading placeholder shaped like the content it replaces, so the layout does
 * not jump when data arrives. The original app showed a centred "Loading…"
 * paragraph and then reflowed the entire page.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-accent', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}
