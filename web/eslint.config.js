import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results", "src/api/schema.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
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
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}", "e2e/**/*.ts", "*.config.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "react-refresh/only-export-components": "off", "no-console": "off" },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },
);
