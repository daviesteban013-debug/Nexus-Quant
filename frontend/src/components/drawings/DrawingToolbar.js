import React from 'react';
import { useDrawings } from './DrawingsContext';

const ToolButton = ({ active, label, onClick, title }) => {
  return (
    <button
      type="button"
      className={`h-9 px-3 rounded-xl border text-[11px] tracking-widest font-mono transition-all ${
        active
          ? 'border-[#00FFA3]/60 text-[#00FFA3] bg-[#00FFA3]/10 shadow-[0_0_20px_rgba(0,255,163,0.18)]'
          : 'border-neutral-800 text-neutral-300 bg-space-950/40 hover:text-neutral-100 hover:border-neutral-700'
      }`}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );
};

export default function DrawingToolbar({ className = '' }) {
  const { activeTool, setTool, deleteActive, clearAll } = useDrawings();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <ToolButton
        active={activeTool === 'trendline'}
        label="TREND"
        title="Trendline"
        onClick={() => setTool(activeTool === 'trendline' ? null : 'trendline')}
      />
      <ToolButton
        active={activeTool === 'hline'}
        label="HLINE"
        title="Horizontal Line"
        onClick={() => setTool(activeTool === 'hline' ? null : 'hline')}
      />
      <ToolButton
        active={activeTool === 'rect'}
        label="RECT"
        title="Rectangle"
        onClick={() => setTool(activeTool === 'rect' ? null : 'rect')}
      />
      <ToolButton label="DEL" title="Delete Active" onClick={deleteActive} />
      <ToolButton label="CLEAR" title="Clear All" onClick={clearAll} />
    </div>
  );
}

