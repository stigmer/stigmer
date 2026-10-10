// Client-side file download via Blob + object URL + anchor click.
//
// The one home of this routine — useExportResource, useExportCSV,
// useExportTranscript and a run's "Make a test case" zip all download
// through it. The pattern is proven inside
// the desktop (Tauri) webview as well as browsers, so SDK components can rely
// on it without a per-host seam.

/**
 * Triggers a browser download of `content` as a UTF-8 text file.
 *
 * @param mimeType - Bare MIME type (e.g. `"text/markdown"`); the UTF-8
 * charset is appended here so callers cannot drift on it.
 */
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  downloadBlob(
    new Blob([content], { type: `${mimeType};charset=utf-8;` }),
    filename,
  );
}

/**
 * Triggers a browser download of `bytes`, such as a zip archive.
 *
 * @param mimeType - Bare MIME type (e.g. `"application/zip"`).
 */
export function downloadBinaryFile(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): void {
  // A copy into a fresh ArrayBuffer: a Blob takes an ArrayBuffer-backed
  // view, and the caller's bytes may sit on a shared buffer.
  downloadBlob(new Blob([bytes.slice()], { type: mimeType }), filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
