import React, { useEffect, useMemo, useRef, useState } from 're-t';

export default function LiveMarketFeed({ ticker = 'AAPL', assetClass = 'stocks', interval = '1m', decimals = 2 }) {
  const [liveData, setLiveData] = useState({ status: 'Disconnected', price: null });
  const socketRef = useRef(null);
  const reconnectRef = useRef({ attempts: 0, timer: null, closedByEffect: false });

  const wsUrl = useMemo(() => {
    const envUrl = process.env.REACT_APP_WS_URL;
    const base = envUrl
      ? envUrl.replace(/\/+$/, '')
      : (process.env.NODE_ENV === 'production'
          ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
          : 'ws://localhost:8000');
    const params = new URLSearchParams({
      ticker,
      asset_class: assetClass,
      interval,
    });
    return `${base}/ws/live?${params.toString()}`;
  }, [assetClass, interval, ticker]);

  useEffect(() => {
    const reconnectState = reconnectRef.current;
    reconnectState.closedByEffect = false;

    const connect = () => {
      if (reconnectState.closedByEffect) return;

      try {
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          reconnectState.attempts = 0;
          setLiveData((prev) => ({ ...prev, status: 'Online' }));
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            const nextPrice = typeof data?.price === 'number' ? data.price : null;
            setLiveData((prev) => ({
              ...prev,
              price: nextPrice != null ? nextPrice : prev.price,
            }));
          } catch {
            return;
          }
        };

        socket.onclose = () => {
          if (reconnectState.closedByEffect) return;
          setLiveData((prev) => ({ ...prev, status: 'Reconnecting' }));

          const attempts = reconnectState.attempts + 1;
          reconnectState.attempts = attempts;
          const delayMs = Math.min(1000 * attempts, 10000);

          if (reconnectState.timer) {
            clearTimeout(reconnectState.timer);
          }
          reconnectState.timer = setTimeout(connect, delayMs);
        };

        socket.onerror = () => {
          try {
            socket.close();
          } catch {
            return;
          }
        };
      } catch {
        setLiveData((prev) => ({ ...prev, status: 'Error' }));
      }
    };

    connect();

    return () => {
      reconnectState.closedByEffect = true;
      if (reconnectState.timer) {
        clearTimeout(reconnectState.timer);
        reconnectState.timer = null;
      }
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          return;
        }
      }
    };
  }, [wsUrl]);

  const isOnline = liveData.status === 'Online';
  const formattedPrice = liveData.price != null ? Number(liveData.price).toFixed(decimals) : '---';

  return (
    <div className="bg-space-950/60 border border-neutral-800 rounded-2xl px-4 py-3 flex justify-between items-center">
      <div className="flex items-center space-x-2">
        <div className={`h-3 w-3 rounded-full ${isOnline ? 'bg-[#00FFA3] animate-pulse' : 'bg-red-500'}`} />
        <span className="text-neutral-400 font-mono text-[11px] tracking-widest">{liveData.status}</span>
      </div>

      <div className="text-right">
        <span className="text-[10px] text-neutral-500 block uppercase tracking-[0.26em]">Live Price</span>
        <span className="text-[#00FFA3] font-mono text-lg font-semibold">{formattedPrice}</span>
      </div>
    </div>
  );
}

