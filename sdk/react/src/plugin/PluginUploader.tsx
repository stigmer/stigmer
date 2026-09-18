"use client";

/**
 * Upload plugin: a folder or a `.zip` from the user's computer, previewed
 * as the CLI describes it, then pushed. The console's `stigmer push plugin`.
 *
 * Two phases, the `SkillUploader` shape: a drop zone that takes a plugin
 * folder (dropped, or picked through a directory input) or a zip of one;
 * then the preview (`InstallPreview`, the one every install path renders)
 * with Install. A Cursor, Claude Code, Codex or Agent Plugins folder
 * installs unchanged, and the archive pushed is rebuilt deterministically
 * from the selected files, so the digest is the one the CLI prints for the
 * same folder; the preview says so.
 *
 * The folder pick depends on the browser handing over dotfiles
 * (`.cursor-plugin/plugin.json` lives in one); when a folder arrives with
 * no manifest at all, the refusal adds the sentence naming the zip as the
 * path that always works, because the reader's own sentence cannot know
 * why the file is missing.
 *
 * Visibility is the kind's default, as `SkillUploader` leaves it; the
 * plugin's page changes it afterwards.
 */

import { type DragEvent, useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { UploadIcon } from "../internal/UploadIcon.js";
import { InstallPreview, PrepareRefusal, describeOrigin } from "./InstallPreview.js";
import { summariseInstall } from "./PluginInstallDialog.js";
import type { PreparedInstall } from "./sources/read.js";
import { type InstallPluginOutcome, useInstallPlugin } from "./useInstallPlugin.js";
import { useInstallRelation } from "./useInstallRelation.js";
import { type PluginUploadPhase, looksLikeDroppedDotfiles, usePluginUpload } from "./usePluginUpload.js";

/** Props for {@link PluginUploader}. */
export interface PluginUploaderProps {
  /** The organization to install into. */
  readonly org: string;
  /** Called after a successful install; the host navigates to the plugin's page. */
  readonly onComplete?: (outcome: InstallPluginOutcome) => void;
  readonly onCancel?: () => void;
  readonly className?: string;
}

const DOTFILE_HINT =
  "No manifest was found in the folder. Some browsers leave out files and folders whose names begin with a dot when a folder is picked, and a Cursor or Claude Code plugin keeps its manifest in one; zip the folder and upload the .zip instead.";

/**
 * Upload a plugin folder or zip and install it.
 *
 * @example
 * ```tsx
 * <PluginUploader org={org} onComplete={({ plugin }) => navigateToDetail("plugins", org, plugin.metadata.slug)} />
 * ```
 */
export function PluginUploader({ org, onComplete, onCancel, className }: PluginUploaderProps) {
  const upload = usePluginUpload();
  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
      {upload.phase.kind === "prepared" ? (
        <PreviewPhase prepared={upload.phase.prepared} org={org} onBack={upload.reset} onComplete={onComplete} />
      ) : (
        <DropZonePhase upload={upload} onCancel={onCancel} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 1: the drop zone
// ---------------------------------------------------------------------------

function DropZonePhase({
  upload,
  onCancel,
}: {
  readonly upload: ReturnType<typeof usePluginUpload>;
  readonly onCancel?: () => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const { phase } = upload;
  const busy = phase.kind === "preparing";

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      void upload.fromDrop(event.dataTransfer.items, event.dataTransfer.files);
    },
    [upload],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsDragOver(false);
        }}
        onDrop={handleDrop}
        aria-label="Upload a plugin"
        className={cn(
          "stg:flex stg:flex-col stg:items-center stg:justify-center stg:gap-3 stg:rounded-lg stg:border-2 stg:border-dashed stg:p-12 stg:transition-colors",
          isDragOver ? "stg:border-primary stg:bg-muted-subtle" : "stg:border-border",
          busy && "stg:pointer-events-none stg:opacity-60",
        )}
      >
        <UploadIcon className={cn("stg:size-10 stg:text-muted-foreground", isDragOver && "stg:text-primary")} />
        {busy ? (
          <p className="stg:flex stg:items-center stg:gap-2 stg:text-sm stg:font-medium stg:text-foreground" role="status">
            <SpinnerIcon className="stg:size-4" />
            Reading {phase.name}…
          </p>
        ) : (
          <>
            <p className="stg:text-sm stg:font-medium stg:text-foreground">Drop a plugin folder or a .zip of one here</p>
            <div className="stg:flex stg:gap-2">
              <Button variant="outline" size="sm" onClick={() => folderInputRef.current?.click()}>
                Choose a folder
              </Button>
              <Button variant="outline" size="sm" onClick={() => zipInputRef.current?.click()}>
                Choose a .zip
              </Button>
            </div>
          </>
        )}
        <p className="stg:mt-2 stg:text-[10px] stg:text-muted-foreground-subtle">
          A Cursor, Claude Code, Codex or Agent Plugins folder installs unchanged.
        </p>

        {/* `webkitdirectory` is not in React's attribute types (a WebKit-born attribute every engine honours), so it is set on the element. */}
        <input
          ref={(element) => {
            folderInputRef.current = element;
            element?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          onChange={(event) => {
            const { files } = event.target;
            if (files && files.length > 0) void upload.fromFolderInput(files);
            event.target.value = "";
          }}
          className="stg:hidden"
          aria-hidden="true"
          data-testid="plugin-folder-input"
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload.fromZip(file);
            event.target.value = "";
          }}
          className="stg:hidden"
          aria-hidden="true"
          data-testid="plugin-zip-input"
        />
      </div>

      {phase.kind === "refused" && (
        <PrepareRefusal error={phase.error} {...(looksLikeDroppedDotfiles(phase) && { hint: DOTFILE_HINT })} />
      )}

      {onCancel && (
        <div className="stg:flex stg:justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase 2: the preview and Install
// ---------------------------------------------------------------------------

function PreviewPhase({
  prepared,
  org,
  onBack,
  onComplete,
}: {
  readonly prepared: PreparedInstall;
  readonly org: string;
  readonly onBack: () => void;
  readonly onComplete?: (outcome: InstallPluginOutcome) => void;
}) {
  const relation = useInstallRelation(prepared, org);
  const { install, isInstalling, error: installError } = useInstallPlugin();
  const [outcome, setOutcome] = useState<InstallPluginOutcome | null>(null);

  const handleInstall = useCallback(async () => {
    try {
      const result = await install(prepared, { org });
      setOutcome(result);
      onComplete?.(result);
    } catch {
      // The hook holds the error; it is rendered below.
    }
  }, [install, prepared, org, onComplete]);

  const verb = relation.relation === "upgrade" ? "Upgrade" : "Install";

  return (
    <div className="stg:flex stg:flex-col stg:gap-5">
      <header>
        <h2 className="stg:text-base stg:font-semibold stg:text-foreground">
          {verb} {prepared.plugin.name}
        </h2>
        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
          From {describeOrigin(prepared.origin)} into {org}. The archive is rebuilt from the selected files, so its digest is
          the one `stigmer push plugin` prints for this folder.
        </p>
      </header>

      <InstallPreview prepared={prepared} relation={relation.relation} />

      {relation.error && <ErrorMessage error={relation.error} title="The organization could not be asked what it holds" />}
      {installError && <ErrorMessage error={installError} title="The server refused the install" />}

      {outcome && (
        <div role="status" className="stg:rounded-md stg:border stg:border-border stg:bg-muted stg:p-3 stg:text-sm stg:text-foreground">
          Installed plugin '{outcome.plugin.metadata?.slug}' ({summariseInstall(outcome)}).
        </div>
      )}

      <footer className="stg:flex stg:justify-end stg:gap-2 stg:pt-1">
        <Button variant="outline" size="sm" onClick={onBack} disabled={isInstalling}>
          {outcome ? "Upload another" : "Choose a different plugin"}
        </Button>
        {!outcome && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleInstall}
            disabled={isInstalling || relation.isLoading || relation.relation === "installed"}
          >
            {isInstalling ? "Installing…" : verb}
          </Button>
        )}
      </footer>
    </div>
  );
}

export type { PluginUploadPhase };
