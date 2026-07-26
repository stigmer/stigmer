/**
 * Pure `renderStep` for the First Skill outcome tour. The player, narration,
 * and viewport are supplied by `scenar pack` — this file only maps step data
 * to views.
 *
 * Both beats live in the reader's quickstart workspace, continuing the
 * project `quickstart-tour` and `connect-tools-tour` depict on the
 * neighbouring pages. The file tree deliberately stays the shared
 * three-file project: after upload the Skill is a library resource
 * referenced by slug, not a folder in the reader's project, so showing a
 * local `return-policy/` here would teach the wrong model.
 */
import type { ReactNode } from "react";
import { CodeEditorView, TerminalView } from "@scenar/react";
import {
  QUICKSTART_FILE_TREE,
  QUICKSTART_WORKSPACE,
} from "../_shared/quickstart-workspace";
import {
  type FirstSkillTourStep,
  EXPERT_OUTPUT,
  SKILL_REFS_CODE,
  SKILL_REFS_HIGHLIGHT_LINE,
} from "./steps";

export function renderStep(data: FirstSkillTourStep): ReactNode {
  switch (data.view) {
    case "code-skill-refs":
      return (
        <CodeEditorView
          filename={QUICKSTART_WORKSPACE.entryFile}
          lines={SKILL_REFS_CODE}
          highlightLines={[SKILL_REFS_HIGHLIGHT_LINE]}
          fileTree={QUICKSTART_FILE_TREE}
          workspaceName={QUICKSTART_WORKSPACE.name}
          contentKey="skill-refs"
        />
      );

    case "terminal-expert":
      return (
        <TerminalView
          title={QUICKSTART_WORKSPACE.terminalTitle}
          cwd={QUICKSTART_WORKSPACE.cwd}
          lines={EXPERT_OUTPUT}
          contentKey="expert"
        />
      );
  }
}
