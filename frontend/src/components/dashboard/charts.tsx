import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MAX_SCORE, scoreBand, type Analytics, type ScoreBand } from '@call-intel/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useChartColors, type ChartColors } from '@/hooks/use-chart-colors';

/**
 * Dashboard charts.
 *
 * Each plots one measure, so each is a single-series bar chart: no legend (the
 * title names the series), a recessive dashed grid, muted axes, thin marks with
 * 4px rounded data ends, and a hover tooltip. The dimension chart is the only
 * one that colours its marks — by score band, from the reserved status palette,
 * with the value direct-labelled so colour is never the only signal.
 *
 * Colours arrive as resolved values from `useChartColors` rather than as
 * `var(--token)` strings, because Recharts emits them as SVG presentation
 * attributes where `var()` does not resolve.
 *
 * Exact values are recoverable two ways: the hover tooltip, and the "View as
 * table" disclosure under every chart. That disclosure is also what covers
 * screen readers, printing and forced-colors mode. (Direct on-mark labels were
 * tried and dropped: neither `LabelList` nor `Bar label` renders under Recharts
 * 3.10 in this configuration, and a label that silently does not paint is worse
 * than one that was never promised.)
 */

const BAR_RADIUS_VERTICAL: [number, number, number, number] = [4, 4, 0, 0];
const BAR_RADIUS_HORIZONTAL: [number, number, number, number] = [0, 4, 4, 0];

function bandColor(score: number, colors: ChartColors): string {
  const map: Record<ScoreBand, string> = {
    strong: colors.good,
    developing: colors.warning,
    weak: colors.critical,
  };
  return map[scoreBand(score)];
}

interface TooltipEntry {
  value?: number | string;
}

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel,
  suffix = '',
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  valueLabel: string;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <p className="tabular mt-0.5 text-xs text-secondary-foreground">
        {valueLabel}: <span className="font-semibold text-foreground">{payload[0]?.value}</span>
        {suffix}
      </p>
    </div>
  );
}

function TableView({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: [string, string];
  rows: Array<[string, string | number]>;
}) {
  return (
    <details className="mt-3 border-t border-border pt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        View as table
      </summary>
      <table className="mt-2 w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 font-medium">
              {columns[0]}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {columns[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key} className="border-t border-border">
              <td className="py-1">{key}</td>
              <td className="tabular py-1 text-right font-medium">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Shared axis/grid configuration so all four charts read as one system. */
function useAxisProps(colors: ChartColors) {
  return {
    tick: { fill: colors.muted, fontSize: 11 },
    stroke: colors.axis,
    tickLine: false,
  } as const;
}

export function ScoreDistributionChart({ data }: { data: Analytics['scoreDistribution'] }) {
  const colors = useChartColors();
  const axis = useAxisProps(colors);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Overall score distribution</CardTitle>
        <CardDescription>Calls per score band, out of {MAX_SCORE}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="bucket" {...axis} axisLine={{ stroke: colors.axis }} />
              <YAxis {...axis} axisLine={false} />
              <Tooltip
                cursor={{ fill: colors.accent }}
                content={<ChartTooltip valueLabel="Calls" />}
              />
              <Bar
                dataKey="count"
                fill={colors.series}
                radius={BAR_RADIUS_VERTICAL}
                maxBarSize={40}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <TableView
          caption="Number of calls in each overall score band"
          columns={['Score band', 'Calls']}
          rows={data.map((row) => [row.bucket, row.count])}
        />
      </CardContent>
    </Card>
  );
}

export function DimensionAveragesChart({ data }: { data: Analytics['dimensionAverages'] }) {
  const colors = useChartColors();
  const axis = useAxisProps(colors);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Average score by dimension</CardTitle>
        <CardDescription>
          Where coaching is needed across all calls · coloured by band
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 44, bottom: 4, left: 8 }}
              barCategoryGap={12}
            >
              <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, MAX_SCORE]}
                {...axis}
                axisLine={{ stroke: colors.axis }}
              />
              <YAxis type="category" dataKey="label" width={112} {...axis} axisLine={false} />
              <Tooltip
                cursor={{ fill: colors.accent }}
                content={<ChartTooltip valueLabel="Average" suffix={` / ${MAX_SCORE}`} />}
              />
              <Bar
                dataKey="avg"
                radius={BAR_RADIUS_HORIZONTAL}
                maxBarSize={20}
                isAnimationActive={false}
              >
                {data.map((row) => (
                  <Cell key={row.dimension} fill={bandColor(row.avg, colors)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <TableView
          caption="Average score for each coaching dimension"
          columns={['Dimension', `Average / ${MAX_SCORE}`]}
          rows={data.map((row) => [row.label, row.avg.toFixed(2)])}
        />
      </CardContent>
    </Card>
  );
}

export function StageFunnelChart({ data }: { data: Analytics['stageFunnel'] }) {
  const colors = useChartColors();
  const axis = useAxisProps(colors);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Furthest stage reached</CardTitle>
        <CardDescription>How far calls progress before they end</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 44, bottom: 4, left: 8 }}
              barCategoryGap={8}
            >
              <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" horizontal={false} />
              <XAxis type="number" {...axis} axisLine={{ stroke: colors.axis }} />
              <YAxis type="category" dataKey="label" width={132} {...axis} axisLine={false} />
              <Tooltip
                cursor={{ fill: colors.accent }}
                content={<ChartTooltip valueLabel="Calls" />}
              />
              <Bar
                dataKey="count"
                fill={colors.series}
                radius={BAR_RADIUS_HORIZONTAL}
                maxBarSize={18}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <TableView
          caption="Number of calls by furthest stage reached"
          columns={['Stage', 'Calls']}
          rows={data.map((row) => [row.label, row.count])}
        />
      </CardContent>
    </Card>
  );
}

export function TopLocationsChart({ data }: { data: Analytics['topLocations'] }) {
  const colors = useChartColors();
  const axis = useAxisProps(colors);
  const rows = data.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Most requested locations</CardTitle>
        <CardDescription>Buying-preference areas named by leads</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 44, bottom: 4, left: 8 }}
              barCategoryGap={8}
            >
              <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" horizontal={false} />
              <XAxis type="number" {...axis} axisLine={{ stroke: colors.axis }} />
              <YAxis type="category" dataKey="label" width={140} {...axis} axisLine={false} />
              <Tooltip
                cursor={{ fill: colors.accent }}
                content={<ChartTooltip valueLabel="Mentions" />}
              />
              <Bar
                dataKey="count"
                fill={colors.series}
                radius={BAR_RADIUS_HORIZONTAL}
                maxBarSize={18}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <TableView
          caption="Number of leads naming each location as a buying preference"
          columns={['Location', 'Mentions']}
          rows={rows.map((row) => [row.label, row.count])}
        />
      </CardContent>
    </Card>
  );
}
