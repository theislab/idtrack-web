// The home's lineages, asked for and laid out off the page's thread: the answer of `GET /organisms/{organism}/lineages`
// read and placed here, the layout sent back with its typed arrays moved, not copied. A slow phone's thread stays free.
import type { LineagesResponse } from "../../api/types";
import { layoutLineages } from "./lineageLayout";

interface Ask {
  url: string;
  eras: number[];
}

const scope = self as unknown as {
  addEventListener: (type: "message", listener: (event: MessageEvent<Ask>) => void) => void;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

scope.addEventListener("message", (event) => {
  const { url, eras } = event.data;
  fetch(url, { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`${response.status}`);
      const layout = layoutLineages((await response.json()) as LineagesResponse, eras);
      const moved = [
        layout.y,
        layout.segments,
        layout.segmentStart,
        layout.edges,
        layout.edgeStart,
        layout.dots,
        layout.familyOf,
        layout.versionCounts,
        layout.runs,
        layout.runStart,
        ...layout.columns,
      ].map((a) => a.buffer);
      // The ids as one string (one clone, not thousands).
      scope.postMessage({ layout: { ...layout, ids: [] }, ids: layout.ids.join("\n") }, moved);
    })
    .catch((error: unknown) => {
      scope.postMessage({ error: String(error) }, []);
    });
});
