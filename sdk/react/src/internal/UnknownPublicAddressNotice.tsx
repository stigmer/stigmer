"use client";

/** Props for {@link UnknownPublicAddressNotice}. */
export interface UnknownPublicAddressNoticeProps {
  /** What cannot be shown, as it reads mid-sentence ("the callback URL"). */
  readonly subject: string;
}

/**
 * Shown in place of a copyable URL or snippet when the server's public
 * address is unknown (`usePublicBaseUrl` answered `null`): the client talks
 * to the server through a relative `baseUrl` and the host named no
 * `publicBaseUrl`. One sentence, shared by every copy surface, so a user is
 * told plainly why there is nothing to copy instead of being offered an
 * address Slack, Meta or a backend cannot call.
 *
 * The surface keeps its own label above the notice, the shape the channel
 * app panel already uses for a verify token it can no longer show. The
 * reader is the host's user, not its developer, so the copy names no prop
 * or configuration.
 */
export function UnknownPublicAddressNotice({
  subject,
}: UnknownPublicAddressNoticeProps) {
  return (
    <p className="stg:text-[0.65rem] stg:text-muted-foreground">
      This app doesn&apos;t know your Stigmer server&apos;s public address, so
      it can&apos;t show {subject}.
    </p>
  );
}
