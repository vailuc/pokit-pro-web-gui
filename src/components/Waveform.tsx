import { useEffect, useRef, useCallback } from "react";
import uPlot from "uplot";

interface WaveformProps {
  /** x-axis values (e.g. seconds or ms). */
  xs: number[];
  /** y-axis values (e.g. volts). */
  ys: number[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
  /** When set, shows only the last N samples (scrolling view for continuous mode).
   *  When undefined, shows the full trace and enables zoom/pan. */
  windowSize?: number;
  /** Fixed X axis range. When set, uPlot keeps x scale locked to [min, max].
   *  Trace grows left-to-right within the frame, then scrolls. */
  xMin?: number;
  xMax?: number;
}

/** Thin uPlot wrapper that resizes to its container and updates on data change.
 *  When windowSize is set, shows a rolling window. When undefined, supports
 *  mouse wheel zoom and drag pan. */
export function Waveform({ xs, ys, xLabel = "Time", yLabel = "Value", height = 320, windowSize, xMin, xMax }: WaveformProps) {
  const ref = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastXRef = useRef(0);

  useEffect(() => {
    if (!ref.current) return;
    const opts: uPlot.Options = {
      width: ref.current.clientWidth,
      height,
      scales: {
        x: {
          time: false,
          ...(xMin !== undefined && xMax !== undefined ? { min: xMin, max: xMax } : {}),
        },
      },
      axes: [
        { label: xLabel, stroke: "#a3a3a3", grid: { stroke: "#262626" }, ticks: { stroke: "#404040" } },
        { label: yLabel, stroke: "#a3a3a3", grid: { stroke: "#262626" }, ticks: { stroke: "#404040" } },
      ],
      series: [
        {},
        { label: yLabel, stroke: "#ffcc00", width: 2, points: { show: false } },
      ],
      cursor: {
        drag: { setScale: false },
      },
    };
    const plot = new uPlot(opts, [xs, ys], ref.current);
    plotRef.current = plot;

    const onResize = () => {
      if (ref.current) plot.setSize({ width: ref.current.clientWidth, height });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      plot.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, xLabel, yLabel]);

  // Update data and scale
  useEffect(() => {
    if (!plotRef.current) return;
    if (xMin !== undefined && xMax !== undefined) {
      // Fixed-frame strip-chart: keep x scale locked
      plotRef.current.setScale("x", { min: xMin, max: xMax });
      plotRef.current.setData([xs, ys]);
    } else if (windowSize && xs.length > windowSize) {
      const start = xs.length - windowSize;
      plotRef.current.setData([xs.slice(start), ys.slice(start)]);
      zoomRef.current = 1;
      panRef.current = 0;
    } else {
      const n = xs.length;
      if (n === 0) return;
      const zoom = zoomRef.current;
      const pan = panRef.current;
      const viewSize = Math.max(1, Math.round(n / zoom));
      let start = Math.max(0, Math.min(n - viewSize, Math.round(pan * n)));
      let end = Math.min(n, start + viewSize);
      if (end - start < 1) { end = start + 1; }
      plotRef.current.setData([xs.slice(start, end), ys.slice(start, end)]);
    }
  }, [xs, ys, windowSize, xMin, xMax]);

  const hasFixedScale = xMin !== undefined && xMax !== undefined;

  // Wheel zoom
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (windowSize !== undefined || hasFixedScale) return; // Disable zoom in running/fixed mode
    if (e.cancelable) e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomRef.current = Math.max(1, Math.min(100, zoomRef.current * delta));
    // Trigger re-render to apply zoom
    if (plotRef.current && xs.length > 0) {
      const n = xs.length;
      const zoom = zoomRef.current;
      const pan = panRef.current;
      const viewSize = Math.max(1, Math.round(n / zoom));
      let start = Math.max(0, Math.min(n - viewSize, Math.round(pan * n)));
      let end = Math.min(n, start + viewSize);
      if (end - start < 1) { end = start + 1; }
      plotRef.current.setData([xs.slice(start, end), ys.slice(start, end)]);
    }
  }, [windowSize, xs]);

  // Drag pan
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (windowSize !== undefined || hasFixedScale) return;
    isDraggingRef.current = true;
    lastXRef.current = e.clientX;
  }, [windowSize, hasFixedScale]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current || windowSize !== undefined || hasFixedScale) return;
    const dx = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    const n = xs.length;
    if (n === 0) return;
    const zoom = zoomRef.current;
    const viewSize = Math.max(1, Math.round(n / zoom));
    panRef.current = Math.max(0, Math.min(1, panRef.current - dx / (n * 0.5)));
    const start = Math.max(0, Math.min(n - viewSize, Math.round(panRef.current * n)));
    const end = Math.min(n, start + viewSize);
    if (plotRef.current) {
      plotRef.current.setData([xs.slice(start, end), ys.slice(start, end)]);
    }
  }, [windowSize, xs]);

  const onMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  return (
    <div
      ref={ref}
      className="w-full"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ cursor: !hasFixedScale && windowSize === undefined ? "grab" : "default" }}
    />
  );
}
