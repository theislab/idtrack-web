// What the server holds (`/organisms`, `/version`), what its codes mean (`/vocabulary`) and its bounds (`/limits`),
// read once and shared by every view, and the organism in view: the one the address names (`?organism=`, or the
// graph's own page `/organisms/<organism>`), else the one last in view in this browser, else a default. Every link of
// the shell carries it, so that it stays in view from section to section until another is chosen. When the graphs' digests change (the server was
// given other graphs), every answer held of the earlier ones is forgotten and every view's read is asked again
// (api/client.ts, a new generation): the version, vocabulary and limits too, and /organisms only once.
import { createContext, use, useEffect, useMemo, useRef, type ReactNode } from "react";
import { API_BASE, api, forgetAnswers, type AnyRequestError } from "../api/client";
import type { GraphDescription, VersionResponse } from "../api/types";
import { commonName } from "./organismNames";
import { FAILED_VOCABULARY, NO_VOCABULARY, readVocabulary } from "./vocabulary";
import { LimitsContext, VocabularyContext } from "./vocabularyContext";
import { href, navigate, useLocation } from "./router";
import { routeOf } from "./routes";
import { setDocsRoot } from "./links";
import { useRequest } from "./useRequest";

/** Parameters of the address kept when the organism changes. */
const KEPT = ["id", "name", "fold_case"];

const PREFERRED = ["homo_sapiens", "mus_musculus", "sus_scrofa"];

/** The organism last in view, kept in the browser (listed on the privacy page: lib/site/storage.ts). */
const REMEMBERED = "idtrack-organism";

function remembered(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
}

function remember(organism: string): void {
  try {
    window.localStorage.setItem(REMEMBERED, organism);
  } catch {
    // Storage may be off (a private window): the organism is then carried by the addresses alone.
  }
}

interface OrganismsValue {
  status: "loading" | "done" | "failed";
  error: AnyRequestError | null;
  retry: () => void;
  organisms: GraphDescription[];
  version: VersionResponse | null;
  /** The state of each fact the pages share, so that a placeholder of one that failed says "not read". */
  facts: Record<"version" | "vocabulary" | "limits", "loading" | "done" | "failed">;
  /** The organism in view (the address's, else the one last in view in this browser, else a default). */
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
  // is asked again quietly (revalidated against its ETag); other digests forget every answer held but this one, and
  // every view asks again.
  useEffect(() => {
    let checked = Date.now();
    const check = () => {
      if (document.visibilityState !== "visible" || Date.now() - checked < GRAPHS_CHECK_MS) return;
      checked = Date.now();
      api.organisms({ fresh: true }).then(
        (answer) => {
          const now = answer.data.organisms.map((o) => `${o.organism}:${o.content_digest ?? ""}`).join(" ");
          if (digests.current !== null && digests.current !== now) {
            digests.current = now;
            forgetAnswers({ [`${API_BASE}/organisms`]: answer });
          }
        },
        () => undefined,
      );
    };
    document.addEventListener("visibilitychange", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  const words = useMemo(
    () =>
      vocabulary.state === "done"
        ? readVocabulary(vocabulary.answer.data)
        : vocabulary.state === "failed"
          ? FAILED_VOCABULARY
          : NO_VOCABULARY,
    [vocabulary],
  );
  const location = useLocation();
  const named = location.search.get("organism");
  const route = routeOf(location.path);
  const requested = named ?? (route.page === "organism" ? route.organism : null);

  const value = useMemo<OrganismsValue>(() => {
    const list = organisms.state === "done" ? organisms.answer.data.organisms : [];
    const byName = (name: string | null) =>
      name === null
        ? undefined
        : list.find((o) => o.organism === name || commonName(o.organism) === name.toLowerCase());
    const fallback = byName(remembered()) ?? PREFERRED.map((p) => byName(p)).find(Boolean) ?? list[0] ?? null;
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
      // A graph's own page says itself when it names no graph of the server.
      unknownRequested: named !== null && list.length > 0 && !asked ? named : null,
      choose: (organism: string) => {
        remember(organism);
        // On a graph's page, another graph is its page (the same tab); elsewhere the same page of the other graph:
        // releases and databases belong to one graph; the identifier, a name or a gene may be asked of another.
        if (route.page === "organism") {
          navigate(href(`/organisms/${encodeURIComponent(organism)}`, { tab: location.search.get("tab") }));
          return;
        }
        const kept = Object.fromEntries([...location.search.entries()].filter(([key]) => KEPT.includes(key)));
        navigate(href(location.path, { ...kept, organism }));
      },
    };
  }, [organisms, version, vocabulary, limits, requested, named, route.page, location.path, location.search]);
  // What the address names is the organism in view from now on, also where a later address names none.
  const inView = value.current?.organism ?? null;
  const fromAddress =
    inView !== null && requested !== null && (inView === requested || commonName(inView) === requested.toLowerCase());
  useEffect(() => {
    if (fromAddress && inView) remember(inView);
  }, [fromAddress, inView]);

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
