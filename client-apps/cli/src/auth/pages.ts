// Minimal HTML pages served by the loopback callback server. Self-contained
// (no external assets) so they render instantly and offline.

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px;color:#1a1a2e">${body}</body></html>`;
}

/** Shown briefly while the user authenticates (only seen on direct navigation). */
export const HOLDING_PAGE = page("Stigmer CLI", "<h2>Stigmer CLI</h2><p>Waiting for authentication…</p>");

/** Shown after a successful login; the user can close the tab and return to the CLI. */
export const SUCCESS_PAGE = page(
  "Stigmer CLI — Success",
  "<h2>✓ Authentication successful</h2><p>You can close this tab and return to your terminal.</p>",
);

/** Shown when Auth0 redirects with an error or no code. */
export function renderErrorPage(message: string, code: string, description: string): string {
  return page(
    "Stigmer CLI — Error",
    `<h2>✗ Authentication failed</h2><p>${escapeHtml(message)}</p><p style="color:#888;font-size:0.9em">${escapeHtml(code)}${description ? `: ${escapeHtml(description)}` : ""}</p>`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
