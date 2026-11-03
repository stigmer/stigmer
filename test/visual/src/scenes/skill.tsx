// The skills page's Skill (docs/concepts/skills.mdx) on its page in the
// console, framed as the Library frames a detail page: the page says the
// description sits at the top as its own section and the rendered body
// below it, so the scene draws that very SKILL.md (docs-fixtures.ts).
import type { ConnectRouter } from "@connectrpc/connect";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { SkillDetailView } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { VARIANCE_REPORT_SKILL } from "../docs-fixtures.ts";
import { ACCOUNT, ORGANIZATION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

function skillRoutes(router: ConnectRouter): void {
  router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
  router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
  router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: true }) });
  router.service(SkillQueryController, {
    getByReference: () => VARIANCE_REPORT_SKILL,
    get: () => VARIANCE_REPORT_SKILL,
    listVersions: () => ({ entries: [] }),
  });
}

/** The variance-report Skill's page, as the person who pushed it sees it. */
export function skillDetailScene(): Drawing {
  return {
    inOrganization: true,
    routes: skillRoutes,
    render: () => (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <SkillDetailView org={ORGANIZATION.metadata?.slug ?? ""} slug={VARIANCE_REPORT_SKILL.metadata?.slug ?? ""} />
      </div>
    ),
  };
}
