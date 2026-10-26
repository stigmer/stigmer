/**
 * The one error this library throws for a fetch that did not produce a
 * verified artifact: a persistent network failure, an HTTP status that is an
 * answer, a digest mismatch, or an archive that breaks the extraction rules.
 * `message` says what failed and `details` the facts behind it (the URL, the
 * expected and actual digest, what to do), one line each, so a consumer
 * renders its own surface (the CLI's exit error, the runner's turn failure)
 * without parsing the message.
 */
export class ArtifactFetchError extends Error {
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[] = []) {
    super(message);
    this.name = "ArtifactFetchError";
    this.details = details;
  }
}
