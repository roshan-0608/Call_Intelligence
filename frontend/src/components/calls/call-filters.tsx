import { Search, X } from 'lucide-react';
import {
  ACTION_LABELS,
  CALL_STAGES,
  NEXT_ACTIONS,
  SITE_VISIT_LABELS,
  SITE_VISIT_OUTCOMES,
  STAGE_LABELS,
  type CallListQuery,
} from '@call-intel/shared';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';

/**
 * Filter row above the table, per the interaction spec: all controls on one
 * line, each one immediately applied, and a single visible reset.
 */
export interface CallFiltersProps {
  value: Partial<CallListQuery>;
  onChange: (next: Partial<CallListQuery>) => void;
  telecallers: string[];
  total: number;
}

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'occurredAt:desc', label: 'Newest first' },
  { value: 'occurredAt:asc', label: 'Oldest first' },
  { value: 'overallScore:desc', label: 'Highest score' },
  { value: 'overallScore:asc', label: 'Lowest score' },
  { value: 'durationSec:desc', label: 'Longest call' },
  { value: 'leadName:asc', label: 'Lead name A–Z' },
];

export function CallFilters({ value, onChange, telecallers, total }: CallFiltersProps) {
  const hasFilters = Boolean(
    value.q || value.stage || value.action || value.outcome || value.telecaller || value.flagged,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={value.q ?? ''}
            onChange={(event) => onChange({ q: event.target.value, page: 1 })}
            placeholder="Search lead, telecaller or call ID"
            aria-label="Search calls"
            className="pl-9"
          />
        </div>

        <Select
          className="w-auto min-w-36"
          value={value.telecaller ?? ''}
          onChange={(event) => onChange({ telecaller: event.target.value || undefined, page: 1 })}
          aria-label="Filter by telecaller"
        >
          <option value="">All telecallers</option>
          {telecallers.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>

        <Select
          className="w-auto min-w-36"
          value={value.stage ?? ''}
          onChange={(event) =>
            onChange({
              stage: (event.target.value || undefined) as CallListQuery['stage'],
              page: 1,
            })
          }
          aria-label="Filter by stage reached"
        >
          <option value="">All stages</option>
          {CALL_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </option>
          ))}
        </Select>

        <Select
          className="w-auto min-w-36"
          value={value.outcome ?? ''}
          onChange={(event) =>
            onChange({
              outcome: (event.target.value || undefined) as CallListQuery['outcome'],
              page: 1,
            })
          }
          aria-label="Filter by site visit outcome"
        >
          <option value="">All visit outcomes</option>
          {SITE_VISIT_OUTCOMES.map((outcome) => (
            <option key={outcome} value={outcome}>
              {SITE_VISIT_LABELS[outcome]}
            </option>
          ))}
        </Select>

        <Select
          className="w-auto min-w-36"
          value={value.action ?? ''}
          onChange={(event) =>
            onChange({
              action: (event.target.value || undefined) as CallListQuery['action'],
              page: 1,
            })
          }
          aria-label="Filter by recommended action"
        >
          <option value="">All actions</option>
          {NEXT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {ACTION_LABELS[action]}
            </option>
          ))}
        </Select>

        <Select
          className="w-auto min-w-36"
          value={`${value.sort ?? 'occurredAt'}:${value.order ?? 'desc'}`}
          onChange={(event) => {
            const [sort, order] = event.target.value.split(':');
            onChange({
              sort: sort as CallListQuery['sort'],
              order: order as CallListQuery['order'],
              page: 1,
            });
          }}
          aria-label="Sort calls"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="tabular text-xs text-muted-foreground">
          {total} call{total === 1 ? '' : 's'}
        </span>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-secondary-foreground">
          <input
            type="checkbox"
            checked={value.flagged === true}
            onChange={(event) => onChange({ flagged: event.target.checked || undefined, page: 1 })}
            className="size-3.5 accent-[var(--primary)]"
          />
          Only rows repaired at import
        </label>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                q: undefined,
                stage: undefined,
                action: undefined,
                outcome: undefined,
                telecaller: undefined,
                flagged: undefined,
                page: 1,
              })
            }
          >
            <X />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
