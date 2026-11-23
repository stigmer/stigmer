/**
 * The Stigmer the app talks to. By default, the one `stigmer up` runs on
 * your machine, which trusts every caller and made the Organization
 * `stigmer`. For Stigmer Cloud, set STIGMER_SERVER to
 * https://api.stigmer.ai, STIGMER_API_KEY to a service account's key and
 * STIGMER_ORG to your Organization's slug.
 */
import { createNodeClient } from "@stigmer/client/node";

const baseUrl = process.env.STIGMER_SERVER ?? "http://localhost:7234";
const apiKey = process.env.STIGMER_API_KEY;

export const stigmer = createNodeClient(
  apiKey === undefined ? { baseUrl, getAccessToken: () => null } : { baseUrl, apiKey },
);

export const org = process.env.STIGMER_ORG ?? "stigmer";
