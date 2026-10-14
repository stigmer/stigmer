/**
 * The federation issuer's single read and delete hooks go through the
 * client's own federationIssuer surface:
 *
 *   - useFederationIssuer reads one issuer by id with
 *     `federationIssuer.get` and answers it as `federationIssuer`, and asks
 *     nothing while its id is null;
 *   - useDeleteFederationIssuer deletes with `federationIssuer.delete` and
 *     answers the deleted issuer, its failure kept as the hook's error.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { StigmerContext } from "../../context";
import { useFederationIssuer } from "../useFederationIssuer";
import { useDeleteFederationIssuer } from "../useDeleteFederationIssuer";

const OKTA = create(FederationIssuerSchema, {
  metadata: { id: "fis_okta", name: "Acme Okta", slug: "acme-okta", org: "acme" },
});

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
  };
}

describe("useFederationIssuer", () => {
  it("reads the issuer by its id and answers it", async () => {
    const get = vi.fn(async () => OKTA);
    const { result } = renderHook(() => useFederationIssuer("fis_okta"), {
      wrapper: wrapper({ federationIssuer: { get } }),
    });
    await waitFor(() => expect(result.current.federationIssuer).toBe(OKTA));
    expect(get).toHaveBeenCalledWith("fis_okta");
    expect(result.current.error).toBeNull();
  });

  it("asks nothing while its id is null", () => {
    const get = vi.fn(async () => OKTA);
    const { result } = renderHook(() => useFederationIssuer(null), {
      wrapper: wrapper({ federationIssuer: { get } }),
    });
    expect(result.current.federationIssuer).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useDeleteFederationIssuer", () => {
  it("deletes through the client and answers the deleted issuer", async () => {
    const del = vi.fn(async () => OKTA);
    const { result } = renderHook(() => useDeleteFederationIssuer(), {
      wrapper: wrapper({ federationIssuer: { delete: del } }),
    });
    let deleted: unknown;
    await act(async () => {
      deleted = await result.current.deleteProvider({ resourceId: "fis_okta" });
    });
    expect(del).toHaveBeenCalledWith({ resourceId: "fis_okta" });
    expect(deleted).toBe(OKTA);
    expect(result.current.isDeleting).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps a failed delete's error and rethrows it", async () => {
    const del = vi.fn(async () => {
      throw new Error("refused");
    });
    const { result } = renderHook(() => useDeleteFederationIssuer(), {
      wrapper: wrapper({ federationIssuer: { delete: del } }),
    });
    await act(async () => {
      await expect(result.current.deleteProvider({ resourceId: "fis_okta" })).rejects.toThrow("refused");
    });
    expect(result.current.error?.message).toBe("refused");
  });
});
