"use client";

/**
 * The install preview and the Install button: what `stigmer validate -f`
 * prints, in a dialog.
 *
 * A user about to install reads the same facts in the same words as the
 * CLI's author does offline: the plugin's name, version and format; what
 * it installs (skills, MCP servers, sub-agents, the variables its tools
 * will ask for); the reader's warnings; what is not installed. Then one
 * fact the CLI states in its output and this dialog states before the
 * act: whether the organization already holds this exact version, or an
 * earlier one an install would replace (the agent is re-created, so a
 * session bound to the old one does not follow).
 *
 * Visibility is the kind's default, as `SkillUploader` leaves it; the
 * plugin's page changes it afterwards through Manage access, which
 * reaches every installed resource.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@stigmer/theme";
import type { PluginPackage } from "@stigmer/plugin-package";
import { DIALECT_LABELS } from "@stigmer/plugin-package/client";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogShell } from "../internal/DialogShell.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import type { OpenedMarketplace } from "./sources/read.js";
import { PluginReadRefusal } from "./sources/read.js";
import { type InstallPluginOutcome, useInstallPlugin } from "./useInstallPlugin.js";
import { type InstallRelation, usePreparePluginInstall } from "./usePreparePluginInstall.js";

/** Props for {@link PluginInstallDialog}. */
export interface PluginInstallDialogProps {
  /** The opened marketplace the entry belongs to; `null` closes the dialog. */
  readonly opened: OpenedMarketplace | null;
  /** The name of the entry to install; `null` closes the dialog. */
  readonly entryName: string | null;
  /** The marketplace's name as the user knows it, kept in the version message. */
  readonly marketplaceName: string;
  /** The organization to install into. */
  readonly org: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called after a successful install with the plugin and its members. */
  readonly onInstalled?: (outcome: InstallPluginOutcome) => void;
  readonly className?: string;
}

/**
 * Previews a marketplace entry as the CLI describes it and installs it on
 * confirmation.
 *
 * @example
 * ```tsx
 * <PluginInstallDialog
 *   opened={opened}
 *   entryName={selected}
 *   marketplaceName="cursor-plugins"
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
  marketplaceName,
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
          marketplaceName={marketplaceName}
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
  marketplaceName,
  org,
  onClose,
  onInstalled,
}: {
  readonly opened: OpenedMarketplace;
  readonly entryName: string;
  readonly marketplaceName: string;
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
      const result = await install(prepared, { org, installedFrom: marketplaceName });
      setOutcome(result);
      onInstalled?.(result);
    } catch {
      // The hook holds the error; it is rendered below.
    }
  }, [prepared, install, org, marketplaceName, onInstalled]);

  const title = relation === "upgrade" ? `Upgrade ${entryName}` : `Install ${entryName}`;

  return (
    <div className="stg:flex stg:flex-col stg:gap-5">
      <header className="stg:flex stg:items-start stg:justify-between stg:gap-4">
        <div>
          <h2 className="stg:text-base stg:font-semibold stg:text-foreground">{title}</h2>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
            From {marketplaceName} ({opened.tree.describe}) into {org}
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

      {prepared && !isPreparing && (
        <>
          <PackageDescription plugin={prepared.plugin} filesIncluded={prepared.stats.filesIncluded} />
          {prepared.warnings.length > 0 && (
            <Block title="Warnings">
              <ul className="stg:list-disc stg:space-y-1 stg:pl-5 stg:text-sm stg:text-foreground">
                {prepared.warnings.map((warning, index) => (
                  <li key={`${warning.kind}:${index}`}>{warning.message}</li>
                ))}
              </ul>
            </Block>
          )}
          {prepared.plugin.ignored.length > 0 && (
            <Block title="Not installed">
              <ul className={cn(UNSTYLED_LIST, "stg:space-y-0.5 stg:text-sm stg:text-muted-foreground")}>
                {prepared.plugin.ignored.map((component) => (
                  <li key={component.path}>
                    {component.kind} <span className="stg:font-mono stg:text-xs">({component.path})</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
          {relation && <RelationNotice relation={relation} name={prepared.plugin.name} />}
        </>
      )}

      {installError && <ErrorMessage error={installError} title="The server refused the install" />}

      {outcome && (
        <div role="status" className="stg:rounded-md stg:border stg:border-border stg:bg-muted stg:p-3 stg:text-sm stg:text-foreground">
          Installed plugin '{outcome.plugin.metadata?.slug}' ({summarise(outcome)}).
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

/** The `Installs` description, the CLI's sections in the CLI's words. */
function PackageDescription({ plugin, filesIncluded }: { readonly plugin: PluginPackage; readonly filesIncluded: number }) {
  return (
    <>
      <Block title="Plugin">
        <Rows
          rows={[
            ["Name", plugin.name],
            ["Version", plugin.version ?? ""],
            ["Format", DIALECT_LABELS[plugin.dialect]],
            ["Files", `${filesIncluded} read`],
          ]}
        />
      </Block>
      <Block title="Installs">
        <Rows
          rows={[
            ["Skills", named(plugin.skills.map((s) => s.name))],
            ["MCP servers", named(plugin.mcpServers.map((s) => `${s.name} (${s.transport})`))],
            ["Sub-agents", named(plugin.subAgents.map((a) => a.name))],
            [
              "Variables",
              named(
                plugin.variables.map(
                  (v) => `${v.name}${v.optional ? " (optional)" : ""}${v.declaredBy === "inferred" ? " (inferred)" : ""}`,
                ),
              ),
            ],
          ]}
        />
        {plugin.variables.length > 0 && (
          <p className="stg:mt-2 stg:text-xs stg:text-muted-foreground">
            The agent asks for these the first time you start a session on it, and saves them to your personal
            environment.
          </p>
        )}
      </Block>
    </>
  );
}

function RelationNotice({ relation, name }: { readonly relation: InstallRelation; readonly name: string }) {
  switch (relation) {
    case "installed":
      return (
        <p role="status" className="stg:text-sm stg:text-muted-foreground">
          This exact version of '{name}' is already installed; there is nothing to do.
        </p>
      );
    case "upgrade":
      return (
        <p role="status" className="stg:text-sm stg:text-foreground">
          '{name}' is already installed at another version. Upgrading replaces its skills, servers and agent with
          this version's; the agent is re-created, so a session bound to the previous one does not follow.
        </p>
      );
    case "not-installed":
      return null;
    default: {
      const exhaustive: never = relation;
      return exhaustive;
    }
  }
}

/** The reader's refusal with every sentence, the way `validate -f` prints it; any other error as it is. */
function PrepareRefusal({ error, retry }: { readonly error: Error; readonly retry: () => void }) {
  if (error instanceof PluginReadRefusal) {
    return (
      <div role="alert" className="stg:rounded-md stg:border stg:border-destructive stg:p-3 stg:text-sm">
        <p className="stg:font-medium stg:text-foreground">{error.subject}:</p>
        <ul className="stg:mt-1 stg:list-disc stg:space-y-0.5 stg:pl-5 stg:text-foreground">
          {error.errors.map((finding, index) => (
            <li key={`e${index}`}>{finding.message}</li>
          ))}
        </ul>
        {error.warnings.length > 0 && (
          <ul className="stg:mt-2 stg:list-disc stg:space-y-0.5 stg:pl-5 stg:text-muted-foreground">
            {error.warnings.map((finding, index) => (
              <li key={`w${index}`}>{finding.message}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return <ErrorMessage error={error} retry={retry} title="The plugin could not be read" />;
}

function Block({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section>
      <h3 className="stg:mb-1.5 stg:text-xs stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">{title}</h3>
      <div className="stg:rounded-md stg:border stg:border-border stg:p-3">{children}</div>
    </section>
  );
}

function Rows({ rows }: { readonly rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="stg:grid stg:grid-cols-[auto_1fr] stg:gap-x-4 stg:gap-y-1 stg:text-sm">
      {rows
        .filter(([, value]) => value !== "")
        .map(([label, value]) => (
          <div key={label} className="stg:contents">
            <dt className="stg:text-muted-foreground">{label}</dt>
            <dd className="stg:min-w-0 stg:break-words stg:text-foreground">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function named(items: readonly string[]): string {
  return items.length === 0 ? "none" : `${items.length}: ${items.join(", ")}`;
}

function summarise(outcome: InstallPluginOutcome): string {
  const counts = outcome.plugin.status?.materialized;
  const parts = [
    count(counts?.skills ?? 0, "skill"),
    count(counts?.mcpServers ?? 0, "MCP server"),
    count(counts?.agents ?? 0, "agent"),
  ];
  if (counts !== undefined && counts.workflows > 0) parts.push(count(counts.workflows, "workflow"));
  return parts.join(", ");
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
