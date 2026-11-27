// @ts-check
// The lint of the frontend (SETUP.md, "Checks and tests"): typescript-eslint's strictest sets with the type checker,
// React's rules of JSX and hooks, accessibility (jsx-a11y strict), import hygiene (no cycle, no duplicate, no import of
// a module by itself) and a few guards against what the code's rules forbid. Each rule turned off or changed below
// says why on its line.
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import eslintReact from "@eslint-react/eslint-plugin";
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { flatConfigs as importX } from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefreshPlugin from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/** @typedef {import("eslint").Linter.Config} Config */
/** @typedef {import("eslint").Linter.RuleEntry} RuleEntry */

/** A rule's entry with "warn" raised to "error". @returns {RuleEntry | undefined} */
const raise = (/** @type {RuleEntry | undefined} */ entry) => {
  if (entry === "warn" || entry === 1) return "error";
  if (typeof entry === "object" && (entry[0] === "warn" || entry[0] === 1)) {
    /** @type {unknown[]} */
    const options = entry.slice(1);
    return ["error", ...options];
  }
  return entry;
};

/** A shared config with every rule it warns of raised to an error: the only warnings of this lint are the guards of
 *  size below, which say where code has grown hard to read without failing the check. */
const errors = (/** @type {Config} */ config) => {
  /** @type {Record<string, RuleEntry>} */
  const rules = {};
  for (const [name, entry] of Object.entries(config.rules ?? {})) {
    const raised = raise(entry);
    if (raised !== undefined) rules[name] = raised;
  }
  return { ...config, rules };
};

export default defineConfig(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results", "src/api/schema.ts"] },
  { linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" } },
  // Every directive that turns a rule off names the rule and says why on its line (`-- reason`).
  errors(eslintComments.recommended),
  {
    rules: {
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: ["eslint-enable"] }],
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx,js}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      errors(importX.recommended),
      errors(importX.typescript),
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver({ project: "tsconfig.json" })],
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      // A switch over a union names every member, or says by a default what the others do.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { requireDefaultForNonUnion: true, considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-import-type-side-effects": "error",
      eqeqeq: ["error", "always"],
      "no-console": "error",
      "no-param-reassign": "error",
      "no-implicit-coercion": "error",
      "prefer-const": "error",
      "object-shorthand": "error",
      // Imports: none of a module by itself, no cycle (type-only imports included: a cycle of types is a knot of
      // modules too), each module imported once, every named import exported by its module.
      "import-x/no-cycle": ["error", { ignoreExternal: true }],
      "import-x/no-self-import": "error",
      "import-x/no-duplicates": ["error", { "prefer-inline": true }],
      "import-x/no-useless-path-segments": "error",
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
      "import-x/no-mutable-exports": "error",
      // TypeScript resolves every import already (typecheck); the plugin's own resolution of default exports of
      // packages written in CommonJS disagrees with the bundler's.
      "import-x/default": "off",
      "import-x/no-named-as-default-member": "off",
      // Guards of nesting and of arguments, at bounds the code keeps: errors.
      "max-depth": ["error", 5],
      "max-nested-callbacks": ["error", 5],
      "max-params": ["error", 6],
      // Guards of size, as warnings (shown by `npm run check`, not failing it): functions past them are where the code
      // is hardest to read, to be split when next changed. The code does not keep a tighter bound yet.
      complexity: ["warn", 30],
      "max-lines-per-function": ["warn", { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    // The rules of hooks and of a pure render are React's own (eslint-plugin-react-hooks, with the React Compiler's
    // checks); @eslint-react's copies of them are off below, so that each fault is reported once, by one definition.
    extends: [errors(eslintReact.configs["strict-type-checked"]), errors(reactHooks.configs.flat.recommended)],
    plugins: { "react-refresh": reactRefreshPlugin, "jsx-a11y": jsxA11y },
    rules: {
      "@eslint-react/rules-of-hooks": "off",
      "@eslint-react/exhaustive-deps": "off",
      "@eslint-react/purity": "off",
      "@eslint-react/set-state-in-render": "off",
      "@eslint-react/set-state-in-effect": "off",
      "@eslint-react/static-components": "off",
      "@eslint-react/use-memo": "off",
      "@eslint-react/unsupported-syntax": "off",
      "@eslint-react/error-boundaries": "off",
      // A key of a position is used for lists rebuilt whole, in one order, from one answer (the parts of a text, the
      // lines of a label, lanes, the rows of a fixed table) and holding no state, often with the content in the key;
      // a position is stable there, and a key made of content alone would repeat where the content repeats.
      "@eslint-react/no-array-index-key": "off",
      // Refs are named for what they hold, as every other name of the code, not by a suffix.
      "@eslint-react/naming-convention-ref-name": "off",
      // A setter whose name a wrapper takes (the wrapper also keeps the draft) is named `set<Value>State`.
      "@eslint-react/use-state": ["error", { enforceSetterName: false }],
      ...jsxA11y.flatConfigs.strict.rules,
      "react-refresh/only-export-components": [
        "error",
        {
          allowConstantExport: true,
          allowExportNames: ["useOrganisms", "useVocabulary", "useLimits", "VocabularyContext", "LimitsContext"],
        },
      ],
      // A table that scrolls sideways is a focusable region, so that a keyboard can scroll it (WCAG 2.1.1).
      "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: [], roles: ["tabpanel", "region"] }],
      // What the code's rules forbid (web/DESIGN.md): text set as HTML, and values written to the console.
      "@eslint-react/dom-no-dangerously-set-innerhtml": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: "Text is set as text: React's children or textContent, never as HTML.",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Text is set as text: React's children or textContent, never as HTML.",
        },
        {
          selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
          message: "Text is set as text: React's children or textContent, never as HTML.",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}", "e2e/**/*.ts", "scripts/**/*.ts", "*.config.{ts,js}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Tests, scripts and configs run in Node and write their reports to the console.
      "no-console": "off",
    },
  },
);
