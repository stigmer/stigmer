/**
 * Navigate to a route using full page load.
 *
 * The Console's static export deployment (output: "export") cannot
 * perform Next.js soft navigation to dynamic routes that were not
 * pre-rendered by generateStaticParams. Nginx's SPA fallback handles
 * full page loads correctly: try_files falls back to /index.html,
 * the app bootstraps, and the router renders from the URL.
 *
 * This function centralizes the workaround so it can be reverted in
 * one place if the Console moves to a server-rendered deployment.
 */
export function navigateTo(path: string): void {
  window.location.href = path;
}
