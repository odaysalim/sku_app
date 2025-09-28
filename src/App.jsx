import React, { useState, useMemo, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Cell
} from 'recharts';
import { Upload, Home, ArrowLeft, BarChart3, ChevronRight } from 'lucide-react';
import Papa from 'papaparse';

// Works locally and on GitHub Pages because it respects vite.config.js base
const DEFAULT_CSV_PATH = `${import.meta.env.BASE_URL}data/sku_data.csv`;

const SKUDashboard = () => {
  const [data, setData] = useState([]);
  const [drillPath, setDrillPath] = useState([]); // ["Category","Sub-Category","Item"]
  const [selectedMetric, setSelectedMetric] = useState('Revenue');
  const [availableMetrics, setAvailableMetrics] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // ---------- helpers ----------
  const toNumber = (v) => {
    if (v === null || v === undefined) return 0;
    const s = String(v).trim().replace(/,/g, '');
    const m = s.match(/^(-?\d+(?:\.\d+)?)([kKmMbB])?$/);
    if (!m) return Number(s) || 0;
    const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9 }[m[2]] || 1;
    return parseFloat(m[1]) * mult;
  };
  const compact = (n) => {
    const x = Number(n);
    const a = Math.abs(x);
    if (a >= 1e9) return (x / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (x / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (x / 1e3).toFixed(1) + 'K';
    return Math.round(x).toString();
  };
  const asPct = (n) => `${Number(n).toFixed(1)}%`;
  const normKey = (k) => String(k || '').toLowerCase().replace(/\s+|-/g, '_');

  const purpleShade = (t) => {
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const lerp = (a, b, p) => Math.round(a + (b - a) * clamp(p));
    const from = { r: 237, g: 233, b: 254 }; // indigo-50
    const to = { r: 91, g: 33, b: 182 };     // indigo-800
    const p = clamp(t);
    return `rgb(${lerp(from.r, to.r, p)}, ${lerp(from.g, to.g, p)}, ${lerp(from.b, to.b, p)})`;
  };
  const marginColor = (v) => (v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#9ca3af');

  // ---------- CSV parsing shared ----------
  const normalizeRows = (rows) => {
    return rows
      .map((r) => {
        const out = {};
        for (const [k, v] of Object.entries(r)) {
          const nk = normKey(k);
          if (nk === 'category') out.category = v;
          else if (nk === 'sub_category' || nk === 'subcategory' || nk === 'subcategory_1') out.sub_category = v;
          else if (nk === 'item') out.item = v;
          else if (nk === 'sku' || nk === 'sku_code' || nk === 'skucode' || nk === 'extid') out.sku_code = v;
          else out[k] = v; // keep everything else (measures, etc.)
        }
        return out;
      })
      .filter((r) => r.category && r.sub_category && r.item);
  };

  const inferMetrics = (rows) => {
    if (!rows.length) return [];
    // Find numeric columns
    const numericCols = new Set();
    rows.forEach((row) => {
      Object.entries(row).forEach(([k, v]) => {
        if (typeof v === 'number') numericCols.add(k);
        else if (typeof v === 'string' && !isNaN(toNumber(v))) numericCols.add(k);
      });
    });

    const list = Array.from(numericCols);
    // Add computed Margin % if both Margin and Revenue exist (by any casing)
    const has = (name) =>
      list.some((k) => normKey(k) === normKey(name));
    if (has('margin') && has('revenue') && !list.includes('Margin %')) list.push('Margin %');
    // Nice default order if present
    const order = ['Revenue', 'Margin', 'Cost', 'No of Transactions', 'Margin %'];
    const ordered = [
      ...order.filter((x) => list.find((y) => normKey(y) === normKey(x))),
      ...list.filter((x) => !order.find((y) => normKey(y) === normKey(x))),
    ];
    return ordered;
  };

  const parseAndSet = (rows) => {
    const normalized = normalizeRows(rows);

    // Coerce numeric-looking fields to numbers
    const numRows = normalized.map((r) => {
      const out = { ...r };
      for (const [k, v] of Object.entries(out)) {
        if (typeof v === 'string' && v.trim() !== '' && !isNaN(toNumber(v))) {
          out[k] = toNumber(v);
        }
      }
      return out;
    });

    const metrics = inferMetrics(numRows);
    setData(numRows);
    setAvailableMetrics(metrics);
    if (metrics.length && !metrics.includes(selectedMetric)) {
      setSelectedMetric(metrics[0]);
    }
  };

  // ---------- Autoload on mount ----------
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoading(true);
        setError('');
        const res = await fetch(DEFAULT_CSV_PATH, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          complete: (result) => {
            if (cancelled) return;
            if (result.errors?.length) {
              // Non-fatal; show first warning
              setError(`CSV parse: ${result.errors[0].message}`);
            }
            parseAndSet(result.data || []);
            setIsLoading(false);
          },
          error: (err) => {
            if (cancelled) return;
            setIsLoading(false);
            setError(`CSV parse failed: ${err?.message || 'Unknown error'}`);
          },
        });
      } catch (e) {
        if (!cancelled) {
          setIsLoading(false);
          setError(`Failed to load data file at ${DEFAULT_CSV_PATH}`);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []); // load once

  // ---------- Manual upload (optional fallback) ----------
  const handleFile = (file) => {
    if (!file) return;
    setIsLoading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (result) => {
        parseAndSet(result.data || []);
        setIsLoading(false);
      },
      error: (err) => {
        setIsLoading(false);
        setError(`CSV parse failed: ${err?.message || 'Unknown error'}`);
      },
    });
  };

  // ---------- Drill helpers ----------
  const levelKey = (lvl) => (['category', 'sub_category', 'item'][lvl] || 'category');
  const currentLevel = drillPath.length; // 0->category, 1->sub_category, 2->item

  const grouped = useMemo(() => {
    if (!data.length) return [];
    // roll up by current level + (previous levels fixed by drillPath)
    let filtered = data;
    if (drillPath[0]) filtered = filtered.filter((r) => r.category === drillPath[0]);
    if (drillPath[1]) filtered = filtered.filter((r) => r.sub_category === drillPath[1]);

    // sum measures by key
    const key = levelKey(currentLevel);
    const map = new Map();
    filtered.forEach((r) => {
      const k = r[key];
      if (!k) return;
      if (!map.has(k)) map.set(k, { name: k, rows: [] });
      map.get(k).rows.push(r);
    });

    // aggregate numerics
    const result = Array.from(map.values()).map(({ name, rows }) => {
      const agg = { name };
      // sum all numeric fields present
      const allKeys = new Set(rows.flatMap((r) => Object.keys(r)));
      allKeys.forEach((k) => {
        if (['category', 'sub_category', 'item', 'sku_code', 'name'].includes(k)) return;
        const sum = rows.reduce((a, r) => a + (typeof r[k] === 'number' ? r[k] : 0), 0);
        if (Number.isFinite(sum)) agg[k] = sum;
      });
      // computed Margin %
      const rev = agg['Revenue'] ?? agg['revenue'];
      const mar = agg['Margin'] ?? agg['margin'];
      if (Number.isFinite(rev) && rev !== 0 && Number.isFinite(mar)) {
        agg['Margin %'] = (mar / rev) * 100;
      }
      return agg;
    });

    // sort A→Z by name
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }, [data, drillPath, currentLevel]);

  // color scale
  const barsWithColor = useMemo(() => {
    if (!grouped.length) return [];
    const m = selectedMetric;
    const vals = grouped.map((d) => Number(d[m]) || 0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    return grouped.map((d) => {
      const v = Number(d[m]) || 0;
      const t = (v - min) / range;
      return {
        ...d,
        __color: m === 'Margin %' ? marginColor(v) : purpleShade(t),
        __label: m === 'Margin %' ? asPct(v) : compact(v),
      };
    });
  }, [grouped, selectedMetric]);

  const onBarClick = (entry) => {
    if (!entry?.name) return;
    if (currentLevel < 2) setDrillPath([...drillPath, entry.name]);
  };
  const drillHome = () => setDrillPath([]);
  const drillBack = () => setDrillPath((p) => p.slice(0, -1));

  // tooltip content with all measures
  const renderTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    const entries = Object.entries(row)
      .filter(([k, v]) => typeof v === 'number' && !k.startsWith('__'));
    return (
      <div className="rounded-xl bg-white p-3 shadow border text-sm">
        <div className="font-medium mb-1">{label}</div>
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-6">
            <span className="text-gray-500">{k}</span>
            <span className="font-medium">
              {k === 'Margin %' ? asPct(v) : compact(v)}
            </span>
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
        <div className="ml-auto flex items-center gap-2 text-sm">
          {drillPath.length ? (
            <>
              <button onClick={drillHome} className="px-2 py-1 rounded hover:bg-gray-100 flex items-center gap-1">
                <Home className="w-4 h-4" /> Root
              </button>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              {drillPath.map((p, i) => (
                <span key={i} className="text-gray-600">{p}{i < drillPath.length - 1 && ' / '}</span>
              ))}
              <button onClick={drillBack} className="px-2 py-1 rounded hover:bg-gray-100 flex items-center gap-1">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            </>
          ) : (
            <span className="text-gray-500">Auto-loaded: <code>data/sku_data.csv</code></span>
          )}
        </div>
      </header>

      {/* Upload (optional fallback) */}
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
      </div>

      {/* Chart */}
      <div className="px-6 pb-10">
        <div className="w-full h-[460px] bg-white rounded-2xl p-4 shadow-sm border">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barsWithColor} margin={{ top: 16, right: 24, left: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} angle={0} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip content={renderTooltip} />
              <Bar dataKey={selectedMetric} onClick={onBarClick}>
                <LabelList dataKey="__label" position="top" />
                {barsWithColor.map((entry, i) => (
                  <Cell key={`c-${i}`} fill={entry.__color} cursor={currentLevel < 2 ? 'pointer' : 'default'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default SKUDashboard;
