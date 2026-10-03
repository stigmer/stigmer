// Local single-organization target: the open-source edition exactly as it
// ships. It boots the shipped entry (backend/services/stigmer-server's
// dist/main.js), whose open-source unit holds ONE organization: the server
// makes it at its first start, fills it into every request that names none,
// refuses a second one and refuses to delete it.
// Domain: conformance targets.
//
// Everything else is the local target's: trusted-local, no Temporal, an
// ephemeral SQLite store, the same capability matrix but for
// `singleOrganization`. The other local targets boot the library entry
// instead, because their suites create an organization per tenancy and
// prove isolation between organizations, which a server holding one cannot
// host. So this target runs one suite, single-organization.conformance.test.ts
// (`make test-conformance-single-org`), and refuses to provision the extra
// organizations any other suite would ask for.
import { ensureTsServerEntry } from "@stigmer/test-support/ts-build";
import { LocalTarget } from "./local";
import type { CapabilityFlags, PrivilegedScope, TenancyContext } from "./target";

const ONE_ORGANIZATION =
  "local-single-org holds one organization and provisions no other: run only single-organization.conformance.test.ts against it";

export class LocalSingleOrgTarget extends LocalTarget {
  override readonly name: string = "local-single-org";
  // The local matrix, read from an instance that starts nothing until
  // setup(), with the one difference this target exists for.
  override readonly capabilities: CapabilityFlags = {
    ...new LocalTarget().capabilities,
    singleOrganization: true,
  };

  protected override serverEntry(): Promise<string> {
    return ensureTsServerEntry();
  }

  override async provisionTenancy(): Promise<TenancyContext> {
    throw new Error(ONE_ORGANIZATION);
  }

  override async provisionPrivilegedScope(): Promise<PrivilegedScope> {
    throw new Error(ONE_ORGANIZATION);
  }
}
