/**
 * Pins Stigmer's OAuth Client ID Metadata Document: offered only on a
 * public https origin (a login server fetches the URL itself, and http or a
 * laptop's localhost is no client id), naming every redirect a sign-in may
 * use, and a public client.
 */
import { describe, expect, it } from "vitest";

import { clientDocument, clientDocumentUrlFor } from "../client-document.js";

describe("clientDocumentUrlFor", () => {
  it("is the document's URL on an https public origin, whatever its trailing slash", () => {
    expect(clientDocumentUrlFor("https://api.stigmer.example")).toBe("https://api.stigmer.example/v1/oauth/client.json");
    expect(clientDocumentUrlFor("https://api.stigmer.example/")).toBe("https://api.stigmer.example/v1/oauth/client.json");
  });

  it("is none for an http origin, an unset one, or a value that is no URL", () => {
    expect(clientDocumentUrlFor("http://192.168.1.5:7234")).toBe("");
    expect(clientDocumentUrlFor("")).toBe("");
    expect(clientDocumentUrlFor("not a url")).toBe("");
  });
});

describe("clientDocument", () => {
  it("lists the console's callback, its desktop bridge and the loopback page, as a public client", () => {
    const url = "https://api.stigmer.example/v1/oauth/client.json";
    expect(JSON.parse(clientDocument(url, "https://console.stigmer.example/auth/oauth/callback"))).toEqual({
      client_id: url,
      client_name: "Stigmer",
      redirect_uris: [
        "https://console.stigmer.example/auth/oauth/callback",
        "https://console.stigmer.example/auth/oauth/callback?source=desktop",
        "http://127.0.0.1/auth/oauth/callback",
      ],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("lists only the loopback page when the deployment has no console callback", () => {
    expect(JSON.parse(clientDocument("https://api.stigmer.example/v1/oauth/client.json", "")).redirect_uris).toEqual([
      "http://127.0.0.1/auth/oauth/callback",
    ]);
  });
});
