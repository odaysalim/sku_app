import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell
} from 'recharts';
import { ChevronRight, Home, ArrowLeft, Upload, BarChart3 } from 'lucide-react';
import Papa from "papaparse";

const SKUDashboard = () => {
  const [data, setData] = useState([]);
  const [drillPath, setDrillPath] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState('Margin');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [availableMetrics, setAvailableMetrics] = useState([
    'Margin',
    'Revenue',
    'Cost',
    'No of Transactions',
  ]);

  // ---------- helpers ----------
  const toNumber = (v) => {
    if (v === null || v === undefined) return 0;
    const s = String(v).trim().toLowerCase().replace(/,/g, '');
    const m = s.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/i);
    if (!m) return Number(s) || 0;
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
    return parseFloat(m[1]) * mult;
  };

  // case-insensitive getter for numeric fields
  const getNum = (obj, candidates) => {
    const norm = (x) => x.toLowerCase().replace(/\s+|_/g, '');
    const keys = Object.keys(obj);
    for (const key of keys) {
      if (candidates.some((c) => norm(c) === norm(key))) {
        return toNumber(obj[key]);
      }
    }
    return 0;
  };

  // --- number/label formatting ---
  const compactNumber = (n) => {
    const num = Number(n);
    const abs = Math.abs(num);
    if (!Number.isFinite(num)) return '0';
    if (abs >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return String(Math.round(num));
  };

  const formatSpecific = (metricName, val) => {
    const isPct = /%/i.test(metricName) || /margin\s*%/i.test(metricName);
    if (isPct) {
      const num = Number(val);
      return Number.isFinite(num) ? `${num.toFixed(1)}%` : '0.0%';
    }
    return compactNumber(val);
  };

  const formatMetricValue = (val) =>
    selectedMetric === 'Margin %' ? `${Number(val).toFixed(1)}%` : compactNumber(val);

  // colors
  const marginColor = (v) => (v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#9ca3af'); // green / red / grey
  const purpleShade = (t) => {
    const clamp = (x) => Math.max(0, Math.min(1, x));
    const lerp = (a, b, p) => Math.round(a + (b - a) * clamp(p));
    const from = { r: 237, g: 233, b: 254 };
    const to = { r: 91, g: 33, b: 182 };
    const p = clamp(t);
    return `rgb(${lerp(from.r, to.r, p)}, ${lerp(from.g, to.g, p)}, ${lerp(from.b, to.b, p)})`;
  };

  // ---------- CSV/TSV upload ----------
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError('');

    try {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        delimitersToGuess: ['\t', ',', ';', '|'],
        transform: (v) => (typeof v === 'string' ? v.trim() : v),
        complete: ({ data: rows, errors }) => {
          if (errors?.length) setError(`Parse warning: ${errors[0].message}`);
          if (!rows || rows.length === 0) throw new Error('No rows found in file');

          const norm = (x) => String(x || '').toLowerCase().replace(/\s+|_/g, '');

          const normalized = rows
            .map((r) => {
              const out = {};
              for (const k of Object.keys(r)) {
                const nk = norm(k);
                const val = r[k];
                if (nk === 'category') out.category = val;
                else if (nk === 'subcategory') out.sub_category = val;
                else if (nk === 'item') out.item = val;
                else if (nk === 'skucode') out.sku_code = (val || '').trim();
                else if (nk === 'skudescription') out.sku_description = val;
              }

              const measureNames = [
                'revenue',
                'margin',
                'cost',
                'nooftransactions',
                'nooftrans',
                'transactions',
              ];

              for (const k of Object.keys(r)) {
                const nk = norm(k);
                if (measureNames.includes(nk)) {
                  out[k] = toNumber(r[k]);
                } else if (!(k in out)) {
                  out[k] = r[k];
                }
              }

              return out;
            })
            .filter((row) => row.category && row.sub_category && row.item);

          if (normalized.length === 0) {
            throw new Error('No valid rows after normalization (check category/sub-category/item)');
          }

          const sample = normalized[0];
          const numericCols = Object.keys(sample).filter((k) => typeof sample[k] === 'number');

          const hasMargin = Object.keys(sample).some((k) => norm(k) === 'margin');
          const hasRevenue = Object.keys(sample).some((k) => norm(k) === 'revenue');

          const metrics = [...numericCols];
          if (hasMargin && hasRevenue && !metrics.includes('Margin %')) metrics.push('Margin %');

          setData(normalized);
          setAvailableMetrics(metrics.length ? metrics : ['Margin', 'Revenue', 'Cost', 'No of Transactions']);
          if (metrics.includes('Margin')) setSelectedMetric('Margin');
          else if (metrics.length > 0) setSelectedMetric(metrics[0]);
          setDrillPath([]);
        },
        error: (e) => { throw e; },
      });
    } catch (err) {
      setError(`Error loading file: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Filtered data based on drill path
  const filteredData = useMemo(() => {
    let filtered = [...data];
    if (drillPath.length > 0) filtered = filtered.filter((i) => i.category === drillPath[0]);
    if (drillPath.length > 1) filtered = filtered.filter((i) => i.sub_category === drillPath[1]);
    if (drillPath.length > 2) filtered = filtered.filter((i) => i.item === drillPath[2]);
    return filtered;
  }, [data, drillPath]);

  // Grouping + chart data with full per-group metrics (and colors)
  const { chartData, isLeafLevel } = useMemo(() => {
    if (data.length === 0) return { chartData: [], isLeafLevel: false };

    let groupCol;
    let isLeaf = false;

    if (drillPath.length === 0) groupCol = 'category';
    else if (drillPath.length === 1) groupCol = 'sub_category';
    else if (drillPath.length === 2) groupCol = 'item';
    else {
      isLeaf = true;
    }

    if (!groupCol) return { chartData: [], isLeafLevel: true };

    // Build aggregated metrics for every group bucket
    const grouped = filteredData.reduce((acc, row) => {
      const key = row[groupCol];
      if (!acc[key]) acc[key] = { sums: {}, marginSum: 0, revenueSum: 0 };
      const bucket = acc[key];

      // sum every numeric metric (except Margin %, which is derived)
      availableMetrics
        .filter((m) => m !== 'Margin %')
        .forEach((m) => {
          const v = toNumber(row[m]);
          bucket.sums[m] = (bucket.sums[m] || 0) + (Number.isFinite(v) ? v : 0);
        });

      // track margin & revenue for % calc (case-insensitive)
      bucket.marginSum += getNum(row, ['Margin', 'margin']);
      bucket.revenueSum += getNum(row, ['Revenue', 'revenue']);

      return acc;
    }, {});

    // Convert to chart rows with colors + derived Margin %
    let temp = Object.entries(grouped).map(([name, agg]) => {
      const metricsMap = { ...agg.sums };
      const marginPct = agg.revenueSum > 0 ? (agg.marginSum / agg.revenueSum) * 100 : 0;
      metricsMap['Margin %'] = marginPct;

      const plottedValue = metricsMap[selectedMetric] ?? 0;

      return {
        name,
        value: plottedValue,
        __metrics: metricsMap,       // all measures for tooltip
      };
    });

    // alphabetical sort
    temp.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    // assign colors based on selected metric
    if (selectedMetric === 'Margin %') {
      temp = temp.map((d) => ({ ...d, fill: marginColor(d.value) }));
    } else {
      const vals = temp.map((d) => d.value);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const span = max - min || 1;
      temp = temp.map((d) => {
        const t = (d.value - min) / span;
        return { ...d, fill: purpleShade(t) };
      });
    }

    return { chartData: temp, isLeafLevel: false };
  }, [filteredData, drillPath, selectedMetric, data, availableMetrics]);

  // Handlers
  const handleBarClick = (d) => {
    if (d && d.name) setDrillPath((prev) => [...prev, d.name]);
  };
  const handleChartClick = (e) => {
    if (e.target.tagName === 'svg' || e.target.classList.contains('recharts-wrapper')) {
      if (drillPath.length > 0) setDrillPath((prev) => prev.slice(0, -1));
    }
  };
  const goBack = () => {
    if (drillPath.length > 0) setDrillPath((prev) => prev.slice(0, -1));
  };
  const goHome = () => setDrillPath([]);

  const breadcrumbs = ['All Categories', ...drillPath];

  // ---- custom label renderer: avoids overlapping with axis (dynamic offset) ----
  const renderBarLabel = ({ x, y, width, height, value }) => {
    const isNeg = Number(value) < 0;
    const cx = x + width / 2;

    const h = Math.max(0, Number(height) || 0);
    const base = 16; // px
    const extraForTiny = Math.max(0, 22 - Math.min(22, h));
    const away = base + extraForTiny;

    const barEndY = isNeg ? (y + h) : y;
    const ty = isNeg ? (barEndY + away) : (barEndY - away);

    return (
      <text
        x={cx}
        y={ty}
        textAnchor="middle"
        fontSize={12}
        fill={isNeg ? '#dc2626' : '#166534'}
      >
        {formatMetricValue(value)}
      </text>
    );
  };

  // ---- custom tooltip: show ALL measures for this bar ----
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0].payload;
    const metricsMap = row.__metrics || {};
    // Keep the tooltip order aligned with dropdown
    const order = availableMetrics;

    return (
      <div
        style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: '10px 12px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
          maxWidth: 260,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
        {order.map((m) => (
          <div key={m} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#6b7280' }}>{m}</span>
            <span style={{ color: '#111827' }}>
              {formatSpecific(m, metricsMap[m] ?? 0)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-4 flex items-center">
            <BarChart3 className="w-8 h-8 mr-3 text-blue-600" />
            SKU Drilldown Dashboard
          </h1>

          {/* File Upload */}
          {data.length === 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Upload Your Data</h2>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <label className="cursor-pointer">
                  <span className="text-lg font-medium text-blue-600 hover:text-blue-500">
                    Click to upload CSV/TSV file
                  </span>
                  <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
                </label>
                <p className="text-gray-500 mt-2">
                  File should contain: category, sub_category (or sub-category), item, sku_code, and your metrics
                </p>
              </div>
              {isLoading && <div className="text-center mt-4 text-blue-600">Loading data...</div>}
              {error && (
                <div className="text-center mt-4">
                  <div className="text-red-600 bg-red-50 p-3 rounded-md">{error}</div>
                </div>
              )}
            </div>
          )}

          {/* Controls */}
          {data.length > 0 && (
            <>
              <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <label className="text-sm font-medium text-gray-700">Measure:</label>
                    <select
                      value={selectedMetric}
                      onChange={(e) => setSelectedMetric(e.target.value)}
                      className="border border-gray-300 rounded-md px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {availableMetrics.map((metric) => (
                        <option key={metric} value={metric}>
                          {metric}
                        </option>
                      ))}
                    </select>
                    <div className="text-sm text-gray-500">{data.length} records loaded</div>
                  </div>
                  <button
                    onClick={() => {
                      setData([]);
                      setDrillPath([]);
                      setError('');
                    }}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Load different file
                  </button>
                </div>
              </div>

              {/* Nav bar */}
              <div className="flex items-center justify-between bg-white rounded-lg shadow-sm p-4">
                <div className="flex items-center space-x-2">
                  {breadcrumbs.map((crumb, index) => (
                    <div key={index} className="flex items-center">
                      <button
                        onClick={() => setDrillPath(drillPath.slice(0, index))}
                        className={`px-3 py-1 rounded transition-colors ${
                          index === breadcrumbs.length - 1
                            ? 'bg-blue-100 text-blue-800 font-medium'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {crumb}
                      </button>
                      {index < breadcrumbs.length - 1 && (
                        <ChevronRight className="w-4 h-4 text-gray-400 mx-1" />
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex space-x-2">
                  {drillPath.length > 0 && (
                    <button
                      onClick={goBack}
                      className="flex items-center px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4 mr-1" />
                      Back
                    </button>
                  )}
                  <button
                    onClick={goHome}
                    className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <Home className="w-4 h-4 mr-1" />
                    Home
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Main Content */}
        {data.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            {!isLeafLevel ? (
              <div>
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-gray-800">
                    {drillPath.length === 0 && `Category Distribution - ${selectedMetric}`}
                    {drillPath.length === 1 && `${drillPath[0]} - Sub Categories`}
                    {drillPath.length === 2 && `${drillPath[1]} - Items`}
                  </h2>
                  <p className="text-gray-600 text-sm mt-1">
                    Click on a bar to drill down, or click outside bars to go back
                  </p>
                </div>

                <div className="h-96 cursor-pointer" onClick={handleChartClick}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12 }}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                        interval={0}
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) =>
                          selectedMetric === 'Margin %'
                            ? (() => {
                                const n = Number(v);
                                return Number.isFinite(n) ? `${n.toFixed(1)}%` : '0.0%';
                              })()
                            : compactNumber(v)
                        }
                        padding={{ top: 20, bottom: 28 }}
                        domain={
                          selectedMetric === 'Margin %'
                            ? ['dataMin - 5', 'dataMax + 5']
                            : ['auto', 'auto']
                        }
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} cursor="pointer" onClick={handleBarClick}>
                        {chartData.map((entry, idx) => (
                          <Cell key={`c-${idx}`} fill={entry.fill} />
                        ))}
                        <LabelList dataKey="value" content={renderBarLabel} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-gray-800">SKU Details - {drillPath[2]}</h2>
                  <p className="text-gray-600 text-sm mt-1">Individual SKU information</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          SKU Code
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Description
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Category
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Sub Category
                        </th>
                        {availableMetrics.map((metric) => (
                          <th
                            key={metric}
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                          >
                            {metric}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {row.sku_code}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {row.sku_description || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.category}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {row.sub_category}
                          </td>
                          {availableMetrics.map((metric) => (
                            <td key={metric} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {metric === 'Margin %'
                                ? (() => {
                                    const m = getNum(row, ['Margin', 'margin']);
                                    const r = getNum(row, ['Revenue', 'revenue']);
                                    const pct = r > 0 ? (m / r) * 100 : 0;
                                    return `${pct.toFixed(1)}%`;
                                  })()
                                : compactNumber(row[metric])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SKUDashboard;
