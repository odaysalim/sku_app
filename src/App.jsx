import React, { useState, useMemo, useCallback } from 'react';

import React, { useState, useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChevronRight, Home, ArrowLeft, Upload, BarChart3 } from 'lucide-react';

const SKUDashboard = () => {
  const [data, setData] = useState([]);
  const [drillPath, setDrillPath] = useState([]);
  const [selectedMetric, setSelectedMetric] = useState('Margin');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Available metrics (will be populated from CSV headers)
  const [availableMetrics, setAvailableMetrics] = useState(['Margin', 'Revenue', 'Cost', 'No of Transactions']);

  // Handle CSV file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        throw new Error('CSV file must have at least a header row and one data row');
      }

      // Parse CSV (simple implementation)
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });
        return row;
      });

      // Validate required columns
      const requiredColumns = ['category', 'sub-category', 'item', 'sku_code'];
      const missingColumns = requiredColumns.filter(col => 
        !headers.find(h => h.toLowerCase().includes(col.toLowerCase().replace('-', '_')))
      );

      if (missingColumns.length > 0) {
        throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
      }

      // Normalize column names and convert numeric values
      const normalizedData = rows.map(row => {
        const normalizedRow = {};
        
        // Map columns to standard names
        Object.keys(row).forEach(key => {
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('category') && !lowerKey.includes('sub')) {
            normalizedRow.category = row[key];
          } else if (lowerKey.includes('sub') && lowerKey.includes('category')) {
            normalizedRow.sub_category = row[key];
          } else if (lowerKey.includes('item')) {
            normalizedRow.item = row[key];
          } else if (lowerKey.includes('sku') && lowerKey.includes('code')) {
            normalizedRow.sku_code = row[key];
          } else if (lowerKey.includes('sku') && lowerKey.includes('description')) {
            normalizedRow.sku_description = row[key];
          } else {
            // For numeric columns, try to convert to numbers
            const value = row[key];
            if (value && !isNaN(parseFloat(value.replace(/,/g, '')))) {
              normalizedRow[key] = parseFloat(value.replace(/,/g, ''));
            } else {
              normalizedRow[key] = value;
            }
          }
        });

        return normalizedRow;
      }).filter(row => row.category && row.sub_category && row.item); // Filter out incomplete rows

      // Find available numeric metrics
      const numericColumns = headers.filter(header => {
        const sampleValue = normalizedData[0] && normalizedData[0][header];
        return typeof sampleValue === 'number';
      });

      setData(normalizedData);
      setAvailableMetrics(numericColumns);
      
      // Set default metric to Margin if available, otherwise first numeric column
      if (numericColumns.includes('Margin')) {
        setSelectedMetric('Margin');
      } else if (numericColumns.length > 0) {
        setSelectedMetric(numericColumns[0]);
      }

      setDrillPath([]); // Reset drill path when new data is loaded
      
    } catch (err) {
      setError(`Error loading CSV: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Color scheme for different levels
  const getBarColor = useCallback((name, level) => {
    const colors = {
      0: ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1'],
      1: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'],
      2: ['#4f46e5', '#059669', '#d97706', '#dc2626', '#0891b2']
    };
    
    const colorSet = colors[level] || colors[0];
    const hash = name.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    return colorSet[Math.abs(hash) % colorSet.length];
  }, []);

  // Filter data based on current drill path
  const filteredData = useMemo(() => {
    let filtered = [...data];
    
    if (drillPath.length > 0) {
      filtered = filtered.filter(item => item.category === drillPath[0]);
    }
    if (drillPath.length > 1) {
      filtered = filtered.filter(item => item.sub_category === drillPath[1]);
    }
    if (drillPath.length > 2) {
      filtered = filtered.filter(item => item.item === drillPath[2]);
    }
    
    return filtered;
  }, [data, drillPath]);

  // Determine current grouping column and chart data
  const { groupColumn, chartData, isLeafLevel } = useMemo(() => {
    if (data.length === 0) {
      return { groupColumn: null, chartData: [], isLeafLevel: false };
    }

    let groupCol;
    let isLeaf = false;
    
    if (drillPath.length === 0) {
      groupCol = 'category';
    } else if (drillPath.length === 1) {
      groupCol = 'sub_category';
    } else if (drillPath.length === 2) {
      groupCol = 'item';
    } else {
      groupCol = null;
      isLeaf = true;
    }

    if (groupCol) {
      // Group by the current column and sum the selected metric
      const grouped = filteredData.reduce((acc, item) => {
        const key = item[groupCol];
        if (!acc[key]) {
          acc[key] = 0;
        }
        const value = item[selectedMetric];
        acc[key] += (typeof value === 'number' ? value : 0);
        return acc;
      }, {});

      const chartData = Object.entries(grouped).map(([name, value]) => ({
        name,
        value,
        fill: getBarColor(name, drillPath.length)
      }));

      return { groupColumn: groupCol, chartData, isLeafLevel: false };
    }
    
    return { groupColumn: null, chartData: [], isLeafLevel: true };
  }, [filteredData, drillPath, selectedMetric, getBarColor, data]);

  // Handle bar click for drilling down
  const handleBarClick = (data) => {
    if (data && data.name) {
      setDrillPath(prev => [...prev, data.name]);
    }
  };

  // Handle chart background click for drilling up
  const handleChartClick = (e) => {
    if (e.target.tagName === 'svg' || e.target.classList.contains('recharts-wrapper')) {
      if (drillPath.length > 0) {
        setDrillPath(prev => prev.slice(0, -1));
      }
    }
  };

  // Navigation handlers
  const goBack = () => {
    if (drillPath.length > 0) {
      setDrillPath(prev => prev.slice(0, -1));
    }
  };

  const goHome = () => {
    setDrillPath([]);
  };

  // Format number for display
  const formatNumber = (num) => {
    if (typeof num !== 'number') return num;
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  // Breadcrumb navigation
  const breadcrumbs = ['All Categories', ...drillPath];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-4 flex items-center">
            <BarChart3 className="w-8 h-8 mr-3 text-blue-600" />
            SKU Drilldown Dashboard
          </h1>
          
          {/* File Upload Section */}
          {data.length === 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Upload Your Data</h2>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <label className="cursor-pointer">
                  <span className="text-lg font-medium text-blue-600 hover:text-blue-500">
                    Click to upload CSV file
                  </span>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                <p className="text-gray-500 mt-2">
                  CSV should contain: category, sub-category, item, sku_code, and your metrics
                </p>
              </div>
              {isLoading && (
                <div className="text-center mt-4">
                  <div className="text-blue-600">Loading data...</div>
                </div>
              )}
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
              {/* Metric Selector */}
              <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <label className="text-sm font-medium text-gray-700">Measure:</label>
                    <select
                      value={selectedMetric}
                      onChange={(e) => setSelectedMetric(e.target.value)}
                      className="border border-gray-300 rounded-md px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {availableMetrics.map(metric => (
                        <option key={metric} value={metric}>{metric}</option>
                      ))}
                    </select>
                    <div className="text-sm text-gray-500">
                      {data.length} records loaded
                    </div>
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

              {/* Navigation Bar */}
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
                
                <div 
                  className="h-96 cursor-pointer"
                  onClick={handleChartClick}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis 
                        dataKey="name" 
                        tick={{ fontSize: 12 }}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                        interval={0}
                      />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip 
                        formatter={(value) => [formatNumber(value), selectedMetric]}
                        labelStyle={{ color: '#374151' }}
                        contentStyle={{ 
                          backgroundColor: 'white', 
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                        }}
                      />
                      <Bar 
                        dataKey="value" 
                        fill="#8884d8"
                        radius={[4, 4, 0, 0]}
                        cursor="pointer"
                        onClick={handleBarClick}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-gray-800">
                    SKU Details - {drillPath[2]}
                  </h2>
                  <p className="text-gray-600 text-sm mt-1">
                    Individual SKU information
                  </p>
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
                        {availableMetrics.map(metric => (
                          <th key={metric} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            {metric}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredData.map((row, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {row.sku_code}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {row.sku_description || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {row.category}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {row.sub_category}
                          </td>
                          {availableMetrics.map(metric => (
                            <td key={metric} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {formatNumber(row[metric])}
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
