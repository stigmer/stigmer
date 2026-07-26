/**
 * Pure `renderStep` for the API key setup tour. The player, narration, and
 * viewport are supplied by `scenar pack` — this file only maps step data
 * to views.
 *
 * Every beat is the console's API Keys page inside `ManagementShell`;
 * which settled state it depicts comes from `_shared/ApiKeysPage`'s
 * `FlowState`-mirroring union. Beats 2 and 3 share a `contentKey` on
 * purpose: only the form's seeded name changes between them, and the form
 * remounts itself on that seed — a whole-page fade would read as a
 * navigation that never happened.
 */
import type { ReactNode } from "react";
import { BrowserView } from "@scenar/react";
import { ManagementShell } from "../_shared/ManagementShell";
import { ApiKeysPage } from "../_shared/ApiKeysPage";
import { QUICKSTART_API_KEY } from "../_shared/quickstart-workspace";
import type { ApiKeySetupStep } from "./steps";

/**
 * Every beat is the settings zone's API Keys page — one browser window at
 * one route throughout, so the window's contentKey stays stable and only
 * the page content transitions.
 */
function settingsWindow(contentKey: string, children: ReactNode) {
  return (
    <BrowserView url="app.stigmer.ai/settings/api-keys" contentKey="api-keys">
      <ManagementShell activeNav="api-keys" contentKey={contentKey}>
        {children}
      </ManagementShell>
    </BrowserView>
  );
}

export function renderStep(data: ApiKeySetupStep): ReactNode {
  switch (data.view) {
    case "keys-idle":
      return settingsWindow("keys-idle", <ApiKeysPage state={{ phase: "idle" }} />);

    case "create-form":
      return settingsWindow(
        "create-form",
        <ApiKeysPage state={{ phase: "creating", initialName: data.name }} />,
      );

    case "key-created":
      return settingsWindow(
        "key-created",
        <ApiKeysPage
          state={{
            phase: "reveal",
            keyName: QUICKSTART_API_KEY.name,
            rawKey: QUICKSTART_API_KEY.rawKey,
          }}
        />,
      );
  }
}
