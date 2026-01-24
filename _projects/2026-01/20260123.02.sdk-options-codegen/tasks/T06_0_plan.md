# Task T06: Implement Struct-Based Args (Pulumi Pattern)

**Created**: 2026-01-24
**Type**: Multi-Conversation Implementation
**Estimated Duration**: 2-3 conversations (4-6 hours)
**Priority**: CRITICAL - Fixes wrong API pattern
**Depends On**: T05 (completed with wrong pattern)

---

## Overview

Pivot from functional options to struct-based args following Pulumi's exact pattern.

**Goal:** Generate `Args` structs (not option functions) and update all SDK constructors to match Pulumi's API style.

---

## Verification-First Approach

**BEFORE implementing ANYTHING:**

```bash
# Clone Pulumi AWS provider for reference
git clone --depth 1 https://github.com/pulumi/pulumi-aws /tmp/pulumi-aws

# Study actual patterns
cd /tmp/pulumi-aws/sdk/go/aws/s3
cat bucket.go | grep -A 50 "func NewBucket"

# Key questions to answer:
# 1. How are Args structs defined?
# 2. What types do fields use (string vs pulumi.StringInput)?
# 3. How are SDK options separated from args?
# 4. How are nested structs handled?
```

**Then proceed with implementation based on what Pulumi actually does.**

---

## Phase Breakdown

### Phase 1: Generator - Produce Args Structs (Conversation 1)

**Duration**: ~2 hours

**Objective:** Update code generator to produce `Args` structs instead of option functions.

**Steps:**

1. **Study Pulumi's Args Pattern**
   - Read `pulumi-aws/sdk/go/aws/s3/bucket.go`
   - Understand `BucketArgs` struct definition
   - Note field types, nested structs, optional fields
   - Document pattern in design-decisions/

2. **Update Generator Core**
   - Remove: `genFieldSetters()` and all option function generators
   - Add: `genArgsStruct()` to generate struct type
   - Update: `Generate()` to call struct generator instead of option generator

3. **Struct Generation Logic**
   ```go
   // What to generate:
   type AgentArgs struct {
       Instructions string
       Description  string
       IconUrl      string
       Skills       []skill.Skill
       McpServers   []mcpserver.MCPServer
   }
   ```

4. **Field Type Mapping**
   - String fields → `string`
   - Int fields → `int`
   - Bool fields → `bool`
   - Message fields → pointer to struct (e.g., `*SubAgentArgs`)
   - Array fields → slice (e.g., `[]skill.Skill`)
   - Map fields → map (e.g., `map[string]string`)

5. **Nested Struct Handling**
   - Generate args structs for nested message types
   - Example: `SubAgentArgs`, `McpServerArgs`, etc.

6. **Output Location**
   - `sdk/go/agent/args.go` (NOT `gen/` package)
   - `sdk/go/workflow/args.go`
   - Keep types close to constructors

**Deliverables:**
- Updated generator producing Args structs
- Generated `AgentArgs`, `SkillArgs` in correct packages
- Compilation successful (even if examples break)

**Verification:**
```bash
# Generate and verify
cd tools/codegen/generator
go run main.go

# Check output
cat sdk/go/agent/args.go
# Should show: type AgentArgs struct { ... }

# Verify compilation
cd sdk/go/agent
go build
```

---

### Phase 2: Constructor Updates (Conversation 1 or 2)

**Duration**: ~1.5 hours

**Objective:** Update SDK constructors to accept `*Args` structs.

**Steps:**

1. **Update Agent Constructor**
   ```go
   // OLD:
   func New(ctx Context, name string, opts ...gen.AgentOption) (*Agent, error)
   
   // NEW:
   func New(ctx Context, name string, args *AgentArgs, opts ...ResourceOption) (*Agent, error)
   ```

2. **Args → Agent Mapping**
   ```go
   func New(ctx Context, name string, args *AgentArgs, opts ...ResourceOption) (*Agent, error) {
       if args == nil {
           args = &AgentArgs{}
       }
       
       a := &Agent{
           Name:         name,
           Instructions: args.Instructions,
           Description:  args.Description,
           IconUrl:      args.IconUrl,
           Skills:       args.Skills,
           // ... map all fields
       }
       
       // Apply SDK-level options
       for _, opt := range opts {
           if err := opt(a); err != nil {
               return nil, err
           }
       }
       
       // Validate and register
       // ...
   }
   ```

3. **Update Skill, Workflow Constructors**
   - Same pattern for all SDK resources
   - Consistent API across the board

4. **Remove Old Code**
   - Delete `sdk/go/agent/gen/` directory
   - Remove `gen` imports from agent.go
   - Clean up any functional option remnants

**Deliverables:**
- All constructors accept `*Args` structs
- Old `gen/` packages deleted
- SDK compiles (examples still broken)

---

### Phase 3: SDK-Level ResourceOptions (Conversation 2)

**Duration**: ~1 hour

**Objective:** Implement Pulumi-style SDK options (Parent, DependsOn, Protect).

**Steps:**

1. **Study Pulumi's ResourceOption Pattern**
   ```bash
   cd /tmp/pulumi-aws
   grep -r "ResourceOption" sdk/go/pulumi/ | head -20
   # Study how Pulumi implements these
   ```

2. **Define ResourceOption Type**
   ```go
   // sdk/go/stigmer/options.go
   type ResourceOption func(*resourceState) error
   
   type resourceState struct {
       parent    Resource
       dependsOn []Resource
       protect   bool
       // ... other SDK concerns
   }
   ```

3. **Implement Common Options**
   ```go
   func Parent(parent Resource) ResourceOption {
       return func(state *resourceState) error {
           state.parent = parent
           return nil
       }
   }
   
   func DependsOn(deps ...Resource) ResourceOption {
       return func(state *resourceState) error {
           state.dependsOn = append(state.dependsOn, deps...)
           return nil
       }
   }
   
   func Protect(protect bool) ResourceOption {
       return func(state *resourceState) error {
           state.protect = protect
           return nil
       }
   }
   ```

4. **Integrate with Constructors**
   ```go
   func New(ctx Context, name string, args *AgentArgs, opts ...ResourceOption) (*Agent, error) {
       state := &resourceState{}
       
       // Apply SDK options
       for _, opt := range opts {
           if err := opt(state); err != nil {
               return nil, err
           }
       }
       
       // Use state.parent, state.dependsOn, etc.
       // ...
   }
   ```

**Deliverables:**
- ResourceOption infrastructure
- Parent(), DependsOn(), Protect() implemented
- Clear separation: config (args) vs options (SDK)

---

### Phase 4: Update Examples (Conversation 2 or 3)

**Duration**: ~2 hours

**Objective:** Rewrite all examples to use struct-based args pattern.

**Examples to Update:**
- 01_basic_agent.go
- 02_agent_with_skills.go
- 03_agent_with_mcp_servers.go
- 04_agent_with_subagents.go
- 05_agent_with_environment_variables.go
- 06_agent_with_instructions_from_files.go
- 12_agent_with_typed_context.go
- 13_workflow_and_agent_shared_context.go

**Pattern:**

```go
// OLD (functional options):
agent.New(ctx, "reviewer",
    gen.AgentInstructions("Review code"),
    gen.AgentDescription("Pro reviewer"),
)

// NEW (struct args):
agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code and suggest improvements",
    Description:  "Professional code reviewer",
})

// With SDK options:
agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",
}, stigmer.Parent(parentResource), stigmer.Protect(true))
```

**Steps:**

1. Update each example file
2. Test compilation: `go build examples/*.go`
3. Run examples: `go run examples/01_basic_agent.go`
4. Verify output correctness

**Deliverables:**
- All examples use struct args
- All examples compile and run
- Examples demonstrate SDK options where appropriate

---

### Phase 5: Workflow Task Args (Conversation 3)

**Duration**: ~1.5 hours

**Objective:** Apply struct args pattern to workflow tasks.

**Steps:**

1. **Generate Task Args Structs**
   ```go
   type HttpCallArgs struct {
       Method  string
       Uri     string
       Headers map[string]string
       Body    interface{}
       Timeout int
   }
   
   type AgentCallArgs struct {
       Agent   string  // or agent reference
       Message string
       Env     map[string]string
   }
   ```

2. **Update Task Constructors**
   ```go
   // OLD:
   func HttpCall(name string, opts ...HttpCallOption) *Task
   
   // NEW:
   func HttpCall(name string, args *HttpCallArgs, opts ...TaskOption) *Task
   ```

3. **Update Workflow Methods**
   ```go
   func (w *Workflow) HttpGet(name string, args *HttpCallArgs) *Task {
       if args == nil {
           args = &HttpCallArgs{}
       }
       args.Method = "GET"
       return HttpCall(name, args)
   }
   ```

4. **Update Workflow Examples**
   - 07-11 (workflow examples)
   - 15-19 (workflow + agent examples)

**Deliverables:**
- Task args structs generated
- Workflow package uses struct args
- Workflow examples updated

---

### Phase 6: Documentation & Cleanup (Conversation 3)

**Duration**: ~30 minutes

**Objective:** Document the new API and clean up old code.

**Steps:**

1. **Update README**
   - Show struct args examples
   - Document SDK options (Parent, DependsOn)
   - Migration guide (functional options → struct args)

2. **Delete Old Generated Code**
   ```bash
   rm -rf sdk/go/agent/gen/*_options.go
   rm -rf sdk/go/skill/gen/*_options.go
   rm -rf sdk/go/workflow/gen/*_options.go
   ```

3. **Update Generator Comments**
   - Remove references to "functional options"
   - Add "Pulumi-style struct args" comments

4. **Create Migration Guide**
   - File: `docs/migration-functional-to-struct-args.md`
   - Show before/after for common patterns
   - Reference for future breaking changes

**Deliverables:**
- README updated with new API
- Old code deleted
- Migration guide created
- Generator comments accurate

---

## Success Criteria

At the end of T06:

- [x] Generator produces `Args` structs (not option functions)
- [x] All SDK constructors accept `*Args` + `...ResourceOption`
- [x] SDK-level options (Parent, DependsOn, Protect) implemented
- [x] All examples use struct args pattern
- [x] Workflow tasks use struct args
- [x] All code compiles and runs
- [x] API matches Pulumi pattern exactly
- [x] Documentation is updated and accurate

## Verification Commands

```bash
# 1. Generator produces correct output
cd tools/codegen/generator
go run main.go
ls -la sdk/go/agent/args.go  # Should exist

# 2. SDK compiles
cd sdk/go
go build ./agent/... ./skill/... ./workflow/...

# 3. Examples compile
cd sdk/go/examples
go build -tags ignore *.go

# 4. Examples run
go run 01_basic_agent.go
go run 02_agent_with_skills.go

# 5. Pattern verification
grep -r "AgentArgs" sdk/go/agent/
# Should show: type AgentArgs struct { ... }
# Should NOT show: func AgentInstructions(...) AgentOption

# 6. Pulumi pattern match
diff <(grep "func New" /tmp/pulumi-aws/sdk/go/aws/s3/bucket.go) \
     <(grep "func New" sdk/go/agent/agent.go)
# Should show similar signatures
```

---

## Risk Management

### Risk 1: Pulumi Pattern Misunderstanding

**Mitigation:** Study Pulumi source code FIRST. Don't proceed until pattern is crystal clear.

**Verification:** Compare our generated Args to Pulumi's BucketArgs side-by-side.

### Risk 2: Nested Struct Complexity

**Mitigation:** Start with flat args (Agent, Skill), then add nested structs (SubAgent).

**Fallback:** If nested args are too complex, use plain structs initially.

### Risk 3: Expression Support

Pulumi uses `pulumi.StringInput` for dynamic values. We need:

**Decision Point:** Do we need expression support in Phase 1?
- **Option A:** Plain strings initially, add expressions later
- **Option B:** Expression support from the start (more complex)

**Recommendation:** Option A - Keep it simple, add expressions in T07 if needed.

---

## Conversation Breakdown

### Conversation 1 (~2 hours)
- Phase 1: Generator produces Args structs
- Phase 2: Constructor updates
- Deliverable: SDK compiles with new API

### Conversation 2 (~2 hours)
- Phase 3: SDK-level ResourceOptions
- Phase 4: Update agent examples (01-06, 12-13)
- Deliverable: Examples work with struct args

### Conversation 3 (~1.5 hours)
- Phase 5: Workflow task args
- Phase 6: Documentation & cleanup
- Deliverable: Complete, documented, Pulumi-style API

---

## Entry Point for Next Conversation

Drop this into the conversation:

```
@next-task.md

Ready to implement struct-based args (T06).
Quick context:
- We discovered functional options don't match Pulumi
- Pulumi uses *Args structs, not option functions
- Need to regenerate everything with correct pattern
- See design-decisions/ and wrong-assumptions/ for details

Starting with Phase 1: Update generator to produce Args structs.
```

---

## Key Principle

**"Ask not what we think Pulumi does. Clone, grep, and read what Pulumi actually does."**

Before implementing ANYTHING:
1. Clone pulumi-aws
2. Find relevant example
3. Copy the pattern exactly
4. Don't innovate, imitate

This ensures we match Pulumi conventions perfectly.
