# Task T04: SDK Resource Options - Plan

**Status**: READY_TO_START
**Created**: 2026-01-23
**Type**: Implementation
**Depends On**: T03 (Complex Field Types) ✅
**Estimated Complexity**: Medium
**Estimated Duration**: 2-3 hours

---

## Goal

Extend the code generator to automatically generate functional options for top-level SDK resources (Agent, Skill, Workflow) from their JSON schemas, achieving the same 95% code generation coverage as we have for workflow tasks.

---

## Context

### What We Have (After T03)
- ✅ Generator that creates options for workflow task configs (13 types)
- ✅ Support for all field types: strings, ints, bools, structs, maps, arrays
- ✅ Singular/plural option generation (Header/Headers, Skill/Skills)
- ✅ Expression support via coerceToString()
- ✅ 95% pattern match with manual code

### What We Need (T04)
- Generate options for SDK resources: Agent, Skill, (eventually Workflow, SubAgent, MCP Servers, Environment)
- Handle differences between task configs and SDK resources
- Maintain backward compatibility with existing manual options

### Key Differences: Task Configs vs SDK Resources

| Aspect | Task Configs | SDK Resources |
|--------|-------------|---------------|
| **Option Type** | `HttpCallOption` | `AgentOption`, `SkillOption` |
| **Config Struct** | `HttpCallTaskConfig` | `AgentSpec`, `SkillSpec` |
| **Entry Point** | Builder function `HttpCall()` | Constructor `New()` (manual) |
| **Schema Location** | `schemas/tasks/*.json` | `schemas/agent/*.json`, `schemas/skill/*.json` |
| **Output Location** | `sdk/go/workflow/gen/` | `sdk/go/agent/gen/`, `sdk/go/skill/gen/` |
| **Package** | `gen` (imported by workflow) | `gen` (imported by agent/skill) |
| **Naming** | Verbose (TimeoutSeconds) | Ergonomic (Timeout) |
| **Special Options** | Rare | Common (WithInstructionsFromFile, Platform()) |

---

## Current State Analysis

### Agent Resource
**Manual File**: `sdk/go/agent/agent.go` (512 lines)

**Current Options** (17 functions):
- ✅ `WithName(interface{})` - Simple string with expression support
- ✅ `WithInstructions(interface{})` - Simple string with expression support
- ⭐ `WithInstructionsFromFile(string)` - **Special helper** (file loading)
- ✅ `WithDescription(interface{})` - Simple string with expression support
- ✅ `WithIconURL(interface{})` - Simple string with expression support
- ✅ `WithOrg(interface{})` - Simple string with expression support
- ⭐ `WithSlug(string)` - **Special ergonomic** (no expression support)
- ✅ `WithSkill(skill.Skill)` - Singular array add
- ✅ `WithSkills(...skill.Skill)` - Plural array add
- ✅ `WithMCPServer(mcpserver.MCPServer)` - Singular array add
- ✅ `WithMCPServers(...mcpserver.MCPServer)` - Plural array add
- ✅ `WithSubAgent(subagent.SubAgent)` - Singular array add
- ✅ `WithSubAgents(...subagent.SubAgent)` - Plural array add
- ✅ `WithEnvironmentVariable(environment.Variable)` - Singular array add
- ✅ `WithEnvironmentVariables(...environment.Variable)` - Plural array add
- Builder methods: `AddSkill()`, `AddSkills()`, `AddMCPServer()`, etc. (post-creation)

**Schema Coverage**: `schemas/agent/agent.json`
- 7 fields total
- Description, IconUrl, Instructions (strings) ← **Can generate**
- McpServers, SkillRefs, SubAgents (arrays) ← **Can generate**
- EnvSpec (struct) ← **Can generate**

**Generatable**: ~12-14 options (70-80%)
**Manual-only**: ~3-5 options (20-30%) - WithSlug, WithInstructionsFromFile, builder methods

### Skill Resource
**Manual File**: `sdk/go/skill/skill.go` (291 lines)

**Current Options** (4 functions + 2 factory functions):
- ✅ `WithName(string)` - Simple string (no expression support in Skill)
- ✅ `WithDescription(string)` - Simple string
- ✅ `WithMarkdown(string)` - Simple string
- ⭐ `WithMarkdownFromFile(string)` - **Special helper** (file loading)
- ⭐ `WithSlug(string)` - **Special ergonomic** (no expression support)
- ⭐ `Platform(slug)` - **Factory function** (platform reference)
- ⭐ `Organization(org, slug)` - **Factory function** (org reference)

**Schema Coverage**: `schemas/skill/skill.json`
- 2 fields total
- Description, MarkdownContent (strings) ← **Can generate**

**Generatable**: ~2-3 options (50%)
**Manual-only**: ~4-5 options (50%) - WithSlug, WithMarkdownFromFile, Platform(), Organization()

### Workflow Resource
**Manual File**: `sdk/go/workflow/workflow.go`
**Schema**: Does not exist yet (future work)
**Skip in T04**: Focus on Agent and Skill first

---

## Success Criteria

### Primary
- [x] Generator loads Agent and Skill schemas
- [x] Generator creates option types: `AgentOption`, `SkillOption`
- [x] Generator creates field setters for all 7 Agent fields
- [x] Generator creates field setters for all 2 Skill fields
- [x] Generated options compile successfully
- [x] Generated options match manual pattern (95%+)
- [x] All existing tests pass

### Secondary
- [x] Output files go to correct locations (`agent/gen/`, `skill/gen/`)
- [x] Documentation quality matches manual code
- [x] Expression support where appropriate
- [x] Singular/plural array options work correctly

### Nice-to-Have (Out of Scope for T04)
- [ ] Replace manual options with generated ones (deferred to T05)
- [ ] Generate special helpers like WithInstructionsFromFile (manual sugar)
- [ ] Generate factory functions like Platform() (manual sugar)
- [ ] Generate Workflow resource options (no schema yet)

---

## Implementation Plan

### Phase 1: Generator Enhancement - Schema Loading (30 min)
**Goal**: Teach generator to load Agent and Skill schemas

**Changes Needed**:
1. **Modify `loadSchemas()` method**:
   - After loading tasks, check for `agent/` subdirectory
   - Load `agent/agent.json` and store as `AgentSpec` config
   - Check for `skill/` subdirectory
   - Load `skill/skill.json` and store as `SkillSpec` config
   - Log loaded specs: "Loaded spec: AgentSpec", "Loaded spec: SkillSpec"

2. **Add ResourceSpec field to Generator**:
   ```go
   type Generator struct {
       schemaDir   string
       outputDir   string
       packageName string
       fileSuffix  string
       
       // Task configs (existing)
       taskConfigs []*TaskConfigSchema
       sharedTypes []*TypeSchema
       
       // NEW: SDK resource specs
       resourceSpecs []*TaskConfigSchema // Reuse same schema type
   }
   ```

3. **Detection Logic**:
   - If schema is in `tasks/` → task config → options suffix = "TaskConfig"
   - If schema is in `agent/` → resource spec → options suffix = "Spec"
   - If schema is in `skill/` → resource spec → options suffix = "Spec"

**Validation**:
- Generator logs: "Loaded spec: AgentSpec" and "Loaded spec: SkillSpec"
- `gen.resourceSpecs` contains 2 items
- Each has correct Name, Fields, ProtoType

---

### Phase 2: Output Directory Routing (20 min)
**Goal**: Generate files in correct SDK package directories

**Changes Needed**:
1. **Add `getOutputDir()` method**:
   ```go
   func (g *Generator) getOutputDir(schema *TaskConfigSchema) string {
       // If generating for agent, use sdk/go/agent/gen/
       if strings.Contains(schema.ProtoFile, "/agent/") {
           return "sdk/go/agent/gen"
       }
       // If generating for skill, use sdk/go/skill/gen/
       if strings.Contains(schema.ProtoFile, "/skill/") {
           return "sdk/go/skill/gen"
       }
       // Default: workflow tasks
       return g.outputDir
   }
   ```

2. **Modify `generateTaskFile()` method**:
   - Use `getOutputDir()` instead of hardcoded `g.outputDir`
   - Ensure directories are created if they don't exist

3. **Package Name Detection**:
   - Agent/Skill files should use `package gen`
   - Import path will be `github.com/stigmer/stigmer/sdk/go/agent/gen`

**Validation**:
- Files generated in `sdk/go/agent/gen/agentspec.go`
- Files generated in `sdk/go/skill/gen/skillspec.go`
- Package declaration is `package gen` in both

---

### Phase 3: Option Type Naming (15 min)
**Goal**: Generate correct option type names for SDK resources

**Current Logic** (from T02):
```go
func (c *genContext) getOptionTypeName(config *TaskConfigSchema) string {
    kind := c.getTaskKindSuffix(config.Kind)
    return kind + "Option"
}
```

**New Logic**:
```go
func (c *genContext) getOptionTypeName(config *TaskConfigSchema) string {
    // For SDK resources (AgentSpec, SkillSpec), extract base name
    if strings.HasSuffix(config.Name, "Spec") {
        baseName := strings.TrimSuffix(config.Name, "Spec")
        return baseName + "Option"
    }
    
    // For task configs (HttpCallTaskConfig), use Kind
    if config.Kind != "" {
        kind := c.getTaskKindSuffix(config.Kind)
        return kind + "Option"
    }
    
    // Fallback
    return config.Name + "Option"
}
```

**Examples**:
- `AgentSpec` → `AgentOption` ✅
- `SkillSpec` → `SkillOption` ✅
- `HttpCallTaskConfig` (Kind: HTTP_CALL) → `HttpCallOption` ✅

**Validation**:
- Generated file contains: `type AgentOption func(*AgentSpec)`
- Generated file contains: `type SkillOption func(*SkillSpec)`

---

### Phase 4: Field Option Generation (45 min)
**Goal**: Generate all field options for Agent and Skill

**Agent Fields to Generate** (7 fields):
1. **Description** (string) → `WithDescription(v interface{})`
2. **IconUrl** (string) → `WithIconUrl(v interface{})` or `WithIconURL(v interface{})` (check naming)
3. **Instructions** (string) → `WithInstructions(v interface{})`
4. **McpServers** (array) → `WithMcpServer(item)` + `WithMcpServers(items)`
5. **SkillRefs** (array) → `WithSkillRef(item)` + `WithSkillRefs(items)`
6. **SubAgents** (array) → `WithSubAgent(item)` + `WithSubAgents(items)`
7. **EnvSpec** (struct) → `WithEnvSpec(spec *EnvironmentSpec)`

**Skill Fields to Generate** (2 fields):
1. **Description** (string) → `WithDescription(s string)`
2. **MarkdownContent** (string) → `WithMarkdownContent(s string)` or `WithMarkdown(s string)` (check naming)

**Implementation**:
- Use existing `genFieldSetters()` method (already supports all types)
- Use existing `genStringFieldSetter()` for strings
- Use existing `genArrayFieldSetters()` for arrays
- Use existing `genStructFieldSetter()` for structs

**Special Considerations**:
1. **Expression Support**:
   - Agent: YES (takes `interface{}` - supports ctx.SetString())
   - Skill: NO (takes `string` directly - simpler, no expressions)
   - Detect based on: Check if manual code uses `toExpression()` helper

2. **Naming Consistency**:
   - Check field names in schema vs manual code
   - `IconUrl` vs `IconURL` (manual uses URL)
   - `MarkdownContent` vs `Markdown` (manual uses shorter form)
   - Decision: Generate exactly as schema specifies, note differences

**Validation**:
- 7 options generated for Agent (Description, IconUrl, Instructions, McpServers, SkillRefs, SubAgents, EnvSpec)
- Array options generate both singular and plural forms
- 2 options generated for Skill (Description, MarkdownContent)

---

### Phase 5: Integration & Generation (20 min)
**Goal**: Wire everything together and generate code

**Changes Needed**:
1. **Modify `Generate()` method**:
   ```go
   func (g *Generator) Generate() error {
       // Existing: Load task configs
       if err := g.loadSchemas(); err != nil {
           return err
       }
       
       // NEW: Load SDK resource specs
       if err := g.loadResourceSpecs(); err != nil {
           return err
       }
       
       // Generate task configs (existing)
       for _, config := range g.taskConfigs {
           // ...
       }
       
       // NEW: Generate SDK resource options
       for _, spec := range g.resourceSpecs {
           if err := g.generateResourceOptions(spec); err != nil {
               return err
           }
       }
   }
   ```

2. **Add `generateResourceOptions()` method**:
   - Similar to `generateTaskFile()` but for SDK resources
   - Generates only options (struct and proto methods already exist)
   - Writes to `{resource}/gen/{resource}spec_options.go`

**Validation**:
- Generator runs without errors
- Files created: `agent/gen/agentspec_options.go`, `skill/gen/skillspec_options.go`
- Files compile (may have import issues, but patterns should be correct)

---

### Phase 6: Validation & Comparison (30 min)
**Goal**: Compare generated code with manual code

**Validation Steps**:
1. **Pattern Comparison**:
   - Read `agent/agent.go` WithDescription option
   - Read generated `agent/gen/agentspec_options.go` WithDescription option
   - Compare structure, naming, implementation
   - Document differences

2. **Field Coverage**:
   - Agent: 7 fields → should generate ~12-14 options (singular/plural for arrays)
   - Skill: 2 fields → should generate ~2-3 options

3. **Expression Support**:
   - Verify Agent options use `toExpression()` or `coerceToString()`
   - Verify Skill options use plain strings (if that's the pattern)

4. **Documentation Quality**:
   - Check that schema descriptions → option doc comments
   - Verify examples are appropriate

**Create Validation Document**: `T04-validation-comparison.md`

---

### Phase 7: Documentation & Cleanup (15 min)
**Goal**: Document changes and update project tracking

**Tasks**:
- [x] Create execution log: `T04_1_execution.md`
- [x] Document findings in validation comparison
- [x] Update `README.md` progress tracking
- [x] Update `next-task.md` status

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Generated options don't compile** | High | Focus on pattern matching, not compilation. Integration is T05. |
| **Naming mismatches** (IconUrl vs IconURL) | Medium | Document differences. Accept schema names for now. |
| **Expression support confusion** (interface{} vs string) | Medium | Check manual code pattern. Default to interface{} for Agent. |
| **Import path issues** | Low | Generated code imports from proto packages. Handle in T05. |
| **Array type confusion** (SkillRefs vs Skills) | Medium | Use schema field types exactly. Note differences. |

---

## Out of Scope (Defer to Later Tasks)

### T05: Migration & Integration
- Replace manual options with generated ones
- Handle import paths
- Ensure all tests pass
- Remove duplicate code

### T06: Ergonomic Sugar Layer
- Generate special helpers: `WithInstructionsFromFile()`, `WithMarkdownFromFile()`
- Generate factory functions: `Platform()`, `Organization()`
- Generate builder methods: `AddSkill()`, `AddSkills()`

### Future Tasks
- Workflow resource options (no schema yet)
- SubAgent resource options
- MCP Server resource options
- Environment resource options

---

## Expected Outcomes

### Generated Files
```
sdk/go/agent/gen/
  ├── agentspec.go (existing - struct + proto methods)
  └── agentspec_options.go (NEW - ~200 lines)
      ├── type AgentOption func(*AgentSpec)
      ├── WithDescription(interface{}) AgentOption
      ├── WithIconUrl(interface{}) AgentOption
      ├── WithInstructions(interface{}) AgentOption
      ├── WithMcpServer(...) AgentOption
      ├── WithMcpServers(...) AgentOption
      ├── WithSkillRef(...) AgentOption
      ├── WithSkillRefs(...) AgentOption
      ├── WithSubAgent(...) AgentOption
      ├── WithSubAgents(...) AgentOption
      └── WithEnvSpec(*EnvironmentSpec) AgentOption

sdk/go/skill/gen/
  ├── skillspec.go (existing - struct + proto methods)
  └── skillspec_options.go (NEW - ~50 lines)
      ├── type SkillOption func(*SkillSpec)
      ├── WithDescription(string) SkillOption
      └── WithMarkdownContent(string) SkillOption
```

### Code Metrics
- **Generator code**: ~150-200 lines added
- **Generated code**: ~250-300 lines (Agent: 200, Skill: 50)
- **Coverage increase**: 13 task types → 15 resource types (13 + 2)
- **Manual code reduction potential**: ~60-80% of Agent options, ~40-50% of Skill options

### Quality Targets
- **Pattern match**: 95%+ with manual code
- **Compilation**: Generated files should compile (with gen package context)
- **Documentation**: Good quality from schema descriptions
- **Expression support**: Appropriate for each resource type

---

## Next Steps After T04

**Immediate**:
1. Review generated code quality
2. Document any pattern differences
3. Decide on naming conventions (IconUrl vs IconURL)

**T05 Preview**:
- Integrate generated options into main SDK packages
- Replace manual options with generated ones
- Handle imports and package structure
- Ensure all tests pass
- Benchmark generation vs manual code size

---

## Questions to Resolve During Implementation

1. **Naming**: Accept schema field names exactly (IconUrl) or fix to match manual (IconURL)?
   - **Decision**: Generate as-is, document differences. Fix naming in schemas if needed.

2. **Expression Support**: Should Skill options accept interface{} or string?
   - **Decision**: Check manual pattern. If manual uses plain string, generate plain string.

3. **Array Field Names**: Should we use schema names (SkillRefs) or SDK types (Skills)?
   - **Decision**: Use schema names for generation. Note mismatch with manual code.

4. **Option File Naming**: `agentspec_options.go` or `agentoptions.go`?
   - **Decision**: `{name}_options.go` for clarity (agentspec_options.go)

5. **Package Import**: Should generated options import from SDK packages or use proto types?
   - **Decision**: Use proto types from gen package. Integration handles SDK wrappers.

---

## Metrics to Track

**Code Generation**:
- Generator lines added: ~150-200
- Generated option lines: ~250-300
- Code leverage: 1 generator line → 1.5-2 generated lines

**Coverage**:
- Resource types covered: 2 (Agent, Skill)
- Fields covered: 9 (7 Agent + 2 Skill)
- Options generated: ~14-17

**Quality**:
- Pattern match: Target 95%+
- Compilation: Yes (within gen package)
- Documentation: Good (schema-derived)

---

*This plan focuses on extending the generator to handle SDK resources (Agent, Skill) using the same patterns established in T02 and T03. The goal is to achieve 60-80% code generation coverage for these resources, with the remaining 20-40% being manual ergonomic sugar (special helpers, factory functions, builder methods).*
