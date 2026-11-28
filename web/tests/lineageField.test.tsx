// @vitest-environment jsdom
// An organism's lineage field is built once per answer: re-rendering the page around it (a change of the address the
// field does not read, a theme, the tab chosen again) neither lays its lineages out again nor makes a new renderer.
// The request's state is the same object from one render to the next until it changes (lib/useRequest.ts).
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LineagesResponse } from "../src/api/types";
import { layoutLineages } from "../src/lib/hero/lineageLayout";
import { description } from "./fixtures";

const lineages: LineagesResponse = {
  organism: "sus_scrofa",
  content_digest: "0".repeat(64),
  releases: [10, 11, 12, 13],
  genes: 5,
  families: 3,
  focus_families: 1,
  limit: 4,
  ids: ["A", "B", "C", "D"],
  family_starts: [0, 2, 3],
  active: [[[10, 11]], [[12, 13]], [[10, 13]], [[11, 13]]],
  versions: [[11], [], [12, 13], []],
  edges: [[0, 1, 11, 12, 0.9]],
};

const made = vi.hoisted(() => ({ fields: 0, layouts: 0 }));

vi.mock("../src/lib/hero/lineageLoad", () => ({
  loadLineageLayout: () => {
    made.layouts += 1;
    return Promise.resolve({ data: layoutLineages(lineages), raw: "", requestId: null, serverTiming: null });
  },
}));

vi.mock("../src/components/hero/field", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/hero/field")>();
  return {
    ...actual,
    createField: (canvas: HTMLCanvasElement) => {
      made.fields += 1;
      return {
        element: canvas,
        mode: "test",
        setColours: () => undefined,
        setRunning: () => undefined,
        resize: () => undefined,
        setPointer: () => undefined,
        destroy: () => undefined,
      };
    },
  };
});

const { LineageField } = await import("../src/components/explore/LineageField");

afterEach(cleanup);

function Page() {
  const [n, setN] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setN(n + 1);
        }}
      >
        render again {n}
      </button>
      <LineageField description={description("sus_scrofa")} />
    </>
  );
}

describe("an organism's lineage field", () => {
  it("is laid out and drawn once per answer, however often the page around it renders", async () => {
    render(<Page />);
    await act(async () => {
      await Promise.resolve();
    });
    await screen.findByRole("application");
    expect(made.layouts).toBe(1);
    expect(made.fields).toBe(1);
    for (let k = 0; k < 5; k++)
      act(() => {
        screen.getByRole("button", { name: /^render again/ }).click();
      });
    expect(made.layouts).toBe(1);
    expect(made.fields).toBe(1);
  });
});
