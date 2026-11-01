import { Link } from "react-router-dom";
import { SettingsOverview } from "@stigmer/react-sdk/console";

/**
 * The settings landing: the kit's overview of every settings group, each
 * page a router link. The web console draws the same component with its
 * own link.
 */
export default function SettingsLanding() {
  return (
    <SettingsOverview
      renderLink={({ id, href, className, children, "aria-current": ariaCurrent }) => (
        <Link key={id} to={href} className={className} aria-current={ariaCurrent}>
          {children}
        </Link>
      )}
    />
  );
}
