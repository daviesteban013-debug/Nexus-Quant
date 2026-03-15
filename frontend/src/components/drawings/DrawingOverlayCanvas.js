import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDrawings } from './DrawingsContext';

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function distPointToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - x1, py - y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - x2, py - y2);
  const t = c1 / c2;
  const projX = x1 + t * vx;
  const projY = y1 + t * vy;
  return Math.hypot(px - projX, py - projY);
}

function rectFromPoints(a, b) {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

export default function DrawingOverlayCanvas({ chart, candleSeries, hostRef }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });

  const draftRef = useRef(null);
  const dragRef = useRef(null);

  const { activeTool, drawings, activeDrawingId, setActive, addDrawing, updateDrawing, setTool } = useDrawings();
  const drawingsRef = useRef(drawings);
  const activeToolRef = useRef(activeTool);
  const activeIdRef = useRef(activeDrawingId);
  const apiRef = useRef({
    setActive,
    addDrawing,
    updateDrawing,
    setTool,
  });

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    activeIdRef.current = activeDrawingId;
  }, [activeDrawingId]);

  useEffect(() => {
    apiRef.current = { setActive, addDrawing, updateDrawing, setTool };
  }, [setActive, addDrawing, updateDrawing, setTool]);

  const style = useMemo(() => {
    return {
      stroke: 'rgba(255, 215, 0, 0.92)',
      fill: 'rgba(255, 215, 0, 0.10)',
      handleFill: 'rgba(255, 215, 0, 0.95)',
      selectedStroke: 'rgba(255, 215, 0, 1)',
      inactiveStroke: 'rgba(255, 215, 0, 0.75)',
    };
  }, []);

  const getLocalXY = useCallback((evt) => {
    const host = hostRef.current;
    if (!host) return null;
    const r = host.getBoundingClientRect();
    const x = evt.clientX - r.left;
    const y = evt.clientY - r.top;
    return { x, y };
  }, [hostRef]);

  const xyToTimePrice = useCallback((xy) => {
    if (!chart || !candleSeries) return null;
    const t = chart.timeScale().coordinateToTime(xy.x);
    if (t == null || typeof t !== 'number') return null;
    const p = candleSeries.coordinateToPrice(xy.y);
    if (p == null) return null;
    return { time: t, price: p };
  }, [chart, candleSeries]);

  const timePriceToXY = useCallback((tp) => {
    if (!chart || !candleSeries) return null;
    const x = chart.timeScale().timeToCoordinate(tp.time);
    const y = candleSeries.priceToCoordinate(tp.price);
    if (x == null || y == null) return null;
    return { x, y };
  }, [chart, candleSeries]);

  const drawLine = useCallback((ctx, a, b, selected) => {
    ctx.beginPath();
    ctx.strokeStyle = selected ? style.selectedStroke : style.inactiveStroke;
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }, [style.inactiveStroke, style.selectedStroke]);

  const drawHandles = useCallback((ctx, pts) => {
    ctx.fillStyle = style.handleFill;
    pts.forEach(p => {
      ctx.beginPath();
      ctx.rect(p.x - 3, p.y - 3, 6, 6);
      ctx.fill();
    });
  }, [style.handleFill]);

  const drawRect = useCallback((ctx, a, b, selected) => {
    const r = rectFromPoints(a, b);
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = selected ? style.selectedStroke : style.inactiveStroke;
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.beginPath();
    ctx.rect(r.x1, r.y1, r.w, r.h);
    ctx.fill();
    ctx.stroke();
  }, [style.fill, style.inactiveStroke, style.selectedStroke]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h } = sizeRef.current;
    ctx.clearRect(0, 0, w, h);

    const list = drawingsRef.current || [];
    const drag = dragRef.current;

    list.forEach(d0 => {
      const d = (drag && drag.id === d0.id && drag.preview) ? drag.preview : d0;
      const selected = d.id === activeIdRef.current;
      if (d.type === 'hline') {
        const p = timePriceToXY(d.points[0]);
        if (!p) return;
        const a = { x: 0, y: p.y };
        const b = { x: w, y: p.y };
        drawLine(ctx, a, b, selected);
        if (selected) drawHandles(ctx, [{ x: clamp(p.x, 8, w - 8), y: p.y }]);
        return;
      }

      const a = timePriceToXY(d.points[0]);
      const b = timePriceToXY(d.points[1]);
      if (!a || !b) return;

      if (d.type === 'trendline') {
        drawLine(ctx, a, b, selected);
        if (selected) drawHandles(ctx, [a, b]);
        return;
      }

      if (d.type === 'rect') {
        drawRect(ctx, a, b, selected);
        if (selected) {
          const r = rectFromPoints(a, b);
          drawHandles(ctx, [
            { x: r.x1, y: r.y1 },
            { x: r.x2, y: r.y1 },
            { x: r.x2, y: r.y2 },
            { x: r.x1, y: r.y2 },
          ]);
        }
      }
    });

    if (draftRef.current) {
      const d = draftRef.current;
      if (d.type === 'hline') {
        const p = timePriceToXY(d.points[0]);
        if (!p) return;
        drawLine(ctx, { x: 0, y: p.y }, { x: w, y: p.y }, true);
        return;
      }
      const a = timePriceToXY(d.points[0]);
      const b = timePriceToXY(d.points[1]);
      if (!a || !b) return;
      if (d.type === 'trendline') drawLine(ctx, a, b, true);
      if (d.type === 'rect') drawRect(ctx, a, b, true);
    }
  }, [drawHandles, drawLine, drawRect, timePriceToXY]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  const hitTest = useCallback((xy) => {
    const threshold = 7;
    const w = sizeRef.current.w;

    const list = drawingsRef.current || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (d.type === 'hline') {
        const p = timePriceToXY(d.points[0]);
        if (!p) continue;
        const yDist = Math.abs(xy.y - p.y);
        if (yDist <= threshold) {
          const handle = { x: clamp(p.x, 8, w - 8), y: p.y };
          const onHandle = Math.hypot(xy.x - handle.x, xy.y - handle.y) <= threshold;
          return { id: d.id, mode: onHandle ? 'handle' : 'move', handleIndex: 0 };
        }
        continue;
      }

      const a = timePriceToXY(d.points[0]);
      const b = timePriceToXY(d.points[1]);
      if (!a || !b) continue;

      if (d.type === 'trendline') {
        const onA = Math.hypot(xy.x - a.x, xy.y - a.y) <= threshold;
        const onB = Math.hypot(xy.x - b.x, xy.y - b.y) <= threshold;
        if (onA) return { id: d.id, mode: 'handle', handleIndex: 0 };
        if (onB) return { id: d.id, mode: 'handle', handleIndex: 1 };
        const dist = distPointToSegment(xy.x, xy.y, a.x, a.y, b.x, b.y);
        if (dist <= threshold) return { id: d.id, mode: 'move', handleIndex: -1 };
        continue;
      }

      if (d.type === 'rect') {
        const r = rectFromPoints(a, b);
        const corners = [
          { x: r.x1, y: r.y1 },
          { x: r.x2, y: r.y1 },
          { x: r.x2, y: r.y2 },
          { x: r.x1, y: r.y2 },
        ];
        for (let c = 0; c < corners.length; c++) {
          if (Math.hypot(xy.x - corners[c].x, xy.y - corners[c].y) <= threshold) {
            return { id: d.id, mode: 'corner', handleIndex: c };
          }
        }
        const inside = xy.x >= r.x1 && xy.x <= r.x2 && xy.y >= r.y1 && xy.y <= r.y2;
        if (inside) return { id: d.id, mode: 'move', handleIndex: -1 };
      }
    }
    return null;
  }, [timePriceToXY]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const ro = new ResizeObserver(entries => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = Math.max(1, Math.floor(cr.width));
      const h = Math.max(1, Math.floor(cr.height));
      sizeRef.current = { w, h };
      canvas.width = w;
      canvas.height = h;
      scheduleDraw();
    });
    ro.observe(host);

    return () => ro.disconnect();
  }, [hostRef, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
  }, [drawings, activeDrawingId, activeTool, scheduleDraw]);

  useEffect(() => {
    if (!chart) return;
    const onRange = () => scheduleDraw();
    chart.timeScale().subscribeVisibleTimeRangeChange(onRange);
    return () => chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
  }, [chart, scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chart || !candleSeries) return;

    const getPoint = (evt) => {
      const xy = getLocalXY(evt);
      if (!xy) return null;
      const tp = xyToTimePrice(xy);
      if (!tp) return null;
      return { xy, tp };
    };

    const onPointerDown = (evt) => {
      // Event flow:
      // - If a drawing tool is armed, pointerdown starts a draft (or places a horizontal line immediately).
      // - Otherwise, pointerdown performs hit-testing for selection and begins a drag session (move/handle/corner).
      const p = getPoint(evt);
      if (!p) return;

      const tool = activeToolRef.current;
      if (tool) {
        canvas.setPointerCapture(evt.pointerId);
        const api = apiRef.current;
        if (tool === 'hline') {
          api.addDrawing({ type: 'hline', points: [p.tp], color: style.selectedStroke });
          api.setTool(null);
          draftRef.current = null;
          scheduleDraw();
          return;
        }

        draftRef.current = { type: tool, points: [p.tp, p.tp], color: style.selectedStroke };
        scheduleDraw();
        return;
      }

      const hit = hitTest(p.xy);
      if (!hit) {
        apiRef.current.setActive(null);
        scheduleDraw();
        return;
      }

      canvas.setPointerCapture(evt.pointerId);
      apiRef.current.setActive(hit.id);
      const list = drawingsRef.current || [];
      const base = list.find(x => x.id === hit.id);
      dragRef.current = {
        id: hit.id,
        mode: hit.mode,
        handleIndex: hit.handleIndex,
        start: p.tp,
        startXY: p.xy,
        base,
        preview: base ? { ...base, points: base.points.map(pt => ({ ...pt })) } : null,
      };
      scheduleDraw();
    };

    const onPointerMove = (evt) => {
      // Event flow:
      // - If a draft exists, pointermove updates the ghost endpoint and triggers a redraw.
      // - If dragging an existing drawing, pointermove applies deltas to move or edit vertices and updates state.
      const p = getPoint(evt);
      if (!p) return;

      if (draftRef.current) {
        draftRef.current = { ...draftRef.current, points: [draftRef.current.points[0], p.tp] };
        scheduleDraw();
        return;
      }

      if (!dragRef.current) return;

      const drag = dragRef.current;
      const d = drag.preview;
      if (!d) return;

      if (drag.mode === 'move') {
        const dt = p.tp.time - drag.start.time;
        const dp = p.tp.price - drag.start.price;
        if (d.type === 'hline') {
          drag.preview = { ...d, points: [{ time: d.points[0].time, price: d.points[0].price + dp }] };
          drag.start = p.tp;
          scheduleDraw();
          return;
        }
        const nextPts = d.points.map(pt => ({ time: pt.time + dt, price: pt.price + dp }));
        drag.preview = { ...d, points: nextPts };
        drag.start = p.tp;
        scheduleDraw();
        return;
      }

      if (drag.mode === 'handle') {
        if (d.type === 'trendline') {
          const nextPts = [...d.points];
          nextPts[drag.handleIndex] = p.tp;
          drag.preview = { ...d, points: nextPts };
          scheduleDraw();
        }
        if (d.type === 'hline') {
          drag.preview = { ...d, points: [{ time: d.points[0].time, price: p.tp.price }] };
          scheduleDraw();
        }
        return;
      }

      if (drag.mode === 'corner' && d.type === 'rect') {
        const a = d.points[0];
        const b = d.points[1];
        const nextA = { ...a };
        const nextB = { ...b };
        const idx = drag.handleIndex;
        if (idx === 0) {
          nextA.time = p.tp.time;
          nextA.price = p.tp.price;
        } else if (idx === 1) {
          nextB.time = p.tp.time;
          nextA.price = p.tp.price;
        } else if (idx === 2) {
          nextB.time = p.tp.time;
          nextB.price = p.tp.price;
        } else if (idx === 3) {
          nextA.time = p.tp.time;
          nextB.price = p.tp.price;
        }
        drag.preview = { ...d, points: [nextA, nextB] };
        scheduleDraw();
      }
    };

    const onPointerUp = (evt) => {
      // Event flow:
      // - If drafting, pointerup finalizes the drawing into the shared drawings array.
      // - If dragging, pointerup ends the drag session and leaves the drawing selected.
      const p = getPoint(evt);
      if (!p) {
        dragRef.current = null;
        draftRef.current = null;
        return;
      }

      if (draftRef.current) {
        const d = draftRef.current;
        const a = d.points[0];
        const b = d.points[1];
        const same = a.time === b.time && a.price === b.price;
        if (!same) apiRef.current.addDrawing({ type: d.type, points: [a, b], color: style.selectedStroke });
        draftRef.current = null;
        apiRef.current.setTool(null);
        scheduleDraw();
      }

      if (dragRef.current && dragRef.current.preview) {
        apiRef.current.updateDrawing(dragRef.current.id, { points: dragRef.current.preview.points });
      }

      dragRef.current = null;
      scheduleDraw();
    };

    const onKeyDown = (evt) => {
      if (evt.key === 'Escape') {
        draftRef.current = null;
        dragRef.current = null;
        apiRef.current.setTool(null);
        scheduleDraw();
      }
    };

    const onWheel = () => {
      scheduleDraw();
    };

    const onCrosshair = () => {
      scheduleDraw();
    };

    window.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      chart.unsubscribeCrosshairMove(onCrosshair);
    };
  }, [chart, candleSeries, getLocalXY, hitTest, scheduleDraw, style.selectedStroke, xyToTimePrice]);

  return (
    <canvas
      ref={canvasRef}
      className="drawing-overlay"
    />
  );
}

