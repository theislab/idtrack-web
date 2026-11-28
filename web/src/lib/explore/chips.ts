// An organism's short name for a chip (Explore's organisms, an organism's page): its common name, capitalised, else
// its binomial.
import { commonName, organismName } from "../organismNames";

export function chipName(organism: string): string {
  const common = commonName(organism);
  return common ? common.charAt(0).toUpperCase() + common.slice(1) : organismName(organism);
}
