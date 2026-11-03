// sdk-docs target: MDX reference pages for docs/sdk/resources. Byte-parity
// port of sdk_docs.go — per resource: frontmatter + overview (preferring
// the hand-written apis/**/docs/overview.md), client access, methods with
// four-language examples, TypeTable sections for input/method/status types,
// and enum tables; plus commons.mdx, roles.mdx (every shareable kind's
// general access levels and roles, from kind_meta), meta.json, and
// stale-page removal (the one target that cleans its own output directory).

import * as fs from "node:fs";
import * as path from "node:path";

import { marshalIndent } from "../gojson.js";
import { goTrimSpace } from "../internalcomment/internalcomment.js";
import type { EnumSchema, MethodSchema, ServiceSchemaFile } from "./gen-common.js";
import { NON_KIND_PACKAGES } from "./gen-common.js";
import {
  indefiniteArticle,
  isEmptyType,
  isIDType,
  isSpecialType,
  isUpdateInputType,
  pageIteratorName,
  pagedListOf,
  pascalToSnake,
  sdkMethodName,
  tsClientFieldName,
  tsMethodName,
  tsProtoFieldName,
} from "./gen-common.js";
import { pyClientFieldName } from "./lang-names.js";
import {
  DOC_EXAMPLE_ORG,
  DOC_LANGS,
  DocImports,
  docProtoInput,
  docSdkInput,
  javaListOf,
  javaResultType,
  javaStream,
  goStd,
  readPythonPublicNames,
  sdkDeleteInput,
  sdkResourceRef,
  TS_MESSAGE_PARAMS,
  type DocExampleEnv,
  type DocInputField,
  type DocLang,
} from "./sdk-docs-examples.js";
import { pyMethodTypePb2Map } from "./sdk-client-python.js";
import type { IamRoleMetaEntry, KindMetaEntry } from "./resource-kind.js";
import { iamRoleMetaEntries, idPrefixByMetaName, kindMetaEntries, ResourceTier } from "./resource-kind.js";
import type { SdkResourceConfig } from "./sdk-resource-config.js";
import { deriveResourceConfig, loadSpecSchemaWithTypes, META_FIELD_NAMES } from "./sdk-resource-config.js";
import type { FieldSchema, SpecSchema, TypeSchema, TypeSpec } from "./schema.js";
import { readDirSorted } from "./schema.js";

const MD_FENCE = "```";

interface CommonsSchemaFile {
  messageTypes: TypeSchema[] | null;
  enumTypes: EnumSchema[] | null;
}

/** Port of runSDKDocsGeneration. */
export function runSDKDocsGeneration(schemaDir: string, outputDir: string, apisDir: string): void {
  const servicesDir = path.join(schemaDir, "services");
  const entries = readDirSorted(servicesDir);
  fs.mkdirSync(outputDir, { recursive: true });

  // Commons types live on the commons page and are cross-linked from
  // resource pages.
  const commonsTypes = new Set<string>();
  const commonsPath = path.join(servicesDir, "commons.json");
  let commonsSchema: CommonsSchemaFile | null = null;
  try {
    commonsSchema = JSON.parse(fs.readFileSync(commonsPath, "utf8")) as CommonsSchemaFile;
    for (const mt of commonsSchema.messageTypes ?? []) commonsTypes.add(mt.name);
    for (const et of commonsSchema.enumTypes ?? []) commonsTypes.add(et.name);
  } catch {
    commonsSchema = null;
  }

  const slugs: string[] = [];
  // The names the Python package exports: an example imports an SDK type
  // from `stigmer` when it does.
  const pyPublic = readPythonPublicNames(apisDir);

  for (const entry of entries) {
    if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;
    const resource = entry.name.slice(0, -".json".length);
    if (NON_KIND_PACKAGES.has(resource)) continue;

    const schema = JSON.parse(fs.readFileSync(path.join(servicesDir, entry.name), "utf8")) as ServiceSchemaFile;

    const cfg = deriveResourceConfig(schema, schemaDir);
    cfg.idPrefix = idPrefixByMetaName.get(cfg.protoResType) ?? "";

    let specSchema: SpecSchema | null = null;
    let specTypes: TypeSchema[] = [];
    if (cfg.specSchema !== "") {
      [specSchema, specTypes] = loadSpecSchemaWithTypes(path.join(schemaDir, cfg.specSchema));
    }

    const page = generateSDKDocPage(schema, cfg, specSchema, specTypes, apisDir, commonsTypes, pyPublic);
    const slug = docSlug(cfg.protoResType);
    fs.writeFileSync(path.join(outputDir, slug + ".mdx"), page);
    slugs.push(slug);
  }

  if (commonsSchema !== null) {
    fs.writeFileSync(path.join(outputDir, "commons.mdx"), generateCommonsDocPage(commonsSchema));
    slugs.push("commons");
  }

  // Written after the resource pages, so each kind links to its own.
  const rolesPage = generateRolesDocPage(kindMetaEntries(), iamRoleMetaEntries(), new Set(slugs));
  fs.writeFileSync(path.join(outputDir, ROLES_DOC_SLUG + ".mdx"), rolesPage);
  slugs.push(ROLES_DOC_SLUG);

  slugs.sort();

  docWriteMetaJSON(outputDir, slugs);
  docRemoveStalePages(outputDir, slugs);
  process.stderr.write(`sdk-docs: generated ${slugs.length} pages in ${outputDir}\n`);
}

// Deletes .mdx files this run did not produce: the output directory is
// generator-owned in its entirety, and stale pages are invisible
// to the freshness check yet ship as live URLs.
function docRemoveStalePages(outputDir: string, slugs: string[]): void {
  const generated = new Set(slugs.map((slug) => slug + ".mdx"));
  for (const entry of readDirSorted(outputDir)) {
    const name = entry.name;
    if (entry.isDirectory() || !name.endsWith(".mdx") || generated.has(name)) continue;
    fs.unlinkSync(path.join(outputDir, name));
  }
}

function generateCommonsDocPage(schema: CommonsSchemaFile): string {
  const buf: string[] = [];

  buf.push("---\ntitle: Commons\n---\n\n");
  buf.push("{/* Auto-generated by stigmer-codegen. DO NOT EDIT. */}\n\n");
  buf.push("Shared types and enums used across all API resources. Fields on resource\n");
  buf.push("pages that reference these types link here.\n\n");

  const documentedTypes = new Set<string>();
  for (const mt of schema.messageTypes ?? []) documentedTypes.add(mt.name);
  for (const et of schema.enumTypes ?? []) documentedTypes.add(et.name);

  buf.push("## Types\n\n");

  for (const mt of schema.messageTypes ?? []) {
    buf.push(`### ${mt.name}\n\n`);
    if (mt.description !== "") {
      const content = docFirstSentence(mt.description);
      if (content !== "") {
        buf.push(docEscapeMDX(content));
        buf.push("\n\n");
      }
    }
    if (mt.fields.length > 0) {
      buf.push("<TypeTable\n  type={{\n");
      for (const field of mt.fields) {
        docWriteCommonsField(buf, field, documentedTypes);
      }
      buf.push("  }}\n/>\n\n");
    }
  }

  if ((schema.enumTypes ?? []).length > 0) {
    buf.push("## Enums\n\n");
    docWriteEnumTypes(buf, schema.enumTypes ?? []);
  }

  return buf.join("");
}

function docWriteCommonsField(buf: string[], f: FieldSchema, documentedTypes: Set<string>): void {
  const fieldName = tsProtoFieldName(f.protoField);
  const fieldType = docResponseTypeString(f.type);
  const desc = docEscapeJSString(docFirstSentence(f.description));

  let link: string;
  const enumName = docEnumTypeName(f.type);
  if (enumName !== "" && documentedTypes.has(enumName)) {
    link = "#" + enumName.toLowerCase();
  } else {
    link = docResponseFieldTypeLinkWithCommons(f.type, documentedTypes, new Set());
  }

  const props: string[] = [];
  props.push(`type: "${fieldType}"`);
  props.push(`description: "${desc}"`);
  if (link !== "") props.push(`typeDescriptionLink: "${link}"`);
  if (f.required) props.push("required: true");
  buf.push(`    ${fieldName}: { ${props.join(", ")} },\n`);
}

// =========================================================================
// Roles page
// =========================================================================

const ROLES_DOC_SLUG = "roles";

/**
 * The reference page of every kind a role can be granted on, in kind-table
 * order: its edition, the general access levels it offers, and each of its
 * roles with the kind's own sentence (the kindless role_meta sentence where
 * the kind declares none) and whether a team may hold it. Everything but the
 * header comes from kind_meta and role_meta, the entries the SDK's role
 * tables are generated from, so the page says what the server enforces.
 * resourcePages names the resource pages this run wrote; a kind links to its
 * own when it has one.
 */
export function generateRolesDocPage(
  kinds: KindMetaEntry[],
  roles: IamRoleMetaEntry[],
  resourcePages: ReadonlySet<string>,
): string {
  const roleMeta = new Map(roles.map((role) => [role.role, role]));
  const buf: string[] = [];

  buf.push("---\ntitle: Roles and general access\n");
  buf.push("description: What each role allows on every kind of resource that can be shared.\n---\n\n");
  buf.push("{/* Auto-generated by stigmer-codegen from the API contract. DO NOT EDIT. */}\n\n");
  buf.push("Every kind of resource that can be shared declares, in the API contract, the roles that\n");
  buf.push("can be granted on it and what each role allows there. This page is generated from those\n");
  buf.push("declarations, so it says what the server enforces.\n");
  buf.push("[Sharing and access](/docs/concepts/sharing-and-access) explains the model.\n\n");
  buf.push("- **General access** decides who in the organization reaches a resource without being\n");
  buf.push("  added to it: Private, Organization or Child organizations, where the kind offers them.\n");
  buf.push("- **A role** decides what one person, or one team, may do with it.\n");
  buf.push("- **Editions.** The open-source edition grants roles on the organization only. Granting a\n");
  buf.push("  role on one resource to a person or a team is a feature of the Enterprise and Cloud\n");
  buf.push("  editions.\n");
  buf.push("- **Starting a conversation** also needs the organization's Member role or higher. An\n");
  buf.push("  organization Viewer who is a Viewer of an Agent sees how the Agent is set up and starts\n");
  buf.push("  no conversation with it.\n");
  buf.push("- **An organization's admins** own every Agent, Skill and Plugin in it, whatever its\n");
  buf.push("  general access.\n");

  for (const kind of kinds) {
    if (kind.grantableRoles.length === 0) continue;
    buf.push(`\n## ${kind.displayName}\n\n`);

    const facts: string[] = [];
    const edition = rolesDocEdition(kind.tier);
    if (edition !== "") facts.push(edition);
    const pageSlug = kind.displayName.replaceAll(" ", "-").toLowerCase();
    if (resourcePages.has(pageSlug)) facts.push(`[API reference](/docs/sdk/resources/${pageSlug})`);
    if (facts.length > 0) buf.push(facts.join(" ") + "\n\n");

    buf.push(`**General access**: ${rolesDocGeneralAccess(kind)}\n\n`);

    const teamRoles = new Set(kind.teamGrantableRoles);
    const descriptions = new Map(kind.roleDescriptions.map((entry) => [entry.role, entry.description]));
    const withTeams = teamRoles.size > 0;
    buf.push(withTeams ? "| Role | What it allows | A team may hold it |\n" : "| Role | What it allows |\n");
    buf.push(withTeams ? "| --- | --- | --- |\n" : "| --- | --- |\n");
    for (const role of kind.grantableRoles) {
      const meta = roleMeta.get(role);
      const cells = [
        rolesDocCell(meta?.displayName ?? String(role)),
        rolesDocCell(descriptions.get(role) ?? meta?.description ?? ""),
      ];
      if (withTeams) cells.push(teamRoles.has(role) ? "Yes" : "No");
      buf.push(`| ${cells.join(" | ")} |\n`);
    }
    if (!withTeams) buf.push("\nNever granted to a team.\n");
  }

  return buf.join("");
}

function rolesDocEdition(tier: ResourceTier): string {
  switch (tier) {
    case ResourceTier.open_source:
      return "Served by every edition.";
    case ResourceTier.enterprise:
      return "Served by the Enterprise and Cloud editions.";
    case ResourceTier.cloud_only:
      return "Served by the Cloud edition.";
    default:
      return "";
  }
}

// The levels a kind offers, Private first and the default marked. A kind
// with no visibility block has no general access setting: it is private,
// and shared only by granting a role.
function rolesDocGeneralAccess(kind: KindMetaEntry): string {
  const visibility = kind.visibility;
  if (visibility === null || (!visibility.supportsOrg && !visibility.supportsChildOrgs)) {
    return "none; it is shared only through the roles below.";
  }
  const levels = [visibility.defaultsToOrg ? "Private" : "Private (the default)"];
  if (visibility.supportsOrg) levels.push(visibility.defaultsToOrg ? "Organization (the default)" : "Organization");
  if (visibility.supportsChildOrgs) levels.push("Child organizations");
  return levels.join(", ") + ".";
}

function rolesDocCell(s: string): string {
  return docEscapeMDX(s).replaceAll("|", "\\|");
}

function docWriteMetaJSON(outputDir: string, pages: string[]): void {
  const meta = { title: "Resources", pages };
  fs.writeFileSync(path.join(outputDir, "meta.json"), marshalIndent(meta) + "\n");
}

// =========================================================================
// Page generation
// =========================================================================

interface DocLangNames {
  ts: string;
  go: string;
  py: string;
  java: string;
}

function generateSDKDocPage(
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  specSchema: SpecSchema | null,
  specTypes: TypeSchema[],
  apisDir: string,
  commonsTypes: Set<string>,
  pyPublic: ReadonlySet<string> | null,
): string {
  const displayName = docDisplayName(cfg.protoResType);
  const hasInputType = specSchema !== null;
  const names: DocLangNames = {
    ts: tsClientFieldName(schema.resource),
    go: cfg.clientName.endsWith("Client") ? cfg.clientName.slice(0, -"Client".length) : cfg.clientName,
    py: pyClientFieldName(schema.resource),
    java: tsClientFieldName(schema.resource),
  };

  const buf: string[] = [];

  let overviewContent: string | null = null;
  if (apisDir !== "") {
    const ovPath = docOverviewFilePath(apisDir, schema.package);
    try {
      const trimmed = goTrimSpace(fs.readFileSync(ovPath, "utf8"));
      if (trimmed.length > 0) overviewContent = trimmed;
    } catch {
      overviewContent = null;
    }
  }

  // Frontmatter — omit description when overview.md provides the body text.
  if (overviewContent !== null) {
    buf.push(`---\ntitle: ${displayName}\n---\n\n`);
  } else {
    const desc = "SDK reference for " + displayName + " resources.";
    buf.push(`---\ntitle: ${displayName}\ndescription: "${docEscapeJSString(desc)}"\n---\n\n`);
  }
  buf.push("{/* Auto-generated by stigmer-codegen. DO NOT EDIT. */}\n\n");

  if (overviewContent !== null) {
    buf.push(overviewContent);
    buf.push("\n\n");
  } else if (specSchema !== null && specSchema.description !== "") {
    const overview = docOverviewSummary(specSchema.description);
    if (overview !== "") {
      buf.push(docEscapeMDX(overview));
      buf.push("\n\n");
    }
  }

  const documentedTypes = docBuildDocumentedTypeSet(cfg, schema, specSchema, specTypes);
  for (const name of commonsTypes) {
    documentedTypes.add(name);
  }

  const methodTypeMap = new Map<string, TypeSchema>();
  for (const mt of schema.methodTypes ?? []) {
    methodTypeMap.set(mt.name, mt);
  }
  const env: DocExampleEnv = {
    schema,
    cfg,
    specTypes: new Map(specTypes.map((t) => [t.name, t])),
    methodTypes: methodTypeMap,
    pyModules: pyMethodTypePb2Map(schema),
    pyPublic,
    imports: new DocImports(),
  };
  // The methods are written first: the imports block "Client Access"
  // shows is what they import.
  const methodsBuf: string[] = [];
  docWriteMethodsWithCommons(methodsBuf, schema, cfg, names, hasInputType, documentedTypes, specSchema, env, commonsTypes);
  docWriteClientAccess(buf, schema, cfg, names, env);
  buf.push(...methodsBuf);

  const typeEmitted = new Set<string>();
  if (specSchema !== null) {
    const typeMap = new Map<string, TypeSchema>();
    for (const t of specTypes) typeMap.set(t.name, t);
    docWriteTypesWithCommons(buf, cfg, specSchema, typeMap, documentedTypes, typeEmitted, commonsTypes);
  } else {
    buf.push("## Types\n\n");
  }

  if ((schema.methodTypes ?? []).length > 0) {
    docWriteMethodTypesWithCommons(buf, schema.methodTypes ?? [], documentedTypes, typeEmitted, commonsTypes);
  }

  docWriteResourceAndStatusTypesWithCommons(buf, cfg, schema, documentedTypes, commonsTypes);

  const resourceEnums = (schema.enumTypes ?? []).filter((et) => !commonsTypes.has(et.name));
  docWriteEnumTypes(buf, resourceEnums);

  return buf.join("");
}

// =========================================================================
// Client Access section
// =========================================================================

/** The tab label and fence language of each language a page shows. */
const DOC_TABS: Readonly<Record<DocLang, { tab: string; fence: string }>> = {
  typescript: { tab: "TypeScript", fence: "typescript" },
  go: { tab: "Go", fence: "go" },
  python: { tab: "Python", fence: "python" },
  java: { tab: "Java", fence: "java" },
};

/**
 * "Client Access": the client every example calls, then each language's
 * imports block (a `prelude` fence: the imports every example on the page
 * uses, written last, once every example has been) and, when the kind has
 * a Get, the read by id.
 */
function docWriteClientAccess(buf: string[], schema: ServiceSchemaFile, cfg: SdkResourceConfig, names: DocLangNames, env: DocExampleEnv): void {
  const varName = docVarName(cfg.protoResType);
  const pyVarName = docPyVarName(cfg.protoResType);
  const exampleID = docExampleID(cfg.idPrefix);

  let getMethod: MethodSchema | null = null;
  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (m.name === "Get") {
        getMethod = m;
        break;
      }
    }
  }

  const reads: Partial<Record<DocLang, string>> = {};
  if (getMethod !== null) {
    reads.typescript = `const ${varName} = await stigmer.${names.ts}.get("${exampleID}");`;
    reads.go = `${varName}, err := client.${names.go}.Get(ctx, "${exampleID}")`;
    reads.python = `${pyVarName} = client.${names.py}.get("${exampleID}")`;
    reads.java = `${javaResultType(env, getMethod.outputFullType)} ${varName} = client.${names.java}.get("${exampleID}");`;
  }

  const tabs: string[] = [];
  for (const lang of DOC_LANGS) {
    const fences: string[] = [];
    const prelude = env.imports.render(lang);
    if (prelude !== null) fences.push(docFence(DOC_TABS[lang].fence, "prelude", prelude));
    const read = reads[lang];
    if (read !== undefined) fences.push(docFence(DOC_TABS[lang].fence, "", read));
    if (fences.length > 0) tabs.push(`<Tab value="${DOC_TABS[lang].tab}">\n${fences.join("")}</Tab>\n`);
  }
  if (tabs.length === 0) return;

  buf.push("## Client Access\n\n");
  buf.push(
    "Every example on this page calls a client created as the [SDK overview](/docs/sdk/overview) shows: `stigmer` in TypeScript, `client` in Go, Python and Java, and Go's `ctx`. Where a language's examples import anything, its tab opens with those imports.\n\n",
  );
  buf.push("<SDKTabs>\n");
  buf.push(tabs.join(""));
  buf.push("</SDKTabs>\n\n");
}

// =========================================================================
// Methods section
// =========================================================================

function docWriteMethodsWithCommons(
  buf: string[],
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  names: DocLangNames,
  hasInputType: boolean,
  documentedTypes: Set<string>,
  specSchema: SpecSchema | null,
  env: DocExampleEnv,
  commonsTypes: Set<string>,
): void {
  const methods = docCollectMethods(schema);
  docSortMethods(methods);

  buf.push("## Methods\n\n");
  docWriteMethodOverview(buf, methods);

  for (const m of methods) {
    docWriteMethodWithCommons(buf, m, cfg, names, hasInputType, documentedTypes, specSchema, env, commonsTypes);
    if (pagedListOf(schema, m) !== undefined) {
      docWritePageIterator(buf, m);
    }
  }
}

function docWriteMethodWithCommons(
  buf: string[],
  m: MethodSchema,
  cfg: SdkResourceConfig,
  names: DocLangNames,
  hasInputType: boolean,
  documentedTypes: Set<string>,
  specSchema: SpecSchema | null,
  env: DocExampleEnv,
  commonsTypes: Set<string>,
): void {
  const tsName = tsMethodName(m.name);
  const pyName = pascalToSnake(m.name);
  const inputTypeName = cfg.inputPrefix + "Input";

  const emptyInput = isEmptyType(m.inputFullType);
  const emptyOutput = isEmptyType(m.outputFullType);
  const idInput = isIDType(m.inputType);
  const resourceInput = m.inputType === cfg.protoResType;
  const updateInput = isUpdateInputType(m.inputType, cfg.protoResType);
  const deleteInput = m.inputType === "ApiResourceDeleteInput";

  buf.push(`### ${tsName}\n\n`);

  if (m.serverStreaming === true) {
    buf.push("> **Server Streaming** — This method returns a stream of updates, not a single response.\n\n");
  }

  if (m.description !== undefined && m.description !== "") {
    const content = docSDKContent(m.description);
    if (content !== "") {
      buf.push(docEscapeMDX(content));
      buf.push("\n\n");
    }
  }

  buf.push("<SDKTabs>\n");
  if (updateInput) {
    docWriteUpdateSigs(buf, m, cfg, names, env, tsName, pyName);
  } else {
    docWriteMethodSigs(buf, m, cfg, names, env, tsName, pyName, resourceInput && hasInputType, specSchema);
  }
  buf.push("</SDKTabs>\n\n");

  if (emptyInput) {
    // no parameters section
  } else if (updateInput) {
    buf.push("**Parameters**\n\n");
    buf.push("| Parameter | Type | Description |\n");
    buf.push("|-----------|------|-------------|\n");
    buf.push(`| \`resource\` | ${docTypeRefWithCommons(cfg.protoResType, documentedTypes, commonsTypes)} | The ${docDisplayName(cfg.protoResType).toLowerCase()}, named by \`metadata.id\`, with the new values at the paths it changes. Carry the \`metadata.etag\` it was read at to be refused if it changed since. |\n`);
    buf.push("| `paths` | `string[]` | The fields the update changes, as proto field paths (`spec.description`, `metadata.name`), or `*` for every one. |\n\n");
  } else if (idInput) {
    buf.push("**Parameters**\n\n");
    buf.push("| Parameter | Type | Description |\n");
    buf.push("|-----------|------|-------------|\n");
    buf.push(`| \`id\` | \`string\` | ${docDisplayName(cfg.protoResType)} identifier. |\n\n`);
  } else if (resourceInput && hasInputType) {
    buf.push(`**Parameters**: [\`${inputTypeName}\`](#${inputTypeName.toLowerCase()})\n\n`);
  } else if (deleteInput) {
    buf.push("**Parameters**\n\n");
    buf.push("| Parameter | Type | Description |\n");
    buf.push("|-----------|------|-------------|\n");
    buf.push("| `resourceId` | `string` | ID of the resource to delete. |\n");
    buf.push("| `versionMessage` | `string` | Optional deletion reason. |\n");
    buf.push("| `force` | `boolean` | Force delete even if resource is in use. |\n\n");
  } else {
    buf.push(`**Parameters**: ${docTypeRefWithCommons(m.inputType, documentedTypes, commonsTypes)}\n\n`);
  }

  if (emptyOutput) {
    buf.push("**Returns**: `void`\n\n");
  } else if (m.serverStreaming === true) {
    buf.push(`**Returns**: Stream&lt;${docTypeRefWithCommons(m.outputType, documentedTypes, commonsTypes)}&gt;\n\n`);
  } else {
    buf.push(`**Returns**: ${docTypeRefWithCommons(m.outputType, documentedTypes, commonsTypes)}\n\n`);
  }
}

/**
 * An update's examples: read the resource, change a field, and update it
 * naming that field. The read's etag rides along, so the update is refused
 * if the resource changed since.
 */
function docWriteUpdateSigs(
  buf: string[],
  m: MethodSchema,
  cfg: SdkResourceConfig,
  names: DocLangNames,
  env: DocExampleEnv,
  tsName: string,
  pyName: string,
): void {
  const varName = docVarName(cfg.protoResType);
  const pyVarName = docPyVarName(cfg.protoResType);
  const exampleID = docExampleID(cfg.idPrefix);
  const javaType = javaResultType(env, m.outputFullType);
  docWriteTab(
    buf,
    "TypeScript",
    "typescript",
    `const ${varName} = await stigmer.${names.ts}.get("${exampleID}");\n${varName}.metadata!.name = "New name";\nconst updated = await stigmer.${names.ts}.${tsName}(${varName}, ["metadata.name"]);`,
  );
  docWriteTab(
    buf,
    "Go",
    "go",
    `${varName}, err := client.${names.go}.Get(ctx, "${exampleID}")\n${varName}.Metadata.Name = "New name"\nupdated, err := client.${names.go}.Update(ctx, ${varName}, []string{"metadata.name"})`,
  );
  docWriteTab(
    buf,
    "Python",
    "python",
    `${pyVarName} = client.${names.py}.get("${exampleID}")\n${pyVarName}.metadata.name = "New name"\nupdated = client.${names.py}.${pyName}(${pyVarName}, ["metadata.name"])`,
  );
  docWriteTab(
    buf,
    "Java",
    "java",
    `${javaType} ${varName} = client.${names.java}.get("${exampleID}");\n${javaType} updated = client.${names.java}.${tsName}(\n    ${varName}.toBuilder().setMetadata(${varName}.getMetadata().toBuilder().setName("New name")).build(),\n    ${javaListOf(env, '"metadata.name"')});`,
  );
}

/** What each language passes a method, or null where the example cannot be written (it is then marked with `reason`). */
interface DocArgs {
  readonly args: Readonly<Record<DocLang, string | null>>;
  readonly reason?: string;
}

/** The argument every language passes: the same text in each. */
function docSameArgs(text: string): DocArgs {
  return { args: { typescript: text, go: text, python: text, java: text } };
}

/** What a method other than an update takes, in each language. */
function docMethodArgs(
  tsClient: string,
  m: MethodSchema,
  cfg: SdkResourceConfig,
  env: DocExampleEnv,
  sdkResourceInput: boolean,
  specSchema: SpecSchema | null,
): DocArgs {
  const exampleID = docExampleID(cfg.idPrefix);
  if (isEmptyType(m.inputFullType)) return docSameArgs("");
  if (isIDType(m.inputType)) return docSameArgs(`"${exampleID}"`);
  if (sdkResourceInput) {
    const fields = docInputFields(specSchema, docExampleResourceName(cfg.protoResType), cfg.isOrgless);
    return { args: perLang((lang) => docSdkInput(env, lang, fields)) };
  }
  if (m.inputType === "ApiResourceDeleteInput") return { args: perLang((lang) => sdkDeleteInput(env, lang, exampleID)) };
  if (m.inputType === "ApiResourceReference") {
    const slug = docExampleResourceName(cfg.protoResType);
    return { args: perLang((lang) => sdkResourceRef(env, lang, slug)) };
  }
  const fields = env.methodTypes.get(m.inputType)?.fields ?? [];
  return {
    args: perLang((lang) => docProtoInput(env, lang, m.inputType, m.inputFullType, fields, TS_MESSAGE_PARAMS.has(`${tsClient}.${tsMethodName(m.name)}`))),
    reason: `the schemas record no module that declares ${m.inputType}`,
  };
}

function perLang<T>(make: (lang: DocLang) => T): Record<DocLang, T> {
  return { typescript: make("typescript"), go: make("go"), python: make("python"), java: make("java") };
}

function docWriteMethodSigs(
  buf: string[],
  m: MethodSchema,
  cfg: SdkResourceConfig,
  names: DocLangNames,
  env: DocExampleEnv,
  tsName: string,
  pyName: string,
  sdkResourceInput: boolean,
  specSchema: SpecSchema | null,
): void {
  const { args, reason } = docMethodArgs(names.ts, m, cfg, env, sdkResourceInput, specSchema);
  if (m.serverStreaming === true) {
    docWriteStreamingSigs(buf, m, names, env, tsName, pyName, args, reason);
    return;
  }

  const resultVar = docVarName(m.outputType);
  const pyResultVar = docPyVarName(m.outputType);
  const noResult = isEmptyType(m.outputFullType);
  const call = (lang: DocLang, text: (arg: string) => string): void => {
    const arg = args[lang];
    docWriteTab(
      buf,
      DOC_TABS[lang].tab,
      DOC_TABS[lang].fence,
      text(arg ?? "input"),
      arg === null ? `no-compile="${reason ?? "the input cannot be named"}"` : "",
    );
  };
  call("typescript", (a) => `${noResult ? "await" : `const ${resultVar} = await`} stigmer.${names.ts}.${tsName}(${a});`);
  call("go", (a) => `${noResult ? "err :=" : `${resultVar}, err :=`} client.${names.go}.${m.name}(ctx${a === "" ? "" : ", " + a})`);
  call("python", (a) => `${noResult ? "" : `${pyResultVar} = `}client.${names.py}.${pyName}(${a})`);
  const javaResult = noResult ? "" : `${javaResultType(env, m.outputFullType)} ${resultVar} = `;
  call("java", (a) => `${javaResult}client.${names.java}.${tsName}(${a});`);
}

/** A streaming method's examples: open the stream and read each message it sends. */
function docWriteStreamingSigs(
  buf: string[],
  m: MethodSchema,
  names: DocLangNames,
  env: DocExampleEnv,
  tsName: string,
  pyName: string,
  args: DocArgs["args"],
  reason: string | undefined,
): void {
  let eventVar = "event";
  let pyEventVar = "event";
  if (m.outputType !== "") {
    eventVar = m.outputType.slice(0, 1).toLowerCase() + m.outputType.slice(1);
    pyEventVar = pascalToSnake(m.outputType);
  }
  const meta = (lang: DocLang): string => (args[lang] === null ? `no-compile="${reason ?? "the input cannot be named"}"` : "");
  const arg = (lang: DocLang): string => args[lang] ?? "input";

  docWriteTab(buf, "TypeScript", "typescript",
    `const stream = stigmer.${names.ts}.${tsName}(${arg("typescript")});\nfor await (const ${eventVar} of stream) {\n  // process ${eventVar}\n}`, meta("typescript"));

  const errors = goStd(env, "errors");
  const io = goStd(env, "io");
  const log = goStd(env, "log");
  docWriteTab(buf, "Go", "go",
    `stream, err := client.${names.go}.${m.name}(ctx, ${arg("go")})\nif err != nil {\n    ${log}.Fatal(err)\n}\nfor {\n    ${eventVar}, recvErr := stream.Recv()\n    if ${errors}.Is(recvErr, ${io}.EOF) {\n        break\n    }\n    if recvErr != nil {\n        ${log}.Fatal(recvErr)\n    }\n    // process ${eventVar}\n}`, meta("go"));

  docWriteTab(buf, "Python", "python",
    `for ${pyEventVar} in client.${names.py}.${pyName}(${arg("python")}):\n    print(${pyEventVar})`, meta("python"));

  const javaType = javaResultType(env, m.outputFullType);
  docWriteTab(buf, "Java", "java",
    `${javaStream(env)}<${javaType}> stream = client.${names.java}.${tsName}(${arg("java")});\nwhile (stream.hasNext()) {\n    ${javaType} ${eventVar} = stream.next();\n    // process ${eventVar}\n}`, meta("java"));
}

// =========================================================================
// The resource's SDK input
// =========================================================================

/** A string field of the input header. */
function docHeaderField(name: string, protoField: string): FieldSchema {
  return { name, jsonName: protoField, protoField, type: { kind: "string" }, description: "", required: false };
}

/**
 * The fields an SDK input example sets: the header (name, org, slug,
 * labels), then the spec's own. An org-less kind's example shows no org:
 * its metadata.org is always empty, and the server refuses one.
 */
function docInputFields(specSchema: SpecSchema | null, exampleName: string, isOrgless: boolean): DocInputField[] {
  const fields: DocInputField[] = [
    { field: docHeaderField("Name", "name"), value: `"${exampleName}"` },
    ...(isOrgless ? [] : [{ field: docHeaderField("Org", "org"), value: `"${DOC_EXAMPLE_ORG}"` }]),
    { field: docHeaderField("Slug", "slug") },
    {
      field: {
        ...docHeaderField("Labels", "labels"),
        type: { kind: "map", keyType: { kind: "string" }, valueType: { kind: "string" } },
      },
    },
  ];
  if (specSchema === null) return fields;
  for (const f of specSchema.fields) {
    if (META_FIELD_NAMES.has(f.name)) continue;
    fields.push({ field: f });
  }
  return fields;
}

// =========================================================================
// Method collection, ordering, and overview table
// =========================================================================

// Methods under their SDK names: one client serves every service of a
// resource package, so a renamed method is documented as callers call it.
function docCollectMethods(schema: ServiceSchemaFile): MethodSchema[] {
  const methods: MethodSchema[] = [];
  for (const svc of schema.services) {
    for (const m of svc.methods) {
      methods.push({ ...m, name: sdkMethodName(svc, m) });
    }
  }
  return methods;
}

// The page iterator every SDK emits beside a paged list.
function docWritePageIterator(buf: string[], m: MethodSchema): void {
  const all = pageIteratorName(m.name);
  buf.push(
    `**Every page**: \`${tsMethodName(all)}\` (Go \`${all}\`, Python \`${pascalToSnake(all)}\`, Java \`${tsMethodName(all)}\`) takes the same input and yields every entry, following \`nextPageToken\` from the token the input names.\n\n`,
  );
}

// Queries first, then mutations, lifecycle operations, and utilities last.
function docSortMethods(methods: MethodSchema[]): void {
  methods.sort((a, b) => {
    const ki = docMethodSortKey(a.name);
    const kj = docMethodSortKey(b.name);
    if (ki !== kj) return ki - kj;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

function docMethodSortKey(name: string): number {
  const lower = name.toLowerCase();
  if (lower === "get") return 100;
  if (lower.startsWith("get")) return 110;
  if (lower === "list") return 200;
  if (lower.startsWith("list")) return 210;
  if (lower === "subscribe") return 300;
  if (lower.startsWith("find")) return 350;
  if (lower === "apply") return 400;
  if (lower === "create") return 500;
  if (lower === "update") return 600;
  if (lower.startsWith("update")) return 610;
  if (lower === "delete") return 700;
  if (lower === "pause") return 810;
  if (lower === "resume") return 820;
  if (lower === "cancel") return 830;
  if (lower === "terminate") return 840;
  if (lower === "recover") return 850;
  if (lower.startsWith("submit")) return 860;
  return 900;
}

function docWriteMethodOverview(buf: string[], methods: MethodSchema[]): void {
  const hasStreaming = methods.some((m) => m.serverStreaming === true);

  buf.push("| Method | Description |");
  if (hasStreaming) buf.push(" Streaming |");
  buf.push("\n");

  buf.push("|--------|-------------|");
  if (hasStreaming) buf.push("-----------|");
  buf.push("\n");

  for (const m of methods) {
    const tsName = tsMethodName(m.name);
    const anchor = tsName.toLowerCase();
    let desc = docFirstSentence(m.description ?? "");
    desc = desc.replaceAll("|", "\\|");

    buf.push(`| [\`${tsName}\`](#${anchor}) | ${desc} |`);
    if (hasStreaming) {
      buf.push(m.serverStreaming === true ? " Server |" : " |");
    }
    buf.push("\n");
  }
  buf.push("\n");
}

// =========================================================================
// Types section
// =========================================================================

function docWriteTypesWithCommons(
  buf: string[],
  cfg: SdkResourceConfig,
  specSchema: SpecSchema,
  typeMap: Map<string, TypeSchema>,
  documentedTypes: Set<string>,
  emitted: Set<string>,
  commonsTypes: Set<string>,
): void {
  buf.push("## Types\n\n");

  const inputName = cfg.inputPrefix + "Input";
  const displayName = docDisplayName(cfg.protoResType);
  buf.push(`### ${inputName}\n\n`);
  buf.push(`Input for creating or updating ${indefiniteArticle(displayName)} ${displayName}.\n\n`);

  const specFields = specSchema.fields.filter((f) => !META_FIELD_NAMES.has(f.name));

  buf.push("<TypeTable\n  type={{\n");
  buf.push('    name: { type: "string", description: "Resource name.", required: true },\n');
  buf.push('    slug: { type: "string", description: "URL-friendly identifier." },\n');
  if (!cfg.isOrgless) {
    buf.push('    org: { type: "string", description: "Organization id (a slug is also accepted).", required: true },\n');
  }
  buf.push('    labels: { type: "Record<string, string>", description: "Key-value labels." },\n');
  for (const f of specFields) {
    docWriteTypeFieldWithCommons(buf, f, documentedTypes, commonsTypes);
  }
  buf.push("  }}\n/>\n\n");

  for (const f of specFields) {
    docWriteNestedTypeWithCommons(buf, f, typeMap, emitted, documentedTypes, commonsTypes);
  }
}

function docWriteTypeFieldWithCommons(buf: string[], f: FieldSchema, documentedTypes: Set<string>, commonsTypes: Set<string>): void {
  const fieldName = tsProtoFieldName(f.protoField);
  const fieldType = docTypeString(f.type);
  const desc = docEscapeJSString(docFirstSentence(f.description));
  const link = docFieldTypeLinkWithCommons(f.type, documentedTypes, commonsTypes);

  const props: string[] = [];
  props.push(`type: "${fieldType}"`);
  props.push(`description: "${desc}"`);
  if (link !== "") props.push(`typeDescriptionLink: "${link}"`);
  if (f.required) props.push("required: true");
  buf.push(`    ${fieldName}: { ${props.join(", ")} },\n`);
}

function docWriteNestedTypeWithCommons(
  buf: string[],
  f: FieldSchema,
  typeMap: Map<string, TypeSchema>,
  emitted: Set<string>,
  documentedTypes: Set<string>,
  commonsTypes: Set<string>,
): void {
  let msgName: string;
  const t = f.type;
  if (t.kind === "message") {
    msgName = t.messageType ?? "";
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    msgName = t.elementType.messageType ?? "";
  } else if (t.kind === "map" && t.valueType?.kind === "message") {
    msgName = t.valueType.messageType ?? "";
  } else {
    return;
  }

  const inputName = docInputDisplayName(msgName);
  if (emitted.has(inputName)) return;
  const ts = typeMap.get(msgName);
  if (ts === undefined) return;
  emitted.add(inputName);

  buf.push(`### ${inputName}\n\n`);

  if (ts.description !== "") {
    buf.push(docEscapeMDX(docFirstSentence(ts.description)));
    buf.push("\n\n");
  }

  if (ts.fields.length > 0) {
    buf.push("<TypeTable\n  type={{\n");
    for (const field of ts.fields) {
      docWriteTypeFieldWithCommons(buf, field, documentedTypes, commonsTypes);
    }
    buf.push("  }}\n/>\n\n");
  }

  for (const field of ts.fields) {
    docWriteNestedTypeWithCommons(buf, field, typeMap, emitted, documentedTypes, commonsTypes);
  }
}

// =========================================================================
// Method types section
// =========================================================================

function docBuildDocumentedTypeSet(
  cfg: SdkResourceConfig,
  schema: ServiceSchemaFile,
  specSchema: SpecSchema | null,
  specTypes: TypeSchema[],
): Set<string> {
  const set = new Set<string>();

  set.add(cfg.protoResType);
  if (schema.statusType !== undefined) {
    set.add(schema.statusType.name);
  }

  if (specSchema !== null) {
    set.add(cfg.inputPrefix + "Input");

    const specFields = specSchema.fields.filter((f) => !META_FIELD_NAMES.has(f.name));
    const typeMap = new Map<string, TypeSchema>();
    for (const t of specTypes) typeMap.set(t.name, t);

    for (const f of specFields) {
      docCollectNestedTypeNames(f, typeMap, set);
    }
  }

  for (const mt of schema.methodTypes ?? []) {
    if (isSpecialType(mt.name)) {
      set.add(docInputDisplayName(mt.name));
    } else {
      set.add(mt.name);
    }
  }

  for (const nt of schema.statusNestedTypes ?? []) {
    set.add(nt.name);
  }

  for (const et of schema.enumTypes ?? []) {
    set.add(et.name);
  }

  return set;
}

function docCollectNestedTypeNames(f: FieldSchema, typeMap: Map<string, TypeSchema>, set: Set<string>): void {
  let msgName: string;
  const t = f.type;
  if (t.kind === "message") {
    msgName = t.messageType ?? "";
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    msgName = t.elementType.messageType ?? "";
  } else if (t.kind === "map" && t.valueType?.kind === "message") {
    msgName = t.valueType.messageType ?? "";
  } else {
    return;
  }

  const inputName = docInputDisplayName(msgName);
  if (set.has(inputName)) return;
  const ts = typeMap.get(msgName);
  if (ts === undefined) return;
  set.add(inputName);

  for (const field of ts.fields) {
    docCollectNestedTypeNames(field, typeMap, set);
  }
}

function docWriteMethodTypesWithCommons(
  buf: string[],
  methodTypes: TypeSchema[],
  documentedTypes: Set<string>,
  emitted: Set<string>,
  commonsTypes: Set<string>,
): void {
  for (const mt of methodTypes) {
    if (commonsTypes.has(mt.name)) continue;

    const heading = isSpecialType(mt.name) ? docInputDisplayName(mt.name) : mt.name;
    if (emitted.has(heading)) continue;
    emitted.add(heading);

    buf.push(`### ${heading}\n\n`);

    if (mt.description !== "") {
      const content = docFirstSentence(mt.description);
      if (content !== "") {
        buf.push(docEscapeMDX(content));
        buf.push("\n\n");
      }
    }

    if (mt.fields.length > 0) {
      buf.push("<TypeTable\n  type={{\n");
      for (const field of mt.fields) {
        docWriteTypeFieldWithCommons(buf, field, documentedTypes, commonsTypes);
      }
      buf.push("  }}\n/>\n\n");
    }
  }
}

function docTypeRefWithCommons(typeName: string, documentedTypes: Set<string>, commonsTypes: Set<string>): string {
  if (commonsTypes.has(typeName)) {
    return `[\`${typeName}\`](/docs/sdk/resources/commons#${typeName.toLowerCase()})`;
  }
  return docTypeRef(typeName, documentedTypes);
}

function docTypeRef(typeName: string, documentedTypes: Set<string>): string {
  if (documentedTypes.has(typeName)) {
    return `[\`${typeName}\`](#${typeName.toLowerCase()})`;
  }
  if (isSpecialType(typeName)) {
    const mapped = docInputDisplayName(typeName);
    if (documentedTypes.has(mapped)) {
      return `[\`${mapped}\`](#${mapped.toLowerCase()})`;
    }
  }
  return `\`${typeName}\``;
}

// =========================================================================
// Resource and status type sections (response types)
// =========================================================================

function docResponseTypeString(ts: TypeSpec): string {
  switch (ts.kind) {
    case "array":
      if (ts.elementType !== undefined) {
        return docResponseTypeString(ts.elementType) + "[]";
      }
      return "string[]";
    case "map": {
      const key = ts.keyType !== undefined ? docResponseTypeString(ts.keyType) : "string";
      const val = ts.valueType !== undefined ? docResponseTypeString(ts.valueType) : "string";
      return `Record<${key}, ${val}>`;
    }
    case "message":
      return ts.messageType ?? "";
    default:
      return docTypeString(ts);
  }
}

function docWriteResponseTypeFieldWithCommons(buf: string[], f: FieldSchema, documentedTypes: Set<string>, commonsTypes: Set<string>): void {
  const fieldName = tsProtoFieldName(f.protoField);
  const fieldType = docResponseTypeString(f.type);
  const desc = docEscapeJSString(docFirstSentence(f.description));
  const link = docResponseFieldTypeLinkWithCommons(f.type, documentedTypes, commonsTypes);

  const props: string[] = [];
  props.push(`type: "${fieldType}"`);
  props.push(`description: "${desc}"`);
  if (link !== "") props.push(`typeDescriptionLink: "${link}"`);
  if (f.required) props.push("required: true");
  buf.push(`    ${fieldName}: { ${props.join(", ")} },\n`);
}

function docWriteResourceAndStatusTypesWithCommons(
  buf: string[],
  cfg: SdkResourceConfig,
  schema: ServiceSchemaFile,
  documentedTypes: Set<string>,
  commonsTypes: Set<string>,
): void {
  const inputTypeName = cfg.inputPrefix + "Input";
  const statusTypeName = cfg.protoResType + "Status";

  buf.push(`### ${cfg.protoResType}\n\n`);
  if (schema.resourceDescription !== undefined && schema.resourceDescription !== "") {
    const content = docFirstSentence(schema.resourceDescription);
    if (content !== "") {
      buf.push(docEscapeMDX(content));
      buf.push("\n\n");
    }
  }

  const specRef = docTypeRef(inputTypeName, documentedTypes);
  const statusRef = docTypeRef(statusTypeName, documentedTypes);

  const specLink = documentedTypes.has(inputTypeName)
    ? `, typeDescriptionLink: "#${inputTypeName.toLowerCase()}"`
    : "";
  const statusLink = documentedTypes.has(statusTypeName)
    ? `, typeDescriptionLink: "#${statusTypeName.toLowerCase()}"`
    : "";
  const metadataLink = commonsTypes.has("ApiResourceMetadata")
    ? ', typeDescriptionLink: "/docs/sdk/resources/commons#apiresourcemetadata"'
    : "";

  buf.push("<TypeTable\n  type={{\n");
  buf.push('    apiVersion: { type: "string", description: "API version for this resource type." },\n');
  buf.push('    kind: { type: "string", description: "Resource kind identifier." },\n');
  buf.push(`    metadata: { type: "ApiResourceMetadata", description: "Resource metadata including id, name, org, slug, labels, visibility, and timestamps."${metadataLink} },\n`);
  buf.push(`    spec: { type: "${inputTypeName}", description: "Resource specification. See ${specRef}."${specLink} },\n`);
  buf.push(`    status: { type: "${statusTypeName}", description: "System-managed state. See ${statusRef}."${statusLink} },\n`);
  buf.push("  }}\n/>\n\n");

  if (schema.statusType !== undefined) {
    buf.push(`### ${schema.statusType.name}\n\n`);
    if (schema.statusType.description !== "") {
      const content = docFirstSentence(schema.statusType.description);
      if (content !== "") {
        buf.push(docEscapeMDX(content));
        buf.push("\n\n");
      }
    }
    if (schema.statusType.fields.length > 0) {
      buf.push("<TypeTable\n  type={{\n");
      for (const field of schema.statusType.fields) {
        docWriteResponseTypeFieldWithCommons(buf, field, documentedTypes, commonsTypes);
      }
      buf.push("  }}\n/>\n\n");
    }
  }

  docWriteStatusNestedTypesWithCommons(buf, schema.statusNestedTypes ?? [], documentedTypes, commonsTypes);
}

function docWriteStatusNestedTypesWithCommons(
  buf: string[],
  types: TypeSchema[],
  documentedTypes: Set<string>,
  commonsTypes: Set<string>,
): void {
  const emitted = new Set<string>();
  for (const nt of types) {
    if (emitted.has(nt.name) || commonsTypes.has(nt.name)) continue;
    emitted.add(nt.name);

    buf.push(`### ${nt.name}\n\n`);
    if (nt.description !== "") {
      const content = docFirstSentence(nt.description);
      if (content !== "") {
        buf.push(docEscapeMDX(content));
        buf.push("\n\n");
      }
    }
    if (nt.fields.length > 0) {
      buf.push("<TypeTable\n  type={{\n");
      for (const field of nt.fields) {
        docWriteResponseTypeFieldWithCommons(buf, field, documentedTypes, commonsTypes);
      }
      buf.push("  }}\n/>\n\n");
    }
  }
}

// =========================================================================
// Enum types section
// =========================================================================

function docWriteEnumTypes(buf: string[], enumTypes: EnumSchema[]): void {
  if (enumTypes.length === 0) return;

  for (const et of enumTypes) {
    buf.push(`### ${et.name}\n\n`);

    if (et.description !== "") {
      const content = docFirstSentence(et.description);
      if (content !== "") {
        buf.push(docEscapeMDX(content));
        buf.push("\n\n");
      }
    }

    if ((et.values ?? []).length > 0) {
      buf.push("| Value | Description |\n");
      buf.push("|-------|-------------|\n");
      for (const v of et.values ?? []) {
        let desc = docEnumValueDescription(v.description);
        desc = desc.replaceAll("|", "\\|");
        buf.push(`| \`${v.name}\` | ${desc} |\n`);
      }
      buf.push("\n");
    }
  }
}

function docEnumValueDescription(desc: string): string {
  if (desc === "") return "";
  desc = docStripSince(desc);
  desc = goTrimSpace(desc);
  if (desc === "") return "";
  return docFirstSentence(docCleanDesc(desc));
}

// =========================================================================
// Tab helper
// =========================================================================

/** One language's tab holding one fence; `meta` follows the fence's language (`no-compile="…"`). */
function docWriteTab(buf: string[], lang: string, syntax: string, code: string, meta = ""): void {
  buf.push(`<Tab value="${lang}">\n${docFence(syntax, meta, code)}</Tab>\n`);
}

/** A code fence: its language, its attributes, its code. */
function docFence(syntax: string, meta: string, code: string): string {
  return `${MD_FENCE}${syntax}${meta === "" ? "" : " " + meta}\n${code}\n${MD_FENCE}\n`;
}

// =========================================================================
// Overview file resolution + display helpers
// =========================================================================

function docOverviewFilePath(apisDir: string, pkg: string): string {
  const parts = pkg.split(".");
  if (parts.length < 2) return "";
  const resourceParts = parts.slice(0, -1);
  return path.join(apisDir, ...resourceParts, "docs", "overview.md");
}

export function docDisplayName(protoResType: string): string {
  let name = "";
  for (let i = 0; i < protoResType.length; i++) {
    const ch = protoResType[i];
    if (i > 0 && ch >= "A" && ch <= "Z") name += " ";
    name += ch;
  }
  name = name.replaceAll("O Auth", "OAuth");
  name = name.replaceAll("Mcp ", "MCP ");
  name = name.replaceAll("Api ", "API ");
  name = name.replaceAll("Iam ", "IAM ");
  return name;
}

export function docSlug(protoResType: string): string {
  return docDisplayName(protoResType).replaceAll(" ", "-").toLowerCase();
}

/**
 * Names a JavaScript module may not bind: `eval` and `arguments`, and the
 * reserved words. A kind's name, lower-cased, can be one (Eval is), and an
 * example that declares `const eval = ...` is a syntax error in every
 * module, so such a name takes a suffix.
 */
const JS_UNBINDABLE_NAMES: ReadonlySet<string> = new Set([
  "arguments", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "enum", "eval", "export",
  "extends", "false", "finally", "for", "function", "if", "implements",
  "import", "in", "instanceof", "interface", "let", "new", "null", "package",
  "private", "protected", "public", "return", "static", "super", "switch",
  "this", "throw", "true", "try", "typeof", "var", "void", "while", "with",
  "yield",
]);

/**
 * Names a Python example must not bind: the keywords, which it cannot, and
 * the builtins a reader's later line may still call (`eval`, `type`, `id`,
 * `list`), which it would shadow.
 */
const PY_UNBINDABLE_NAMES: ReadonlySet<string> = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
  "del", "elif", "else", "except", "finally", "for", "from", "global", "if",
  "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
  "return", "try", "while", "with", "yield", "dict", "eval", "exec", "filter",
  "format", "hash", "id", "input", "iter", "list", "map", "next", "object",
  "open", "print", "range", "set", "slice", "str", "sum", "type", "vars", "zip",
]);

/** The variable a TypeScript example binds a value of `typeName` to. */
export function docVarName(typeName: string): string {
  if (typeName === "" || typeName.endsWith("List")) return "result";
  const name = typeName.slice(0, 1).toLowerCase() + typeName.slice(1);
  return JS_UNBINDABLE_NAMES.has(name) ? `${name}Resource` : name;
}

/** The variable a Python example binds a value of `typeName` to. */
export function docPyVarName(typeName: string): string {
  if (typeName === "" || typeName.endsWith("List")) return "result";
  const name = pascalToSnake(typeName);
  return PY_UNBINDABLE_NAMES.has(name) ? `${name}_resource` : name;
}

function docExampleID(idPrefix: string): string {
  const exampleULID = "01j5q3k7m8r2s4tnz2hfp0q0c3";
  if (idPrefix === "") return "id_" + exampleULID;
  return idPrefix + "_" + exampleULID;
}

function docExampleResourceName(protoResType: string): string {
  return "my-" + docSlug(protoResType);
}

// =========================================================================
// Description helpers
// =========================================================================

function docCleanDesc(desc: string): string {
  desc = goTrimSpace(desc);
  const paragraphs = desc.split("\n\n");
  for (let i = 0; i < paragraphs.length; i++) {
    const lines = goTrimSpace(paragraphs[i]).split("\n");
    for (let j = 0; j < lines.length; j++) {
      lines[j] = goTrimSpace(lines[j]);
    }
    paragraphs[i] = lines.join(" ");
  }
  return paragraphs.join("\n\n");
}

function docEscapeMDX(s: string): string {
  s = s.replaceAll("{", "\\{");
  s = s.replaceAll("}", "\\}");
  s = s.replaceAll("<", "&lt;");
  s = s.replaceAll(">", "&gt;");
  return s;
}

function docFirstSentence(desc: string): string {
  if (desc === "") return "";
  desc = docCleanDesc(desc);
  const idx = desc.indexOf("\n\n");
  if (idx >= 0) desc = desc.slice(0, idx);
  const end = docSentenceEnd(desc);
  if (end >= 0) return desc.slice(0, end + 1);
  if (desc.endsWith(".")) return desc;
  return desc + ".";
}

// Index of the period ending the first sentence, skipping abbreviations.
function docSentenceEnd(s: string): number {
  const abbrevs = ["e.g.", "i.e.", "etc.", "vs.", "approx.", "incl.", "resp."];
  let offset = 0;
  for (;;) {
    const idx = s.slice(offset).indexOf(". ");
    if (idx < 0) return -1;
    const pos = offset + idx;
    let isAbbrev = false;
    for (const abbr of abbrevs) {
      if (pos + 1 >= abbr.length && s.slice(pos + 1 - abbr.length, pos + 1).toLowerCase() === abbr.toLowerCase()) {
        isAbbrev = true;
        break;
      }
    }
    if (!isAbbrev) return pos;
    offset = pos + 2;
  }
}

function docEscapeJSString(s: string): string {
  s = s.replaceAll("\\", "\\\\");
  s = s.replaceAll('"', '\\"');
  s = s.replaceAll("\n", " ");
  return s;
}

function docSDKContent(desc: string): string {
  if (desc === "") return "";
  desc = goTrimSpace(desc);
  desc = docStripSince(desc);

  if (desc.startsWith("## ")) return "";

  const paragraphs: string[] = [];
  for (let p of desc.split("\n\n")) {
    p = goTrimSpace(p);
    if (p.startsWith("## ")) break;
    if (p === "") continue;
    const lines = p.split("\n");
    for (let i = 0; i < lines.length; i++) {
      lines[i] = goTrimSpace(lines[i]);
    }
    paragraphs.push(lines.join(" "));
  }
  return goTrimSpace(paragraphs.join("\n\n"));
}

function docStripSince(desc: string): string {
  const result: string[] = [];
  for (const line of desc.split("\n")) {
    if (goTrimSpace(line).startsWith("@since")) continue;
    result.push(line);
  }
  return result.join("\n");
}

function docOverviewSummary(desc: string): string {
  if (desc === "") return "";
  desc = goTrimSpace(desc);
  desc = docStripSince(desc);
  desc = docCleanDesc(desc);

  if (desc === "") return "";

  let firstLine = desc;
  const nl = desc.indexOf("\n");
  if (nl >= 0) firstLine = desc.slice(0, nl);
  const firstLineLower = goTrimSpace(firstLine).toLowerCase();
  if (firstLineLower.length < 30 && (firstLineLower.endsWith(" spec") || firstLineLower.endsWith(" spec."))) {
    return "";
  }

  // Strip "XxxSpec defines..." preamble from first paragraph.
  const words = firstLine.split(/\s+/).filter((w) => w !== "");
  if (words.length >= 2 && words[0].endsWith("Spec")) {
    const idx = firstLine.indexOf(". ");
    if (idx >= 0) {
      const remainder = goTrimSpace(firstLine.slice(idx + 2));
      let rest = "";
      const nlIdx = desc.indexOf("\n\n");
      if (nlIdx >= 0) rest = goTrimSpace(desc.slice(nlIdx + 2));
      if (remainder !== "" && rest !== "") return remainder + "\n\n" + rest;
      if (remainder !== "") return remainder;
    }
    const nlIdx = desc.indexOf("\n\n");
    if (nlIdx >= 0) {
      const rest = goTrimSpace(desc.slice(nlIdx + 2));
      if (rest !== "") return rest;
    }
    return "";
  }

  return desc;
}

// =========================================================================
// Type formatting
// =========================================================================

function docInputDisplayName(msgName: string): string {
  switch (msgName) {
    case "ApiResourceReference":
      return "ResourceRef";
    default:
      return msgName + "Input";
  }
}

function docFieldTypeLinkWithCommons(ts: TypeSpec, documentedTypes: Set<string>, commonsTypes: Set<string>): string {
  const enumName = docEnumTypeName(ts);
  if (enumName !== "") {
    if (commonsTypes.has(enumName)) {
      return "/docs/sdk/resources/commons#" + enumName.toLowerCase();
    }
    if (documentedTypes.has(enumName)) {
      return "#" + enumName.toLowerCase();
    }
    return "";
  }

  let msgName: string;
  if (ts.kind === "message") {
    msgName = ts.messageType ?? "";
  } else if (ts.kind === "array" && ts.elementType?.kind === "message") {
    msgName = ts.elementType.messageType ?? "";
  } else if (ts.kind === "map" && ts.valueType?.kind === "message") {
    msgName = ts.valueType.messageType ?? "";
  } else {
    return "";
  }

  if (commonsTypes.has(msgName)) {
    return "/docs/sdk/resources/commons#" + msgName.toLowerCase();
  }

  const displayName = docInputDisplayName(msgName);
  if (documentedTypes.has(displayName)) {
    return "#" + displayName.toLowerCase();
  }
  return "";
}

function docResponseFieldTypeLinkWithCommons(ts: TypeSpec, documentedTypes: Set<string>, commonsTypes: Set<string>): string {
  const enumName = docEnumTypeName(ts);
  if (enumName !== "") {
    if (commonsTypes.has(enumName)) {
      return "/docs/sdk/resources/commons#" + enumName.toLowerCase();
    }
    if (documentedTypes.has(enumName)) {
      return "#" + enumName.toLowerCase();
    }
    return "";
  }

  let typeName: string;
  if (ts.kind === "message") {
    typeName = ts.messageType ?? "";
  } else if (ts.kind === "array" && ts.elementType?.kind === "message") {
    typeName = ts.elementType.messageType ?? "";
  } else {
    return "";
  }
  if (commonsTypes.has(typeName)) {
    return "/docs/sdk/resources/commons#" + typeName.toLowerCase();
  }
  if (documentedTypes.has(typeName)) {
    return "#" + typeName.toLowerCase();
  }
  return "";
}

function docEnumTypeName(ts: TypeSpec): string {
  let enumFQN: string;
  if (ts.enumType !== undefined && ts.enumType !== "") {
    enumFQN = ts.enumType;
  } else if (ts.kind === "array" && ts.elementType?.enumType !== undefined && ts.elementType.enumType !== "") {
    enumFQN = ts.elementType.enumType;
  } else if (ts.kind === "map" && ts.valueType?.enumType !== undefined && ts.valueType.enumType !== "") {
    enumFQN = ts.valueType.enumType;
  } else {
    return "";
  }
  const parts = enumFQN.split(".");
  return parts[parts.length - 1];
}

function docTypeString(ts: TypeSpec): string {
  switch (ts.kind) {
    case "string":
      if (ts.enumType !== undefined && ts.enumType !== "") {
        const parts = ts.enumType.split(".");
        return parts[parts.length - 1];
      }
      return "string";
    case "int32":
    case "uint32":
    case "float":
    case "double":
      return "number";
    case "int64":
      return "number";
    case "bool":
      return "boolean";
    case "bytes":
      return "Uint8Array";
    case "timestamp":
      return "string";
    case "struct":
      return "object";
    case "value":
      return "any";
    case "array":
      if (ts.elementType !== undefined) {
        return docTypeString(ts.elementType) + "[]";
      }
      return "string[]";
    case "map": {
      const key = ts.keyType !== undefined ? docTypeString(ts.keyType) : "string";
      const val = ts.valueType !== undefined ? docTypeString(ts.valueType) : "string";
      return `Record<${key}, ${val}>`;
    }
    case "message":
      switch (ts.messageType) {
        case "ApiResourceReference":
          return "ResourceRef";
        default:
          return (ts.messageType ?? "") + "Input";
      }
    default:
      return "string";
  }
}
