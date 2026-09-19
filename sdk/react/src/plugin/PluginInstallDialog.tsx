"use client";

/**
 * The Marketplace's install dialog: a source's entry previewed as the CLI
 * describes it, then pushed on confirmation.
 *
 * The dialog owns the preparation (`usePreparePluginInstall`): opening it
 * on an entry fetches the entry's selected files, reads them and asks the
 * organization what it holds. The facts it shows are `InstallPreview`'s,
 * the one preview every console install path renders, so a plugin from a
 * source and a plugin the user uploaded read alike. The push's version
 * message records the source's name, the way `stigmer install` does.
 *
 * Visibility is the kind's default, as `SkillUploader` leaves it; the
 * plugin's page changes it afterwards through Manage access, which
 * reaches every installed resource.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@stigmer/theme";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogShell } from "../internal/DialogShell.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { InstallPreview, PrepareRefusal, describeOrigin } from "./InstallPreview.js";
import type { OpenedMarketplace } from "./sources/read.js";
import { type InstallPluginOutcome, useInstallPlugin } from "./useInstallPlugin.js";
import { usePreparePluginInstall } from "./usePreparePluginInstall.js";

/** Props for {@link PluginInstallDialog}. */
export interface PluginInstallDialogProps {
  /** The opened source the entry belongs to; `null` closes the dialog. */
  readonly opened: OpenedMarketplace | null;
  /** The name of the entry to install; `null` closes the dialog. */
  readonly entryName: string | null;
  /** The source's name as the user knows it (`acme-plugins`), kept in the version message. */
  readonly sourceName: string;
  /** The organization to install into. */
  readonly org: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called after a successful install with the plugin and its members. */
  readonly onInstalled?: (outcome: InstallPluginOutcome) => void;
  readonly className?: string;
}

/**
 * Previews a source's entry as the CLI describes it and installs it on
 * confirmation.
 *
 * @example
 * ```tsx
 * <PluginInstallDialog
 *   opened={opened}
 *   entryName={selected}
 *   sourceName="acme-plugins"
 *   org={org}
 *   open={selected !== null}
 *   onClose={() => setSelected(null)}
 *   onInstalled={({ plugin }) => navigateToDetail("plugins", org, plugin.metadata.slug)}
 * />
 * ```
 */
export function PluginInstallDialog({
  opened,
  entryName,
  sourceName,
  org,
  open,
  onClose,
  onInstalled,
  className,
}: PluginInstallDialogProps) {
  if (!open || opened === null || entryName === null) return null;
  return (
    <DialogShell
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width="lg"
      className={cn("stg:max-h-[85vh] stg:bg-card stg:text-foreground", className)}
      aria-label={`Install ${entryName}`}
    >
      <div className="stg:flex stg:max-h-[85vh] stg:flex-col stg:overflow-y-auto stg:p-6">
        <InstallDialogContent
          opened={opened}
          entryName={entryName}
          sourceName={sourceName}
          org={org}
          onClose={onClose}
          onInstalled={onInstalled}
        />
      </div>
    </DialogShell>
  );
}

function InstallDialogContent({
  opened,
  entryName,
  sourceName,
  org,
  onClose,
  onInstalled,
}: {
  readonly opened: OpenedMarketplace;
  readonly entryName: string;
  readonly sourceName: string;
  readonly org: string;
  readonly onClose: () => void;
  readonly onInstalled?: (outcome: InstallPluginOutcome) => void;
}) {
  const { prepared, relation, isPreparing, error: prepareError, refetch } = usePreparePluginInstall(opened, entryName, org);
  const { install, isInstalling, error: installError, clearError } = useInstallPlugin();
  const [outcome, setOutcome] = useState<InstallPluginOutcome | null>(null);

  useEffect(() => {
    clearError();
    setOutcome(null);
  }, [entryName, clearError]);

  const handleInstall = useCallback(async () => {
    if (!prepared) return;
    try {
      const result = await install(prepared, { org, installedFrom: sourceName });
      setOutcome(result);
      onInstalled?.(result);
    } catch {
      // The hook holds the error; it is rendered below.
    }
  }, [prepared, install, org, sourceName, onInstalled]);

  const title = relation === "upgrade" ? `Upgrade ${entryName}` : `Install ${entryName}`;

  return (
    <div className="stg:flex stg:flex-col stg:gap-5">
      <header className="stg:flex stg:items-start stg:justify-between stg:gap-4">
        <div>
          <h2 className="stg:text-base stg:font-semibold stg:text-foreground">{title}</h2>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
            From {sourceName} ({prepared ? describeOrigin(prepared.origin) : opened.tree.describe}) into {org}
          </p>
        </div>
      </header>

      {isPreparing && (
        <div className="stg:flex stg:items-center stg:gap-2 stg:text-sm stg:text-muted-foreground" role="status">
          <SpinnerIcon className="stg:size-4" />
          Reading the plugin's files…
        </div>
      )}

      {prepareError && <PrepareRefusal error={prepareError} retry={refetch} />}

      {prepared && !isPreparing && <InstallPreview prepared={prepared} relation={relation} />}

      {installError && <ErrorMessage error={installError} title="The server refused the install" />}

      {outcome && (
        <div role="status" className="stg:rounded-md stg:border stg:border-border stg:bg-muted stg:p-3 stg:text-sm stg:text-foreground">
          Installed plugin '{outcome.plugin.metadata?.slug}' ({summariseInstall(outcome)}).
        </div>
      )}

      <footer className="stg:flex stg:justify-end stg:gap-2 stg:pt-1">
        <Button variant="outline" size="sm" onClick={onClose}>
          {outcome ? "Close" : "Cancel"}
        </Button>
        {!outcome && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleInstall}
            disabled={!prepared || isPreparing || isInstalling || relation === "installed"}
          >
            {isInstalling ? "Installing…" : relation === "upgrade" ? "Upgrade" : "Install"}
          </Button>
        )}
      </footer>
    </div>
  );
}

/**
 * "2 skills, 1 MCP server, 1 agent": what the push produced, in the CLI's
 * words. A kind the plugin did not install is not named: most of the
 * catalogue installs tools alone, and "0 skills, 1 MCP server, 0 agents"
 * reads as three facts where there is one. A push that produced nothing
 * says so.
 */
export function summariseInstall(outcome: InstallPluginOutcome): string {
  const counts = outcome.plugin.status?.materialized;
  const parts = [
    [counts?.skills ?? 0, "skill"],
    [counts?.mcpServers ?? 0, "MCP server"],
    [counts?.agents ?? 0, "agent"],
    [counts?.workflows ?? 0, "workflow"],
  ] as const;
  const named = parts.filter(([n]) => n > 0).map(([n, noun]) => count(n, noun));
  return named.length === 0 ? "nothing installed" : named.join(", ");
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
