/**
 * Session page route — a no-op placeholder.
 *
 * Session content is rendered by `AppShell` via the session navigation
 * context, not by this route component. The route and its
 * `generateStaticParams` still exist so that `next export` produces
 * `/sessions/__placeholder__.html` for the nginx SPA fallback.
 */
export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function Page() {
  return null;
}
