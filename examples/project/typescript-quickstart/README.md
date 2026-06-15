# TypeScript Quickstart (SDK Synthesis)

A minimal, runnable Stigmer project that defines its resources in code using
`@stigmer/sdk/synth` and deploys them with `stigmer apply`.

```
typescript-quickstart/
├── stigmer.yaml              # Project config; spec.entry_point: index.ts
├── index.ts                  # defineProject(...) + await project.synth()
├── package.json              # @stigmer/sdk + tsx
└── skills/
    └── calculator/
        └── SKILL.md          # a local skill (slug = its `name`)
```

## How it works

1. `stigmer apply` finds `stigmer.yaml`. Because `spec.entry_point` is set, it
   runs the **SDK synthesis track** (the runtime is inferred from the `.ts`
   extension → Node, executed with `tsx`).
2. The CLI runs `index.ts` with `STIGMER_OUT_DIR` (and `STIGMER_ORG_ID`) set.
   `await project.synth()` writes one `.pb` file per registered resource into
   that directory.
3. The CLI reads the `.pb` files, pushes the skills, applies the agents /
   workflows / MCP servers, and records project membership so the server can
   reconcile (resources you remove from the code are pruned on the next apply).

## Run it

```bash
npm install          # installs @stigmer/sdk and tsx
stigmer apply        # synthesize + deploy (uses --org or your CLI context)

# Preview without deploying:
stigmer apply --dry-run
```

## The authoring API

```ts
import { defineProject } from "@stigmer/sdk/synth";

const project = defineProject((ctx) => {
  ctx.skill.fromDir("./skills/calculator");      // local skill
  ctx.skill.fromGit({ url: "https://github.com/org/skills.git", subdir: "web" });
  ctx.agent({ name: "math-helper", org: "acme", instructions: "..." });
  ctx.workflow({ name: "onboard", org: "acme", document: { namespace: "acme", name: "onboard", version: "1.0.0" } });
  ctx.mcpServer({ name: "filesystem", org: "acme" });
});

await project.synth();   // explicit — no import-time magic
```

`ctx.agent` / `ctx.workflow` / `ctx.mcpServer` accept the same `*Input` shapes
the imperative `@stigmer/sdk` clients use, so there is one way to describe a
resource. `synth()` resolves its output directory from `STIGMER_OUT_DIR` (set by
`stigmer apply`); pass `synth({ outDir })` to run it directly in a test.
