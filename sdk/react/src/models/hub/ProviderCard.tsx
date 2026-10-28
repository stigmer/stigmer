"use client";

// One model provider as a card: whether it serves the organization and by
// what, the key's details where the key list is readable (Stigmer Cloud),
// where to get a key, the models it unlocks on each engine, and the one act
// the person looking can take. The act follows the server's report and who
// is looking, never a guess: an admin of an organization missing a key gets
// the form, a member the line naming who connects it, a laptop's runner the
// command that gives it a key, a server's runners the person who runs them,
// and a server that cannot see its runners nothing to do here.

import { useId, useState, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ProviderKeyCheck, type ProviderKey } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import { getUserMessage } from "@stigmer/client";
import { ArrowUpRight } from "lucide-react";
import { Button } from "../../button/index.js";
import { CopyButton, useCopy } from "../../internal/CopyBlock.js";
import { UNSTYLED_LIST } from "../../internal/element-resets.js";
import { useProviderKeyActions, type ProviderKeyProvider } from "../../billing/useProviderKeys.js";
import { HARNESS_META, HARNESS_OPTIONS } from "../harness.js";
import { presentationOf } from "../provider-presentation.js";
import type { ModelReadiness, ProviderAvailability, ProviderReadiness } from "../readiness.js";
import { ProviderKeyForm } from "./ProviderKeyForm.js";
import { ProviderMark } from "./ProviderMark.js";

/** A model's readiness with the name the registry gives it. */
export type NamedModelReadiness = ModelReadiness & { readonly displayName: string };

/**
 * What a card offers for its provider, from the server's report and who is
 * looking:
 *
 * - `served`: nothing to fix (an admin may still replace or remove an own key).
 * - `admin-form`: missing from the organization, and the person may manage
 *   its keys: the key form.
 * - `member-line`: missing from the organization, and the person may not:
 *   who connects it.
 * - `local-command`: missing from the runners of a server on this machine:
 *   the command that gives the runner its key.
 * - `runners-line`: missing from the runners of a server elsewhere: whoever
 *   runs them gives them one.
 * - `unknown`: the server cannot see its runners; the key is configured
 *   where the runner runs, and nothing is refused here.
 */
export type ProviderFace = "served" | "admin-form" | "member-line" | "local-command" | "runners-line" | "unknown";

/** Who is looking, for {@link providerFace}. */
export interface ProviderViewer {
  /** Whether the person may save and remove the organization's keys (`can_manage_billing`). */
  readonly canManage: boolean;
  /** Whether the server runs on this machine (the open-source edition's local mode). */
  readonly local: boolean;
}

/** The act a card offers for a provider in `availability`, for `viewer`. */
export function providerFace(availability: ProviderAvailability, viewer: ProviderViewer): ProviderFace {
  if (availability.state === "served") return "served";
  if (availability.state === "unknown") return "unknown";
  if (availability.scope === "runners") return viewer.local ? "local-command" : "runners-line";
  return viewer.canManage ? "admin-form" : "member-line";
}

/** Whether the kit can save a key for `provider` (the key slots the contract names). */
export function isKeyProvider(provider: string): provider is ProviderKeyProvider {
  return provider === "anthropic" || provider === "openai";
}

/** Props for {@link ProviderCard}. */
export interface ProviderCardProps {
  readonly org: string;
  /** The organization's name, for the member's line and the removal's warning. */
  readonly orgName: string;
  readonly report: ProviderReadiness;
  /** The key that serves it, own or inherited, when the key list is readable (Stigmer Cloud). */
  readonly storedKey?: ProviderKey;
  /** The parent organization's name when its key serves; the report's own id otherwise. */
  readonly parentOrgName?: string;
  readonly viewer: ProviderViewer;
  /** The models this provider serves, every engine, with their names. */
  readonly models: readonly NamedModelReadiness[];
  /** Open with the key form showing, with no Cancel (the launcher's first step). */
  readonly initiallyEditing?: boolean;
  /** Drawn as the launcher's first step: more room, its name as a second-level heading, fewer models named. */
  readonly prominent?: boolean;
  /** Called after a key is saved or removed; the caller asks the server again. */
  readonly onChanged?: () => void;
  readonly className?: string;
}

/**
 * One model provider: whether it serves this organization, by what, where
 * to get a key, the models it unlocks on each engine, and the act the
 * person looking can take.
 *
 * @example
 * ```tsx
 * <ProviderCard org={org} orgName="Acme" report={report} viewer={{ canManage: true, local: false }} models={models} />
 * ```
 */
export function ProviderCard({
  org,
  orgName,
  report,
  storedKey,
  parentOrgName,
  viewer,
  models,
  initiallyEditing = false,
  prominent = false,
  onChanged,
  className,
}: ProviderCardProps) {
  const presentation = presentationOf(report.provider);
  const headingId = useId();
  const face = providerFace(report.availability, viewer);
  const keyProvider = isKeyProvider(report.provider) ? report.provider : null;
  const canEdit = face === "admin-form" && keyProvider !== null;
  // Until the person opens or closes the form, `initiallyEditing` decides,
  // once the permission check has said the form is theirs.
  const [editingChoice, setEditing] = useState<boolean | null>(null);
  const editing = editingChoice ?? (initiallyEditing && canEdit);
  const [confirming, setConfirming] = useState(false);
  const actions = useProviderKeyActions();
  const { availability } = report;
  const served = availability.state === "served";
  const ownKey = served && availability.source === "organization" && storedKey !== undefined && storedKey.inheritedFromOrg === "";
  const canReplace = viewer.canManage && ownKey && keyProvider !== null;
  const Heading = prominent ? "h2" : "h3";

  const remove = async (provider: ProviderKeyProvider) => {
    try {
      await actions.removeKey(org, provider);
      setConfirming(false);
      onChanged?.();
    } catch {
      // The hook holds the error; the card shows it.
    }
  };

  const showBody = editing || confirming || face !== "served";

  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "stg:rounded-xl stg:border stg:bg-card stg:text-card-foreground",
        served ? "stg:border-border" : "stg:border-dashed stg:border-border-prominent",
        className,
      )}
    >
      {/* The actions sit beside the name where there is room, and wrap to
          their own row below it on a phone, so the name never squeezes. */}
      <div className={cn("stg:flex stg:flex-wrap stg:items-start stg:gap-3", prominent ? "stg:p-5" : "stg:p-4")}>
        <div className="stg:flex stg:min-w-0 stg:flex-1 stg:basis-64 stg:items-start stg:gap-3">
          <ProviderMark provider={report.provider} served={served} />
          <div className="stg:min-w-0 stg:flex-1">
            <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1">
              <Heading id={headingId} className="stg:text-sm stg:font-semibold stg:text-foreground">
                {presentation.name}
              </Heading>
              <StateLabel availability={availability} local={viewer.local} parentOrgName={parentOrgName} />
            </div>
            <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
              {detailLine(availability, storedKey, presentation.name, viewer.local, parentOrgName)}
            </p>
          </div>
        </div>
        {!editing && !confirming && (canEdit || canReplace) && (
          <div className="stg:flex stg:shrink-0 stg:flex-wrap stg:gap-2">
            {canEdit && (
              <Button size="sm" onClick={() => setEditing(true)}>
                Connect {presentation.name}
              </Button>
            )}
            {canReplace && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Replace key
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                  Remove
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {showBody && (
        <div
          className={cn(
            "stg:space-y-3 stg:border-t stg:border-border",
            prominent ? "stg:px-5 stg:py-4" : "stg:px-4 stg:py-3",
          )}
        >
          {confirming && keyProvider !== null ? (
            <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2">
              <p className="stg:min-w-0 stg:flex-1 stg:text-xs stg:text-foreground">
                {`Remove the ${presentation.name} key? Runs that need ${presentation.name} are refused until a key serves ${orgName} again.`}
              </p>
              <div className="stg:flex stg:gap-2">
                <Button size="sm" variant="destructive" onClick={() => void remove(keyProvider)} disabled={actions.isSubmitting}>
                  {actions.isSubmitting ? "Removing…" : "Remove key"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={actions.isSubmitting}>
                  Cancel
                </Button>
              </div>
              {actions.error && (
                <p role="alert" className="stg:w-full stg:text-xs stg:text-destructive">
                  {getUserMessage(actions.error)}
                </p>
              )}
            </div>
          ) : editing && keyProvider !== null ? (
            <ProviderKeyForm
              org={org}
              provider={keyProvider}
              initialBaseUrl={ownKey ? (storedKey?.baseUrl ?? "") : ""}
              submitLabel={ownKey ? "Replace key" : `Connect ${presentation.name}`}
              onSaved={() => {
                setEditing(false);
                onChanged?.();
              }}
              onCancel={initiallyEditing ? undefined : () => setEditing(false)}
            />
          ) : (
            <ProviderAct face={face} provider={report.provider} orgName={orgName} />
          )}
          {!confirming && face === "admin-form" && presentation.keysUrl !== null && (
            <a
              href={presentation.keysUrl}
              target="_blank"
              rel="noreferrer"
              className="stg:inline-flex stg:items-center stg:gap-1 stg:text-xs stg:text-muted-foreground stg:hover:text-foreground"
            >
              Get a key at {presentation.keysUrlLabel}
              <ArrowUpRight aria-hidden className="stg:size-3" />
            </a>
          )}
        </div>
      )}

      <Unlocks models={models} served={served} prominent={prominent} />
    </article>
  );
}

/** The provider's state in a few words, with a dot that is solid when it serves. */
function StateLabel({
  availability,
  local,
  parentOrgName,
}: {
  readonly availability: ProviderAvailability;
  readonly local: boolean;
  readonly parentOrgName: string | undefined;
}) {
  const served = availability.state === "served";
  return (
    <span
      className={cn(
        "stg:inline-flex stg:items-center stg:gap-1.5 stg:whitespace-nowrap stg:rounded-full stg:border stg:px-2 stg:py-0.5 stg:text-2xs stg:font-medium",
        served ? "stg:border-border stg:bg-success-subtle stg:text-foreground" : "stg:border-border stg:text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "stg:size-1.5 stg:rounded-full",
          served
            ? "stg:bg-success"
            : availability.state === "missing"
              ? "stg:border stg:border-muted-foreground"
              : "stg:bg-muted-foreground",
        )}
      />
      {stateWords(availability, local, parentOrgName)}
    </span>
  );
}

/** What serves a provider, in the server's report. */
type ServedSource = Extract<ProviderAvailability, { readonly state: "served" }>["source"];

/** A served provider's state label, by what serves it; keyed by every source, so a new one cannot be left without words. */
const SERVED_WORDS: Readonly<Record<ServedSource, (served: { readonly local: boolean; readonly parentName: string }) => string>> = {
  organization: () => "Connected",
  parent: ({ parentName }) => `Connected through ${parentName || "the parent organization"}`,
  runners: ({ local }) => (local ? "Set on this machine" : "Set on this server's runners"),
};

/** The state label's words. */
export function stateWords(availability: ProviderAvailability, local: boolean, parentOrgName?: string): string {
  if (availability.state === "missing") return "Not connected";
  if (availability.state === "unknown") return "Configured where the runner runs";
  return SERVED_WORDS[availability.source]({ local, parentName: parentOrgName || availability.parentOrg });
}

/** What {@link ProviderAct} draws an act for. */
interface ActSubject {
  readonly name: string;
  readonly provider: string;
  readonly orgName: string;
}

/**
 * The act for a provider that does not serve, by who is looking; a provider
 * that serves, or one the server cannot see, offers none. Keyed by every
 * face, so a new one cannot be left without its act.
 */
const PROVIDER_ACTS: Readonly<Record<ProviderFace, ((subject: ActSubject) => ReactNode) | null>> = {
  "admin-form": ({ name, orgName }) => (
    <p className="stg:text-xs stg:text-foreground">
      Paste {/^[AEIOU]/.test(name) ? "an" : "a"} {name} API key, and every member of {orgName} can run these
      models. {name} bills {orgName} directly.
    </p>
  ),
  "member-line": ({ name, orgName }) => (
    <p className="stg:text-xs stg:text-foreground">
      An admin of {orgName} connects {name}. Ask one to add its key in Models &amp; providers, and these models
      are ready for everyone in {orgName}.
    </p>
  ),
  "local-command": ({ provider }) => <SetupCommand provider={provider} />,
  "runners-line": ({ name }) => (
    <p className="stg:text-xs stg:text-foreground">
      This server&apos;s runners have no {name} key; whoever runs them gives them one.
    </p>
  ),
  unknown: null,
  served: null,
};

/** The act for a provider that does not serve, by who is looking. */
function ProviderAct({ face, provider, orgName }: { readonly face: ProviderFace; readonly provider: string; readonly orgName: string }) {
  return PROVIDER_ACTS[face]?.({ name: presentationOf(provider).name, provider, orgName }) ?? null;
}

/** Props for {@link SetupCommand}. */
export interface SetupCommandProps {
  /** The server's name for the provider the runner needs a key for. */
  readonly provider: string;
}

/** How a person gives their own machine's runner a provider's key: the commands, with a Copy button. */
export function SetupCommand({ provider }: SetupCommandProps) {
  const setup = presentationOf(provider).runnerSetup;
  const commands = setup?.commands.join("\n") ?? "";
  const { copied, copy } = useCopy(commands);
  if (setup === null) {
    return (
      <p className="stg:text-xs stg:text-foreground">
        This machine&apos;s runner has no {presentationOf(provider).name} key.
      </p>
    );
  }
  return (
    <div className="stg:space-y-1.5">
      <p className="stg:text-xs stg:text-foreground">{setup.lead}</p>
      <div className="stg:flex stg:items-start stg:gap-2 stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2">
        <pre className="stg:m-0 stg:min-w-0 stg:flex-1 stg:overflow-x-auto stg:font-mono stg:text-xs stg:leading-relaxed stg:text-foreground">
          {commands}
        </pre>
        <CopyButton copied={copied} onCopy={copy} />
      </div>
    </div>
  );
}

/** How many models a card names per engine before it counts the rest: fewer on the launcher's narrower card, so a row never wraps. */
function modelsNamed(prominent: boolean): number {
  return prominent ? 3 : 5;
}

/** The models a provider unlocks, by engine. */
function Unlocks({
  models,
  served,
  prominent,
}: {
  readonly models: readonly NamedModelReadiness[];
  readonly served: boolean;
  readonly prominent: boolean;
}) {
  const engines = HARNESS_OPTIONS.map((harness) => ({
    harness,
    models: models.filter((model) => model.harness === harness),
  })).filter((engine) => engine.models.length > 0);
  if (engines.length === 0) return null;
  const named = modelsNamed(prominent);
  return (
    <div
      className={cn(
        "stg:rounded-b-xl stg:border-t stg:border-border stg:bg-muted-faint",
        prominent ? "stg:px-5 stg:py-3" : "stg:px-4 stg:py-3",
      )}
    >
      <p className="stg:mb-2 stg:text-2xs stg:font-medium stg:text-muted-foreground">
        {served ? "Ready to run" : "Unlocks"}
      </p>
      <dl className="stg:space-y-1.5">
        {engines.map(({ harness, models: engineModels }) => (
          // On a phone the engine's name sits above its models, so the
          // models get the card's whole width.
          <div key={harness} className="stg:flex stg:flex-col stg:gap-1 stg:sm:flex-row stg:sm:items-baseline stg:sm:gap-3">
            <dt className="stg:shrink-0 stg:text-2xs stg:text-muted-foreground stg:sm:w-20">{HARNESS_META[harness].label}</dt>
            <dd className="stg:m-0 stg:min-w-0 stg:flex-1">
              <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-wrap stg:gap-1.5")}>
                {engineModels.slice(0, named).map((model) => (
                  <li
                    key={model.modelId}
                    className={cn(
                      "stg:whitespace-nowrap stg:rounded-md stg:border stg:border-border stg:px-1.5 stg:py-0.5 stg:text-2xs",
                      served ? "stg:bg-background stg:text-foreground" : "stg:text-muted-foreground",
                    )}
                  >
                    {model.displayName}
                  </li>
                ))}
                {engineModels.length > named && (
                  <li className="stg:whitespace-nowrap stg:px-1 stg:py-0.5 stg:text-2xs stg:text-muted-foreground">
                    and {engineModels.length - named} more
                  </li>
                )}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The check's words by its value; keyed by every value the contract names, so a new one in this build cannot be left without words. */
const CHECK_WORDS: Readonly<Record<ProviderKeyCheck, ((name: string) => string) | null>> = {
  [ProviderKeyCheck.checked]: (name) => `Checked with ${name}`,
  [ProviderKeyCheck.unchecked]: (name) => `Saved, not checked: ${name} did not answer`,
  [ProviderKeyCheck.provider_key_check_unspecified]: null,
};

/** The words for the save's check with the provider; nothing when the server says nothing. */
export function checkWords(check: ProviderKeyCheck, name: string): string | null {
  // A value newer than this build has no entry, and says nothing either.
  return CHECK_WORDS[check]?.(name) ?? null;
}

/** One line about how the provider serves, or does not serve, this organization. */
function detailLine(
  availability: ProviderAvailability,
  key: ProviderKey | undefined,
  name: string,
  local: boolean,
  parentOrgName: string | undefined,
): string {
  if (availability.state === "missing") {
    if (availability.scope === "organization") return `Runs that need ${name} are refused until a key is added.`;
    return local
      ? `Runs that need ${name} are refused until this machine's runner has a key.`
      : `Runs that need ${name} are refused until this server's runners have a key.`;
  }
  if (availability.state === "unknown") {
    return `This server cannot see its runners' settings: ${name} works if the runner has a key, and a run without one fails there.`;
  }
  if (availability.source === "runners") {
    return local ? `The runner on this machine reaches ${name}.` : `This server's runners reach ${name}.`;
  }
  const parent = parentOrgName || availability.parentOrg;
  if (key === undefined) {
    return availability.source === "parent"
      ? `${parent || "The parent organization"}'s key serves this organization.`
      : "This organization's own key serves it.";
  }
  const parts = [`Key ending in ${key.keyHint}`];
  if (key.inheritedFromOrg !== "") parts.push(`from ${parent || key.inheritedFromOrg} (parent organization)`);
  const checked = checkWords(key.check, name);
  if (checked !== null) parts.push(checked);
  if (key.baseUrl !== "") parts.push(`on ${endpointHost(key.baseUrl)}`);
  if (key.inheritedFromOrg === "" && key.updatedAt !== undefined) {
    parts.push(`saved ${formatDay(timestampDate(key.updatedAt))}${key.createdBy ? ` by ${key.createdBy}` : ""}`);
  }
  parts.push(key.lastUsedAt === undefined ? "not used yet" : `last used ${formatDay(timestampDate(key.lastUsedAt))}`);
  return parts.join(" · ");
}

function endpointHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
