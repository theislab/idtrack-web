// What the server holds (`/organisms`, `/version`), what its codes mean (`/vocabulary`) and its bounds (`/limits`),
// read once and shared by every view, and the organism chosen.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { api, type AnyRequestError } from "../api/client";
import type { GraphDescription, VersionResponse } from "../api/types";
import { commonName } from "./organismNames";
import { NO_VOCABULARY, readVocabulary } from "./vocabulary";
import { LimitsContext, VocabularyContext } from "./vocabularyContext";
import { href, navigate, useLocation } from "./router";
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
  /** The organism in view (the address's `organism`, else a default), and its description. */
  current: GraphDescription | null;
  /** The address asked for an organism the server does not hold. */
  unknownRequested: string | null;
  choose: (organism: string) => void;
}

const Context = createContext<OrganismsValue | null>(null);

export function OrganismsProvider({ children }: { children: ReactNode }) {
  const organisms = useRequest("organisms", (signal) => api.organisms(signal));
  const version = useRequest("version", (signal) => api.version(signal));
  const vocabulary = useRequest("vocabulary", (signal) => api.vocabulary(signal));
  const limits = useRequest("limits", (signal) => api.limits(signal));
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
    <Context.Provider value={value}>
      <VocabularyContext.Provider value={words}>
        <LimitsContext.Provider value={limits.state === "done" ? limits.answer.data : null}>
          {children}
        </LimitsContext.Provider>
      </VocabularyContext.Provider>
    </Context.Provider>
  );
}

export function useOrganisms(): OrganismsValue {
  const value = useContext(Context);
  if (!value) throw new Error("useOrganisms outside OrganismsProvider");
  return value;
}
