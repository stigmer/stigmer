# PIVOT SUMMARY: Functional Options → Struct-Based Args

**Date**: 2026-01-24
**For**: Next conversation starting T06

---

## What Happened

We spent T01-T05 implementing functional options code generation:

```go
// What we built (WRONG):
agent.New(ctx, "reviewer",
    gen.AgentInstructions("Review code"),
    gen.AgentDescription("Pro reviewer"),
)
```

But discovered Pulumi uses **struct-based args**, not functional options:

```go
// What Pulumi actually does (CORRECT):
s3.NewBucket(ctx, "my-bucket", &s3.BucketArgs{
    Acl: pulumi.String("private"),
    Tags: pulumi.StringMap{...},
})
```

**User asked:** "Is `gen.AgentInstructions()` how Pulumi does it?"

**We verified:** NO. Pulumi uses struct args across ALL providers.

---

## What We Need to Do

Pivot to struct-based args following Pulumi's exact pattern:

```go
// NEW API (what we're implementing in T06):
agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: "Review code and suggest improvements",
    Description:  "Professional code reviewer",
    IconUrl:      "https://example.com/icon.png",
})
```

---

## Key Documents to Read

**Start here:**
1. `tasks/T06_0_plan.md` - Multi-conversation implementation plan
2. `design-decisions/2026-01-24-pivot-to-struct-based-args.md` - Why we're pivoting
3. `wrong-assumptions/2026-01-24-functional-options-not-pulumi-pattern.md` - What we learned

---

## T06 Phase Breakdown

### Phase 1: Generator → Args Structs (~2 hours)
- Update generator to produce `type AgentArgs struct { ... }`
- Remove option function generation
- Output to main package, not `gen/`

### Phase 2: Constructor Updates (~1.5 hours)
- Change signature: `New(ctx, name, *Args, ...ResourceOption)`
- Map args fields to Agent struct
- Delete old `gen/` packages

### Phase 3: SDK Options (~1 hour)
- Implement `Parent()`, `DependsOn()`, `Protect()`
- Separate from resource config

### Phase 4: Update Examples (~2 hours)
- Rewrite 8 agent examples
- Use struct args pattern

### Phase 5: Workflow Tasks (~1.5 hours)
- Apply to workflow task constructors
- Update workflow examples

### Phase 6: Docs & Cleanup (~30 min)
- Update README
- Migration guide
- Delete old code

---

## First Step for Next Conversation

```bash
# 1. Clone Pulumi AWS provider for reference
git clone --depth 1 https://github.com/pulumi/pulumi-aws /tmp/pulumi-aws

# 2. Study actual Pulumi pattern
cd /tmp/pulumi-aws/sdk/go/aws/s3
cat bucket.go | grep -A 30 "type BucketArgs"
cat bucket.go | grep -A 20 "func NewBucket"

# 3. Start implementation
cd /Users/suresh/scm/github.com/stigmer/stigmer
# Open: tools/codegen/generator/main.go
# Focus: Remove genFieldSetters, add genArgsStruct
```

---

## Critical Principle

**"Always ask: What does Pulumi do?"**

Before implementing ANYTHING:
1. Clone Pulumi provider
2. Find relevant example
3. Copy the pattern EXACTLY
4. Don't innovate, imitate

---

## What's Already Done

✅ Generator infrastructure (parsing, types, helpers)
✅ Package organization (agent, skill, workflow)
✅ Project documentation structure
✅ Understanding of what needs to change

❌ Generated option functions (must be replaced)
❌ Examples using old API (must be rewritten)
❌ Functional options pattern (wrong, must pivot)

---

## Success Criteria for T06

By the end of T06:
- [ ] Generator produces `Args` structs
- [ ] SDK uses `New(ctx, name, *Args, ...ResourceOption)`
- [ ] Examples match Pulumi style
- [ ] API is Pulumi-idiomatic
- [ ] Documentation is accurate

---

## Quick Start Command

```
@stigmer/_projects/2026-01/20260123.02.sdk-options-codegen/next-task.md

Ready to start T06 Phase 1.
First step: Clone pulumi-aws and study BucketArgs pattern.
Then update generator to produce Args structs.
```

---

**Remember:** Verify with Pulumi source code before implementing anything. Code is truth, opinions are noise.
