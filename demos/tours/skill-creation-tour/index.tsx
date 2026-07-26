import type { CSSProperties, ReactNode } from "react";
import { SkillDetailView, SkillUploader } from "@stigmer/react";
import { BrowserView, CodeEditorView, type FileTreeEntry } from "@scenar/react";
import { AppShell } from "../_shared/AppShell";
import { ResourceListPage } from "../_shared/ResourceListPage";
import { DEMO_ORG } from "../_shared/fixtures";
import {
  type SkillCreationTourStep,
  ALL_SKILLS,
  EXISTING_SKILLS,
  SKILL_MD,
  SKILL_SLUG,
} from "./steps";

const SKILL_MD_LINES = SKILL_MD.split("\n");

/** Single-file skill workspace shown in the editor prologue. */
const FILE_TREE: FileTreeEntry[] = [{ name: "SKILL.md", type: "file", depth: 0 }];

/** Placeholder content area before the tour navigates anywhere. */
const HOME_HINT: CSSProperties = {
  display: "flex",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  fontSize: 12,
  color: "var(--stgm-muted-foreground)",
};

/** Centers the uploader drop zone in the content area. */
const UPLOADER_WRAP: CSSProperties = {
  display: "flex",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};

/**
 * Sizes the real SkillUploader like the console's upload page card. One
 * scale factor per frame — no zoom; the card lays out at real size.
 */
const UPLOADER_CARD: CSSProperties = {
  width: 560,
};

/**
 * Scrollable library-detail frame at the zone's real geometry
 * (`mx-auto max-w-4xl px-6 py-8`).
 */
const DETAIL_SCROLL: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: "32px 24px",
};
const DETAIL_CONTENT: CSSProperties = {
  margin: "0 auto",
  maxWidth: "56rem",
};

/**
 * Console beats render inside a browser window whose address bar tracks the
 * depicted route — a screen recording shows an app in its container. The
 * editor prologue keeps its own window chrome (`CodeEditorView`).
 */
function consoleWindow(contentKey: string, path: string, children: ReactNode) {
  return (
    <BrowserView url={`app.stigmer.ai${path}`} contentKey={contentKey}>
      {children}
    </BrowserView>
  );
}

/**
 * Pure `renderStep`: maps a step's data to the view it renders. The player,
 * cursor, narration, and viewport are supplied by `scenar pack` (embed) and
 * `scenar render` (video) — this stays declarative. Cursor targets referenced
 * by the steps' interactions: `library` and `create-skill` come from the
 * shared chrome; `skill-dropzone` is the wrapper around the real
 * SkillUploader's drop zone.
 */
export function renderStep(data: SkillCreationTourStep): ReactNode {
  switch (data.view) {
    case "editor":
      return (
        <CodeEditorView
          filename="SKILL.md"
          lines={SKILL_MD_LINES}
          // 0-based: the frontmatter's name + description lines
          highlightLines={[1, 2]}
          fileTree={FILE_TREE}
          workspaceName="return-policy"
          contentKey="skill-md"
        />
      );

    case "library-click":
      return consoleWindow(
        "home",
        "/",
        <AppShell highlightNav="library" contentKey="home">
          <div style={HOME_HINT}>Start a new session</div>
        </AppShell>,
      );

    case "skills-list":
      return consoleWindow(
        "skills",
        "/library/skills",
        <AppShell activeNav="library" contentKey="skills" slideDirection="forward">
          <ResourceListPage
            title="Skills"
            createLabel="Add Skill"
            cursorTarget="create-skill"
            items={EXISTING_SKILLS}
          />
        </AppShell>,
      );

    case "create-skill-click":
      return consoleWindow(
        "skills",
        "/library/skills",
        <AppShell activeNav="library" contentKey="skills">
          <ResourceListPage
            title="Skills"
            createLabel="Add Skill"
            cursorTarget="create-skill"
            items={EXISTING_SKILLS}
            highlightCreate
          />
        </AppShell>,
      );

    case "uploader":
      return consoleWindow(
        "upload",
        "/library/skills/new",
        <AppShell activeNav="library" contentKey="upload" slideDirection="forward">
          <div style={UPLOADER_WRAP}>
            <div style={UPLOADER_CARD} data-cursor-target="skill-dropzone">
              <SkillUploader org={DEMO_ORG} />
            </div>
          </div>
        </AppShell>,
      );

    case "skill-detail":
      return consoleWindow(
        "detail",
        `/library/skills/${SKILL_SLUG}`,
        <AppShell activeNav="library" contentKey="detail" slideDirection="forward">
          <div style={DETAIL_SCROLL}>
            <div style={DETAIL_CONTENT}>
              <SkillDetailView org={DEMO_ORG} slug={SKILL_SLUG} />
            </div>
          </div>
        </AppShell>,
      );

    case "library-complete":
      return consoleWindow(
        "skills",
        "/library/skills",
        <AppShell activeNav="library" contentKey="skills" slideDirection="backward">
          <ResourceListPage
            title="Skills"
            createLabel="Add Skill"
            cursorTarget="create-skill"
            items={ALL_SKILLS}
            showNewItem
          />
        </AppShell>,
      );
  }
}
