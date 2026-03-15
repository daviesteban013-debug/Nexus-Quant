import React, { useEffect, useMemo, useRef, useState, memo } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import '../App.css';
import DrawingOverlayCanvas from './drawings/DrawingOverlayCanvas';

function PriceAnalysisPane({ data, isForex, height, showFibs }) {
  const priceHostRef = useRef(null);
  const priceChartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const fastSeriesRef = useRef(null);
  const slowSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const fibLinesRef = useRef([]);
  const fitKeyRef = useRef('');
  const didFitRef = useRef(false);

  const [ready, setReady] = useState(false);

  const { candleData, fastData, slowData, markers, fibLevels, volumeHistData } = useMemo(() => {
    if (!data?.candles || data.candles.length === 0) {
      return {
        candleData: [],
        fastData: [],
        slowData: [],
        markers: [],
        fibLevels: [],
        volumeHistData: [],
      };
    }

    const cData = data.candles.map(c => ({
      time: new Date(c.x).getTime() / 1000,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));

    const fData = data.candles.filter(c => c.sma_fast != null).map(c => ({ time: new Date(c.x).getTime() / 1000, value: c.sma_fast }));
    const sData = data.candles.filter(c => c.sma_slow != null).map(c => ({ time: new Date(c.x).getTime() / 1000, value: c.sma_slow }));

    const tradeMarkers = (data.trades || []).map(t => {
      const isBuy = t.type.includes('BUY') || t.type.includes('COVER');
      const side = isBuy ? 'BUY' : 'SELL';
      const px = Number(t.price);
      const pxLabel = Number.isFinite(px) ? `${isForex ? '' : '$'}${px.toFixed(isForex ? 5 : 2)}` : '';
      const pnl = typeof t.pnl === 'number' ? ` P/L ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` : '';
      return {
        time: new Date(t.date).getTime() / 1000,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#00FFA3' : '#FF3B30',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: `${side} ${pxLabel}${pnl}`.trim(),
      };
    });

    let maxHigh = -Infinity;
    let minLow = Infinity;
    cData.forEach(c => {
      if (c.high > maxHigh) maxHigh = c.high;
      if (c.low < minLow) minLow = c.low;
    });

    let fibs = [];
    if (maxHigh > -Infinity && minLow < Infinity && maxHigh > minLow) {
      const diff = maxHigh - minLow;
      const ratios = [0, 0.236, 0.382, 0.5, 0.618, 1];
      fibs = ratios.map(r => ({
        price: maxHigh - (diff * r),
        title: `Fib ${r.toFixed(3)}`,
        color: 'rgba(255, 215, 0, 0.3)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
      }));
    }

    const volData = data.candles.map(c => ({
      time: new Date(c.x).getTime() / 1000,
      value: c.total_volume ?? c.v ?? 0,
      color: (c.c > c.o) ? 'rgba(0, 255, 163, 0.20)' : 'rgba(255, 59, 48, 0.20)',
    }));

    return {
      candleData: cData,
      fastData: fData,
      slowData: sData,
      markers: tradeMarkers,
      fibLevels: fibs,
      volumeHistData: volData,
    };
  }, [data, isForex]);

  useEffect(() => {
    const host = priceHostRef.current;
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

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceFormat: {
        type: 'price',
        precision: isForex ? 5 : 2,
        minMove: isForex ? 0.00001 : 0.01,
      },
    });

    const fast = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const slow = chart.addSeries(LineSeries, {
      color: '#FFD700',
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });

    priceChartRef.current = chart;
    candleSeriesRef.current = candles;
    fastSeriesRef.current = fast;
    slowSeriesRef.current = slow;
    volumeSeriesRef.current = volume;

    setReady(true);

    return () => {
      chart.remove();
      priceChartRef.current = null;
      candleSeriesRef.current = null;
      fastSeriesRef.current = null;
      slowSeriesRef.current = null;
      volumeSeriesRef.current = null;
      fibLinesRef.current = [];
      didFitRef.current = false;
      fitKeyRef.current = '';
      setReady(false);
    };
  }, [isForex]);

  useEffect(() => {
    if (!priceChartRef.current || !candleSeriesRef.current || !fastSeriesRef.current || !slowSeriesRef.current || !volumeSeriesRef.current) return;

    candleSeriesRef.current.setData(candleData);
    fastSeriesRef.current.setData(fastData);
    slowSeriesRef.current.setData(slowData);
    volumeSeriesRef.current.setData(volumeHistData);

    candleSeriesRef.current.setMarkers(markers);

    const nextFitKey = `${data?.ticker || ''}:${data?.interval || ''}:${isForex ? 'fx' : 'eq'}`;
    if (fitKeyRef.current !== nextFitKey) {
      fitKeyRef.current = nextFitKey;
      didFitRef.current = false;
    }

    if (!didFitRef.current && candleData.length > 0) {
      priceChartRef.current.timeScale().fitContent();
      didFitRef.current = true;
    }

    fibLinesRef.current.forEach(line => {
      try {
        candleSeriesRef.current.removePriceLine(line);
      } catch {
        return;
      }
    });
    fibLinesRef.current = [];

    if (showFibs && candleData.length > 0) {
      fibLinesRef.current = fibLevels.map(f => candleSeriesRef.current.createPriceLine(f));
    }
  }, [candleData, fastData, slowData, markers, fibLevels, volumeHistData, data?.ticker, data?.interval, isForex, showFibs]);

  return (
    <div className="price-volume-stack" style={{ height }}>
      <div className="price-pane">
        <div className="price-pane-inner" ref={priceHostRef} />
        {ready && priceChartRef.current && candleSeriesRef.current ? (
          <DrawingOverlayCanvas chart={priceChartRef.current} candleSeries={candleSeriesRef.current} hostRef={priceHostRef} />
        ) : null}
      </div>
    </div>
  );
}

export default memo(PriceAnalysisPane);

