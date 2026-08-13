import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * Modal built on the native `<dialog>` element, which gives focus trapping,
 * Escape-to-close and the top layer for free — all of which the original
 * hand-rolled overlay div lacked.
 */
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Clicking the backdrop (the dialog element itself, outside its content)
      // dismisses; clicks inside the panel stop here.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
      className={cn(
        'fixed inset-0 m-auto max-h-[85vh] w-[min(42rem,92vw)] overflow-y-auto rounded-card border border-border bg-popover p-0 text-foreground shadow-xl backdrop:bg-black/50',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border p-4">
        <div>
          <h2 id="dialog-title" className="text-sm font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog">
          <X />
        </Button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
