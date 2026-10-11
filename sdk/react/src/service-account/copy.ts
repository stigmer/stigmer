/**
 * The words and the one route every service-account surface shares, so the
 * settings page, the Members page's group and the share picker say the same
 * thing about the same accounts, and a host that mounts the settings page
 * elsewhere changes one link.
 */
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

/** The settings page that manages service accounts, as the hosts route it. */
export const SERVICE_ACCOUNTS_SETTINGS_HREF = "/settings/service-accounts";

/** Said where a caller may not manage service accounts. */
export const SERVICE_ACCOUNTS_MANAGED_BY_ADMINS =
  "Your organization's admins manage its service accounts.";

/** The label a service account carries wherever it is listed beside people. */
export const SERVICE_ACCOUNT_LABEL = "Service account";

/**
 * The organization roles a role picker leaves out for a service account:
 * owner, because an owner decides who owns the organization and a key in a
 * CI job must never be able to. The server refuses it too.
 */
export const SERVICE_ACCOUNT_OMITTED_ROLES: readonly IamRole[] = [IamRole.owner];

/** The role a new service account starts on. */
export const DEFAULT_SERVICE_ACCOUNT_ROLE = IamRole.member;
