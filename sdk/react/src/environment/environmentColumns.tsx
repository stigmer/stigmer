"use client";

import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import type { WorkbenchColumnDef } from "../resource-workbench/types.js";
import { packageCountOf } from "./EnvironmentFields.js";

/** The network an Environment allows, in a list's few words: "Unrestricted" or "Limited · 3 hosts". */
export function describeNetworkShort(environment: Environment): string {
  const networking = environment.spec?.networking;
  if (networking?.type !== NetworkingType.limited) {
    return "Unrestricted";
  }
  const hosts = networking.allowedHosts.length;
  return `Limited · ${hosts} ${hosts === 1 ? "host" : "hosts"}`;
}

/** The packages an Environment installs, in a list's few words: "None" or "4 packages". */
export function describePackagesShort(environment: Environment): string {
  const count = packageCountOf(environment.spec?.packages);
  if (count === 0) {
    return "None";
  }
  return `${count} ${count === 1 ? "package" : "packages"}`;
}

/**
 * Column set for an Environment workbench, shared by every console so the
 * list renders identically everywhere: its name, its network, how many
 * packages it installs, and who can see it. Each row is a full
 * `Environment` from the direct query (`createEnvironmentListFn`).
 *
 * Columns are not sortable: the direct query has one fixed server-side
 * order (newest first), and a sort affordance that did nothing would lie.
 */
export function createEnvironmentColumns(): WorkbenchColumnDef<Environment>[] {
  return [
    {
      id: "name",
      header: "Name",
      cell: (item) => (
        <span className="stg:font-medium stg:text-foreground">{item.metadata?.name || item.metadata?.slug}</span>
      ),
      flex: 2,
    },
    {
      id: "network",
      header: "Network",
      cell: (item) => <span className="stg:text-muted-foreground">{describeNetworkShort(item)}</span>,
      flex: 1.5,
    },
    {
      id: "packages",
      header: "Packages",
      cell: (item) => <span className="stg:text-muted-foreground">{describePackagesShort(item)}</span>,
      flex: 1,
    },
    {
      id: "visibility",
      header: "Visibility",
      cell: (item) => (item.metadata ? <VisibilityBadge visibility={item.metadata.visibility} /> : null),
      flex: 1,
    },
  ];
}
