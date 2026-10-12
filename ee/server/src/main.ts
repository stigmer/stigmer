/**
 * The package's process entry, where every standalone Stigmer server keeps
 * its own: at the root of the build output, so the consumer-install check,
 * the library's boot check and an image's command all start a server from
 * the same place. The entry itself is editions/enterprise-entry.ts, which
 * reads the license key and boots the edition it decides; this file only
 * loads it.
 */
import "./editions/enterprise-entry.js";
