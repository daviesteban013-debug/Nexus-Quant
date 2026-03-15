import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import '../App.css';
import VolumePane from './VolumePane';
import { DrawingsProvider } from './drawings/DrawingsContext';
import DrawingToolbar from './drawings/DrawingToolbar';
import DrawingOverlayCanvas from './drawings/DrawingOverlayCanvas';

export default function PriceAnalysisPane({ data, isForex, height }) {
  const priceHostRef = useRef(null);
  const priceChartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const fastSeriesRef = useRef(null);
  const slowSeriesRef = useRef(null);

  const [priceChart, setPriceChart] = useState(null);
  const [candleSeries, setCandleSeries] = useState(null);
  const [volumeChart, setVolumeChart] = useState(null);

  const { candleData, fastData, slowData, markers, fibLevels, volumeData, volumeExperimental } = useMemo(() => {
    if (!data?.candles || data.candles.length === 0) {
      return {
        candleData: [],
        fastData: [],
        slowData: [],
        markers: [],
        fibLevels: [],
        volumeData: [],
        volumeExperimental: Boolean(isForex || data?.volume_experimental),
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
      const isBuy = t.type === 'BUY' || t.type.includes('COVER');
      return {
        time: new Date(t.date).getTime() / 1000,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? '#10b981' : '#ef4444',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: isBuy ? 'B' : 'S',
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
      buy_volume: c.buy_volume ?? (c.c > c.o ? (c.v ?? 0) : 0),
      sell_volume: c.sell_volume ?? (c.c <= c.o ? (c.v ?? 0) : 0),
      total_volume: c.total_volume ?? c.v ?? 0,
    }));

    const totalSum = volData.reduce((acc, v) => acc + (v.total_volume || 0), 0);
    const experimental = Boolean(isForex || data?.volume_experimental || totalSum <= 0);

    return {
      candleData: cData,
      fastData: fData,
      slowData: sData,
      markers: tradeMarkers,
      fibLevels: fibs,
      volumeData: volData,
      volumeExperimental: experimental,
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

    priceChartRef.current = chart;
    candleSeriesRef.current = candles;
    fastSeriesRef.current = fast;
    slowSeriesRef.current = slow;

    setPriceChart(chart);
    setCandleSeries(candles);

    return () => {
      chart.remove();
      priceChartRef.current = null;
      candleSeriesRef.current = null;
      fastSeriesRef.current = null;
      slowSeriesRef.current = null;
      setPriceChart(null);
      setCandleSeries(null);
    };
  }, [isForex]);

  useEffect(() => {
    if (!priceChartRef.current || !candleSeriesRef.current || !fastSeriesRef.current || !slowSeriesRef.current) return;

    candleSeriesRef.current.setData(candleData);
    fastSeriesRef.current.setData(fastData);
    slowSeriesRef.current.setData(slowData);

    if (markers.length > 0) createSeriesMarkers(candleSeriesRef.current, markers);

    if (candleData.length > 0) {
      fibLevels.forEach(f => candleSeriesRef.current.createPriceLine(f));
      priceChartRef.current.timeScale().fitContent();
    }
  }, [candleData, fastData, slowData, markers, fibLevels]);

  useEffect(() => {
    if (!priceChart || !volumeChart) return;
    let syncing = false;

    const syncFromPrice = (range) => {
      if (syncing || !range) return;
      syncing = true;
      volumeChart.timeScale().setVisibleRange(range);
      syncing = false;
    };

    const syncFromVolume = (range) => {
      if (syncing || !range) return;
      syncing = true;
      priceChart.timeScale().setVisibleRange(range);
      syncing = false;
    };

    priceChart.timeScale().subscribeVisibleTimeRangeChange(syncFromPrice);
    volumeChart.timeScale().subscribeVisibleTimeRangeChange(syncFromVolume);
    const initial = priceChart.timeScale().getVisibleRange();
    if (initial) volumeChart.timeScale().setVisibleRange(initial);

    return () => {
      priceChart.timeScale().unsubscribeVisibleTimeRangeChange(syncFromPrice);
      volumeChart.timeScale().unsubscribeVisibleTimeRangeChange(syncFromVolume);
    };
  }, [priceChart, volumeChart]);

  return (
    <DrawingsProvider>
      <div className="price-volume-stack" style={{ height }}>
        <div className="price-pane">
          <div className="price-pane-inner" ref={priceHostRef} />
          {priceChart && candleSeries ? (
            <>
              <DrawingToolbar />
              <DrawingOverlayCanvas chart={priceChart} candleSeries={candleSeries} hostRef={priceHostRef} />
            </>
          ) : null}
        </div>
        <VolumePane volumeData={volumeData} isExperimental={volumeExperimental} onChartReady={setVolumeChart} />
      </div>
    </DrawingsProvider>
  );
}

