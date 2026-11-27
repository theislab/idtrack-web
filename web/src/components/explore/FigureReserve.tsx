// The room a figure will take, held while its code loads, so that nothing below it moves when it is drawn.
import { useWidth } from "../figure/useWidth";

export function FigureReserve({ height }: { height: (width: number) => number }) {
  const { ref, width } = useWidth<HTMLDivElement>(1200);
  return <div ref={ref} className="figure-reserve" style={{ height: height(width) }} aria-hidden="true" />;
}
