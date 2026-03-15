import React, { useState, useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import '../App.css';
import AdvancedProChart from './AdvancedProChart';
import EquityPane from './EquityPane';

const ChartTerminal = ({ data, isForex, isFullscreen, toggleFullscreen }) => {
    const [activeTab, setActiveTab] = useState('price');

    const { accountState, heatmapData } = useMemo(() => {
        return {
            accountState: data?.account_state || {},
            heatmapData: data?.heatmap || []
        };
    }, [data]);

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
                <>
                    {activeTab === 'price' ? (
                        <AdvancedProChart data={data} isForex={isForex} isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />
                    ) : (
                        <EquityPane data={data} height={isFullscreen ? 'calc(100vh - 50px)' : '400px'} />
                    )}
                </>
            )}
        </div>
    );
};

export default ChartTerminal;
