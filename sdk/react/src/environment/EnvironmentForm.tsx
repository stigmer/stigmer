"use client";

/**
 * The form that creates an Environment: its name, what it is for, its
 * network and its packages.
 *
 * Where the server's sandboxes can limit networking, a new Environment
 * starts limited, with the package registries and code hosts allowed and no
 * other host: narrower than unrestricted, and still able to install its
 * packages and clone a repository (a limited Environment that allowed
 * nothing would fail every repository conversation's first turn). Where
 * they cannot, or the server has not said, it starts unrestricted, which is
 * also the contract's own default. The start waits for the server's answer
 * rather than switching under the person's hand once it arrives.
 */
import { type FormEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage, type EnvironmentAvailability } from "@stigmer/client";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { useServerInfo } from "../server-info.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import {
  EMPTY_PACKAGES_DRAFT,
  NetworkingFields,
  PackagesFields,
  networkingInputOf,
  packagesInputOf,
  type NetworkingDraft,
  type PackagesDraft,
} from "./EnvironmentFields.js";
import { EnvironmentsNotOnServerNotice } from "./EnvironmentsNotOnServerNotice.js";
import { useCreateEnvironment } from "./useCreateEnvironment.js";

/** Props for {@link EnvironmentForm}. */
export interface EnvironmentFormProps {
  /** Organization id the Environment is created in (a slug is also accepted). */
  readonly org: string;
  /** Fired with the created Environment after a successful submit. */
  readonly onCreated?: (environment: Environment) => void;
  /** Fired when the person cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root form element. */
  readonly className?: string;
}

/** The network a new Environment starts with on a server that can do `availability`. */
export function startingNetworkOf(availability: EnvironmentAvailability | undefined): NetworkingDraft {
  return availability?.limitedNetworking === true
    ? { type: "limited", hosts: "", allowPackageManagers: true, allowMcpServers: false }
    : { type: "unrestricted", hosts: "", allowPackageManagers: false, allowMcpServers: false };
}

/**
 * Single-page form for creating an Environment.
 *
 * @example
 * ```tsx
 * <EnvironmentForm org="acme" onCreated={(env) => navigate(env)} onCancel={() => navigate(list)} />
 * ```
 */
export function EnvironmentForm(props: EnvironmentFormProps) {
  const { serverInfo, isLoading } = useServerInfo();
  if (isLoading) {
    return null;
  }
  return <EnvironmentFormBody {...props} availability={serverInfo?.environments} />;
}

function EnvironmentFormBody({
  org,
  onCreated,
  onCancel,
  className,
  availability,
}: EnvironmentFormProps & { readonly availability: EnvironmentAvailability | undefined }) {
  const baseId = useId();
  const { create, isCreating, error } = useCreateEnvironment();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [network, setNetwork] = useState<NetworkingDraft>(() => startingNetworkOf(availability));
  const [packages, setPackages] = useState<PackagesDraft>(EMPTY_PACKAGES_DRAFT);

  const canSubmit = name.trim() !== "" && !isCreating;

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;
      const packageInput = packagesInputOf(packages);
      try {
        const created = await create({
          name: name.trim(),
          org,
          ...(description.trim() !== "" ? { description: description.trim() } : {}),
          networking: networkingInputOf(network),
          ...(Object.values(packageInput).some((list) => (list?.length ?? 0) > 0) ? { packages: packageInput } : {}),
        });
        onCreated?.(created);
      } catch {
        // The refusal is shown from the hook's error.
      }
    },
    [canSubmit, create, name, org, description, network, packages, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:max-w-2xl stg:space-y-5", className)} aria-label="New environment">
      <div className="stg:space-y-1">
        <h1 className="stg:text-xl stg:font-semibold stg:text-foreground">New environment</h1>
        <p className={hintClasses}>
          The packages and network access the sandboxes of the agents, routines and conversations that use it get.
        </p>
      </div>

      <EnvironmentsNotOnServerNotice />

      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-name`} className={labelClasses}>
          Name
        </label>
        <input
          id={`${baseId}-name`}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. data-science"
          disabled={isCreating}
          autoFocus
          required
          className={inputClasses}
        />
      </div>

      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-description`} className={labelClasses}>
          Description <span className="stg:font-normal stg:text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={`${baseId}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this environment is for"
          disabled={isCreating}
          rows={2}
          maxLength={500}
          className={cn(inputClasses, "stg:resize-y")}
        />
      </div>

      <NetworkingFields value={network} onChange={setNetwork} disabled={isCreating} availability={availability} />

      <PackagesFields value={packages} onChange={setPackages} disabled={isCreating} availability={availability} />

      {error && (
        <p className="stg:text-xs stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon size={14} />}
          Create environment
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm",
              "stg:text-muted-foreground stg:hover:bg-accent-hover stg:hover:text-foreground",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

const labelClasses = "stg:block stg:text-xs stg:font-medium stg:text-foreground";
const hintClasses = "stg:text-2xs stg:text-muted-foreground";
const inputClasses = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);
