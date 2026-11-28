// The one order of organisms on the site: the server's (the masthead's list). A view that has some organisms only (those
// the benchmarks measured) shows them in that order.
import { useOrganisms } from "./organisms";

/** `among` in the site's order of organisms (the server's), those the server does not hold after them. */
export function inSiteOrder(among: readonly string[], served: readonly string[]): string[] {
  const at = (o: string) => {
    const i = served.indexOf(o);
    return i < 0 ? served.length + among.indexOf(o) : i;
  };
  return [...among].sort((a, b) => at(a) - at(b));
}

/** The organisms of `among` (else every organism the server holds) in the site's order. */
export function useSiteOrder(among?: readonly string[]): string[] {
  const { organisms } = useOrganisms();
  const served = organisms.map((o) => o.organism);
  return among ? inSiteOrder(among, served) : served;
}
