import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@call-intel/shared';
import { Button } from '@/components/ui/button';

/** Server-driven pagination. Page size is a user choice, capped by the API. */
export function Pagination({
  meta,
  onPageChange,
  onPageSizeChange,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const firstRow = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const lastRow = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <p className="tabular text-xs text-muted-foreground">
        {firstRow}–{lastRow} of {meta.total}
      </p>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Rows
          <select
            value={meta.pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-7 rounded-md border border-border bg-card px-1.5 text-xs"
            aria-label="Rows per page"
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <Button
          variant="outline"
          size="sm"
          disabled={!meta.hasPrev}
          onClick={() => onPageChange(meta.page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>

        <span className="tabular text-xs text-secondary-foreground">
          {meta.page} / {Math.max(meta.totalPages, 1)}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={!meta.hasNext}
          onClick={() => onPageChange(meta.page + 1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
