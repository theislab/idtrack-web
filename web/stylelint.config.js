// @ts-check
// The lint of the stylesheets (SETUP.md, "Checks and tests"): stylelint's standard set, adapted to the code's
// conventions. Each rule changed below says why on its line.
/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  rules: {
    // Class names are BEM-like: a block, an element after `__`, a modifier after `--` (`load-monitor__trigger--ok`),
    // each in kebab case (states are `is-<state>`); a modifier that is a code of the api is written as the api writes
    // it (`sfill--no_target`).
    "selector-class-pattern": [
      "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:--[a-z0-9]+(?:[-_][a-z0-9]+)*)?$",
      { message: (/** @type {string} */ name) => `Expected class "${name}" to be block__element--modifier` },
    ],
    // Media queries are written with min-width / max-width, the form every browser the page supports reads.
    "media-feature-range-notation": "prefix",
    // Sizes in rem are exact fractions of a pixel (0.84375rem is 13.5 px): five decimals keep them exact.
    "number-max-precision": 5,
    // The rule compares selectors by their last part only (`.mono`, `> td`), so it reports pairs of rules of different
    // components that never style one element, and rules whose higher specificity is meant to win wherever they
    // stand (a state over its element's base); its reports are not faults of this code.
    "no-descending-specificity": null,
    // Safari reads only the prefixed text-size-adjust (written beside the standard one).
    "property-no-vendor-prefix": [true, { ignoreProperties: ["/text-size-adjust$/"] }],
    // A grid's areas, rows and columns are written as their longhands, which read as the grid they draw.
    "declaration-block-no-redundant-longhand-properties": [true, { ignoreShorthands: ["grid-template"] }],
    // Stylesheets are imported by a string, as the bundler resolves it.
    "import-notation": "string",
    // Colours are written in six hex digits, as the palette's test reads them (tests/palette.test.ts).
    "color-hex-length": "long",
    // The faces of a font stack keep their names (`Georgia`).
    "value-keyword-case": ["lower", { ignoreProperties: ["/^--font-/"] }],
  },
};
