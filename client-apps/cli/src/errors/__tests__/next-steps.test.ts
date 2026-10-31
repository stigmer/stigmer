// Proves that every error kind the classifier words ends with what to do,
// and that the words follow what the running command recorded: a server
// that cannot be reached is named by the address the backend client
// dialled, with the next step its source calls for (start the local daemon,
// check the named backend, look at the override); a code path that made no
// client names no address; a missing resource points at the list of the
// type the command resolved; a refused request points at the running
// command's help. The records are set by hand here, as the client and the
// commands set them (client/__tests__/client.test.ts and
// commands/__tests__/not-found-type.test.ts prove those seams).

import { Code, ConnectError } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/client";
import { ExitCode } from "@stigmer/client/exit-codes";
import { afterEach, describe, expect, it } from "vitest";
import { setActionCommand, setActionResourceType, setServerAddress } from "../../runtime.js";
import { cannotConnect, classify, isTransportFailure } from "../classify.js";

afterEach(() => {
  setServerAddress(undefined);
  setActionCommand("");
  setActionResourceType("");
});

const unavailable = (): ConnectError => new ConnectError("connect ECONNREFUSED 127.0.0.1:7234", Code.Unavailable);

describe("CLI-04 a server that cannot be reached is named by the address tried, with the fix its source calls for", () => {
  it("names the local daemon's address and says to start it", () => {
    expect(cannotConnect({ address: "localhost:7234", source: "local" })).toEqual({
      message: "Could not reach the Stigmer server at localhost:7234",
      hints: ["Start it: stigmer up"],
    });
  });

  it("names a cloud backend's address and points at the backend's status", () => {
    expect(cannotConnect({ address: "api.example.com:443", source: "cloud" })).toEqual({
      message: "Could not reach the Stigmer server at api.example.com:443",
      hints: ["Check the backend: stigmer config backend status"],
    });
  });

  it("names a self-hosted backend's address and points at the backend's status", () => {
    expect(cannotConnect({ address: "stigmer.acme.internal:7234", source: "selfhost" })).toEqual({
      message: "Could not reach the Stigmer server at stigmer.acme.internal:7234",
      hints: ["Check the backend: stigmer config backend status"],
    });
  });

  it("names the override as the address's source and says how to leave it", () => {
    expect(cannotConnect({ address: "10.0.0.5:7234", source: "environment" })).toEqual({
      message: "Could not reach the Stigmer server at 10.0.0.5:7234 (set by STIGMER_SERVER_ADDRESS)",
      hints: ["Start the server it names, or unset STIGMER_SERVER_ADDRESS to use the active backend."],
    });
  });

  it("names no address when no client was made, and still says where to look", () => {
    expect(cannotConnect(undefined)).toEqual({
      message: "Could not reach the Stigmer server",
      hints: ["Check the backend: stigmer config backend status"],
    });
  });

  it("reads the address the client recorded, for a raw and a wrapped Unavailable alike", () => {
    setServerAddress({ address: "localhost:7234", source: "local" });
    const expected = {
      exitCode: ExitCode.Connection,
      code: Code.Unavailable,
      message: "Could not reach the Stigmer server at localhost:7234",
      hints: ["Start it: stigmer up"],
    };
    expect(classify(unavailable())).toEqual(expect.objectContaining(expected));
    expect(classify(new StigmerError("unavailable", "down", Code.Unavailable, { cause: unavailable() }))).toEqual(
      expect.objectContaining(expected),
    );
  });

  it("follows the record as it changes, never an address resolved again", () => {
    setServerAddress({ address: "api.example.com:443", source: "cloud" });
    expect(classify(unavailable())?.message).toBe("Could not reach the Stigmer server at api.example.com:443");
    setServerAddress(undefined);
    expect(classify(unavailable())?.message).toBe("Could not reach the Stigmer server");
  });
});

describe("CLI-04 a missing resource points at the list of its type", () => {
  const notFound = (): ConnectError => new ConnectError("agent 'demo/reviewer' not found", Code.NotFound);

  it("names the type the command resolved", () => {
    setActionResourceType("agent");
    expect(classify(notFound())).toEqual(
      expect.objectContaining({
        exitCode: ExitCode.NotFound,
        message: "agent 'demo/reviewer' not found",
        hints: ["Check the reference: stigmer list agent"],
      }),
    );
  });

  it("names what a reference is made of when no type was recorded", () => {
    expect(classify(notFound())?.hints).toEqual(["Check the reference and the organization (--org)."]);
  });
});

describe("CLI-04 a refused request points at the running command's help", () => {
  const refusals: ReadonlyArray<readonly [string, Code, string]> = [
    ["invalid argument", Code.InvalidArgument, "nope"],
    ["failed precondition", Code.FailedPrecondition, "Precondition failed: nope"],
    ["already exists", Code.AlreadyExists, "Already exists: nope"],
  ];

  it.each(refusals)("names the command for %s", (_name, code, message) => {
    setActionCommand("stigmer get");
    expect(classify(new ConnectError("nope", code))).toEqual(
      expect.objectContaining({ exitCode: ExitCode.Usage, message, hints: ["Run `stigmer get --help` for usage."] }),
    );
  });

  it.each(refusals)("names the root's help for %s before any command ran", (_name, code) => {
    expect(classify(new ConnectError("nope", code))?.hints).toEqual(["Run `stigmer --help` for usage."]);
  });
});

describe("CLI-04 the remaining kinds end with what to do", () => {
  it("says a remote cancel can be tried again", () => {
    expect(classify(new ConnectError("the server canceled the call", Code.Canceled))).toEqual(
      expect.objectContaining({
        exitCode: ExitCode.General,
        message: "Operation cancelled",
        hints: ["The server cancelled the request. Try again."],
      }),
    );
  });

  it.each([Code.Unknown, Code.Unimplemented, Code.OutOfRange, Code.DataLoss])(
    "points an unnamed kind (code %s) at --debug",
    (code) => {
      expect(classify(new ConnectError("odd", code))?.hints).toEqual(["Run with --debug for more details."]);
    },
  );

  it("keeps a local error's own hints and none of the address", () => {
    setServerAddress({ address: "localhost:7234", source: "local" });
    expect(classify(new Error("ENOENT: no such file or directory, open 'agent.yaml'"))).toEqual({
      exitCode: ExitCode.General,
      message: "ENOENT: no such file or directory, open 'agent.yaml'",
      cause: expect.any(Error),
    });
  });
});

describe("CLI-04 an Unavailable the server sent keeps the server's words", () => {
  it("names the address only when the request never reached a server", () => {
    setServerAddress({ address: "localhost:7234", source: "local" });
    const answered = classify(new ConnectError("My vault is being created by another request; try again", Code.Unavailable));
    expect([answered?.exitCode, answered?.message, answered?.hints]).toEqual([
      3,
      "My vault is being created by another request; try again",
      ["The server could not take the request just now. Try again in a moment."],
    ]);
    const refused = classify(new ConnectError("connect ECONNREFUSED 127.0.0.1:7234", Code.Unavailable));
    expect(refused?.message).toBe("Could not reach the Stigmer server at localhost:7234");
  });

  it("reads a network failure from the message's words or from a code in the cause chain", () => {
    for (const words of ["fetch failed", "socket hang up", "getaddrinfo ENOTFOUND api.example.com", "other side closed", "NGHTTP2_REFUSED_STREAM"]) {
      expect(isTransportFailure(words, undefined), words).toBe(true);
    }
    const reset = Object.assign(new Error("read failed"), { code: "ECONNRESET" });
    expect(isTransportFailure("", new Error("wrapped", { cause: reset }))).toBe(true);
    expect(isTransportFailure("", new Error("terminated", { cause: new Error("UND_ERR_SOCKET") }))).toBe(true);
    expect(isTransportFailure("the provider is unavailable for this organization", new Error("no code"))).toBe(false);
    expect(isTransportFailure("", Object.assign(new Error("x"), { code: 14 }))).toBe(false);
  });
});

