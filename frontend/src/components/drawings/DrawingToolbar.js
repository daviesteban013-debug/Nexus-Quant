import React from 'react';
import { useDrawings } from './DrawingsContext';

const ToolButton = ({ active, label, onClick, title }) => {
  return (
    <button
      type="button"
      className={`drawtool-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );
};

export default function DrawingToolbar() {
  const { activeTool, setTool, deleteActive, clearAll } = useDrawings();

  return (
    <div className="drawtool-palette">
      <div className="drawtool-row">
        <ToolButton
          active={activeTool === 'trendline'}
          label="／"
          title="Trendline"
          onClick={() => setTool(activeTool === 'trendline' ? null : 'trendline')}
        />
        <ToolButton
          active={activeTool === 'hline'}
          label="―"
          title="Horizontal Line"
          onClick={() => setTool(activeTool === 'hline' ? null : 'hline')}
        />
        <ToolButton
          active={activeTool === 'rect'}
          label="▭"
          title="Rectangle"
          onClick={() => setTool(activeTool === 'rect' ? null : 'rect')}
        />
      </div>
      <div className="drawtool-row">
        <ToolButton label="⌫" title="Delete Active" onClick={deleteActive} />
        <ToolButton label="⟲" title="Clear All" onClick={clearAll} />
      </div>
    </div>
  );
}

