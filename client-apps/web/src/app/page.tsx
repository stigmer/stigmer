/**
 * Home page route — a no-op placeholder.
 *
 * The `SessionLauncher` is rendered by `AppShell` via the session
 * navigation context, not by this route component. The route exists
 * so Next.js static export produces `/index.html` for nginx to serve.
 */
export default function HomePage() {
  return null;
}
