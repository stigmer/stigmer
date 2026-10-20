/**
 * Pins the order of pushFromFile's questions: every authorization question
 * is asked before a byte of the File is read. The method's own
 * can_create_skill on the organization comes first, before the File is
 * even loaded; a File of another organization answers not-found before
 * can_view is asked; a File the caller may not view, or one over the
 * archive cap, is refused with its bytes unread. Once all of them pass,
 * the bytes are read and the shared push pipeline authorizes again under
 * this method's annotation. A store fault loading the File answers a
 * sanitized Internal, and so does a read that fails without its own
 * answer; a read that fails with one passes it through.
 *
 * The handler runs on an in-process router with a recording authorizer, a
 * store that answers only the File's load and a FileBlobs whose only door
 * is readHead, each recording into one shared log, so the order is read
 * from the log. The push pipeline is stopped by denying its own ask.
 */
import type { Client } from "@connectrpc/connect";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { SkillCommandController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer, AuthzCheck, AuthzDecision } from "../../../extensions/authorizer.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import { errorOf, untouchable } from "../../../pipeline/__tests__/support.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import type { FileBlobs } from "../../file/blobs.js";

import { MAX_ZIP_SIZE } from "../constants.js";
import { registerSkillServices } from "../controller.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const ORG = "org_acme";
const FILE_ID = "file_skillzip";

function fileOf(org: string, sizeBytes: number): File {
  return create(FileSchema, {
    metadata: { id: FILE_ID, org },
    spec: { filename: "my-skill.zip", mimeType: "application/zip" },
    status: { sizeBytes: BigInt(sizeBytes) },
  });
}

interface Harness {
  readonly command: Client<typeof SkillCommandController>;
  readonly log: string[];
}

/**
 * `deny` names the asks the authorizer refuses, as `<permission>:<kind>`,
 * and `from` the ask number (1-based) from which a match is refused: the
 * push pipeline's second can_create_skill is ask 3 on the full path.
 */
function harness(options: {
  readonly file: File | undefined;
  readonly deny?: (check: AuthzCheck, ask: number) => boolean;
  /** A fault the store's load answers with, in place of the File. */
  readonly loadFault?: Error;
  /** A fault the File's read answers with, in place of its bytes. */
  readonly readFault?: Error;
}): Harness {
  const log: string[] = [];
  let asks = 0;
  const authorizer: Authorizer = {
    authorize(_caller, check): Promise<AuthzDecision> {
      asks += 1;
      log.push(`authorize ${IamPermission[check.permission]} ${ApiResourceKind[check.resourceKind]} ${check.resourceId}`);
      if (options.deny?.(check, asks) === true) {
        return Promise.resolve({ kind: "deny", reason: "test" });
      }
      return Promise.resolve({ kind: "allow" });
    },
  };
  const store = {
    getResource(kind: ApiResourceKind, id: string): Promise<File> {
      log.push(`load ${ApiResourceKind[kind]} ${id}`);
      if (options.loadFault !== undefined) {
        return Promise.reject(options.loadFault);
      }
      if (options.file === undefined) {
        return Promise.reject(new ResourceNotFoundError(`file/${id}`));
      }
      return Promise.resolve(options.file);
    },
  } as unknown as Store;
  const fileBlobs = {
    readHead(fileId: string, maxBytes: number): Promise<Uint8Array> {
      log.push(`read ${fileId} ${maxBytes}`);
      if (options.readFault !== undefined) {
        return Promise.reject(options.readFault);
      }
      return Promise.resolve(new Uint8Array([0x50, 0x4b]));
    },
  } as unknown as FileBlobs;
  const transport = createRouterTransport(
    (router) => {
      registerSkillServices(router, {
        store,
        logger: silentLogger,
        authorizer,
        authorizationLifecycle: undefined,
        listReadScope: undefined,
        artifactStorage: untouchable("artifactStorage"),
        fileBlobs,
      });
    },
    {
      router: {
        interceptors: [createVerifierChainInterceptor([], [], silentLogger), createApiResourceInterceptor()],
      },
    },
  );
  return { command: createClient(SkillCommandController, transport), log };
}

const isCreateSkill = (check: AuthzCheck): boolean => check.permission === IamPermission.can_create_skill;
const isViewFile = (check: AuthzCheck): boolean =>
  check.permission === IamPermission.can_view && check.resourceKind === ApiResourceKind.file;

describe("pushFromFile — every question before a byte is read", () => {
  it("asks can_create_skill first, then loads the File, asks can_view on it, reads it, and the push authorizes again", async () => {
    const { command, log } = harness({
      file: fileOf(ORG, 2048),
      deny: (check, ask) => isCreateSkill(check) && ask > 2,
    });

    const error = await errorOf(() => command.pushFromFile({ org: ORG, fileId: FILE_ID, tag: "v1" }));

    expect(error.code).toBe(Code.PermissionDenied);
    expect(log).toEqual([
      `authorize can_create_skill organization ${ORG}`,
      `load file ${FILE_ID}`,
      `authorize can_view file ${FILE_ID}`,
      `read ${FILE_ID} 2048`,
      `authorize can_create_skill organization ${ORG}`,
    ]);
  });

  it("a caller who may not push skills is refused before the File is loaded", async () => {
    const { command, log } = harness({ file: fileOf(ORG, 2048), deny: isCreateSkill });

    const error = await errorOf(() => command.pushFromFile({ org: ORG, fileId: FILE_ID }));

    expect(error.code).toBe(Code.PermissionDenied);
    expect(log).toEqual([`authorize can_create_skill organization ${ORG}`]);
  });

  it("a missing File answers not-found and reads nothing", async () => {
    const { command, log } = harness({ file: undefined });

    const error = await errorOf(() => command.pushFromFile({ org: ORG, fileId: FILE_ID }));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`file not found: ${FILE_ID}`);
    expect(log).toEqual([`authorize can_create_skill organization ${ORG}`, `load file ${FILE_ID}`]);
  });

  it("another organization's File answers not-found before access to it is asked", async () => {
    const { command, log } = harness({ file: fileOf("org_other", 2048) });

    const error = await errorOf(() => command.pushFromFile({ org: ORG, fileId: FILE_ID }));

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(`file not found: ${FILE_ID}`);
    expect(log).toEqual([`authorize can_create_skill organization ${ORG}`, `load file ${FILE_ID}`]);
  });

  it("a File the caller may not view is refused with its bytes unread", async () => {
    const { command, log } = harness({ file: fileOf(ORG, 2048), deny: isViewFile });

    const error = await errorOf(() => command.pushFromFile({ org: ORG, fileId: FILE_ID }));

    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("unauthorized to get file");
    expect(log.some((line) => line.startsWith("read "))).toBe(false);
  });

  it("a File over the archive cap is refused with its bytes unread", async () => {
    const { command, log } = harness({ file: fileOf(ORG, MAX_ZIP_SIZE + 1) });

    const error = await errorOf(() => command.pushFromFile({ org: ORG, fileId: FILE_ID }));

    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(
      `file ${FILE_ID} is ${MAX_ZIP_SIZE + 1} bytes; a skill archive may be at most ${MAX_ZIP_SIZE}`,
    );
    expect(log.some((line) => line.startsWith("read "))).toBe(false);
  });

  it("a store fault loading the File answers a sanitized Internal and reads nothing", async () => {
    const { command, log } = harness({ file: fileOf(ORG, 2048), loadFault: new Error("SQLITE_BUSY: database is locked") });

    const error = await errorOf(() => command.pushFromFile({ org: ORG, fileId: FILE_ID }));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to load file");
    expect(log.some((line) => line.startsWith("read "))).toBe(false);
  });

  it("a read that fails with its own answer passes it through, and pushes nothing", async () => {
    const { command, log } = harness({
      file: fileOf(ORG, 2048),
      readFault: new ConnectError("the file's bytes are missing", Code.Internal),
    });

    const error = await errorOf(() => command.pushFromFile({ org: ORG, fileId: FILE_ID }));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("the file's bytes are missing");
    expect(log.filter((line) => line.startsWith("authorize can_create_skill"))).toHaveLength(1);
  });

  it("a read that fails without an answer of its own answers a sanitized Internal", async () => {
    const { command } = harness({ file: fileOf(ORG, 2048), readFault: new Error("socket hang up") });

    const error = await errorOf(() => command.pushFromFile({ org: ORG, fileId: FILE_ID }));

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to read the file");
  });

  it.each([
    ["org", { fileId: FILE_ID }],
    ["file_id", { org: ORG }],
  ])("an empty %s answers InvalidArgument before any question", async (_field, request) => {
    const { command, log } = harness({ file: fileOf(ORG, 2048) });

    const error = await errorOf(() => command.pushFromFile(request));

    expect(error.code).toBe(Code.InvalidArgument);
    expect(log).toEqual([]);
  });
});
