/**
 * Pure `renderStep` for the Quickstart overview tour. The player, narration,
 * and viewport are supplied by `scenar pack` — this file only maps step data
 * to views.
 *
 * Beat 0 is the console's API Keys page in the reveal state
 * (`_shared/ApiKeysPage` — see its docstring for what each depicted phase
 * shows and hides). Beats 1–4 alternate the reader's editor and terminal
 * inside the quickstart workspace shared with `create-agent-tour` and
 * `connect-tools-tour`, so the Getting Started pages depict one continuous
 * project.
 */
import type { ReactNode } from "react";
import { BrowserView, CodeEditorView, TerminalView } from "@scenar/react";
import { ManagementShell } from "../_shared/ManagementShell";
import {
  QUICKSTART_API_KEY,
  QUICKSTART_FILE_TREE,
  QUICKSTART_WORKSPACE,
} from "../_shared/quickstart-workspace";
import { ApiKeysPage } from "../_shared/ApiKeysPage";
import {
  type QuickstartTourStep,
  CONNECT_CODE,
  CONNECT_HIGHLIGHT_LINES,
  DOMAIN_CODE,
  DOMAIN_FAIL_OUTPUT,
  GENERIC_OUTPUT,
  QUESTION_LINE,
} from "./steps";

export function renderStep(data: QuickstartTourStep): ReactNode {
  switch (data.view) {
    case "api-key-created":
      return (
        <BrowserView url="app.stigmer.ai/settings/api-keys" contentKey="api-keys">
          <ManagementShell activeNav="api-keys" contentKey="api-keys">
            <ApiKeysPage
              state={{
                phase: "reveal",
                keyName: QUICKSTART_API_KEY.name,
                rawKey: QUICKSTART_API_KEY.rawKey,
              }}
            />
          </ManagementShell>
        </BrowserView>
      );

    case "code-connect":
      return (
        <CodeEditorView
          filename={QUICKSTART_WORKSPACE.entryFile}
          lines={CONNECT_CODE}
          highlightLines={CONNECT_HIGHLIGHT_LINES}
          fileTree={QUICKSTART_FILE_TREE}
          workspaceName={QUICKSTART_WORKSPACE.name}
          contentKey="connect"
        />
      );

    case "terminal-generic":
      return (
        <TerminalView
          title={QUICKSTART_WORKSPACE.terminalTitle}
          cwd={QUICKSTART_WORKSPACE.cwd}
          lines={GENERIC_OUTPUT}
          contentKey="generic"
        />
      );

    case "code-domain-question":
      return (
        <CodeEditorView
          filename={QUICKSTART_WORKSPACE.entryFile}
          lines={DOMAIN_CODE}
          highlightLines={[QUESTION_LINE]}
          fileTree={QUICKSTART_FILE_TREE}
          workspaceName={QUICKSTART_WORKSPACE.name}
          contentKey="domain"
          slideDirection="forward"
        />
      );

    case "terminal-domain-fail":
      return (
        <TerminalView
          title={QUICKSTART_WORKSPACE.terminalTitle}
          cwd={QUICKSTART_WORKSPACE.cwd}
          lines={DOMAIN_FAIL_OUTPUT}
          contentKey="domain-fail"
        />
      );
  }
}
