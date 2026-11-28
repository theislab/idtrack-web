// The files of the site that are written at each build, after `vite build` (npm run build runs it):
// dist/.well-known/security.txt (RFC 9116), whose `Expires` is a year ahead of the build less a day (the RFC asks for
// less than a year), so a deployed build carries a current one; the weekly check of the server (deploy/vm/check.sh)
// says when it nears its end.
//
//   node scripts/site-files.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Where a vulnerability is reported: privately, through the repository's security advisories. */
export const SECURITY_CONTACT = "https://github.com/theislab/idtrack-web/security/advisories/new";

/** The day `Expires` names for a build made at `now`: 364 days later, at midnight UTC. */
export function expiresOf(now: Date): Date {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(day + 364 * 24 * 3600 * 1000);
}

/** security.txt (RFC 9116) for a build made at `now`. */
export function securityTxt(now: Date): string {
  return [
    "# The security contact of IDTrack's web app (RFC 9116). Report a vulnerability privately, through the",
    "# repository's security advisories; questions that are not about security go to its issues.",
    `Contact: ${SECURITY_CONTACT}`,
    `Expires: ${expiresOf(now).toISOString().replace(".000Z", "Z")}`,
    "Preferred-Languages: en, de",
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  mkdirSync(`${dist}/.well-known`, { recursive: true });
  const text = securityTxt(new Date());
  writeFileSync(`${dist}/.well-known/security.txt`, text);
  console.log(`wrote dist/.well-known/security.txt (${text.split("\n").find((l) => l.startsWith("Expires")) ?? ""})`);
}
