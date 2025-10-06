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
  Cell,
  Customized
} from 'recharts';
import { ChevronRight, Home, ArrowLeft, Upload, BarChart3 } from 'lucide-react';
import Papa from "papaparse";

const SKUDashboard = () => {
  const [data, setData] = useState([]);
  const [drillPath, setDrillPath] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState('Margin %'); // default measure
  const [selectedOpCo, setSelectedOpCo] = useState('All');
  const [availableOpCos, setAvailableOpCos] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

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
      if (!Number.isFinite(num)) return '';
      return `${num.toFixed(1)}%`;
    }
    if (!Number.isFinite(Number(val))) return '';
    return compactNumber(val);
  };

  const formatMetricValue = (val) =>
    selectedMetric === 'Margin %'
      ? (Number.isFinite(Number(val)) ? `${Number(val).toFixed(1)}%` : '')
      : (Number.isFinite(Number(val)) ? compactNumber(val) : '');

  // colors (restored)
  const marginColor = (v) => (v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#9ca3af');
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
                else if (nk === 'opco') out.opco = val;
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

          const uniqueOpCos = [...new Set(normalized.map(r => r.opco).filter(Boolean))].sort();

          setData(normalized);
          setAvailableMetrics(metrics.length ? metrics : ['Margin', 'Revenue', 'Cost', 'No of Transactions']);
          setAvailableOpCos(uniqueOpCos);
          if (metrics.includes('Margin %')) setSelectedMetric('Margin %');
          else if (metrics.includes('Margin')) setSelectedMetric('Margin');
          else if (metrics.length > 0) setSelectedMetric(metrics[0]);
          setSelectedOpCo('All');
          setDrillPath([]);
          setSortConfig({ key: null, direction: 'asc' });
        },
        error: (e) => { throw e; },
      });
    } catch (err) {
      setError(`Error loading file: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter by drill path + OpCo
  const filteredData = useMemo(() => {
    let filtered = [...data];
    if (selectedOpCo !== 'All') filtered = filtered.filter((i) => i.opco === selectedOpCo);
    if (drillPath.length > 0) filtered = filtered.filter((i) => i.category === drillPath[0]);
    if (drillPath.length > 1) filtered = filtered.filter((i) => i.sub_category === drillPath[1]);
    if (drillPath.length > 2) filtered = filtered.filter((i) => i.item === drillPath[2]);
    return filtered;
  }, [data, drillPath, selectedOpCo]);

  // Build chart data (grouped by OpCo when "All" is selected)
  const { chartData, isLeafLevel, seriesKeys, valueRange } = useMemo(() => {
    if (data.length === 0) return { chartData: [], isLeafLevel: false, seriesKeys: [], valueRange: [0, 1] };

    let groupCol;
    if (drillPath.length === 0) groupCol = 'category';
    else if (drillPath.length === 1) groupCol = 'sub_category';
    else if (drillPath.length === 2) groupCol = 'item';
    else return { chartData: [], isLeafLevel: true, seriesKeys: [], valueRange: [0, 1] };

    const groupedByDim = {};
    const useGroupedOpco = selectedOpCo === 'All' && availableOpCos.length > 0;

    filteredData.forEach((row) => {
      const dim = row[groupCol];
      if (!groupedByDim[dim]) groupedByDim[dim] = {};
      const opcoKey = useGroupedOpco ? (row.opco || 'Unknown') : '__single__';
      if (!groupedByDim[dim][opcoKey]) {
        groupedByDim[dim][opcoKey] = { sums: {}, marginSum: 0, revenueSum: 0 };
      }
      const bucket = groupedByDim[dim][opcoKey];

      availableMetrics
        .filter((m) => m !== 'Margin %')
        .forEach((m) => {
          const v = toNumber(row[m]);
          bucket.sums[m] = (bucket.sums[m] || 0) + (Number.isFinite(v) ? v : 0);
        });

      bucket.marginSum += getNum(row, ['Margin', 'margin']);
      bucket.revenueSum += getNum(row, ['Revenue', 'revenue']);
    });

    const rows = Object.entries(groupedByDim).map(([dim, opcoMap]) => {
      const obj = { name: dim, __byOpCo: {} };
      Object.entries(opcoMap).forEach(([opcoKey, agg]) => {
        const metricsMap = { ...agg.sums };
        metricsMap['Margin %'] = agg.revenueSum > 0 ? (agg.marginSum / agg.revenueSum) * 100 : NaN;
        const plotted = metricsMap[selectedMetric];

        if (useGroupedOpco) {
          obj[opcoKey] = plotted;
          obj.__byOpCo[opcoKey] = metricsMap;
        } else {
          obj.value = plotted;
          obj.__metrics = metricsMap;
        }
      });
      return obj;
    });

    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const keys = (selectedOpCo === 'All')
      ? (availableOpCos.length ? availableOpCos : [])
      : [];

    // for purple gradient span (non-% metrics)
    const allVals = [];
    if (keys.length) {
      rows.forEach(r => keys.forEach(k => {
        const val = Number(r[k]);
        if (Number.isFinite(val)) allVals.push(val);
      }));
    } else {
      rows.forEach(r => {
        const val = Number(r.value);
        if (Number.isFinite(val)) allVals.push(val);
      });
    }
    const min = allVals.length ? Math.min(...allVals) : 0;
    const max = allVals.length ? Math.max(...allVals) : 1;

    return { chartData: rows, isLeafLevel: false, seriesKeys: keys, valueRange: [min, max] };
  }, [filteredData, drillPath, selectedMetric, data, availableMetrics, selectedOpCo, availableOpCos]);

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

  // sorting for leaf table
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const sortedFilteredData = useMemo(() => {
    if (!sortConfig.key) return filteredData;

    const sorted = [...filteredData].sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === 'Margin %') {
        const aM = getNum(a, ['Margin', 'margin']);
        const aR = getNum(a, ['Revenue', 'revenue']);
        const bM = getNum(b, ['Margin', 'margin']);
        const bR = getNum(b, ['Revenue', 'revenue']);
        aVal = aR > 0 ? (aM / aR) * 100 : NaN;
        bVal = bR > 0 ? (bM / bR) * 100 : NaN;
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        aVal = Number(aVal);
        bVal = Number(bVal);
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }

      if (!Number.isFinite(aVal) && !Number.isFinite(bVal)) return 0;
      if (!Number.isFinite(aVal)) return sortConfig.direction === 'asc' ? -1 : 1;
      if (!Number.isFinite(bVal)) return sortConfig.direction === 'asc' ? 1 : -1;

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [filteredData, sortConfig]);

  const breadcrumbs = ['All Categories', ...drillPath];

  // label renderer (value; hide NaN)
  const renderBarLabel = ({ x, y, width, height, value }) => {
    if (!Number.isFinite(Number(value))) return null;
    const isNeg = Number(value) < 0;
    const cx = x + width / 2;

    const h = Math.max(0, Number(height) || 0);
    const base = 16;
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

  // small OpCo tag under each grouped bar
  const makeOpcoTag = (opco) => (props) => {
    const { x, y, width, height, value } = props;
    if (!Number.isFinite(Number(value))) return null;
    const cx = x + width / 2;
    const ty = y + height + 14;
    return (
      <text x={cx} y={ty} textAnchor="middle" fontSize={10} fill="#6b7280">
        {opco}
      </text>
    );
  };

  // --------- CATEGORY SEPARATORS (FIXED) ---------
  const CategorySeparators = ({ xAxisMap, offset }) => {
    // Guard against props not being ready on the initial render
    if (!xAxisMap || !offset) return null;

    const axes = Object.values(xAxisMap);
    const catAxis = axes.find(a => a?.props?.dataKey === 'name') || axes[0];
    
    // Ensure the axis and its ticks are available
    if (!catAxis || !catAxis.ticks || catAxis.ticks.length < 2) {
      return null;
    }

    const { ticks } = catAxis;
    const top = offset.top;
    const bottom = offset.top + offset.height;

    const lines = [];
    for (let i = 0; i < ticks.length - 1; i++) {
      // FIX: The property for the tick's x-position is `coordinate`, not `coord`.
      const curr = Number(ticks[i].coordinate);
      const next = Number(ticks[i + 1].coordinate);
      
      if (!Number.isFinite(curr) || !Number.isFinite(next)) continue;
      
      const sepX = (curr + next) / 2;
      lines.push(
        <line
          key={`sep-${i}`}
          x1={sepX}
          x2={sepX}
          y1={top}
          y2={bottom}
          stroke="#e5e7eb"
          strokeWidth="1"
          strokeDasharray="3 3"
          pointerEvents="none"
        />
      );
    }
    return <g>{lines}</g>;
  };

  // tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0].payload;

    if (row.__byOpCo) {
      return (
        <div style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: '10px 12px',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
          maxWidth: 280,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
          {availableOpCos.map((op) => {
            const metricsMap = row.__byOpCo[op] || {};
            return (
              <div key={op} style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{op}</div>
                {availableMetrics.map((m) => (
                  <div key={`${op}-${m}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ color: '#6b7280' }}>{m}</span>
                    <span style={{ color: '#111827' }}>
                      {formatSpecific(m, metricsMap[m])}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      );
    }

    const metricsMap = row.__metrics || {};
    const order = availableMetrics;

    return (
      <div style={{
        background: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '10px 12px',
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
        maxWidth: 260,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
        {order.map((m) => (
          <div key={m} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#6b7280' }}>{m}</span>
            <span style={{ color: '#111827' }}>
              {formatSpecific(m, metricsMap[m])}
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
                  File should contain: category, sub_category (or sub-category), item, sku_code, <b>opco</b>, and your metrics
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

                    {availableOpCos.length > 0 && (
                      <>
                        <label className="text-sm font-medium text-gray-700">OpCo:</label>
                        <select
                          value={selectedOpCo}
                          onChange={(e) => setSelectedOpCo(e.target.value)}
                          className="border border-gray-300 rounded-md px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="All">All</option>
                          {availableOpCos.map((opco) => (
                            <option key={opco} value={opco}>
                              {opco}
                            </option>
                          ))}
                        </select>
                      </>
                    )}

                    <div className="text-sm text-gray-500">{data.length} records loaded</div>
                  </div>
                  <button
                    onClick={() => {
                      setData([]);
                      setDrillPath([]);
                      setError('');
                      setSelectedOpCo('All');
                      setSortConfig({ key: null, direction: 'asc' });
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
                  {(['All Categories', ...drillPath]).map((crumb, index, arr) => (
                    <div key={index} className="flex items-center">
                      <button
                        onClick={() => setDrillPath(drillPath.slice(0, index))}
                        className={`px-3 py-1 rounded transition-colors ${
                          index === arr.length - 1
                            ? 'bg-blue-100 text-blue-800 font-medium'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {crumb}
                      </button>
                      {index < arr.length - 1 && (
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
                    <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 70 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12 }}
                        angle={-45}
                        textAnchor="end"
                        height={90}
                        interval={0}
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) =>
                          selectedMetric === 'Margin %'
                            ? (() => {
                                const n = Number(v);
                                return Number.isFinite(n) ? `${n.toFixed(1)}%` : '';
                              })()
                            : (Number.isFinite(Number(v)) ? compactNumber(v) : '')
                        }
                        padding={{ top: 20, bottom: 28 }}
                        domain={
                          selectedMetric === 'Margin %'
                            ? ['dataMin - 5', 'dataMax + 5']
                            : ['auto', 'auto']
                        }
                      />

                      <Tooltip content={<CustomTooltip />} />

                      {/* Bars */}
                      {selectedOpCo === 'All' && availableOpCos.length > 0 ? (
                        <>
                          {availableOpCos.map((opco) => (
                            <Bar
                              key={opco}
                              dataKey={opco}
                              name={opco}
                              radius={[4, 4, 0, 0]}
                              cursor="pointer"
                              onClick={(d) => handleBarClick(d)}
                            >
                              {chartData.map((row, i) => {
                                const val = Number(row[opco]);
                                let fill = '#9ca3af';
                                if (selectedMetric === 'Margin %') {
                                  fill = marginColor(val);
                                } else {
                                  const [min, max] = valueRange;
                                  const span = (max - min) || 1;
                                  const t = Number.isFinite(val) ? (val - min) / span : 0;
                                  fill = purpleShade(t);
                                }
                                return <Cell key={`${opco}-${i}`} fill={fill} />;
                              })}
                              <LabelList dataKey={opco} content={renderBarLabel} />
                              <LabelList dataKey={opco} content={makeOpcoTag(opco)} />
                            </Bar>
                          ))}
                        </>
                      ) : (
                        <Bar
                          dataKey="value"
                          radius={[4, 4, 0, 0]}
                          cursor="pointer"
                          onClick={handleBarClick}
                        >
                          {chartData.map((row, i) => {
                            const val = Number(row.value);
                            let fill = '#9ca3af';
                            if (selectedMetric === 'Margin %') {
                              fill = marginColor(val);
                            } else {
                              const [min, max] = valueRange;
                              const span = (max - min) || 1;
                              const t = Number.isFinite(val) ? (val - min) / span : 0;
                              fill = purpleShade(t);
                            }
                            return <Cell key={`single-${i}`} fill={fill} />;
                          })}
                          <LabelList dataKey="value" content={renderBarLabel} />
                        </Bar>
                      )}

                      {/* separators between category groups (grouped view only) */}
                      {selectedOpCo === 'All' && availableOpCos.length > 0 && (
                        <Customized component={<CategorySeparators />} />
                      )}
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
                        <th
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('sku_code')}
                        >
                          SKU Code {sortConfig.key === 'sku_code' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('sku_description')}
                        >
                          Description {sortConfig.key === 'sku_description' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('category')}
                        >
                          Category {sortConfig.key === 'category' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th
                          className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('sub_category')}
                        >
                          Sub Category {sortConfig.key === 'sub_category' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        {availableMetrics.map((metric) => (
                          <th
                            key={metric}
                            className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                            onClick={() => handleSort(metric)}
                          >
                            {metric} {sortConfig.key === metric && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {sortedFilteredData.map((row, idx) => (
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
                                    const pct = r > 0 ? (m / r) * 100 : NaN;
                                    return Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '';
                                  })()
                                : (Number.isFinite(Number(row[metric])) ? compactNumber(row[metric]) : '')}
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
