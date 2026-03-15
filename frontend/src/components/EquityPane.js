import React, { useEffect, useMemo, useRef } from 'react';
import { createChart, AreaSeries } from 'lightweight-charts';
import '../App.css';

export default function EquityPane({ data, height }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  const equityData = useMemo(() => {
    if (!data?.equity_curve) return [];
    return data.equity_curve.map(e => ({ time: new Date(e.date).getTime() / 1000, value: e.equity }));
  }, [data]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      layout: {
        background: { type: 'solid', color: '#131722' },
        textColor: '#a1a1aa',
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: '#2A2E39', style: 1 },
        horzLines: { color: '#2A2E39', style: 1 },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#FFD700', style: 3, labelBackgroundColor: '#18181b' },
        horzLine: { color: '#FFD700', style: 3, labelBackgroundColor: '#18181b' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderVisible: false,
      },
      rightPriceScale: {
        borderVisible: false,
        alignLabels: true,
      },
      autoSize: true,
    });

    const area = chart.addSeries(AreaSeries, {
      lineColor: '#2962FF',
      topColor: 'rgba(41, 98, 255, 0.4)',
      bottomColor: 'rgba(41, 98, 255, 0.0)',
      lineWidth: 2,
      crosshairMarkerVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = area;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    seriesRef.current.setData(equityData);
    if (equityData.length > 0) chartRef.current.timeScale().fitContent();
  }, [equityData]);

  return (
    <div className="chart-container-inner" ref={hostRef} style={{ width: '100%', height }} />
  );
}

