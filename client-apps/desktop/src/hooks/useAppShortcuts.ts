import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Registers app-level keyboard shortcuts active when Stigmer has focus.
 *
 * | Shortcut         | Action               |
 * |------------------|-----------------------|
 * | Cmd/Ctrl + N     | New session (`/`)     |
 * | Cmd/Ctrl + ,     | Settings              |
 *
 * Uses `metaKey` on macOS and `ctrlKey` on other platforms to match
 * each OS's standard modifier key. Calls `preventDefault()` to
 * suppress any default browser/webview behavior for the bound keys.
 *
 * Mount in the app shell so shortcuts are available on every page.
 */
export function useAppShortcuts(): void {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          navigate("/");
          break;
        case ",":
          e.preventDefault();
          navigate("/settings/runners");
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);
}
