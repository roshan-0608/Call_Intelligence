import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Minimal toast system.
 *
 * Exists because the original upload handler swallowed failures into
 * `console.log`: the button did nothing visible and the user had no way to know
 * the request had failed. Every mutation in this app reports its outcome here.
 */

export type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  notify: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-good' },
  error: { icon: AlertTriangle, className: 'text-critical' },
  info: { icon: Info, className: 'text-chart-1' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { ...toast, id }]);
      // Errors stay longer: they usually carry an instruction to read.
      window.setTimeout(() => dismiss(id), toast.tone === 'error' ? 9000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,92vw)] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const { icon: Icon, className } = TONE_STYLES[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
              className="pointer-events-auto flex items-start gap-3 rounded-card border border-border bg-popover p-3 shadow-lg"
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs text-secondary-foreground">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
