// Pins describeConnectionFailure (INK-05's wording): the step and the address
// in the headline, the client's plain cause, the next step by the failure's
// kind (a socket error in a plain Error's message counts as no server), and
// the raw message kept as details.
import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { describeConnectionFailure } from "../errors.js";

const URL = "http://localhost:7234";

describe("describeConnectionFailure", () => {
  it("names the step and the address", () => {
    const error = new ConnectError("connect ECONNREFUSED 127.0.0.1:7234", Code.Unavailable);
    expect(describeConnectionFailure(error, URL, "start").headline).toBe("Could not start the run at http://localhost:7234.");
    expect(describeConnectionFailure(error, URL, "load").headline).toBe("Could not load the session from http://localhost:7234.");
    expect(describeConnectionFailure(error, URL, "stream").headline).toBe("Lost the session's stream from http://localhost:7234.");
    expect(describeConnectionFailure(error, "", "load").headline).toBe("Could not load the session from the server.");
  });

  it.each([
    ["no server", new ConnectError("connect ECONNREFUSED 127.0.0.1:7234", Code.Unavailable), "Is the server running?"],
    ["no server, as a plain error", new Error("connect ECONNREFUSED 127.0.0.1:7234"), "Is the server running?"],
    ["a refused key", new ConnectError("bad key", Code.Unauthenticated), "Check STIGMER_API_KEY: the server did not accept"],
    ["a key without access", new ConnectError("no", Code.PermissionDenied), "may not use this organization"],
    ["nothing there", new ConnectError("no such session", Code.NotFound), "Check the session id and the organization"],
    ["a refused request", new ConnectError("bad", Code.InvalidArgument), "Check the arguments"],
    ["a server failure", new ConnectError("boom", Code.Internal), "The server failed"],
    ["a cancelled request", new ConnectError("stop", Code.Canceled), "The request was cancelled"],
    ["anything else", new Error("odd"), "Try again"],
  ])("%s gets its next step", (_name, error, next) => {
    const failure = describeConnectionFailure(error, URL, "load");
    expect(failure.next).toContain(next);
    expect(failure.details).toBe(error.message);
  });

  it("says the cause plainly and keeps a thrown non-error as details", () => {
    expect(describeConnectionFailure(new Error("connect ECONNREFUSED 127.0.0.1:1"), URL, "load").cause).toBe("Unable to connect to the server.");
    expect(describeConnectionFailure("a string", URL, "load").details).toBe("a string");
  });
});
