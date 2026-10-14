// Pins how the SDK generators recognise a paged list and name its methods.
// A list is paged when its request carries page_size and page_token and its
// response a repeated message `entries` and next_page_token; anything short
// of that (a capped window, an event cursor, a stream) stays a plain call
// with no iterator. One client serves every service of a resource package,
// so two services' `list` is renamed on the client through one table, and a
// collision the table does not name fails the generator.
import { describe, expect, it } from "vitest";

import type { MethodSchema, ServiceDefinition, ServiceSchemaFile } from "../gen-common.js";
import {
  assertUniqueSdkMethodNames,
  pageIteratorName,
  pagedListOf,
  protoFileOfMessage,
  sdkMethodName,
} from "../gen-common.js";
import type { FieldSchema, TypeSchema, TypeSpec } from "../schema.js";

const PKG = "ai.stigmer.agentic.thing.v1";

function field(protoField: string, type: TypeSpec): FieldSchema {
  return { name: protoField, jsonName: protoField, protoField, type, description: "", required: false } as FieldSchema;
}

function type(name: string, fields: FieldSchema[]): TypeSchema {
  return { name, description: "", protoType: `${PKG}.${name}`, protoFile: "", fields } as TypeSchema;
}

const pageRequest = type("ListThingsRequest", [
  field("org", { kind: "string" }),
  field("page_size", { kind: "int32" }),
  field("page_token", { kind: "string" }),
]);
const pageResponse = type("ThingList", [
  field("entries", { kind: "array", elementType: { kind: "message", messageType: "Thing" } }),
  field("next_page_token", { kind: "string" }),
]);
const cursorResponse = type("ThingEventList", [
  field("events", { kind: "array", elementType: { kind: "message", messageType: "ThingEvent" } }),
  field("next_page_token", { kind: "string" }),
]);
const windowRequest = type("ListRecentThingsRequest", [field("page_size", { kind: "int32" })]);

function method(name: string, input: TypeSchema, output: TypeSchema, extra: Partial<MethodSchema> = {}): MethodSchema {
  return {
    name,
    inputType: input.name,
    inputFullType: input.protoType,
    outputType: output.name,
    outputFullType: output.protoType,
    ...extra,
  };
}

function schema(services: ServiceDefinition[], types: TypeSchema[]): ServiceSchemaFile {
  return { resource: "thing", package: PKG, goImportPath: "", services, methodTypes: types };
}

describe("pagedListOf", () => {
  const types = [pageRequest, pageResponse, cursorResponse, windowRequest];
  const s = schema([], types);

  it("recognises a list in the one shape and names its entry type", () => {
    expect(pagedListOf(s, method("List", pageRequest, pageResponse))).toEqual({
      entryType: "Thing",
      entryFullType: `${PKG}.Thing`,
    });
  });

  it("leaves a cursor whose response carries no entries a plain call", () => {
    expect(pagedListOf(s, method("ListEvents", pageRequest, cursorResponse))).toBeUndefined();
  });

  it("leaves a capped window with no page token a plain call", () => {
    expect(pagedListOf(s, method("ListRecent", windowRequest, pageResponse))).toBeUndefined();
  });

  it("leaves a streaming method a plain call", () => {
    expect(pagedListOf(s, method("Watch", pageRequest, pageResponse, { serverStreaming: true }))).toBeUndefined();
  });

  it("names the iterator after its list", () => {
    expect(pageIteratorName("ListByAgent")).toBe("ListByAgentAll");
  });
});

describe("SDK method names", () => {
  const listThings = method("List", pageRequest, pageResponse);
  const thingQuery: ServiceDefinition = { name: "ThingQueryController", role: "query", methods: [listThings] };

  it("keeps a method's RPC name when nothing collides", () => {
    expect(sdkMethodName(thingQuery, listThings)).toBe("List");
  });

  it("renames the conversation list on the agent channel client", () => {
    const conversations: ServiceDefinition = {
      name: "ChannelConversationQueryController",
      role: "channelConversationQuery",
      methods: [listThings],
    };
    expect(sdkMethodName(conversations, listThings)).toBe("ListConversations");
  });

  it("refuses two services whose methods would share one SDK name", () => {
    const other: ServiceDefinition = { name: "OtherThingQueryController", role: "otherThingQuery", methods: [listThings] };
    expect(() => assertUniqueSdkMethodNames(schema([thingQuery, other], [pageRequest, pageResponse]))).toThrow(
      /ThingQueryController.List.*both become the SDK method List/,
    );
  });

  it("refuses a method named like another list's page iterator", () => {
    const listAll = method("ListAll", windowRequest, pageResponse);
    const svc: ServiceDefinition = { name: "ThingQueryController", role: "query", methods: [listThings, listAll] };
    expect(() => assertUniqueSdkMethodNames(schema([svc], [pageRequest, pageResponse, windowRequest]))).toThrow(
      /ListAll/,
    );
  });
});

describe("protoFileOfMessage", () => {
  it("finds the file that declares a message, wherever the generator runs", () => {
    expect(protoFileOfMessage("ai.stigmer.agentic.schedule.v1.ScheduleFire")).toBe(
      "apis/ai/stigmer/agentic/schedule/v1/io.proto",
    );
  });

  it("refuses a message no file declares", () => {
    expect(() => protoFileOfMessage("ai.stigmer.agentic.schedule.v1.NoSuchMessage")).toThrow(/declares message/);
  });
});
