// Every check of the frontend, in order, each run whatever the ones before found, then one table of them all: the
// check, its result, what it counted and how long it took. The exit status is 1 when any check failed.
//
//   npm run check                    every check
//   npm run check -- --only eslint   the checks named (a comma-separated list of the names below)
//   npm run check -- --rows <file>   also write the table's rows to a file (tab-separated), for scripts/check.sh
//
// The generated files' checks fetch idtrack's documentation and the benchmarks' results from GitHub (SETUP.md,
// "Checks and tests").
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Check {
  name: string;
  /** What runs: a program of node_modules/.bin or node itself, and its arguments. */
  command: string[];
  /** What the check counted, read from its output (and whether it passed). */
  count: (output: string, passed: boolean) => string;
}

const web = fileURLToPath(new URL("..", import.meta.url));

/**
 * The most warnings ESLint may report (its guards of size: eslint.config.js): the count the code has, so that a new
 * warning fails the check; lowered whenever a function is split, never raised.
 */
const ESLINT_MAX_WARNINGS = 33;
const bin = (name: string) => `node_modules/.bin/${name}`;

const matches = (output: string, pattern: RegExp) => output.match(pattern)?.length ?? 0;
const number = (output: string, pattern: RegExp) => Number(pattern.exec(output)?.[1] ?? 0);
const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** A generated file's check: whether the file is what its source gives. */
const generated = (name: string, script: string): Check => ({
  name,
  command: ["node", script, "--check"],
  count: (_, passed) => (passed ? "current" : "stale"),
});

const CHECKS: Check[] = [
  generated("types", "scripts/generate-types.ts"),
  generated("limitations", "scripts/limitations.ts"),
  generated("idtrack-docs", "scripts/idtrack-docs.ts"),
  generated("benchmarks", "scripts/benchmarks.ts"),
  generated("licences", "scripts/licences.ts"),
  generated("icons", "scripts/icons.ts"),
  {
    name: "prettier",
    command: [bin("prettier"), "--check", "."],
    count: (output) => plural(matches(output, /^\[warn\] (?!Code style issues)\S.*$/gm), "file"),
  },
  {
    name: "eslint",
    command: [bin("eslint"), ".", "--max-warnings", String(ESLINT_MAX_WARNINGS)],
    count: (output) =>
      `${plural(number(output, /\((\d+) errors?,/), "error")}, ${plural(number(output, /, (\d+) warnings?\)/), "warning")} of ${String(ESLINT_MAX_WARNINGS)} allowed`,
  },
  {
    name: "names",
    command: ["node", "scripts/names.ts"],
    count: (output) => plural(number(output, /(\d+) bare names? in/), "bare name"),
  },
  {
    name: "stylelint",
    command: [bin("stylelint"), "**/*.css"],
    count: (output) => plural(number(output, /✖ (\d+) problems?/), "problem"),
  },
  {
    name: "typecheck",
    command: [bin("tsc"), "-b", "--noEmit"],
    count: (output) => plural(matches(output, /error TS\d+/g), "error"),
  },
  {
    name: "knip",
    command: [bin("knip")],
    count: (output) =>
      plural(
        [...output.matchAll(/^[A-Z][\w ]+ \((\d+)\)$/gm)].reduce((sum, m) => sum + Number(m[1]), 0),
        "finding",
      ),
  },
  {
    name: "unit tests",
    command: [bin("vitest"), "run"],
    count: (output) => {
      const failed = number(output, /Tests\s+(\d+) failed/);
      const passed = number(output, /Tests\s+(?:\d+ failed \| )?(\d+) passed/);
      return failed ? `${String(failed)} failed, ${String(passed)} passed` : `${String(passed)} passed`;
    },
  },
];

interface Outcome {
  name: string;
  passed: boolean;
  count: string;
  seconds: number;
}

/** Run one check with its output shown as it comes, and keep the output for its count. */
function run(check: Check): Promise<Outcome> {
  const started = performance.now();
  const [program = "", ...args] = check.command;
  return new Promise((resolve) => {
    // FORCE_COLOR off: the counts are read from plain text.
    const child = spawn(program, args, { cwd: web, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
    let output = "";
    const keep = (chunk: Buffer, to: NodeJS.WriteStream) => {
      output += chunk.toString();
      to.write(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      keep(chunk, process.stdout);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      keep(chunk, process.stderr);
    });
    const done = (passed: boolean) => {
      resolve({
        name: check.name,
        passed,
        count: check.count(output, passed),
        seconds: (performance.now() - started) / 1000,
      });
    };
    child.on("error", (error) => {
      output += String(error);
      done(false);
    });
    child.on("close", (code) => {
      done(code === 0);
    });
  });
}

function table(outcomes: Outcome[]): string {
  const rows = [
    ["check", "result", "count", "time"],
    ...outcomes.map((o) => [o.name, o.passed ? "pass" : "FAIL", o.count, `${o.seconds.toFixed(1)} s`]),
  ];
  const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ");
  return [line(rows[0] ?? []), widths.map((w) => "-".repeat(w)).join("  "), ...rows.slice(1).map(line)].join("\n");
}

const option = (name: string) =>
  process.argv.includes(name) ? (process.argv[process.argv.indexOf(name) + 1] ?? "") : null;
const only = option("--only");
const rows = option("--rows");
const chosen = only === null ? CHECKS : CHECKS.filter((c) => only.split(",").includes(c.name));
if (!chosen.length) {
  console.error(`--only names none of the checks: ${CHECKS.map((c) => c.name).join(", ")}`);
  process.exit(2);
}
const outcomes: Outcome[] = [];
for (const check of chosen) {
  console.log(`\n=== ${check.name}: ${check.command.join(" ")}`);
  outcomes.push(await run(check));
}
const failed = outcomes.filter((o) => !o.passed);
if (rows)
  writeFileSync(
    rows,
    outcomes
      .map((o) => [o.name, o.passed ? "pass" : "FAIL", o.count, `${o.seconds.toFixed(1)} s`].join("\t"))
      .join("\n") + "\n",
  );
console.log(`\nThe frontend's checks (web/):\n${table(outcomes)}`);
console.log(failed.length ? `\n${plural(failed.length, "check")} failed.` : "\nEvery check passed.");
process.exitCode = failed.length ? 1 : 0;
