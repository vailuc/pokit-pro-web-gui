import { useEffect, useRef } from "react";
import uPlot from "uplot";

interface WaveformProps {
  /** x-axis values (e.g. seconds or ms). */
  xs: number[];
  /** y-axis values (e.g. volts). */
  ys: number[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
}

/** Thin uPlot wrapper that resizes to its container and updates on data change. */
export function Waveform({ xs, ys, xLabel = "Time", yLabel = "Value", height = 320 }: WaveformProps) {
  const ref = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const opts: uPlot.Options = {
      width: ref.current.clientWidth,
      height,
      scales: { x: { time: false } },
      axes: [
        { label: xLabel, stroke: "#a3a3a3", grid: { stroke: "#262626" }, ticks: { stroke: "#404040" } },
        { label: yLabel, stroke: "#a3a3a3", grid: { stroke: "#262626" }, ticks: { stroke: "#404040" } },
      ],
      series: [
        {},
        { label: yLabel, stroke: "#ffcc00", width: 2, points: { show: false } },
      ],
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

  useEffect(() => {
    plotRef.current?.setData([xs, ys]);
  }, [xs, ys]);

  return <div ref={ref} className="w-full" />;
}
