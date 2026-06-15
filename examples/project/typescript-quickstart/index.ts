// SDK synthesis entry point.
//
// `defineProject` registers resources functionally; `await project.synth()`
// writes one proto (.pb) file per resource into STIGMER_OUT_DIR, which
// `stigmer apply` sets before running this file. The CLI then pushes the skills,
// applies the resources, and records project membership for reconciliation.
//
// Run it with:  stigmer apply
// (Org is taken from `--org`, your CLI context, or STIGMER_ORG_ID.)

import { defineProject } from "@stigmer/sdk/synth";

const project = defineProject((ctx) => {
  // Skills are pushed first so agents can reference them by slug. A skill's
  // slug is its SKILL.md `name` (here: "calculator").
  ctx.skill.fromDir("./skills/calculator");

  ctx.agent({
    name: "math-helper",
    org: process.env.STIGMER_ORG_ID ?? "",
    instructions: "You are a careful assistant. Use the calculator skill for arithmetic.",
    skillRefs: [{ org: process.env.STIGMER_ORG_ID ?? "", slug: "calculator" }],
  });
});

await project.synth();
