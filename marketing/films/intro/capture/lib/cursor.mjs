/**
 * Injected cursor overlay — scripted browsers render no OS pointer, so
 * recordings would show a UI reacting to nothing. A macOS-style arrow
 * (owner note at the rough-cut gate: a real pointer, not a dot) mounts in
 * the TOP frame only and is positioned explicitly by the Human driver
 * (lib/human.mjs), never by DOM mouse events: synthetic events are routed
 * to whatever frame is under the point, so an event-listening cursor
 * freezes at an iframe boundary (the embed widget is a cross-origin
 * iframe) while a second one appears inside. Driven positioning keeps one
 * cursor, in page-viewport coordinates, across every frame boundary.
 *
 * Injected via addInitScript so it exists before any page script runs;
 * everything lives under one #stgm-film-cursor node with pointer-events
 * none, so it can never affect the page being filmed.
 */
export const CURSOR_INIT_SCRIPT = `
(() => {
  if (window !== window.top) return; // one cursor, in the top frame only
  if (window.__stgmFilmCursor) return;

  // The classic arrow: dark fill, light outline, tip at the svg origin.
  const ARROW_SVG = [
    '<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">',
    '<path d="M 3 1 L 3 20.5 L 7.8 16.2 L 10.9 23.3 L 14.3 21.8 L 11.2 14.8 L 17.7 14.6 Z"',
    ' fill="#0b0d10" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>',
    '</svg>',
  ].join("");

  const mount = () => {
    const el = document.createElement("div");
    el.id = "stgm-film-cursor";
    el.innerHTML = ARROW_SVG;
    el.style.cssText = [
      "position: fixed",
      "z-index: 2147483647",
      "width: 26px",
      "height: 26px",
      // Hotspot: the arrow tip sits ~(3,1) inside the svg.
      "margin: -1px 0 0 -3px",
      "filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4))",
      "pointer-events: none",
      "left: -100px",
      "top: -100px",
      "transform-origin: 3px 1px",
      "transition: transform 90ms ease",
    ].join(";");
    document.documentElement.appendChild(el);
    window.__stgmFilmCursor = {
      move: (x, y) => {
        el.style.left = x + "px";
        el.style.top = y + "px";
      },
      press: () => {
        el.style.transform = "scale(0.82)";
      },
      release: () => {
        el.style.transform = "scale(1)";
      },
    };
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
`;
