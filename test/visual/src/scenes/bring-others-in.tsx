// The journey's last page, as each moment of it draws: an organization a
// Cloud sign-up named from the email, asked for its company's name before
// anyone is invited; the same organization named, its invite link live and
// nobody else there yet; the team joined, the journey done and the next line
// for a company with customers of its own; and a server that trusts every
// caller, where nobody else can reach it.
//
// The page reads the server's posture, the organization, the viewer's
// permissions and account, its invitations, the organization's access list
// and, on Cloud, the plan's entitlements; each scene answers those calls.
// The newcomer is the fixtures' Ada; the address is the one a sign-up named
// from her email.
import { clone, create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter } from "@connectrpc/connect";
import { GetEntitlementsOutputSchema } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/io_pb";
import { SubscriptionQueryController } from "@stigmer/apis/ai/stigmer/billing/subscription/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { InvitationSchema } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/enum_pb";
import { InvitationQueryController } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/query_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { Feature } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { BringOthersIn, BRING_OTHERS_IN_LINK_DAYS, BRING_OTHERS_IN_LINK_LABEL } from "@stigmer/react-sdk";
import { sampleDate, samples } from "@stigmer/react-sdk/test";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { ACCOUNT, BUSY_WEEK_RUNS, ORGANIZATION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";
import { journeyAnswer, journeyRoutes, MADE_YOURS } from "./journey.tsx";
import { ANTHROPIC_ONLY } from "./models.tsx";

/** Which moment of the page a scene draws. */
export type BringOthersInFace = "unnamed" | "link" | "joined" | "local";

const DAY_MS = 86_400_000;
const ADDRESS = "ada-lovelace";

/** An access-list entry: an account of `mode` with its direct organization role. */
function person(id: string, name: string, role: string, mode = IdentityAccountProvisioningMode.direct) {
  return {
    principal: { kind: "identity_account", id, name, email: "", identityOrigin: { provisioningMode: mode } },
    roles: [{ role: { code: role, name: role }, isInherited: false }],
  };
}

/** The page, as `face` draws it. */
export function bringOthersInScene(face: BringOthersInFace): Drawing {
  const signsIn = face !== "local";
  const organization = clone(OrganizationSchema, ORGANIZATION);
  organization.metadata!.slug = ADDRESS;
  organization.metadata!.name = face === "unnamed" ? ADDRESS : "Ledgerly";
  const live = create(InvitationSchema, {
    metadata: { id: "inv_00000000000000000000000001", org: organization.metadata!.id },
    spec: {
      role: IamRole.member,
      label: BRING_OTHERS_IN_LINK_LABEL,
      expiresAt: timestampFromDate(sampleDate(BRING_OTHERS_IN_LINK_DAYS * DAY_MS)),
    },
    status: { token: "q7Hk2mWx9pLr4tVc", state: InvitationState.active },
  });
  const people = [
    person(ACCOUNT.metadata?.id ?? "", ACCOUNT.metadata?.name ?? "", "owner"),
    ...(face === "joined"
      ? [
          person("ia-sam", "Sam Ortiz", "member"),
          person("ia-priya", "Priya Shah", "admin"),
          // The app's first user, who ticked step 5: the page leaves them out.
          person("ia-dana", "Dana Lee", "member", IdentityAccountProvisioningMode.app_user),
        ]
      : []),
  ];
  return {
    inOrganization: true,
    deploymentMode: signsIn ? "cloud" : "local",
    routes: (router: ConnectRouter) => {
      // The joined team's page reads the journey for its headline: an
      // organization whose agent was made, changed and run (steps 1 to 4);
      // the access list below holds the app's first user (step 5) and the
      // teammates (step 6). Named first, so the services after it win.
      journeyRoutes(MADE_YOURS)(router);
      router.service(RunQueryController, { getRunSummary: () => BUSY_WEEK_RUNS });
      router.service(PlatformQueryController, {
        getServerInfo: () => ({ authenticationRequired: signsIn, singleOrg: !signsIn, version: "0.1.3" }),
        getModelReadiness: () => ANTHROPIC_ONLY,
      });
      router.service(OrganizationQueryController, {
        listMine: () => samples.organizationList([organization]),
        get: () => organization,
        getOnboarding: () =>
          journeyAnswer(MADE_YOURS, signsIn && face === "joined" ? { appUser: "Dana Lee", joined: ["Sam Ortiz", "Priya Shah"] } : {}),
      });
      router.service(GrantQueryController, {
        checkMyPermission: () => ({ isAuthorized: true }),
        listResourceAccessByPrincipal: () => ({ entries: people }),
      });
      router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
      router.service(InvitationQueryController, { list: () => ({ entries: face === "unnamed" ? [] : [live], nextPageToken: "" }) });
      router.service(SubscriptionQueryController, {
        getEntitlements: () =>
          create(GetEntitlementsOutputSchema, { entitlements: { features: [Feature.teams, Feature.child_orgs] } }),
      });
    },
    render: () => (
      <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 className="gallery-visually-hidden">Settings</h1>
        <BringOthersIn
          buildInviteUrl={(token) => `https://app.stigmer.ai/invite/${token}`}
          consoleUrl="https://app.stigmer.ai"
          membersHref="#/settings/members"
        />
      </div>
    ),
  };
}
