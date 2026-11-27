// What the server holds (`/organisms`, `/version`), what its codes mean (`/vocabulary`) and its bounds (`/limits`),
// read once and shared by every view, and the organism chosen. When the graphs' digests change (the server was
// given other graphs), every answer held of the earlier ones is forgotten (api/client.ts).
import { createContext, use, useEffect, useMemo, useRef, type ReactNode } from "react";
import { api, forgetAnswers, type AnyRequestError } from "../api/client";
import type { GraphDescription, VersionResponse } from "../api/types";
import { commonName } from "./organismNames";
import { NO_VOCABULARY, readVocabulary } from "./vocabulary";
import { LimitsContext, VocabularyContext } from "./vocabularyContext";
import { href, navigate, useLocation } from "./router";
import { setDocsRoot } from "./links";
import { useRequest } from "./useRequest";

/** Parameters of the address kept when the organism changes. */
const KEPT = ["id", "name", "fold_case"];

const PREFERRED = ["homo_sapiens", "mus_musculus", "sus_scrofa"];

interface OrganismsValue {
  status: "loading" | "done" | "failed";
  error: AnyRequestError | null;
  retry: () => void;
  organisms: GraphDescription[];
  version: VersionResponse | null;
  /** The state of each fact the pages share, so that a placeholder of one that failed says "not read". */
  facts: Record<"version" | "vocabulary" | "limits", "loading" | "done" | "failed">;
  /** The organism in view (the address's `organism`, else a default), and its description. */
  current: GraphDescription | null;
  /** The address asked for an organism the server does not hold. */
  unknownRequested: string | null;
  choose: (organism: string) => void;
}

const Context = createContext<OrganismsValue | null>(null);

function factState(state: "idle" | "loading" | "done" | "failed"): "loading" | "done" | "failed" {
  return state === "idle" ? "loading" : state;
}

/** How often a tab shown again asks whether the server's graphs changed (a quiet revalidation of /organisms). */
const GRAPHS_CHECK_MS = 60_000;

export function OrganismsProvider({ children }: { children: ReactNode }) {
  const organisms = useRequest("organisms", (signal, fresh) => api.organisms({ signal, fresh }));
  const version = useRequest("version", (signal, fresh) => api.version({ signal, fresh }));
  // The documentation's address the server names, read before any page draws a link to it.
  if (version.state === "done") setDocsRoot(version.answer.data.docs_url);
  const vocabulary = useRequest("vocabulary", (signal, fresh) => api.vocabulary({ signal, fresh }));
  const limits = useRequest("limits", (signal, fresh) => api.limits({ signal, fresh }));
  const digests = useRef<string | null>(null);
  useEffect(() => {
    if (organisms.state !== "done") return;
    const now = organisms.answer.data.organisms.map((o) => `${o.organism}:${o.content_digest ?? ""}`).join(" ");
    if (digests.current !== null && digests.current !== now) forgetAnswers();
    digests.current = now;
  }, [organisms]);
  // A tab left open across a change of the server's graphs: when it is shown again (at most once a minute), /organisms
  // is asked again quietly (revalidated against its ETag); other digests forget every answer held and read the
  // organisms anew.
  const retryOrganisms = organisms.retry;
  useEffect(() => {
    let checked = Date.now();
    const check = () => {
      if (document.visibilityState !== "visible" || Date.now() - checked < GRAPHS_CHECK_MS) return;
      checked = Date.now();
      api.organisms({ fresh: true }).then(
        (answer) => {
          const now = answer.data.organisms.map((o) => `${o.organism}:${o.content_digest ?? ""}`).join(" ");
          if (digests.current !== null && digests.current !== now) {
            forgetAnswers();
            retryOrganisms();
          }
        },
        () => undefined,
      );
    };
    document.addEventListener("visibilitychange", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
    };
  }, [retryOrganisms]);
  const words = useMemo(
    () => (vocabulary.state === "done" ? readVocabulary(vocabulary.answer.data) : NO_VOCABULARY),
    [vocabulary],
  );
  const location = useLocation();
  const requested = location.search.get("organism");

  const value = useMemo<OrganismsValue>(() => {
    const list = organisms.state === "done" ? organisms.answer.data.organisms : [];
    const byName = (name: string | null) =>
      name === null
        ? undefined
        : list.find((o) => o.organism === name || commonName(o.organism) === name.toLowerCase());
    const fallback = PREFERRED.map((p) => byName(p)).find(Boolean) ?? list[0] ?? null;
    const asked = byName(requested);
    const status = organisms.state === "failed" ? "failed" : organisms.state === "done" ? "done" : "loading";
    return {
      status,
      error: organisms.state === "failed" ? organisms.error : null,
      retry: () => {
        organisms.retry();
        version.retry();
        vocabulary.retry();
        limits.retry();
      },
      organisms: list,
      version: version.state === "done" ? version.answer.data : null,
      facts: {
        version: factState(version.state),
        vocabulary: factState(vocabulary.state),
        limits: factState(limits.state),
      },
      current: asked ?? fallback,
      unknownRequested: requested !== null && list.length > 0 && !asked ? requested : null,
      choose: (organism: string) => {
        // Releases and databases belong to one graph; the identifier, a name or a gene may be asked of another.
        const kept = Object.fromEntries([...location.search.entries()].filter(([key]) => KEPT.includes(key)));
        navigate(href(location.path, { ...kept, organism }));
      },
    };
  }, [organisms, version, vocabulary, limits, requested, location.path, location.search]);

  return (
    <Context value={value}>
      <VocabularyContext value={words}>
        <LimitsContext value={limits.state === "done" ? limits.answer.data : null}>{children}</LimitsContext>
      </VocabularyContext>
    </Context>
  );
}

export function useOrganisms(): OrganismsValue {
  const value = use(Context);
  if (!value) throw new Error("useOrganisms outside OrganismsProvider");
  return value;
}
