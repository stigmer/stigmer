// The organization a command acts in, read whole: the one `--org`,
// `STIGMER_ORG` or the context names, or, on a server that holds one
// organization (the open-source edition), that one, since there nothing names
// it. The commands that read or change an organization's own settings
// (`stigmer embedding`, `stigmer app-handover`) need its record, not only a
// value to send.
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { UsageError } from "../errors/usage-error.js";
import { myOrganizations } from "./organizations.js";
import { holdsOneOrganization } from "./single-org.js";

/** The organization `org` names, or the server's one when `org` is empty and it holds one. */
export async function currentOrganization(
  stigmer: Pick<Stigmer, "organization" | "platform">,
  org: string,
  setItWith: readonly string[],
): Promise<Organization> {
  if (org !== "") return stigmer.organization.get(org);
  if (await holdsOneOrganization(stigmer as Stigmer)) {
    const [only] = await myOrganizations(stigmer);
    if (only !== undefined) return only;
  }
  throw new UsageError(
    "organization not set\n\nSet it with:\n" + setItWith.map((line) => `  ${line}`).join("\n"),
  );
}
