/**
 * Injected cursor overlay — scripted browsers render no OS pointer, so
 * recordings would show a UI reacting to nothing. This init script draws
 * a cursor that follows the real (synthetic) mouse events Playwright
 * dispatches, with a press animation on mousedown.
 *
 * Injected via addInitScript so it exists before any page script runs;
 * everything lives under one #stgm-film-cursor node with pointer-events
 * none, so it can never affect the page being filmed.
 */
export const CURSOR_INIT_SCRIPT = `
(() => {
  if (window.__stgmFilmCursor) return;
  window.__stgmFilmCursor = true;
  const mount = () => {
    const dot = document.createElement("div");
    dot.id = "stgm-film-cursor";
    dot.style.cssText = [
      "position: fixed",
      "z-index: 2147483647",
      "width: 22px",
      "height: 22px",
      "margin: -11px 0 0 -11px",
      "border-radius: 50%",
      "background: rgba(255,255,255,0.92)",
      "border: 1.5px solid rgba(0,0,0,0.55)",
      "box-shadow: 0 1px 6px rgba(0,0,0,0.35)",
      "pointer-events: none",
      "left: -100px",
      "top: -100px",
      "transition: transform 90ms ease",
    ].join(";");
    document.documentElement.appendChild(dot);
    window.addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
    }, true);
    window.addEventListener("mousedown", () => { dot.style.transform = "scale(0.7)"; }, true);
    window.addEventListener("mouseup", () => { dot.style.transform = "scale(1)"; }, true);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
`;
