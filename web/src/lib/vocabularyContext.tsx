// The api's vocabulary and bounds for every view (read once by the app's provider).
import { createContext, useContext } from "react";
import type { LimitsResponse } from "../api/types";
import { NO_VOCABULARY, type Vocabulary } from "./vocabulary";

export const VocabularyContext = createContext<Vocabulary>(NO_VOCABULARY);
export const LimitsContext = createContext<LimitsResponse | null>(null);

export function useVocabulary(): Vocabulary {
  return useContext(VocabularyContext);
}

export function useLimits(): LimitsResponse | null {
  return useContext(LimitsContext);
}
