/**
 * Execution page route — a no-op placeholder.
 *
 * Execution content is rendered by `AppShell` via the app/execution
 * navigation context, not by this route component. The route and its
 * `generateStaticParams` still exist so that `next export` produces
 * `/executions/__placeholder__.html` for the nginx SPA fallback, which
 * backs deep links and hard reloads to `/executions/<id>`.
 */
export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function Page() {
  return null;
}
