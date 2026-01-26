---
name: Phase 1 Codegen Fixes
overview: "Fix critical issues in the code generation pipeline: remove DEBUG statements from generator, eliminate dead code, improve buf.validate extraction with proper protoreflect APIs, and extend namespace coverage to include IAM and tenancy."
todos:
  - id: 1.1-remove-debug
    content: Remove DEBUG print statement generation from generator/main.go lines 1032 and 1046
    status: completed
  - id: 1.2-remove-dead-code
    content: Delete dead generateHelpersFile function (lines 515-569) from generator/main.go
    status: completed
  - id: 1.3-improve-validation
    content: Rewrite extractValidation() using protoreflect APIs instead of string matching
    status: completed
  - id: 1.4-extend-namespaces
    content: Extend runComprehensiveGeneration() to scan IAM and tenancy namespaces
    status: completed
  - id: regenerate-verify
    content: "Regenerate all SDK code and verify: no DEBUG statements, build passes, schemas include IAM/tenancy"
    status: completed
isProject: false
---

# Phase 1: Code Generation Pipeline Fixes

This phase addresses critical issues in the code generation tools that produce the SDK's generated code. These tools are foundational - their quality directly impacts every generated file.

---

## Task 1.1: Remove DEBUG Print Statements (HIGH)

### Problem

The generator embeds `fmt.Printf("DEBUG ...")` statements INTO the generated Go code. This is not debug output during generation - it's debug code that ships in production.

**Evidence**: 4 generated files currently contain DEBUG statements:

```47:57:sdk/go/gen/workflow/trytaskconfig.go
// ToProto converts TryTaskConfig to google.protobuf.Struct for proto marshaling.
func (c *TryTaskConfig) ToProto() (*structpb.Struct, error) {
	data := make(map[string]interface{})

	if !isEmpty(c.Try) {
		// Convert Try array to proto-compatible format using JSON marshaling
		jsonBytes, err := json.Marshal(c.Try)
		if err != nil {
			return nil, err
		}
		fmt.Printf("DEBUG Try JSON: %s\n", string(jsonBytes))
```

### Root Cause

In [tools/codegen/generator/main.go](tools/codegen/generator/main.go), lines 1032 and 1046:

```go
fmt.Fprintf(w, "\t\tfmt.Printf(\"DEBUG %s JSON: %%s\\n\", string(jsonBytes))\n", field.Name)
```

### Fix

Remove both DEBUG-generating lines from `genToProtoMethod`. The JSON marshaling logic remains - only the debug output is removed.

### Verification

- Run `go run tools/codegen/generator/main.go --comprehensive`
- Verify no generated files contain `DEBUG` with: `grep -r "DEBUG" sdk/go/gen/`
- Run `go build ./...` to ensure build passes

---

## Task 1.2: Remove Dead Code (HIGH)

### Problem

`generateHelpersFile()` (lines 515-569) is a 55-line function that duplicates `generateHelpers()` (lines 459-513) but is never called.

### Evidence

```515:569:tools/codegen/generator/main.go
// generateHelpersFile generates a helpers.go file in the specified directory
func (g *Generator) generateHelpersFile(outputDir string) error {
	var buf bytes.Buffer
	// ... identical implementation to generateHelpers() ...
}
```

The only difference: `generateHelpersFile` takes an `outputDir` parameter and uses `writeFormattedFileToDir`. But it's never invoked - only `generateHelpers()` at line 130 is called.

### Fix

Delete the entire `generateHelpersFile` function (lines 515-569).

### Verification

- `go build ./tools/codegen/generator/...`
- Ensure no compilation errors about missing function

---

## Task 1.3: Improve buf.validate Extraction (MEDIUM)

### Problem

Validation extraction uses brittle string matching instead of protoreflect APIs:

```644:660:tools/codegen/proto2schema/main.go
// Get the full proto text representation of the field
protoText := field.AsProto().String()
optsStr := opts.String()
fullText := protoText + " " + optsStr

if strings.Contains(fullText, "required") &&
	(strings.Contains(fullText, "= true") || ...)
```

This approach:

1. Is fragile to proto format changes
2. Misses several validation types (pattern, string.in, float constraints)
3. Cannot distinguish between similarly-named constraints

### Current Extraction Status

| Validation Type | Status |

|-----------------|--------|

| `required` | Partial (string match) |

| `min_len` / `max_len` | Partial |

| `gte` / `lte` | Partial |

| `min_items` / `max_items` | Partial |

| `string.in` (enums) | **Not extracted** |

| `pattern` | **Not extracted** |

| `float.gte` / `double.gte` | **Not supported** |

### Fix Approach

Use protoreflect to properly access buf.validate extensions:

```go
import (
    "buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go/buf/validate"
    "google.golang.org/protobuf/proto"
)

func extractValidation(field *desc.FieldDescriptor) *Validation {
    opts := field.GetFieldOptions()
    if opts == nil {
        return nil
    }
    
    // Use proto.GetExtension to properly extract buf.validate.field
    ext := proto.GetExtension(opts, validate.E_Field)
    if ext == nil {
        return nil
    }
    
    fieldConstraints, ok := ext.(*validate.FieldConstraints)
    if !ok || fieldConstraints == nil {
        return nil
    }
    
    validation := &Validation{}
    
    // Required constraint
    if fieldConstraints.GetRequired() {
        validation.Required = true
    }
    
    // String constraints
    if strConstraints := fieldConstraints.GetString_(); strConstraints != nil {
        if strConstraints.MinLen != nil {
            validation.MinLength = int(*strConstraints.MinLen)
        }
        if strConstraints.MaxLen != nil {
            validation.MaxLength = int(*strConstraints.MaxLen)
        }
        if strConstraints.Pattern != nil {
            validation.Pattern = *strConstraints.Pattern
        }
        // String enum constraints (string.in)
        if len(strConstraints.In) > 0 {
            validation.Enum = strConstraints.In
        }
    }
    
    // ... similar for int, float, repeated constraints
    
    return validation
}
```

### Dependencies

Add to `go.mod`:

```
buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go
```

### Verification

- Parse a proto with various buf.validate rules
- Verify all constraint types are properly extracted to JSON schema

---

## Task 1.4: Extend Namespace Coverage (MEDIUM)

### Problem

`runComprehensiveGeneration` only scans the `agentic` namespace:

```255:256:tools/codegen/proto2schema/main.go
agenticDir := filepath.Join(includeDir, "ai", "stigmer", "agentic")
```

This misses:

- `apis/ai/stigmer/iam/apikey/v1/spec.proto` → ApiKeySpec
- `apis/ai/stigmer/iam/iampolicy/v1/spec.proto` → IamPolicySpec  
- `apis/ai/stigmer/iam/identityaccount/v1/spec.proto` → IdentityAccountSpec
- `apis/ai/stigmer/tenancy/organization/v1/spec.proto` → OrganizationSpec

### Fix

Refactor to scan multiple top-level namespaces:

```go
func runComprehensiveGeneration(includeDir, baseOutputDir string, useBufCache bool) error {
    if baseOutputDir == "" {
        baseOutputDir = "tools/codegen/schemas"
    }

    stigmerDir := filepath.Join(includeDir, "ai", "stigmer")
    
    // Define all top-level namespaces to scan
    topLevelNamespaces := []string{"agentic", "iam", "tenancy"}
    
    for _, namespace := range topLevelNamespaces {
        namespaceDir := filepath.Join(stigmerDir, namespace)
        if _, err := os.Stat(namespaceDir); os.IsNotExist(err) {
            continue
        }
        
        // Scan subdirectories (e.g., iam/apikey, iam/iampolicy)
        subDirs, _ := os.ReadDir(namespaceDir)
        for _, subDir := range subDirs {
            if !subDir.IsDir() {
                continue
            }
            
            // Process each v1 directory
            protoDir := filepath.Join(namespaceDir, subDir.Name(), "v1")
            outputDir := filepath.Join(baseOutputDir, namespace, subDir.Name())
            
            if err := generateNamespaceSchemas(protoDir, outputDir, ...); err != nil {
                // ...
            }
        }
    }
    
    // ... existing workflow tasks handling
}
```

### Verification

- Run with `--comprehensive` flag
- Verify schemas generated for IAM and tenancy resources
- Check output structure: `tools/codegen/schemas/iam/apikey/apikey.json`, etc.

---

## Execution Order

1. **Task 1.1** (5 min) - Remove DEBUG lines, regenerate, verify
2. **Task 1.2** (2 min) - Delete dead function, verify build
3. **Task 1.3** (30 min) - Implement proper validation extraction
4. **Task 1.4** (15 min) - Extend namespace scanning

---

## Post-Implementation Verification

```bash
# Build codegen tools
go build ./tools/codegen/...

# Run comprehensive generation
go run tools/codegen/proto2schema/main.go --comprehensive

# Regenerate SDK code
go run tools/codegen/generator/main.go --comprehensive

# Verify no DEBUG statements
grep -r "DEBUG" sdk/go/gen/ && echo "FAIL: DEBUG found" || echo "PASS"

# Verify build
go build ./...
```

---

## Files Modified

| File | Changes |

|------|---------|

| `tools/codegen/generator/main.go` | Remove lines 1032, 1046 (DEBUG); Delete lines 515-569 (dead code) |

| `tools/codegen/proto2schema/main.go` | Rewrite `extractValidation`; Extend `runComprehensiveGeneration` |

| `tools/codegen/proto2schema/go.mod` | Add protovalidate dependency |

| `sdk/go/gen/workflow/*.go` | Regenerated without DEBUG statements |