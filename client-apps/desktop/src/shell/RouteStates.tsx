// The desktop router's own states, inside the app's shell: an address that
// leads nowhere, and a page that broke while it drew. Both are the kit's
// page states, so the sidebar stays and the screen says what happened in the
// console's words, where react-router's developer page stood before.

import { isRouteErrorResponse, Link, useNavigate, useRouteError } from "react-router-dom";
import { PageFailure, PageNotFound } from "@stigmer/react-sdk/console";
import type { RenderLink } from "@stigmer/react-sdk";

const routerLink: RenderLink = ({ href, className, children }) => (
  <Link to={href} className={className}>
    {children}
  </Link>
);

/** The `*` route: nothing at this address. */
export function RouteNotFound() {
  return <PageNotFound homeHref="/dashboard" renderLink={routerLink} />;
}

/** The pathless route's `errorElement`: a page that broke, inside the shell. */
export function RouteFailure() {
  const thrown = useRouteError();
  const navigate = useNavigate();
  if (isRouteErrorResponse(thrown) && thrown.status === 404) return <RouteNotFound />;
  const error =
    thrown instanceof Error
      ? thrown
      : new Error(isRouteErrorResponse(thrown) ? `${thrown.status} ${thrown.statusText}` : String(thrown));
  return (
    <PageFailure
      error={error}
      onRetry={() => navigate(0)}
      comfort="Nothing was lost; only this page didn't load."
    />
  );
}
