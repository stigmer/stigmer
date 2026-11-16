/**
 * The desktop app's Library landing: the kit's overview, its cards and Add
 * menu going through the router; a card's address is the hash route.
 */

import { useNavigate } from "react-router-dom";
import { LibraryOverview } from "@stigmer/react-sdk/console";

const toHashHref = (path: string) => `#${path}`;

export default function LibraryLanding() {
  const navigate = useNavigate();
  return <LibraryOverview onNavigate={(path) => navigate(path)} toHref={toHashHref} />;
}
