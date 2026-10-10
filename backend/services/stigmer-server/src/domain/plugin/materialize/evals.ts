/**
 * The plugin's eval suite, as the install receipt summarises it.
 *
 * The push reads the suite from the same archive the install reads, with
 * the library's `readEvalSuite`, and records what the plugin page and the
 * CLI list before anyone runs it: the suite's directory, each case's name,
 * path, tags and the feature Stigmer does not run yet, and every finding
 * as a `PluginWarning`. The suite is the author's tests, not a member, so
 * nothing about it refuses or changes an install: a case that does not
 * load is a finding on the receipt. The eval workflow reads the archive
 * again at the digest it runs; this summary is for display, and a plugin
 * installed before it existed carries none until its next push.
 *
 * `planEvals` is `undefined` when the plugin has no eval directory and the
 * manifest said nothing about one, so `PluginStatus.evals` stays unset.
 */
import { create } from "@bufbuild/protobuf";

import { readEvalSuite } from "@stigmer/plugin-package";
import type { EvalSuite, PluginFiles } from "@stigmer/plugin-package";
import {
  PluginEvalSuiteCaseSchema,
  PluginEvalSuiteSchema,
  PluginWarningSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { PluginEvalSuite } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";

/** The suite the archive carries; `undefined` when it carries none. */
export function planEvals(files: PluginFiles): EvalSuite | undefined {
  const suite = readEvalSuite(files);
  const prefix = `${suite.dir}/`;
  const present = files.entries.some((entry) => entry.path.startsWith(prefix));
  return present || suite.findings.length > 0 ? suite : undefined;
}

/** The suite in the contract's shape. */
export function evalSuiteOf(suite: EvalSuite): PluginEvalSuite {
  return create(PluginEvalSuiteSchema, {
    dir: suite.dir,
    caseCount: suite.cases.length,
    caseTags: [...new Set(suite.cases.flatMap((c) => c.tags))].sort(),
    cases: suite.cases.map((c) =>
      create(PluginEvalSuiteCaseSchema, {
        caseName: c.name,
        path: c.dir,
        caseTags: [...c.tags],
        unsupported: c.unsupported ?? "",
      }),
    ),
    findings: suite.findings.map((finding) =>
      create(PluginWarningSchema, {
        kind: finding.kind,
        message: finding.message,
        path: finding.path,
      }),
    ),
  });
}
