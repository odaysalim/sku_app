// mobile friendly view
import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from "recharts";
import Papa from "papaparse";
import { BarChart3 } from "lucide-react";

/* =========================
   Config
========================= */
const DEFAULT_CSV_PATH = `${import.meta.env.BASE_URL}data/sku_data.csv`;

// Categorical columns we’ll try, in order. We’ll only use the ones present.
const HIERARCHY_PREFERENCE = [
  "Category",
  "Group",
  "Sub-Group",
  "Sub_Group",
  "Sub Group",
  "Item",
  "SKU",
  "SKU_ID",
  "SKU Id",
  "SKU Description",
  "Description",
  "Name",
];

/* =========================
   Utilities
========================= */
// K/M/B formatter with 1 decimal when needed
const formatCompact = (n) => {
  if (n === null || n === undefined || Number.isNaN(+n)) return "-";
  const v = +n;
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return (v / 1_000_000_000).toFixed(v % 1_000_000_000 === 0 ? 0 : 1) + "B";
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + "M";
  if (abs >= 1_000) return (v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1) + "K";
  return String(v);
};

// % formatter (1 decimal)
const formatPct = (n) => (n === null || n === undefined || Number.isNaN(+n) ? "-" : `${(+n).toFixed(1)}%`);

// numeric check
const isNumberLike = (v) => v !== null && v !== "" && !isNaN(+v);

// build a nice title case for labels
const titleCase = (s) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1)) : s;

/* =========================
   Mobile detector (<=640px)
========================= */
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

/* =========================
   Main App
========================= */
export default function App() {
  const isMobile = useIsMobile();

  const [rawRows, setRawRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Drill path is an array of {key: <colName>, value: <groupValue>}
  const [drillPath, setDrillPath] = useState([]);

  // Available metrics (detected from CSV). Default to "Margin %" if present.
  const [metrics, setMetrics] = useState([]);
  const [metric, setMetric] = useState("Margin %");

  // Auto-load CSV on mount
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const resp = await fetch(DEFAULT_CSV_PATH, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Failed to load CSV: ${resp.status}`);
        const text = await resp.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const rows = parsed.data;

        if (!alive) return;

        // Trim & normalize headings
        const normalized = rows.map((r) => {
          const obj = {};
          Object.entries(r).forEach(([k, v]) => {
            const key = k.replace(/\uFEFF/g, "").trim();
            obj[key] = typeof v === "string" ? v.trim() : v;
          });
          return obj;
        });

        setRawRows(normalized);

        // Detect numeric columns
        const cols = Object.keys(normalized[0] || {});
        const numericCols = cols.filter((c) => {
          // if most values are number-like, consider numeric
          let count = 0;
          let seen = 0;
          for (let i = 0; i < normalized.length && seen < 30; i++) {
            const v = normalized[i][c];
            if (v !== undefined && v !== null && v !== "") {
              seen++;
              if (isNumberLike(v)) count++;
            }
          }
          return seen > 0 && count / Math.max(1, seen) > 0.7;
        });

        // Prefer "Margin %" default if present
        const initialMetric = numericCols.includes("Margin %")
          ? "Margin %"
          : numericCols[0] || "";

        setMetrics(numericCols);
        setMetric(initialMetric);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  // Pick which hierarchy columns exist in the file, in order.
  const hierarchy = useMemo(() => {
    const cols = Object.keys(rawRows[0] || {});
    return HIERARCHY_PREFERENCE.filter((c) => cols.includes(c));
  }, [rawRows]);

  const currentLevelIndex = drillPath.length; // 0 at root
  const atLeaf = currentLevelIndex >= Math.max(1, hierarchy.length) - 1;

  // Subset of rows at the current drill level (apply filters from drillPath)
  const scopedRows = useMemo(() => {
    if (!rawRows.length) return [];
    return rawRows.filter((r) =>
      drillPath.every((step) => String(r[step.key]) === String(step.value))
    );
  }, [rawRows, drillPath]);

  // Build chart data for the current level
  const chartData = useMemo(() => {
    if (!scopedRows.length) return [];

    const levelKey = hierarchy[currentLevelIndex] || hierarchy[hierarchy.length - 1];
    // Group rows by this level’s key
    const groups = new Map();
    for (const row of scopedRows) {
      const name = row[levelKey] ?? "(Unknown)";
      const key = String(name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    // For each group, compute metric value (sum or avg?)
    // Heuristic: For "Margin %" we use average; for others, sum.
    const useAvg = metric.toLowerCase().includes("%");
    const result = [];
    for (const [name, rows] of groups.entries()) {
      let agg = 0;
      let cnt = 0;
      for (const r of rows) {
        const v = r[metric];
        if (isNumberLike(v)) {
          agg += +v;
          cnt++;
        }
      }
      const value = useAvg ? (cnt ? agg / cnt : 0) : agg;

      // collect all numeric columns for tooltip display (from the *first* row)
      const first = rows[0] || {};
      const numerics = {};
      for (const k of Object.keys(first)) {
        const v = first[k];
        if (isNumberLike(v)) numerics[k] = +v;
      }

      result.push({ name, value, count: rows.length, _rows: rows, _numericsSample: numerics });
    }

    // Sort alphabetically by name for a stable UX
    result.sort((a, b) => a.name.localeCompare(b.name));

    return result;
  }, [scopedRows, metric, hierarchy, currentLevelIndex]);

  // Color strategy
  const isPercentMetric = metric.toLowerCase().includes("%") || /margin/i.test(metric);
  const colorScale = (val, idx, arr) => {
    if (isPercentMetric) return val >= 0 ? "#22c55e" : "#ef4444"; // green / red
    // purple gradient by rank (low -> light, high -> dark)
    const n = arr.length || 1;
    const t = n <= 1 ? 1 : idx / (n - 1); // 0..1
    // interpolate from #c4b5fd (light purple) to #6d28d9 (deep)
    const from = [196, 181, 253];
    const to = [109, 40, 217];
    const mix = (a, b) => Math.round(a + (b - a) * t);
    const [r, g, b_] = [mix(from[0], to[0]), mix(from[1], to[1]), mix(from[2], to[2])];
    return `rgb(${r},${g},${b_})`;
  };

  // Mobile-only chart props
  const chartMargin = isMobile
    ? { top: 16, right: 8, left: 8, bottom: 64 }
    : { top: 24, right: 24, left: 24, bottom: 16 };

  const xTickStyle = { fontSize: isMobile ? 10 : 12 };
  const yTickStyle = { fontSize: isMobile ? 10 : 12 };

  const xAxisMobileProps = isMobile
    ? { angle: -45, textAnchor: "end", interval: 0, height: 72 }
    : { interval: "preserveEnd" };

  const shortLabel = (s) =>
    isMobile && typeof s === "string" && s.length > 12 ? s.slice(0, 12) + "…" : s;

  // Value label formatter (top of bars)
  const valueFormatter = (v) => (isPercentMetric ? formatPct(v) : formatCompact(v));

  // Drill handlers
  const canDrill = !atLeaf;
  const onBarClick = (entry) => {
    if (!canDrill) return;
    const levelKey = hierarchy[currentLevelIndex];
    setDrillPath((prev) => [...prev, { key: levelKey, value: entry.name }]);
  };

  const onBreadcrumbClick = (idx) => {
    // keep up to idx (exclusive of the clicked level)
    setDrillPath((prev) => prev.slice(0, idx));
  };

  // Build tooltip content that shows all measures for that bucket (sample row + selected value)
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload;
    const numerics = p?._numericsSample || {};
    // ensure selected metric is shown first
    const orderedKeys = [
      metric,
      ...Object.keys(numerics).filter((k) => k !== metric),
    ];

    return (
      <div className="bg-white/95 backdrop-blur rounded-lg shadow p-3 border border-gray-200 text-xs sm:text-sm">
        <div className="font-semibold mb-1">{label}</div>
        <div className="space-y-0.5">
          {orderedKeys.map((k) => {
            const v = numerics[k];
            if (!isNumberLike(v)) return null;
            const show =
              k.toLowerCase().includes("%") || /margin/i.test(k) ? formatPct(v) : formatCompact(v);
            const strong = k === metric;
            return (
              <div key={k} className="flex gap-2 justify-between">
                <span className={strong ? "font-semibold" : ""}>{k}</span>
                <span className={strong ? "font-semibold" : ""}>{show}</span>
              </div>
            );
          })}
          <div className="pt-1 text-gray-500">Items: {p.count}</div>
        </div>
      </div>
    );
  };

  // Table at leaf level
  const leafTable = useMemo(() => {
    if (!atLeaf) return null;
    const cols = Object.keys(scopedRows[0] || {});
    // Keep some important columns at front if they exist
    const preferredFront = ["SKU", "SKU_ID", "SKU Description", "Description", "Item"];
    const front = preferredFront.filter((c) => cols.includes(c));
    const rest = cols.filter((c) => !front.includes(c));
    const ordered = [...front, ...rest];
    const maxRows = 200; // safety
    const rows = scopedRows.slice(0, maxRows);
    return { cols: ordered, rows };
  }, [atLeaf, scopedRows]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-indigo-600" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold leading-tight">SKU Drilldown Dashboard</h1>
              <div className="text-xs sm:text-sm text-gray-500">
                Auto-loaded: <code>data/sku_data.csv</code>
              </div>
            </div>
          </div>

          {/* Metric selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 hidden sm:block">Metric:</label>
            <select
              className="text-sm sm:text-base border rounded-lg px-2 py-1 bg-white"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
            >
              {metrics.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Breadcrumbs */}
        <nav className="text-sm mb-3 text-gray-600 flex flex-wrap items-center gap-1">
          <button
            className="underline-offset-2 hover:underline"
            onClick={() => setDrillPath([])}
          >
            Home
          </button>
          {drillPath.map((step, i) => (
            <span key={`${step.key}-${i}`} className="flex items-center gap-1">
              <span className="text-gray-400">/</span>
              <button
                className="underline-offset-2 hover:underline"
                onClick={() => onBreadcrumbClick(i + 1)}
              >
                {titleCase(step.value)}
              </button>
            </span>
          ))}
        </nav>

        {/* Status */}
        {loading && (
          <div className="p-4 rounded-lg bg-white border shadow-sm">Loading CSV…</div>
        )}
        {error && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        {/* Chart */}
        {!loading && !error && chartData.length > 0 && (
          <div className="bg-white border shadow-sm rounded-2xl p-3 sm:p-5">
            <ResponsiveContainer width="100%" height={isMobile ? 360 : 420}>
              <BarChart data={chartData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tick={xTickStyle}
                  tickFormatter={shortLabel}
                  {...xAxisMobileProps}
                />
                <YAxis
                  tick={yTickStyle}
                  tickFormatter={(v) => (isPercentMetric ? `${v}` : formatCompact(v))}
                />
                <Tooltip content={<CustomTooltip />} wrapperStyle={{ fontSize: isMobile ? 12 : 14 }} />
                <Bar dataKey="value" onClick={onBarClick} cursor={canDrill ? "pointer" : "default"}>
                  {/* Labels on top */}
                  <LabelList
                    dataKey="value"
                    position="top"
                    formatter={valueFormatter}
                    style={{ fontSize: isMobile ? 10 : 12, fill: "#111827" }}
                  />
                  {chartData.map((d, i, arr) => (
                    <Cell key={`c-${i}`} fill={colorScale(d.value, i, arr)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {canDrill ? (
              <div className="text-xs text-gray-500 mt-2">Tip: tap a bar to drill down.</div>
            ) : (
              <div className="text-xs text-gray-500 mt-2">End of hierarchy.</div>
            )}
          </div>
        )}

        {/* Leaf table */}
        {!loading && !error && atLeaf && leafTable && (
          <div className="mt-6 bg-white border shadow-sm rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b bg-gray-50">
                  {leafTable.cols.map((c) => (
                    <th key={c} className="px-3 py-2 whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leafTable.rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {leafTable.cols.map((c) => (
                      <td key={c} className="px-3 py-2 whitespace-nowrap">
                        {isNumberLike(r[c])
                          ? (String(c).toLowerCase().includes("%") ? formatPct(+r[c]) : formatCompact(+r[c]))
                          : String(r[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {scopedRows.length > leafTable.rows.length && (
              <div className="p-3 text-xs text-gray-500">
                Showing first {leafTable.rows.length} of {scopedRows.length} rows.
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && chartData.length === 0 && (
          <div className="p-6 rounded-xl bg-white border shadow-sm text-gray-600">
            No data to display.
          </div>
        )}
      </main>
    </div>
  );
}
