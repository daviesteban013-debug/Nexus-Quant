import React, { useEffect, useMemo, useRef } from 'react';
import { createChart, HistogramSeries } from 'lightweight-charts';
import '../App.css';

export default function VolumePane({ volumeData, isExperimental, onChartReady, height = 130 }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const buyRef = useRef(null);
  const sellRef = useRef(null);

  const { buySeriesData, sellSeriesData } = useMemo(() => {
    const buy = (volumeData || []).map(v => ({ time: v.time, value: v.buy_volume || 0 }));
    const sell = (volumeData || []).map(v => ({ time: v.time, value: -Math.abs(v.sell_volume || 0) }));
    return { buySeriesData: buy, sellSeriesData: sell };
  }, [volumeData]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      layout: {
        background: { type: 'solid', color: '#0f111a' },
        textColor: '#787B86',
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.35)', style: 1 },
        horzLines: { color: 'rgba(42, 46, 57, 0.35)', style: 1 },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderVisible: false,
      },
      rightPriceScale: {
        visible: false,
        borderVisible: false,
      },
      leftPriceScale: {
        visible: false,
        borderVisible: false,
      },
      autoSize: true,
    });

    const buySeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      color: 'rgba(16, 185, 129, 0.85)',
      base: 0,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const sellSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      color: 'rgba(239, 68, 68, 0.85)',
      base: 0,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    buyRef.current = buySeries;
    sellRef.current = sellSeries;

    if (onChartReady) onChartReady(chart);

    return () => {
      chart.remove();
      chartRef.current = null;
      buyRef.current = null;
      sellRef.current = null;
    };
  }, [onChartReady]);

  useEffect(() => {
    if (!buyRef.current || !sellRef.current) return;
    buyRef.current.setData(buySeriesData);
    sellRef.current.setData(sellSeriesData);
  }, [buySeriesData, sellSeriesData]);

  return (
    <div className="volume-pane" style={{ height }}>
      <div className="volume-pane-inner" ref={hostRef} />
      <div className={`volume-pane-badge ${isExperimental ? 'experimental' : ''}`}>
        {isExperimental ? 'EXPERIMENTAL VOLUME (FX/0V)' : 'BUY/SELL VOLUME'}
      </div>
    </div>
  );
}

