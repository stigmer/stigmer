import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * Returns a stable callback that opens the OS native folder picker.
 *
 * Resolves to the selected folder's absolute path, or `null` if the
 * user cancelled the dialog. Designed to be passed directly as the
 * `onBrowseLocalFolder` prop to `SessionComposer` / `WorkspaceEditor`.
 */
export function useNativeFolderPicker(): () => Promise<string | null> {
  return useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select project folder",
    });
    return selected ?? null;
  }, []);
}
