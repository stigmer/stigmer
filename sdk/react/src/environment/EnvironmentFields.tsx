"use client";

/**
 * The two halves of an Environment a person writes, shared by the create
 * form and the detail page's editors: its network (`NetworkingFields`)
 * and its packages (`PackagesFields`).
 *
 * The fields hold drafts (the text a person types) and the helpers turn a
 * stored Environment into a draft and a draft into the SDK's input. No
 * copy of the server's grammar lives here: lines are trimmed and blanks
 * dropped, and a host or a package the server does not admit is refused
 * at save with a sentence that names it, shown under the form. What the
 * server's sandboxes cannot do at all is said before anyone tries
 * (`useEnvironmentAvailability`): "Limited" is offered disabled where they
 * cannot limit networking, the package boxes where they cannot install.
 * A server that has not said offers both, and its refusal speaks.
 */
import { useId } from "react";
import { cn } from "@stigmer/design-tokens";
import type { EnvironmentAvailability, EnvironmentNetworkingInput, EnvironmentPackagesInput } from "@stigmer/client";
import {
  NetworkingType,
  type EnvironmentNetworking,
  type EnvironmentPackages,
} from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { useEnvironmentAvailability } from "../server-info.js";
import { LIMITED_NETWORKING_UNAVAILABLE_COPY, PACKAGES_UNAVAILABLE_COPY } from "./copy.js";

/** An Environment's network as a person edits it. */
export interface NetworkingDraft {
  /** Any host, or only the listed ones. */
  readonly type: "unrestricted" | "limited";
  /** The listed hosts, one per line, as typed. */
  readonly hosts: string;
  /** Also allow the public package registries and code hosts. */
  readonly allowPackageManagers: boolean;
  /** Also allow the MCP servers of the conversation's agent. */
  readonly allowMcpServers: boolean;
}

/** The installers an Environment's packages are listed by, in the order the server runs them. */
export const PACKAGE_MANAGERS = ["apt", "cargo", "gem", "go", "npm", "pip"] as const;

/** One installer an Environment lists packages for. */
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** An Environment's packages as a person edits them: one box per installer, one entry per line. */
export type PackagesDraft = Readonly<Record<PackageManager, string>>;

/** What each installer is, and an entry with its own version pin, from the contract's own examples. */
export const PACKAGE_MANAGER_HINTS: Readonly<Record<PackageManager, { readonly label: string; readonly example: string }>> = {
  apt: { label: "apt (Debian packages)", example: "poppler-utils=22.02.0-2" },
  cargo: { label: "cargo (Rust crates)", example: "hyperfine@1.18.0" },
  gem: { label: "gem (Ruby gems)", example: "rails:7.1.0" },
  go: { label: "go (Go programs)", example: "golang.org/x/tools/cmd/goimports@latest" },
  npm: { label: "npm (Node packages)", example: "express@4.18.0" },
  pip: { label: "pip (Python packages)", example: "sqlalchemy==2.0.30" },
};

/** The draft a new Environment starts with: no hosts, no packages. */
export const EMPTY_PACKAGES_DRAFT: PackagesDraft = { apt: "", cargo: "", gem: "", go: "", npm: "", pip: "" };

/** The entries a box holds: each line trimmed, blank lines dropped. */
export function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** A stored network as a draft; unset reads as unrestricted, as the server reads it. */
export function networkingDraftOf(networking: EnvironmentNetworking | undefined): NetworkingDraft {
  return {
    type: networking?.type === NetworkingType.limited ? "limited" : "unrestricted",
    hosts: (networking?.allowedHosts ?? []).join("\n"),
    allowPackageManagers: networking?.allowPackageManagers ?? false,
    allowMcpServers: networking?.allowMcpServers ?? false,
  };
}

/**
 * A draft as the SDK's input. Unrestricted carries nothing else, since the
 * contract refuses hosts or flags beside it; limited carries the listed
 * hosts and both flags.
 */
export function networkingInputOf(draft: NetworkingDraft): EnvironmentNetworkingInput {
  if (draft.type === "unrestricted") {
    return { type: NetworkingType.unrestricted };
  }
  return {
    type: NetworkingType.limited,
    allowedHosts: linesOf(draft.hosts),
    allowPackageManagers: draft.allowPackageManagers,
    allowMcpServers: draft.allowMcpServers,
  };
}

/** Stored packages as a draft. */
export function packagesDraftOf(packages: EnvironmentPackages | undefined): PackagesDraft {
  return {
    apt: (packages?.apt ?? []).join("\n"),
    cargo: (packages?.cargo ?? []).join("\n"),
    gem: (packages?.gem ?? []).join("\n"),
    go: (packages?.go ?? []).join("\n"),
    npm: (packages?.npm ?? []).join("\n"),
    pip: (packages?.pip ?? []).join("\n"),
  };
}

/** A draft as the SDK's input: every installer, empty ones as empty lists, so a save clears what was removed. */
export function packagesInputOf(draft: PackagesDraft): EnvironmentPackagesInput {
  return {
    apt: linesOf(draft.apt),
    cargo: linesOf(draft.cargo),
    gem: linesOf(draft.gem),
    go: linesOf(draft.go),
    npm: linesOf(draft.npm),
    pip: linesOf(draft.pip),
  };
}

/** How many packages a stored set lists, across every installer. */
export function packageCountOf(packages: EnvironmentPackages | undefined): number {
  return PACKAGE_MANAGERS.reduce((total, manager) => total + (packages?.[manager].length ?? 0), 0);
}

/** Props for {@link NetworkingFields}. */
export interface NetworkingFieldsProps {
  readonly value: NetworkingDraft;
  readonly onChange: (next: NetworkingDraft) => void;
  readonly disabled?: boolean;
  /**
   * What the server's sandboxes can do. Defaults to the connected server's
   * answer (`useEnvironmentAvailability`); `undefined` offers everything.
   */
  readonly availability?: EnvironmentAvailability;
  readonly className?: string;
}

/**
 * The network an Environment allows: any host, or only the listed ones,
 * with the package registries and the agent's MCP servers allowed beside
 * them on request.
 *
 * @example
 * ```tsx
 * const [network, setNetwork] = useState(networkingDraftOf(environment.spec?.networking));
 * <NetworkingFields value={network} onChange={setNetwork} />
 * ```
 */
export function NetworkingFields({ value, onChange, disabled = false, availability, className }: NetworkingFieldsProps) {
  const served = useEnvironmentAvailability();
  const support = availability ?? served;
  const limitedUnavailable = support?.limitedNetworking === false;
  const baseId = useId();
  const hintId = `${baseId}-limited-hint`;

  return (
    <fieldset className={cn("stg:space-y-2", className)} disabled={disabled}>
      <legend className={labelClasses}>Network</legend>
      <div className="stg:space-y-1.5">
        <label className="stg:flex stg:items-start stg:gap-2 stg:text-xs stg:text-foreground">
          <input
            type="radio"
            name={`${baseId}-type`}
            checked={value.type === "unrestricted"}
            onChange={() => onChange({ ...value, type: "unrestricted" })}
            className="stg:mt-0.5"
          />
          <span>
            Unrestricted
            <span className={cn(hintClasses, "stg:block")}>The sandbox may reach any website.</span>
          </span>
        </label>
        <label
          className={cn(
            "stg:flex stg:items-start stg:gap-2 stg:text-xs stg:text-foreground",
            limitedUnavailable && "stg:opacity-60",
          )}
        >
          <input
            type="radio"
            name={`${baseId}-type`}
            checked={value.type === "limited"}
            disabled={limitedUnavailable}
            aria-describedby={limitedUnavailable ? hintId : undefined}
            onChange={() => onChange({ ...value, type: "limited" })}
            className="stg:mt-0.5"
          />
          <span>
            Limited to listed websites
            <span id={hintId} className={cn(hintClasses, "stg:block")}>
              {limitedUnavailable
                ? LIMITED_NETWORKING_UNAVAILABLE_COPY
                : "The sandbox may reach only the websites below."}
            </span>
          </span>
        </label>
      </div>

      {value.type === "limited" && (
        <div className="stg:space-y-2 stg:pl-5">
          <div className="stg:space-y-1">
            <label htmlFor={`${baseId}-hosts`} className={labelClasses}>
              Websites
            </label>
            <textarea
              id={`${baseId}-hosts`}
              value={value.hosts}
              onChange={(e) => onChange({ ...value, hosts: e.target.value })}
              placeholder={"api.github.com\n*.example.com"}
              rows={4}
              className={cn(inputClasses, "stg:resize-y stg:font-mono")}
            />
            <p className={hintClasses}>
              One per line, with no scheme or path. <code className="stg:font-mono">*.example.com</code> matches{" "}
              <code className="stg:font-mono">api.example.com</code>, not{" "}
              <code className="stg:font-mono">example.com</code>.
            </p>
          </div>
          <label className="stg:flex stg:items-start stg:gap-2 stg:text-xs stg:text-foreground">
            <input
              type="checkbox"
              checked={value.allowPackageManagers}
              onChange={(e) => onChange({ ...value, allowPackageManagers: e.target.checked })}
              className="stg:mt-0.5"
            />
            <span>
              Also allow package registries and code hosts
              <span className={cn(hintClasses, "stg:block")}>
                npm, PyPI, crates.io, the Go module proxy, RubyGems, the Debian and Ubuntu archives, GitHub and the
                other common code hosts. Packages need it.
              </span>
            </span>
          </label>
          <label className="stg:flex stg:items-start stg:gap-2 stg:text-xs stg:text-foreground">
            <input
              type="checkbox"
              checked={value.allowMcpServers}
              onChange={(e) => onChange({ ...value, allowMcpServers: e.target.checked })}
              className="stg:mt-0.5"
            />
            <span>Also allow this agent&apos;s MCP servers</span>
          </label>
        </div>
      )}
    </fieldset>
  );
}

/** Props for {@link PackagesFields}. */
export interface PackagesFieldsProps {
  readonly value: PackagesDraft;
  readonly onChange: (next: PackagesDraft) => void;
  readonly disabled?: boolean;
  /**
   * What the server's sandboxes can do. Defaults to the connected server's
   * answer (`useEnvironmentAvailability`); `undefined` offers everything.
   */
  readonly availability?: EnvironmentAvailability;
  readonly className?: string;
}

/**
 * The packages installed in every sandbox an Environment governs, one box
 * per installer in the order the server runs them, one entry per line.
 *
 * @example
 * ```tsx
 * const [packages, setPackages] = useState(packagesDraftOf(environment.spec?.packages));
 * <PackagesFields value={packages} onChange={setPackages} />
 * ```
 */
export function PackagesFields({ value, onChange, disabled = false, availability, className }: PackagesFieldsProps) {
  const served = useEnvironmentAvailability();
  const support = availability ?? served;
  const unavailable = support?.packages === false;
  const baseId = useId();

  return (
    <fieldset className={cn("stg:space-y-2", className)} disabled={disabled || unavailable}>
      <legend className={labelClasses}>Packages</legend>
      <p className={hintClasses}>
        {unavailable
          ? PACKAGES_UNAVAILABLE_COPY
          : "Installed before the first turn of every conversation in this environment. One per line, each with its installer's own version pin if you want one."}
      </p>
      <div className="stg:grid stg:grid-cols-1 stg:gap-2 stg:sm:grid-cols-2">
        {PACKAGE_MANAGERS.map((manager) => (
          <div key={manager} className="stg:space-y-1">
            <label htmlFor={`${baseId}-${manager}`} className={labelClasses}>
              {PACKAGE_MANAGER_HINTS[manager].label}
            </label>
            <textarea
              id={`${baseId}-${manager}`}
              value={value[manager]}
              onChange={(e) => onChange({ ...value, [manager]: e.target.value })}
              placeholder={PACKAGE_MANAGER_HINTS[manager].example}
              rows={2}
              className={cn(inputClasses, "stg:resize-y stg:font-mono")}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

const labelClasses = "stg:block stg:text-xs stg:font-medium stg:text-foreground";
const hintClasses = "stg:text-[0.65rem] stg:text-muted-foreground";
const inputClasses = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);
