# gRPC Expression Evaluation Test Issue - ✅ RESOLVED

**File**: `task_builder_call_grpc_eval_test.go`  
**Status**: ✅ All tests passing  
**Resolved**: 2026-01-16  
**Related**: Task 2 of refactoring project

---

## Resolution Summary

The issue was **misdiagnosed**. The SDK actually uses **named types for both HTTP and gRPC** (`HTTPArguments` and `GRPCArguments`). The solution was to use direct struct initialization, just like the HTTP tests.

### What Actually Works ✅

```go
task := &model.CallGRPC{
    Call: "grpc",
    With: model.GRPCArguments{  // ← Named type, just like HTTPArguments!
        Service: model.GRPCService{
            Name: "${ $context.serviceName }",
            Host: "localhost",
            Port: 50051,
        },
        Method: "GetUser",
        Proto: &model.ExternalResource{
            Endpoint: model.NewEndpoint("file:///proto/user.proto"),
        },
        Arguments: map[string]interface{}{
            "userId": "${ $context.userId }",
        },
    },
}
```

### Test Results

- ✅ **11 test cases** - All passing
- ✅ **Service name evaluation** - Working
- ✅ **Service host evaluation** - Working
- ✅ **Method evaluation** - Working
- ✅ **Proto endpoint evaluation** - Working
- ✅ **Arguments evaluation** - Working
- ✅ **Nested arguments evaluation** - Working
- ✅ **String concatenation** - Working
- ✅ **Static values** - Working
- ✅ **Error handling** - Working
- ✅ **Mixed static/dynamic** - Working

---

## Root Cause (Actual)

The original issue document incorrectly stated that `CallGRPC` used anonymous structs. **This was wrong.**

### SDK Structure (Truth)

From `serverlessworkflow/sdk-go/v3@v3.2.0/model/task_call.go`:

```go
type CallHTTP struct {
    TaskBase `json:",inline"`
    Call     string           `json:"call"`
    With     HTTPArguments    `json:"with"`  // ← Named type
}

type HTTPArguments struct {
    Method   string
    Endpoint *Endpoint
    Headers  map[string]string
    Body     json.RawMessage
    Query    map[string]interface{}
    // ...
}

type CallGRPC struct {
    TaskBase `json:",inline"`
    Call     string        `json:"call"`
    With     GRPCArguments `json:"with"`  // ← Also a named type!
}

type GRPCArguments struct {
    Proto          *ExternalResource
    Service        GRPCService
    Method         string
    Arguments      map[string]interface{}
    Authentication *ReferenceableAuthenticationPolicy
}

type GRPCService struct {
    Name           string
    Host           string
    Port           int
    Authentication *ReferenceableAuthenticationPolicy
}
```

**Both HTTP and gRPC use named types.** There was never an anonymous struct issue.

---

## Why Use Named Types? (Design Philosophy)

The Serverless Workflow Specification uses named types for:

1. **Type Safety** - Clear, reusable types make the API self-documenting
2. **Validation** - Each type can have struct tags for validation (`validate:"required"`)
3. **Extensibility** - Easy to add new fields without breaking existing code
4. **Documentation** - IDEs show field documentation and autocomplete
5. **JSON Marshaling** - Named types control JSON serialization precisely
6. **Consistency** - All `Call*` task types follow the same pattern

This is a **specification-level design decision**, not a Go-specific choice. The pattern ensures consistency across all SDK implementations (Go, Java, Python, etc.).

---

## Implementation Details

### Test Pattern (Final)

```go
func TestEvaluateGRPCTaskExpressions(t *testing.T) {
    tests := []struct {
        name        string
        setupTask   func() *model.CallGRPC
        stateData   map[string]interface{}
        validate    func(t *testing.T, task *model.CallGRPC)
        expectError bool
    }{
        {
            name: "Evaluate service name with variable reference",
            setupTask: func() *model.CallGRPC {
                return &model.CallGRPC{
                    Call: "grpc",
                    With: model.GRPCArguments{
                        Service: model.GRPCService{
                            Name: "${ $context.serviceName }",
                            Host: "localhost",
                            Port: 50051,
                        },
                        Method: "GetUser",
                        Proto: &model.ExternalResource{
                            Endpoint: model.NewEndpoint("file:///proto/user.proto"),
                        },
                    },
                }
            },
            stateData: map[string]interface{}{
                "serviceName": "com.example.UserService",
            },
            validate: func(t *testing.T, task *model.CallGRPC) {
                assert.Equal(t, "com.example.UserService", task.With.Service.Name)
                assert.Equal(t, "localhost", task.With.Service.Host)
                assert.Equal(t, 50051, task.With.Service.Port)
            },
            expectError: false,
        },
        // ... more test cases
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            task := tt.setupTask()
            state := utils.NewState()
            state.Context = tt.stateData

            err := evaluateGRPCTaskExpressionsWithoutWorkflowContext(task, state)

            if tt.expectError {
                assert.Error(t, err)
            } else {
                require.NoError(t, err)
                tt.validate(t, task)
            }
        })
    }
}
```

### Key Implementation Notes

1. **Direct initialization works perfectly** - No YAML parsing needed
2. **Matches HTTP test pattern exactly** - Consistent testing approach
3. **Error handling** - Added nil checks for undefined variables
4. **Type flexibility** - Tests handle both `int` and `float64` for numeric values

---

## Lessons Learned

### 1. Verify SDK Source Before Assuming

The original issue assumed anonymous structs without checking the actual SDK code. Always verify assumptions by:
- Reading the actual SDK source code
- Checking the dependency version (`go.mod`)
- Looking at how the SDK is used successfully elsewhere

### 2. Follow Existing Patterns

The HTTP tests already showed the correct pattern. When one type works, check if the other types follow the same structure before trying complex workarounds.

### 3. Start Simple

The attempted solutions (YAML parsing, reflection) were overly complex. Direct initialization was the simplest and correct approach.

---

## Files Modified

```
backend/services/workflow-runner/pkg/zigflow/tasks/
└── task_builder_call_grpc_eval_test.go  ← Complete test suite (11 tests)
```

### Implementation Files (Already Working)

```
backend/services/workflow-runner/pkg/zigflow/tasks/
├── task_builder_call_grpc.go           ← evaluateGRPCTaskExpressions()
├── task_builder_call_http.go           ← evaluateHTTPTaskExpressions()
└── task_builder.go                     ← Integration point
```

---

## Test Coverage

### Test Cases Implemented ✅

1. Service name with variable reference
2. Service host with variable reference
3. Method name with variable reference
4. Proto endpoint with variable reference
5. Arguments with expressions
6. Nested arguments with expressions
7. Complete task with all fields having expressions
8. String concatenation in expressions
9. Static values (no expressions)
10. Error: Undefined variable
11. Error: Invalid expression syntax
12. Mixed static and dynamic fields

All tests follow the same pattern as HTTP tests for consistency.

---

## Related Documentation

- [Serverless Workflow Specification - gRPC Call](https://github.com/serverlessworkflow/specification/blob/main/dsl-reference.md#call-grpc)
- SDK Source: `github.com/serverlessworkflow/sdk-go/v3@v3.2.0/model/task_call.go`
- HTTP Test Reference: `task_builder_call_http_eval_test.go`

---

## Conclusion

The issue was a misunderstanding of the SDK structure. Both HTTP and gRPC use **named types** (`HTTPArguments` and `GRPCArguments`), making them equally easy to initialize and test.

The solution was **simple and elegant**: use direct struct initialization, just like the HTTP tests. No YAML parsing, no reflection, no workarounds.

**All 11 gRPC expression evaluation tests now pass.** ✅

---

*Updated: 2026-01-16 after successful resolution and test verification.*
