import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Cell
} from "recharts";
import { Upload, Home, ArrowLeft, BarChart3, ChevronRight } from "lucide-react";
import Papa from "papaparse";

const DEFAULT_CSV_PATH = `${import.meta.env.BASE_URL}data/sku_data.csv`;

// ---- strict numeric parsing (K/M/B supported). Returns NaN when not numeric.
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
const normKey = (k) => String(k || "").toLowerCase().replace(/\s+|-/g, "_");

const DIM_KEYS = new Set([
  "category", "sub_category", "item", "sku_code", "sku", "extid",
  "sku_description", "description", "name"
]);

const purpleShade = (t) => {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, p) => Math.round(a + (b - a) * clamp(p));
  const from = { r: 237, g: 233, b: 254 }; // indigo-50
  const to = { r: 91, g: 33, b: 182 };     // indigo-800
  const p = clamp(t);
  return `rgb(${lerp(from.r, to.r, p)}, ${lerp(from.g, to.g, p)}, ${lerp(from.b, to.b, p)})`;
};
const marginColor = (v) => (v > 0 ? "#16a34a" : v < 0 ? "#dc2626" : "#9ca3af");

function SKUDashboard() {
  const [rows, setRows] = useState([]);
  const [drillPath, setDrillPath] = useState([]); // [category, sub_category]
  const [availableMetrics, setAvailableMetrics] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // ---------- normalize headers (category/sub_category/item) ----------
  const normalizeRows = (raw) =>
    raw.map((r) => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        const nk = normKey(k);
        if (nk === "category") out.category = v;
        else if (nk === "sub_category" || nk === "subcategory") out.sub_category = v;
        else if (nk === "item") out.item = v;
        else if (nk === "sku" || nk === "sku_code" || nk === "skucode" || nk === "extid") out.sku_code = v;
        else if (nk === "sku_description" || nk === "description") out.sku_description = v;
        else out[k] = v;
      }
      return out;
    }).filter(r => r.category && r.sub_category && r.item);

  // ---------- detect numeric fields (≥80% of rows numeric) ----------
  const detectNumericFields = (rs) => {
    const counts = {};
    rs.forEach((r) => {
      for (const [k, v] of Object.entries(r)) {
        if (DIM_KEYS.has(k)) continue;
        const n = toNumberStrict(v);
        if (!Number.isNaN(n)) counts[k] = (counts[k] || 0) + 1;
      }
    });
    const threshold = Math.max(1, Math.floor(rs.length * 0.8));
    return Object.keys(counts).filter((k) => counts[k] >= threshold);
  };

  // ---------- parse & set ----------
  const parseAndSet = (rawRows) => {
    const nrm = normalizeRows(rawRows);
    // coerce numeric-looking fields (leave dimensions as text)
    const coerced = nrm.map((r) => {
      const out = { ...r };
      for (const [k, v] of Object.entries(out)) {
        if (DIM_KEYS.has(k)) continue;
        const n = toNumberStrict(v);
        if (!Number.isNaN(n)) out[k] = n; // keep original if not numeric
      }
      return out;
    });

    const numericCols = detectNumericFields(coerced);

    // Add Margin % only if Revenue and Margin are truly numeric columns
    const has = (name) => numericCols.some((c) => normKey(c) === normKey(name));
    const metrics = [...numericCols];
    if (has("revenue") && has("margin") && !metrics.includes("Margin %")) metrics.push("Margin %");

    // Preferred ordering if present
    const order = ["Revenue", "Margin", "Cost", "No of Transactions", "Margin %"];
    const ordered = [
      ...order.filter((x) => metrics.find((y) => normKey(y) === normKey(x))),
      ...metrics.filter((x) => !order.find((y) => normKey(y) === normKey(x))),
    ];

    setRows(coerced);
    setAvailableMetrics(ordered);
    if (!ordered.includes(selectedMetric)) setSelectedMetric(ordered[0] || "");
  };

  // ---------- autoload CSV ----------
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
  }, []); // once

  // ---------- optional manual upload ----------
  const handleFile = (file) => {
    if (!file) return;
    setIsLoading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res) => { parseAndSet(res.data || []); setIsLoading(false); },
      error: (err) => { setIsLoading(false); setError(`CSV parse failed: ${err?.message || "Unknown error"}`); }
    });
  };

  // ---------- drill state ----------
  const currentLevel = drillPath.length; // 0=category,1=sub_category,2=item
  const levelKey = (lvl) => (["category", "sub_category", "item"][lvl] || "category");

  // ---------- aggregate for current level ----------
  const grouped = useMemo(() => {
    if (!rows.length) return [];
    // filter by drillPath
    let filtered = rows;
    if (drillPath[0]) filtered = filtered.filter((r) => r.category === drillPath[0]);
    if (drillPath[1]) filtered = filtered.filter((r) => r.sub_category === drillPath[1]);

    // group by current level
    const key = levelKey(currentLevel);
    const bucket = new Map();
    for (const r of filtered) {
      const k = r[key];
      if (!k) continue;
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k).push(r);
    }

    // aggregate only vetted numeric metrics
    const metricSet = new Set(availableMetrics.filter((m) => m !== "Margin %"));
    const result = Array.from(bucket.entries()).map(([name, rs]) => {
      const agg = { name };
      for (const m of metricSet) {
        const sum = rs.reduce((a, r) => a + (Number(r[m]) || 0), 0);
        if (Number.isFinite(sum)) agg[m] = sum;
      }
      // computed margin %
      if (metricSet.has("Revenue") && metricSet.has("Margin")) {
        const rev = agg["Revenue"];
        const mar = agg["Margin"];
        if (Number.isFinite(rev) && rev !== 0 && Number.isFinite(mar)) {
          agg["Margin %"] = (mar / rev) * 100;
        }
      }
      return agg;
    });

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }, [rows, drillPath, currentLevel, availableMetrics]);

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
    const entries = availableMetrics
      .filter((m) => typeof row[m] === "number" || m === "Margin %")
      .map((m) => [m, row[m]]);
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
      <header className="px-6 py-4 border-b bg-white flex items-center gap-3">
        <BarChart3 className="w-5 h-5 text-indigo-600" />
        <h1 className="font-semibold">SKU Drilldown Dashboard</h1>
        <div className="ml-auto text-sm text-gray-500">Auto-loaded: data/sku_data.csv</div>
      </header>

      {/* Optional upload fallback */}
      <div className="m-6">
        <label
          htmlFor="file"
          className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl bg-white cursor-pointer hover:bg-gray-50"
        >
          <Upload className="w-6 h-6 text-gray-500 mb-1" />
          <span className="text-sm text-gray-700">Click to upload CSV/TSV (optional)</span>
          <span className="text-xs text-gray-500">Auto-load is using public/data/sku_data.csv</span>
          <input id="file" type="file" accept=".csv,.tsv,.txt" className="hidden"
                 onChange={(e) => handleFile(e.target.files?.[0])} />
        </label>
        {isLoading && <p className="text-sm text-gray-500 mt-2">Loading…</p>}
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {/* Controls */}
      <div className="px-6 flex items-center gap-3 mb-3">
        <span className="text-sm text-gray-600">Metric:</span>
        <select
          className="bg-white border rounded-lg px-3 py-2 text-sm"
          value={selectedMetric}
          onChange={(e) => setSelectedMetric(e.target.value)}
        >
          {availableMetrics.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2 text-sm">
          {drillPath.length ? (
            <>
              <button onClick={drillHome} className="px-2 py-1 rounded hover:bg-gray-100 flex items-center gap-1">
                <Home className="w-4 h-4" /> Root
              </button>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              {drillPath.map((p, i) => (
                <span key={i} className="text-gray-600">
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

      {/* Chart */}
      <div className="px-6 pb-10">
        <div className="w-full h-[460px] bg-white rounded-2xl p-4 shadow-sm border">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={colorized} margin={{ top: 16, right: 24, left: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip content={renderTooltip} />
              <Bar dataKey={selectedMetric} onClick={(e) => onBarClick(e)}>
                <LabelList dataKey="__label" position="top" />
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
