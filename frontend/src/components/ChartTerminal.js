import React, { memo, useMemo } from 'react';
import FastChart from './FastChart';

function ChartTerminal({ data, isForex, isFullscreen, toggleFullscreen }) {
  const header = useMemo(() => {
    const symbol = String(data?.ticker || '').replace('=X', '');
    const tf = String(data?.interval || '');
    const cls = String(data?.asset_class || '').toUpperCase();
    return `${cls} ${symbol} ${tf}`.trim();
  }, [data?.asset_class, data?.interval, data?.ticker]);

  return (
    <div className="w-full h-full bg-black text-[#00FFA3] font-mono">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="text-[11px] tracking-widest">{header || 'NO DATA'}</div>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="px-2 py-1 border border-white/10 text-[11px] tracking-widest hover:border-white/20"
        >
          {isFullscreen ? 'EXIT' : 'FULL'}
        </button>
      </div>
      <div className="h-[520px]">
        <FastChart data={data} isForex={isForex} />
      </div>
    </div>
  );
}

export default memo(ChartTerminal);
