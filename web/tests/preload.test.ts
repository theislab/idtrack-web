// The answers the server writes into the page it sends are held from the start: the views that ask them first are
// answered without a request of the api, with the text as the api sent it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, forgetAnswers, holdPreloaded, PRELOAD_ID } from "../src/api/client";

const limits = JSON.stringify({ batch_max: 1000 });

function page(texts: Record<string, string>): Pick<Document, "getElementById"> {
  const block = { textContent: JSON.stringify(texts) } as HTMLElement;
  return { getElementById: (id: string) => (id === PRELOAD_ID ? block : null) };
}

afterEach(() => {
  forgetAnswers();
  vi.unstubAllGlobals();
});

describe("answers written into the page", () => {
  it("are held and answered without a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const organisms = JSON.stringify({ organisms: [], names: [] });
    expect(holdPreloaded(page({ "/api/v1/organisms": organisms }))).toBe(1);
    const answer = await api.organisms();
    expect(answer.raw).toBe(organisms);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leave an answer of another form, or another address, to be asked", () => {
    expect(holdPreloaded(page({ "/api/v1/organisms": JSON.stringify({ nothing: 1 }), "/elsewhere": limits }))).toBe(0);
    expect(holdPreloaded(null)).toBe(0);
  });
});
