// App.jsx
import React, { useMemo, useState, useCallback } from "react";
import Papa from "papaparse";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts";

const normalizeHeader = (h) => h.trim().toLowerCase().replace(/\s+/g, "_");

const toNumber = (v) => {
  if (v == null) return 0;
  const s = String(v).trim().replace(/,/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/i);
  if (!m) return Number(s) || 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
  return parseFloat(m[1]) * mult;
};

const fmt = (v, { percent = false } = {}) => {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  const unit = a >= 1e9 ? "B" : a >= 1e6 ? "M" : a >= 1e3 ? "K" : "";
  const base = unit ? a / (unit === "B" ? 1e9 : unit === "M" ? 1e6 : 1e3) : a;
  const num = base.toFixed(1).replace(/\.0$/, "");
  return percent ? `${sign}${num}%` : `${sign}${num}${unit}`;
};

export default function App() {
  const [rawRows, setRawRows] = useState([]);
  const [selectedMeasure, setSelectedMeasure] = useState("revenue"); // 'revenue' | 'margin' | 'cost' | 'no_of_transactions' | 'margin_pct'
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [subcatFilter, setSubcatFilter] = useState("All");

  const handleFileUpload = useCallback((file) => {
    Papa.parse(file, {
      header: true,
      delimiter: "\t",            // IMPORTANT: your sample is TSV
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: normalizeHeader,
      transform: (v) => (typeof v === "string" ? v.trim() : v),
      complete: ({ data }) => {
        const rows = data.map((r) => ({
          category: r.category || "",
          sub_category: r.sub_category || "",
          item: r.item || "",
          sku_code: (r.sku_code || "").trim(),
          sku_description: r.sku_description || "",
          revenue: toNumber(r.revenue),
          margin: toNumber(r.margin),
          cost: toNumber(r.cost),
          no_of_transactions: toNumber(r.no_of_transactions),
        }));
        setRawRows(rows);
      },
    });
  }, []);

  // Filters
  const filtered = useMemo(() => {
    return rawRows.filter((r) =>
      (categoryFilter === "All" || r.category === categoryFilter) &&
      (subcatFilter === "All" || r.sub_category === subcatFilter)
    );
  }, [rawRows, categoryFilter, subcatFilter]);

  // Aggregate at filtered "view" level & compute Margin%
  const viewData = useMemo(() => {
    // group by item
    const byItem = new Map();
    for (const r of filtered) {
      const k = r.item || "(Unknown)";
      const o = byItem.get(k) || { item: k, revenue: 0, margin: 0, cost: 0, no_of_transactions: 0 };
      o.revenue += r.revenue || 0;
      o.margin += r.margin || 0;
      o.cost += r.cost || 0;
      o.no_of_transactions += r.no_of_transactions || 0;
      byItem.set(k, o);
    }
    const arr = Array.from(byItem.values()).map((o) => ({
      ...o,
      margin_pct: o.revenue ? (o.margin / o.revenue) * 100 : 0,
    }));
    // sort alphabetically by item
    arr.sort((a, b) => (a.item || "").localeCompare(b.item || "", undefined, { sensitivity: "base" }));
    return arr;
  }, [filtered]);

  const valueDomain = useMemo(() => {
    const vals = viewData.map((d) => d[selectedMeasure] || 0);
    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 1); // avoid 0 range
    return { min, max, range: Math.max(max - min, 1) };
  }, [viewData, selectedMeasure]);

  // Color rules
  const colorFor = useCallback(
    (v) => {
      if (selectedMeasure === "margin_pct") {
        return v >= 0 ? "#2e7d32" : "#c62828"; // green / red
      }
      // purple gradient (lighter->darker by value)
      const t = (v - valueDomain.min) / valueDomain.range; // 0..1
      // Interpolate between light and dark purple
      const start = [220, 200, 255]; // light lilac
      const end = [90, 20, 140];     // deep purple
      const to = start.map((s, i) => Math.round(s + (end[i] - s) * t));
      return `rgb(${to[0]}, ${to[1]}, ${to[2]})`;
    },
    [selectedMeasure, valueDomain]
  );

  // Custom tooltip
  const tooltipFormatter = useCallback(
    (value) => {
      const isPct = selectedMeasure === "margin_pct";
      return [isPct ? fmt(value, { percent: true }) : fmt(value), labelFor(selectedMeasure)];
    },
    [selectedMeasure]
  );

  const labelFor = (k) =>
    ({
      revenue: "Revenue",
      margin: "Margin",
      cost: "Cost",
      no_of_transactions: "No. of Transactions",
      margin_pct: "Margin %",
    }[k] || k);

  const categories = useMemo(() => ["All", ...Array.from(new Set(rawRows.map((r) => r.category))).filter(Boolean).sort()], [rawRows]);
  const subcats = useMemo(() => {
    const base = rawRows.filter((r) => categoryFilter === "All" || r.category === categoryFilter);
    return ["All", ...Array.from(new Set(base.map((r) => r.sub_category))).filter(Boolean).sort()];
  }, [rawRows, categoryFilter]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <h2 className="text-xl font-semibold mb-3">SKU App</h2>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <input type="file" accept=".csv,.tsv,.txt" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
        <select value={selectedMeasure} onChange={(e) => setSelectedMeasure(e.target.value)}>
          <option value="revenue">Revenue</option>
          <option value="margin">Margin</option>
          <option value="cost">Cost</option>
          <option value="no_of_transactions">No. of Transactions</option>
          <option value="margin_pct">Margin %</option>
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={subcatFilter} onChange={(e) => setSubcatFilter(e.target.value)}>
          {subcats.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-sm text-gray-600">
          Rows: {viewData.length} • Measure: <strong>{labelFor(selectedMeasure)}</strong>
        </span>
      </div>

      <div style={{ width: "100%", height: 520 }}>
        <ResponsiveContainer>
          <BarChart data={viewData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="item"
              interval={0}
              angle={-25}
              textAnchor="end"
              height={80}
            />
            <YAxis
              tickFormatter={(v) =>
                selectedMeasure === "margin_pct" ? fmt(v, { percent: true }) : fmt(v)
              }
            />
            <Tooltip
              formatter={tooltipFormatter}
              labelStyle={{ fontWeight: 600 }}
              itemStyle={{ paddingTop: 4 }}
            />
            <Bar
              dataKey={selectedMeasure}
              isAnimationActive={false}
              // Per-bar color using function
              fill="#7e57c2"
            >
              <LabelList
                dataKey={selectedMeasure}
                position="top"
                formatter={(v) =>
                  selectedMeasure === "margin_pct" ? fmt(v, { percent: true }) : fmt(v)
                }
              />
              {
                // Apply per-bar color via a function on each cell
                viewData.map((entry, idx) => (
                  <cell // lowercase 'cell' in JSX maps to <Cell />
                    key={`cell-${idx}`}
                    fill={colorFor(entry[selectedMeasure] || 0)}
                  />
                ))
              }
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
