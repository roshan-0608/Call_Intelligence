import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Status variants use the reserved status palette. Two of those colours sit
 * below 3:1 on the light surface by design, which is why every badge carries a
 * text label — colour never carries the meaning alone.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-accent text-secondary-foreground',
        outline: 'border border-border text-secondary-foreground',
        good: 'bg-good/12 text-good',
        warning: 'bg-warning/15 text-warning',
        serious: 'bg-serious/15 text-serious',
        critical: 'bg-critical/12 text-critical',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
