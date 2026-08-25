import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { ProviderStandingQueryController } from "@stigmer/protos/ai/stigmer/platform/providerstanding/v1/query_pb";
import {
  GetProviderStandingViewInputSchema,
  type ProviderStandingView,
} from "@stigmer/protos/ai/stigmer/platform/providerstanding/v1/io_pb";
import { wrapError } from "./gen/errors.js";

/**
 * Client for platform provider standing (platform operators only).
 *
 * Serves the read-only operator view of the platform's LLM provider
 * account health: the latest canary-probe verdict per provider (status,
 * HTTP status, latency, bounded error summary, probe time) recorded by
 * the hourly standing probe. Requires `can_view_provider_standing` on
 * `platform:stigmer`. Cloud-only — the OSS server does not implement
 * this controller.
 */
export class ProviderStandingClient {
  private readonly query: Client<typeof ProviderStandingQueryController>;

  constructor(transport: Transport) {
    this.query = createClient(ProviderStandingQueryController, transport);
  }

  /** Retrieve the latest probe verdict for every platform provider. */
  async getStandingView(): Promise<ProviderStandingView> {
    try {
      return await this.query.getProviderStandingView(
        create(GetProviderStandingViewInputSchema, {}),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }
}
