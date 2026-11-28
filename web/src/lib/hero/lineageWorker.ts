// The home's lineages laid out off the page's thread: the answer of `GET /organisms/{organism}/lineages`, read by the
// page's api client (its checks, its retries, its shared answers), is sent here as the text the api sent, read and
// placed here, and the layout sent back with its typed arrays moved, not copied. A slow phone's thread stays free.
import type { LineagesResponse } from "../../api/types";
import { layoutLineages, type LayoutAsk } from "./lineageLayout";

self.addEventListener("message", (event: MessageEvent<LayoutAsk>) => {
  const { raw, eras } = event.data;
  try {
    const layout = layoutLineages(JSON.parse(raw) as LineagesResponse, eras);
    const moved = [
      layout.y,
      layout.top,
      layout.segments,
      layout.segmentStart,
      layout.edges,
      layout.edgeStart,
      layout.dots,
      layout.familyOf,
      layout.versionCounts,
      layout.runs,
      layout.runStart,
      layout.pulseEdges,
      layout.pulseDots,
      ...Object.values(layout.lines).flatMap((lines) => [lines.straight, lines.curved]),
      ...layout.columns,
    ].map((a) => a.buffer);
    // The ids as one string (one clone, not thousands).
    self.postMessage({ layout: { ...layout, ids: [] }, ids: layout.ids.join("\n") }, { transfer: moved });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
});
