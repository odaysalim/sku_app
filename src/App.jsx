import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Cell
} from "recharts";
import { Home, ArrowLeft, BarChart3, ChevronRight } from "lucide-react";
import Papa from "papaparse";

const DEFAULT_CSV_PATH = `${import.meta.env.BASE_URL}data/sku_data.csv`;

/* ---------- utils ---------- */
const normKey = (k) => String(k || "").toLowerCase().replace(/\s+|-/g, "_");

// strict numeric (supports K/M/B). Returns NaN when not numeric.
function toNumberStrict(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return NaN;
  const s = v.trim().replace(/,/g, "");
  if (!s) return NaN;
  const m = s.match(/^(-?\d+(?:\.\d+)?)([kKmMbB])?$/);
  if (!m) return NaN;
  const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9 }[m[2]] || 1;
  return parseFloat(m[1]) * mult;
}

const compact = (n) => {
  const x = Number(n);
  const a = Math.abs(x);
  if (!Number.isFinite(x)) return "0";
  if (a >= 1e9) return (x / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (x / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (x / 1e3).toFixed(1) + "K";
  return Math.round(x).toString();
};
const asPct = (n) => `${Number(n).toFixed(1)}%`;
const purpleShade = (t) => {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, p) => Math.round(a + (b - a) * clamp(p));
  const from = { r: 237, g: 233, b: 254 }; // indigo-50
  const to = { r: 91, g: 33, b: 182 };     // indigo-800
  const p = clamp(t);
  return `rgb(${lerp(from.r, to.r, p)}, ${lerp(from.g, to.g, p)}, ${lerp(from.b, to.b, p)})`;
};
const marginColor = (v) => (v > 0 ? "#16a34a" : v < 0 ? "#dc2626" : "#9ca3af");

/* ---------- canonical metric names & header aliases ---------- */
const METRIC_ALIASES = {
  "Revenue": ["revenue", "rev"],
  "Margin": ["margin"],
  "Cost": ["cost"],
  "No of Transactions": ["no of transactions", "no_of_transactions", "nooftransactions", "transactions"]
};

function SKUDashboard() {
  const [rows, setRows] = useState([]);
  const [drillPath, setDrillPath] = useState([]); // [category, sub_category]
  const [availableMetrics, setAvailableMetrics] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState("Margin %"); // default to Margin %
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // normalize and coerce to canonical fields
  const normalizeRows = (raw) => {
    return raw.map((r) => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        const nk = normKey(k);
        if (nk === "category") out.category = v;
        else if (nk === "sub_category" || nk === "subcategory" || nk === "sub_category_1") out.sub_category = v;
        else if (nk === "item") out.item = v;
        else if (nk === "sku" || nk === "sku_code" || nk === "skucode" || nk === "extid") out.sku_code = v;
        else if (nk === "sku_description" || nk === "description") out.sku_description = v;
      }
      const keyMap = Object.fromEntries(Object.keys(r).map((k) => [normKey(k), k]));
      for (const [canon, aliases] of Object.entries(METRIC_ALIASES)) {
        for (const a of aliases) {
          if (keyMap[a] !== undefined) {
            const n = toNumberStrict(r[keyMap[a]]);
            if (!Number.isNaN(n)) out[canon] = n;
            break;
          }
        }
      }
      return out;
    }).filter((r) => r.category && r.sub_category && r.item);
  };

  const parseAndSet = (rawRows) => {
    const nrm = normalizeRows(rawRows);

    const present = new Set();
    for (const row of nrm) {
      for (const canon of Object.keys(METRIC_ALIASES)) {
        if (Number.isFinite(row[canon])) present.add(canon);
      }
    }

    const baseMetrics = ["Revenue", "Margin", "Cost", "No of Transactions"].filter((m) => present.has(m));
    const metrics = [...baseMetrics];
    if (present.has("Revenue") && present.has("Margin")) metrics.push("Margin %");

    setRows(nrm);
    setAvailableMetrics(metrics);
    // keep Margin % as default if available, else fallback to first metric
    if (metrics.includes("Margin %")) setSelectedMetric("Margin %");
    else if (!metrics.includes(selectedMetric)) setSelectedMetric(metrics[0] || "");
  };

  // autoload CSV
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        setIsLoading(true);
        setError("");
        const res = await fetch(DEFAULT_CSV_PATH, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          complete: (result) => {
            if (cancel) return;
            parseAndSet(result.data || []);
            if (result.errors?.length) setError(`CSV parse: ${result.errors[0].message}`);
            setIsLoading(false);
          },
          error: (err) => {
            if (cancel) return;
            setIsLoading(false);
            setError(`CSV parse failed: ${err?.message || "Unknown error"}`);
          }
        });
      } catch (e) {
        if (!cancel) {
          setIsLoading(false);
          setError(`Failed to load ${DEFAULT_CSV_PATH}`);
        }
      }
    })();
    return () => { cancel = true; };
  }, []);

  // drill / grouping
  const currentLevel = drillPath.length; // 0=category,1=sub_category,2=item
  const levelKey = (lvl) => (["category", "sub_category", "item"][lvl] || "category");

  const grouped = useMemo(() => {
    if (!rows.length) return [];
    let filtered = rows;
    if (drillPath[0]) filtered = filtered.filter((r) => r.category === drillPath[0]);
    if (drillPath[1]) filtered = filtered.filter((r) => r.sub_category === drillPath[1]);

    const key = levelKey(currentLevel);
    const bucket = new Map();
    for (const r of filtered) {
      const k = r[key];
      if (!k) continue;
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k).push(r);
    }

    const result = Array.from(bucket.entries()).map(([name, rs]) => {
      const agg = { name };
      for (const m of ["Revenue", "Margin", "Cost", "No of Transactions"]) {
        const sum = rs.reduce((a, r) => a + (Number(r[m]) || 0), 0);
        if (Number.isFinite(sum)) agg[m] = sum;
      }
      if (Number.isFinite(agg["Revenue"]) && agg["Revenue"] !== 0 && Number.isFinite(agg["Margin"])) {
        agg["Margin %"] = (agg["Margin"] / agg["Revenue"]) * 100;
      }
      return agg;
    });

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }, [rows, drillPath, currentLevel]);

  const colorized = useMemo(() => {
    if (!grouped.length || !selectedMetric) return [];
    const vals = grouped.map((d) => Number(d[selectedMetric]) || 0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    return grouped.map((d) => {
      const v = Number(d[selectedMetric]) || 0;
      const t = (v - min) / span;
      return {
        ...d,
        __color: selectedMetric === "Margin %" ? marginColor(v) : purpleShade(t),
        __label: selectedMetric === "Margin %" ? asPct(v) : compact(v)
      };
    });
  }, [grouped, selectedMetric]);

  const onBarClick = (e) => {
    if (!e?.name) return;
    if (currentLevel < 2) setDrillPath((p) => [...p, e.name]);
  };
  const drillHome = () => setDrillPath([]);
  const drillBack = () => setDrillPath((p) => p.slice(0, -1));

  const renderTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    const entries = [...availableMetrics].map((m) => [m, row[m]]).filter(([_, v]) => v !== undefined);
    return (
      <div className="rounded-xl bg-white p-3 shadow border text-sm">
        <div className="font-medium mb-1">{label}</div>
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-6">
            <span className="text-gray-500">{k}</span>
            <span className="font-medium">{k === "Margin %" ? asPct(v) : compact(v)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="px-8 py-5 border-b bg-white flex items-center gap-3">
        <BarChart3 className="w-6 h-6 text-indigo-600" />
        <h1 className="font-semibold text-lg md:text-xl">SKU Drilldown Dashboard</h1>
        <div className="ml-auto text-xs md:text-sm text-gray-500">Auto-loaded: data/sku_data.csv</div>
      </header>

      {/* Controls + breadcrumbs */}
      <div className="px-8 py-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm md:text-base text-gray-600">Metric:</span>
          <select
            className="bg-white border rounded-lg px-3 py-2 text-sm md:text-base"
            value={selectedMetric}
            onChange={(e) => setSelectedMetric(e.target.value)}
          >
            {availableMetrics.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2 text-sm md:text-base">
          {drillPath.length ? (
            <>
              <button onClick={drillHome} className="px-2 py-1 rounded hover:bg-gray-100 flex items-center gap-1">
                <Home className="w-4 h-4" /> Root
              </button>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              {drillPath.map((p, i) => (
                <span key={i} className="text-gray-700">
                  {p}{i < drillPath.length - 1 ? " / " : ""}
                </span>
              ))}
              <button onClick={drillBack} className="px-2 py-1 rounded hover:bg-gray-100 flex items-center gap-1">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Chart card */}
      <div className="px-8 pb-10">
        <div className="w-full h-[520px] bg-white rounded-2xl p-6 shadow-sm border">
          {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={colorized} margin={{ top: 24, right: 32, left: 8, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
                interval={0}
              />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
              <Tooltip content={renderTooltip} />
              <Bar dataKey={selectedMetric} onClick={onBarClick}>
                <LabelList dataKey="__label" position="top" style={{ fontSize: 12, fontWeight: 600 }} />
                {colorized.map((d, i) => (
                  <Cell key={i} fill={d.__color} cursor={drillPath.length < 2 ? "pointer" : "default"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default SKUDashboard;
