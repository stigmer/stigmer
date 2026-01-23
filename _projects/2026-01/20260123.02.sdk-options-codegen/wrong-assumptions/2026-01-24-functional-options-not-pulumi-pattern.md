# Wrong Assumption: Functional Options Are Pulumi's Pattern

**Date**: 2026-01-24
**Discovered During**: T05 (Migration & Testing) - Example updates
**Impact**: Major - Entire code generation strategy was wrong

---

## What We Assumed

We believed Pulumi used functional options for resource configuration:

```go
// ❌ What we thought Pulumi did:
bucket, err := s3.NewBucket(ctx,
    s3.WithName("my-bucket"),
    s3.WithAcl("private"),
    s3.WithVersioning(true),
)
```

**This assumption drove our entire design:**
- Generated `gen.AgentOption` function type
- Generated `gen.AgentInstructions()`, `gen.AgentDescription()`, etc.
- Spent significant time implementing functional options pattern
- Updated examples to use `gen.Agent*()` functions

## What Pulumi Actually Does

Pulumi uses **struct-based args**, NOT functional options:

```go
// ✅ What Pulumi actually does:
bucket, err := s3.NewBucket(ctx, "my-bucket", &s3.BucketArgs{
    Acl: pulumi.String("private"),
    Versioning: &s3.BucketVersioningArgs{
        Enabled: pulumi.Bool(true),
    },
})
```

**Verification:**
- Checked Pulumi AWS provider source code
- Reviewed Pulumi documentation examples
- Searched for actual NewBucket usage patterns

**Finding:** Pulumi consistently uses struct args across ALL providers.

## Where Pulumi Uses Functional Options

Pulumi DOES use functional options, but ONLY for **SDK-level concerns**:

```go
// ✅ SDK-level options (NOT resource config):
bucket, err := s3.NewBucket(ctx, "my-bucket", &s3.BucketArgs{
    Acl: pulumi.String("private"),  // ← Resource config in struct
}, 
    pulumi.Parent(parentResource),   // ← SDK option
    pulumi.DependsOn([]pulumi.Resource{dep}), // ← SDK option
    pulumi.Protect(true),            // ← SDK option
)
```

**SDK Options Include:**
- `Parent()` - Set parent resource
- `DependsOn()` - Explicit dependencies
- `Protect()` - Prevent deletion
- `DeleteBeforeReplace()` - Replacement strategy
- `Provider()` - Override provider

**Resource Config:** Always in `*Args` struct
**SDK Options:** Separate functional options

## Why We Made This Mistake

### Source of Confusion

1. **Functional options exist in Pulumi** - We saw them and assumed they were for config
2. **Secondary sources mentioned options** - Blogs/docs mentioned "options" generically
3. **Didn't verify with actual code** - Should have checked pulumi/pulumi-aws source first
4. **Pattern seemed reasonable** - Functional options are popular in Go

### The Critical Error

We read ABOUT Pulumi instead of reading Pulumi's ACTUAL CODE.

**Should have done:**
```bash
git clone github.com/pulumi/pulumi-aws
grep -r "NewBucket" --include="*.go" | head -20
# Would immediately show &BucketArgs pattern
```

**What we did:**
- Read blog posts about Pulumi
- Saw mentions of "options pattern"
- Assumed it meant functional options for config
- Implemented without verification

## Cost of This Mistake

### Time Invested (Sunk Cost)

- **T02-T04**: ~6 hours implementing functional options generator
- **T05 Phase 1-2**: ~2 hours fixing generator bugs and conflicts
- **Example updates**: ~1 hour updating to wrong API
- **Total**: ~9 hours of work on wrong pattern

### Code to Discard

**Generated Code:**
- `sdk/go/agent/gen/*_options.go` - Delete all option functions
- `sdk/go/skill/gen/*_options.go` - Delete all option functions  
- `sdk/go/workflow/gen/*_options.go` - Delete all option functions

**Generator Code:**
- Remove: `genFieldSetters()` for option functions
- Remove: `genStringFieldSetter()`, `genIntFieldSetter()`, etc.
- Add: `genArgsStruct()` for struct generation

**Examples:**
- All 6 updated examples need rewriting AGAIN

### Silver Lining

The generator framework is solid:
- ✅ JSON schema parsing works perfectly
- ✅ Field type handling is complete
- ✅ Package organization is clean
- ✅ Helper generation logic is reusable

**We can pivot the output without rewriting everything.**

## What We Learned

### Lesson 1: Verify with Primary Sources

**Before implementing a pattern:**
1. Check actual source code from the reference project
2. Don't rely on blog posts or secondary descriptions
3. Run `git clone` and `grep` - it's faster than guessing

**Example verification:**
```bash
# Clone Pulumi AWS provider
git clone --depth 1 https://github.com/pulumi/pulumi-aws /tmp/pulumi-aws

# Check actual usage
cd /tmp/pulumi-aws
find . -name "*.go" -exec grep -l "NewBucket" {} \; | head -1 | xargs cat

# Would show: func NewBucket(ctx *Context, name string, args *BucketArgs, opts ...ResourceOption)
```

### Lesson 2: Question Assumptions Early

The user asked: "Why are you using `gen.AgentInstructions()`? Does Pulumi do that?"

**This was the moment to stop and verify.**

Instead, we doubled down on our assumption. Next time:
- When questioned, pause and verify
- Don't defend assumptions without evidence
- It's cheaper to verify than to continue wrong

### Lesson 3: Pre-Launch Flexibility is Valuable

Because we're **pre-launch**:
- ✅ Breaking changes are acceptable
- ✅ No production users to migrate
- ✅ Can pivot without customer impact

**This is the RIGHT time to get the API correct.**

If we had launched with functional options, we'd be stuck with the wrong pattern forever (or face massive breaking change costs).

## How to Avoid This in the Future

### Always Ask: "What Does Pulumi Do?"

Before designing ANY API:
1. Clone relevant Pulumi provider
2. Find similar resource/pattern
3. Copy the exact structure
4. Don't innovate where we should imitate

### Verification Checklist

For any major design decision:
- [ ] Checked Pulumi source code (not docs, not blogs)
- [ ] Found 3+ real examples of the pattern
- [ ] Verified across multiple providers (AWS, GCP, Azure)
- [ ] Tested the pattern ourselves before committing

### Red Flags to Watch For

If you hear yourself say:
- "I think Pulumi does..."
- "Functional options are a common Go pattern..."
- "This should work like..."

**STOP. VERIFY. CODE FIRST, OPINIONS SECOND.**

## Impact Assessment

### What's Wrong

- ❌ Generated option functions don't match Pulumi
- ❌ `gen.Agent*()` API is verbose and un-Pulumi-like
- ❌ Examples don't teach correct pattern
- ❌ Users would learn wrong habits

### What's Right

- ✅ Generator infrastructure (parsing, types, helpers)
- ✅ Package organization (agent, skill, workflow)
- ✅ Testing approach
- ✅ Project documentation structure

### Pivot Cost vs. Continue Cost

**Pivot Now:**
- 1-2 days to regenerate as structs
- 1 day to update examples
- Clean, correct API forever

**Continue Wrong:**
- API doesn't match Pulumi (confusing for users)
- Have to pivot later anyway (more expensive)
- Users learn wrong patterns

**Decision: Pivot now. The cost is temporary, the benefit is permanent.**

## Action Items

1. ✅ Document wrong assumption (this file)
2. ✅ Document correct design decision (struct-based args)
3. ⏳ Create new task plan (T06: Implement Struct-Based Args)
4. ⏳ Update generator to produce Args structs
5. ⏳ Rewrite examples with correct pattern
6. ⏳ Add "verify with Pulumi" to our review checklist

---

## Key Takeaway

**"Verify, don't assume. Code is truth, opinions are noise."**

When in doubt about Pulumi patterns: `git clone`, `grep`, and read the actual code. It's faster, cheaper, and correct.

This mistake cost us ~9 hours, but taught us a critical lesson: primary sources beat secondary descriptions every time.
