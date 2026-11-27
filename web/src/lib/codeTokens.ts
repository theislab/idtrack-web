// The words of a short program in kinds, for reading it on the api page: comments, strings, numbers, a language's own
// words and literals, and the rest. A light reader of the five languages the page writes (shell, Python, R,
// JavaScript, JSON), not a parser: it only splits the text, and the tokens joined give back the text exactly. Drawn
// in the ink scale and weights of the page (never a hue: colour is kept for meaning), so it reads in either theme.

export type CodeKind = "comment" | "string" | "number" | "keyword" | "literal" | "plain";

export interface CodeToken {
  kind: CodeKind;
  text: string;
}

export type CodeLanguage = "bash" | "python" | "r" | "javascript" | "json";

const WORDS: Record<CodeLanguage, { keywords: string[]; literals: string[]; comment: string | null }> = {
  bash: { keywords: ["curl"], literals: [], comment: "#" },
  python: {
    keywords: [
      "import", "from", "as", "def", "return", "for", "in", "if", "elif", "else", "while", "with", "raise", "try",
      "except", "finally", "not", "and", "or", "is", "lambda", "continue", "break", "pass", "class", "yield",
    ],
    literals: ["True", "False", "None"],
    comment: "#",
  },
  r: {
    keywords: ["library", "function", "for", "in", "if", "else", "while", "return", "next", "break", "repeat", "stop"],
    literals: ["TRUE", "FALSE", "NULL", "NA", "Inf"],
    comment: "#",
  },
  javascript: {
    keywords: [
      "const", "let", "var", "await", "async", "function", "return", "if", "else", "for", "of", "in", "new", "throw",
      "try", "catch", "while", "import", "from", "export",
    ],
    literals: ["true", "false", "null", "undefined"],
    comment: "//",
  },
  json: { keywords: [], literals: ["true", "false", "null"], comment: null },
}; // prettier-ignore

const cache = new Map<CodeLanguage, RegExp>();

/** One expression of the language's tokens, each kind a named group; anything it does not match is plain text. */
function scanner(language: CodeLanguage): RegExp {
  const found = cache.get(language);
  if (found) return found;
  const { keywords, literals, comment } = WORDS[language];
  const parts: string[] = [];
  if (comment) parts.push(`(?<comment>${comment === "#" ? "(?<![\\w$])#" : "//"}[^\\n]*)`);
  // Strings: double, single and (JavaScript) back quotes, with backslash escapes; a Python f, r or b prefix with them.
  const quotes = language === "javascript" ? "\"'`" : "\"'";
  const strings = [...quotes].map((q) => `${q}(?:[^${q}\\\\]|\\\\.)*${q}`).join("|");
  parts.push(`(?<string>${language === "python" ? "(?:[fFrRbB]{1,2})?" : ""}(?:${strings}))`);
  parts.push("(?<number>(?<![\\w.$])-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?(?![\\w$]))");
  if (language === "bash") parts.push("(?<keyword>(?<![\\w-])(?:curl|-[A-Za-z]+|--[a-z][a-z-]*)(?![\\w-]))");
  else if (keywords.length) parts.push(`(?<keyword>\\b(?:${keywords.join("|")})\\b)`);
  if (literals.length) parts.push(`(?<literal>\\b(?:${literals.join("|")})\\b)`);
  const made = new RegExp(parts.join("|"), "gs");
  cache.set(language, made);
  return made;
}

/** The tokens of `code` in `language`, in order; their texts joined are `code`. */
export function codeTokens(code: string, language: CodeLanguage): CodeToken[] {
  const tokens: CodeToken[] = [];
  let at = 0;
  for (const match of code.matchAll(scanner(language))) {
    const groups = match.groups ?? {};
    const kind = (Object.keys(groups) as CodeKind[]).find((k) => groups[k] !== undefined);
    if (!kind || match.index === undefined) continue;
    if (match.index > at) tokens.push({ kind: "plain", text: code.slice(at, match.index) });
    tokens.push({ kind, text: match[0] });
    at = match.index + match[0].length;
  }
  if (at < code.length) tokens.push({ kind: "plain", text: code.slice(at) });
  return tokens;
}
