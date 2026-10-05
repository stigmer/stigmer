/**
 * The organization purge's proof on SQLite (organization-purge-suite.ts
 * says what it pins).
 */
import {
  describeOrganizationPurge,
  sqliteDatabase,
} from "./organization-purge-suite.js";

describeOrganizationPurge("sqlite", () => sqliteDatabase);
