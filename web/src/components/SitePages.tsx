// The site's own pages, as links in the footer's row about the site (components/shell/SiteFooter.tsx): the legal
// notice, privacy, the licences and the accessibility statement.
import "../styles/sitepages.css";
import { Link } from "./ui";

const SITE_PAGES: [string, string][] = [
  ["/legal", "Legal notice"],
  ["/privacy", "Privacy"],
  ["/licences", "Licences"],
  ["/accessibility", "Accessibility"],
];

export function SitePageLinks() {
  return (
    <>
      {SITE_PAGES.map(([to, name]) => (
        <Link key={to} to={to} className="site-pages__link">
          {name}
        </Link>
      ))}
    </>
  );
}
