import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, CandlestickSeries, LineSeries, AreaSeries, createSeriesMarkers } from 'lightweight-charts';
import ReactApexChart from 'react-apexcharts';
import '../App.css';

const ChartTerminal = ({ data, isForex, isFullscreen, toggleFullscreen }) => {
    const chartContainerRef = useRef();
    const chartRef = useRef(null);

    const [activeTab, setActiveTab] = useState('price');

    const { accountState, heatmapData } = useMemo(() => {
        return {
            accountState: data?.account_state || {},
            heatmapData: data?.heatmap || []
        };
    }, [data]);

    // Parse and memoize chart data
    const { candleData, fastData, slowData, markers, fibLevels, equityData } = useMemo(() => {
        let curve = [];
        if (data?.equity_curve) {
            curve = data.equity_curve.map(e => ({ time: new Date(e.date).getTime() / 1000, value: e.equity }));
        }

        if (!data?.candles || data.candles.length === 0) {
            return { candleData: [], fastData: [], slowData: [], markers: [], fibLevels: [], equityData: curve };
        }

        // Candles and SMAs
        const cData = data.candles.map(c => ({ time: new Date(c.x).getTime() / 1000, open: c.o, high: c.h, low: c.l, close: c.c }));
        const fData = data.candles.filter(c => c.sma_fast != null).map(c => ({ time: new Date(c.x).getTime() / 1000, value: c.sma_fast }));
        const sData = data.candles.filter(c => c.sma_slow != null).map(c => ({ time: new Date(c.x).getTime() / 1000, value: c.sma_slow }));

        // Trade Markers
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

        // Dynamic Fibonacci Retracement Levels
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
                lineStyle: 2, // Dashed
                axisLabelVisible: true,
            }));
        }

        return { candleData: cData, fastData: fData, slowData: sData, markers: tradeMarkers, fibLevels: fibs, equityData: curve };
    }, [data]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Initialize chart
        const chart = createChart(chartContainerRef.current, {
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
            autoSize: true, // Handle resize automatically
        });
        chartRef.current = chart;

        if (activeTab === 'price') {
            // Main Candlestick Series
            const candleSeries = chart.addSeries(CandlestickSeries, {
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

            if (candleData.length > 0) {
                candleSeries.setData(candleData);
                if (markers.length > 0) {
                    createSeriesMarkers(candleSeries, markers);
                }
                fibLevels.forEach(fib => candleSeries.createPriceLine(fib));
            }

            // Fast SMA Series
            const fastSeries = chart.addSeries(LineSeries, {
                color: '#10b981',
                lineWidth: 1,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
            if (fastData.length > 0) fastSeries.setData(fastData);

            // Slow SMA Series
            const slowSeries = chart.addSeries(LineSeries, {
                color: '#FFD700',
                lineWidth: 2,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
            if (slowData.length > 0) slowSeries.setData(slowData);

            if (candleData.length > 0) chart.timeScale().fitContent();
        } else if (activeTab === 'equity') {
            const areaSeries = chart.addSeries(AreaSeries, {
                lineColor: '#2962FF',
                topColor: 'rgba(41, 98, 255, 0.4)',
                bottomColor: 'rgba(41, 98, 255, 0.0)',
                lineWidth: 2,
                crosshairMarkerVisible: true,
            });

            if (equityData.length > 0) {
                areaSeries.setData(equityData);
                chart.timeScale().fitContent();
            }
        }

        return () => chart.remove();
    }, [activeTab, candleData, fastData, slowData, markers, fibLevels, equityData, isForex]);

    // Risk Analytics Chart Configurations
    const heatmapOptions = {
        chart: { type: 'heatmap', background: '#131722', toolbar: { show: false }, fontFamily: 'JetBrains Mono, monospace' },
        plotOptions: {
            heatmap: {
                shadeIntensity: 0.5,
                colorScale: {
                    ranges: [
                        { from: -999999, to: -0.01, color: '#ef5350', name: 'Loss' },
                        { from: 0, to: 0.01, color: '#1E222D', name: 'Neutral' },
                        { from: 0.02, to: 999999, color: '#26a69a', name: 'Profit' }
                    ]
                }
            }
        },
        dataLabels: { enabled: false },
        theme: { mode: 'dark' },
        xaxis: { labels: { style: { colors: '#787B86' } }, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { style: { colors: '#787B86' } } },
        grid: { show: false },
        tooltip: { theme: 'dark' }
    };

    const totalTrades = accountState.total_trades || 0;
    const winRate = accountState.win_rate || 0;
    const lossRate = 100 - winRate;
    const donutOptions = {
        chart: { type: 'donut', background: '#131722', fontFamily: 'JetBrains Mono, monospace' },
        labels: ['Win', 'Loss'],
        colors: ['#26a69a', '#ef5350'],
        theme: { mode: 'dark' },
        plotOptions: {
            pie: {
                donut: {
                    size: '75%',
                    labels: {
                        show: true,
                        name: { show: true, color: '#787B86' },
                        value: { show: true, color: '#D1D4DC', formatter: (val) => `${val}%` },
                        total: { show: true, label: 'Trades', color: '#787B86', formatter: () => totalTrades }
                    }
                }
            }
        },
        stroke: { show: false },
        dataLabels: { enabled: false },
        legend: { show: false }
    };
    const donutSeries = [Math.round(winRate), Math.round(lossRate)];

    return (
        <div className={`chart-terminal-wrapper ${isFullscreen ? 'fullscreen' : ''}`}>
            <div className="chart-header">
                <div className="chart-tabs">
                    <button className={`chart-tab ${activeTab === 'price' ? 'active' : ''}`} onClick={() => setActiveTab('price')}>Price Analysis</button>
                    <button className={`chart-tab ${activeTab === 'equity' ? 'active' : ''}`} onClick={() => setActiveTab('equity')}>Equity Curve</button>
                    <button className={`chart-tab ${activeTab === 'risk' ? 'active' : ''}`} onClick={() => setActiveTab('risk')}>Risk Analytics</button>
                </div>
                <button className="btn-fullscreen" onClick={toggleFullscreen}>
                    {isFullscreen ? '⤓ Exit Full Screen' : '⤢ Full Screen'}
                </button>
            </div>

            {activeTab === 'risk' ? (
                <div className="risk-analytics-container">
                    <div className="risk-kpis">
                        <div className="kpi-card gold" style={{ flex: 1 }}>
                            <div className="kpi-label">Profit Factor</div>
                            <div className="kpi-value gold">{accountState.profit_factor || '—'}</div>
                            <div className="kpi-sub">Gross Profit / Gross Loss</div>
                        </div>
                        <div className="kpi-card red" style={{ flex: 1 }}>
                            <div className="kpi-label">Max Losing Streak</div>
                            <div className="kpi-value red">{accountState.max_losing_streak || 0}</div>
                            <div className="kpi-sub">Consecutive Losses</div>
                        </div>
                    </div>

                    <div className="risk-charts">
                        <div className="heatmap-section">
                            <h4 className="chart-sec-title">Performance Heatmap</h4>
                            <div className="apex-wrap">
                                {heatmapData.length > 0 ? (
                                    <ReactApexChart options={heatmapOptions} series={heatmapData} type="heatmap" height={220} />
                                ) : (
                                    <div className="empty-state"><p>No data</p></div>
                                )}
                            </div>
                        </div>
                        <div className="donut-section">
                            <h4 className="chart-sec-title">Win/Loss Dist.</h4>
                            <div className="apex-wrap">
                                {totalTrades > 0 ? (
                                    <ReactApexChart options={donutOptions} series={donutSeries} type="donut" height={220} />
                                ) : (
                                    <div className="empty-state"><p>No data</p></div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="chart-container-inner" ref={chartContainerRef} style={{ width: '100%', height: isFullscreen ? 'calc(100vh - 50px)' : '400px' }} />
            )}
        </div>
    );
};

export default ChartTerminal;
