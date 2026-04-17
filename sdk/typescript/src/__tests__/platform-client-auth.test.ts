import { describe, it, expect } from "vitest";
import {
  createPlatformClientAuth,
  PlatformClientAuth,
} from "../platform-client-auth";

describe("createPlatformClientAuth", () => {
  it("throws when baseUrl is missing", () => {
    expect(() =>
      createPlatformClientAuth({
        baseUrl: "",
        clientId: "stgm_cid_abc",
        clientSecret: "stgm_cs_xyz",
      }),
    ).toThrow("baseUrl is required");
  });

  it("throws when clientId is missing", () => {
    expect(() =>
      createPlatformClientAuth({
        baseUrl: "https://api.stigmer.ai",
        clientId: "",
        clientSecret: "stgm_cs_xyz",
      }),
    ).toThrow("clientId is required");
  });

  it("throws when clientSecret is missing", () => {
    expect(() =>
      createPlatformClientAuth({
        baseUrl: "https://api.stigmer.ai",
        clientId: "stgm_cid_abc",
        clientSecret: "",
      }),
    ).toThrow("clientSecret is required");
  });

  it("returns a PlatformClientAuth instance with valid config", () => {
    const auth = createPlatformClientAuth({
      baseUrl: "https://api.stigmer.ai",
      clientId: "stgm_cid_abc",
      clientSecret: "stgm_cs_xyz",
    });
    expect(auth).toBeInstanceOf(PlatformClientAuth);
  });
});

describe("PlatformClientAuth.mintUserToken", () => {
  it("throws StigmerError when userId is empty", async () => {
    const auth = createPlatformClientAuth({
      baseUrl: "https://api.stigmer.ai",
      clientId: "stgm_cid_abc",
      clientSecret: "stgm_cs_xyz",
    });

    await expect(
      auth.mintUserToken({ userId: "" }),
    ).rejects.toThrow("userId is required");
  });

  it("throws StigmerError with invalid-argument code when userId is empty", async () => {
    const auth = createPlatformClientAuth({
      baseUrl: "https://api.stigmer.ai",
      clientId: "stgm_cid_abc",
      clientSecret: "stgm_cs_xyz",
    });

    try {
      await auth.mintUserToken({ userId: "" });
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(e).toHaveProperty("code", "invalid-argument");
      expect(e).toHaveProperty("name", "StigmerError");
    }
  });
});
