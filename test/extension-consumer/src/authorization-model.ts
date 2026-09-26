/**
 * The compile proof of the one data file @stigmer/server publishes beside
 * its barrel: `@stigmer/server/authorization-model.json`, the compiled
 * authorization model (OpenFGA's JSON, generated from the server's
 * fga/model; its README states the file's contract). An edition that runs
 * OpenFGA applies exactly these bytes, so the subpath must resolve through
 * the exports map for TypeScript as it does for `require.resolve` and the
 * `fga` CLI.
 *
 * It imports the file as a JSON module and reads it through the small
 * structural type a consumer that applies the model needs. It runs against
 * the file-linked package on every PR and against the packed tarball in
 * `npm run verify:consumer`, so a subpath that stops resolving, or a file
 * the tarball does not carry, fails here. Never executed.
 */
import compiledModel from "@stigmer/server/authorization-model.json" with { type: "json" };

/** What a consumer applying the model reads: OpenFGA's schema version and one entry per type. */
interface AuthorizationModelJson {
  readonly schema_version: string;
  readonly type_definitions: ReadonlyArray<{ readonly type: string }>;
}

export const authorizationModel: AuthorizationModelJson = compiledModel;

export const authorizationModelTypes: ReadonlyArray<string> =
  authorizationModel.type_definitions.map((definition) => definition.type);
