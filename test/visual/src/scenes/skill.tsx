// The skills page's Skill (docs/concepts/skills.mdx) on its page in the
// console, framed as the Library frames a detail page: the page says the
// description sits at the top as its own section and the rendered body
// below it, so the scene draws that very SKILL.md (docs-fixtures.ts).
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { strToU8, zipSync } from "fflate";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
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
        <SkillDetailView headingLevel={1} org={ORGANIZATION.metadata?.slug ?? ""} slug={VARIANCE_REPORT_SKILL.metadata?.slug ?? ""} />
      </div>
    ),
  };
}

// The same Skill as an uploaded package: SKILL.md beside a reference and a
// script, so its page reads as its files (folders on the left, the chosen
// file on the right). The bytes are the zip the server would hand back.
const PACKAGE_FILES: Readonly<Record<string, string>> = {
  "SKILL.md": VARIANCE_REPORT_SKILL.spec?.skillMd ?? "",
  "references/report-template.md": "# Variance report\n\nA two-sentence summary of the quarter, then one table of every account.\n",
  "references/chart-of-accounts.csv": "account,name\n4000,Revenue\n6100,Marketing\n",
  "scripts/variance.py": [
    "import csv",
    "",
    "def variance(row):",
    '    budget = float(row["budget"])',
    '    actual = float(row["actual"])',
    "    return actual - budget, (actual - budget) / budget if budget else None",
    "",
    'with open("ledger.csv") as f:',
    "    for row in csv.DictReader(f):",
    '        print(row["account"], *variance(row))',
    "",
  ].join("\n"),
};

const PACKAGED_SKILL = create(SkillSchema, {
  apiVersion: VARIANCE_REPORT_SKILL.apiVersion,
  kind: VARIANCE_REPORT_SKILL.kind,
  metadata: VARIANCE_REPORT_SKILL.metadata,
  spec: VARIANCE_REPORT_SKILL.spec,
  status: { audit: VARIANCE_REPORT_SKILL.status?.audit, artifactStorageKey: "skills/variance-report/1.zip" },
});

/** What the package read does: hands back the zip, or fails. */
function packagedSkillRoutes(router: ConnectRouter, readFails = false): void {
  router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
  router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
  router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: true }) });
  router.service(SkillQueryController, {
    getByReference: () => PACKAGED_SKILL,
    get: () => PACKAGED_SKILL,
    listVersions: () => ({ entries: [] }),
    // No download address on this server: the page reads the bytes in one call.
    getArtifactDownloadUrl: () => {
      throw new ConnectError("no transfer lane", Code.Unimplemented);
    },
    getArtifact: () => {
      if (readFails) throw new ConnectError("the file store did not answer", Code.Unavailable);
      return { artifact: zipSync(Object.fromEntries(Object.entries(PACKAGE_FILES).map(([path, text]) => [path, strToU8(text)]))) };
    },
  });
}

/** The variance-report Skill as an uploaded package of four files: its files (SKILL.md open), its Versions tab, or a package that won't read. */
export function skillFilesScene(state: "files" | "versions" | "failed" = "files"): Drawing {
  return {
    inOrganization: true,
    routes: (router) => packagedSkillRoutes(router, state === "failed"),
    render: () => (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <SkillDetailView
          headingLevel={1}
          org={ORGANIZATION.metadata?.slug ?? ""}
          slug={PACKAGED_SKILL.metadata?.slug ?? ""}
          defaultTab={state === "versions" ? "versions" : undefined}
        />
      </div>
    ),
  };
}
