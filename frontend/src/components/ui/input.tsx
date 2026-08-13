import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const fieldStyles =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldStyles, className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(fieldStyles, 'cursor-pointer pr-8', className)} {...props} />
  ),
);
Select.displayName = 'Select';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-lg border border-border bg-card p-3 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-xs font-medium text-secondary-foreground', className)}
      {...props}
    />
  );
}
