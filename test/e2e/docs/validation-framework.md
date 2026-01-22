# E2E Test Validation Framework

## Overview

This framework provides **deterministic validation** for non-deterministic AI agent outputs. It uses three tiers of validation to ensure agent executions are correct without relying on LLM-based validators.

## How Agent Execution Works (Async)

Agent execution is **asynchronous**:

```
1. User runs: stigmer run test-agent --message "Hello"
2. Server creates execution record (PENDING)
3. Returns execution ID immediately
4. Background worker processes execution (IN_PROGRESS)
5. Agent completes (COMPLETED or FAILED)
```

### Execution Phases

```
PENDING → IN_PROGRESS → COMPLETED ✓
                      → FAILED ✗
                      → CANCELLED ⊘
```

### How Tests Wait for Completion

Tests use **polling** to wait for async execution:

```go
execution, err := WaitForExecutionPhase(
    serverPort,
    executionID,
    agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
    60*time.Second, // timeout
)
```

**Polling mechanism:**
- Queries API every 500ms
- Checks if phase matches target
- Returns immediately on FAILED
- Times out after 60 seconds (configurable)

## Three-Tier Validation System

### Tier 1: Execution Status (MUST PASS)

Validates that the execution completed successfully.

**Checks:**
- `ValidateCompleted()` - Execution reached COMPLETED phase
- `ValidateNotFailed()` - Execution did not fail
- `ValidateHasMessages()` - Execution produced at least one message

**These checks are HARD REQUIREMENTS.** If any fail, the test fails.

```go
validator := NewExecutionValidator(execution)

result := validator.ValidateCompleted()
require.True(t, result.Passed, result.Reason)
```

### Tier 2: Output Quality (MUST PASS)

Validates that the output is sensible and not gibberish.

**Checks:**
- `ValidateOutputNotEmpty()` - Output has content
- `ValidateOutputMinLength(n)` - Output meets minimum length
- `ValidateNotGibberish()` - Output is not random characters
- `ValidateNotErrorMessage()` - Output doesn't contain error indicators
- `ValidateHasSentenceStructure()` - Output has punctuation, capitals, spaces

**These checks catch most common failures without semantic understanding.**

**Gibberish detection:**
- Excessive repeated characters: "aaaaaaa", "........"
- No vowels in long text (keyboard mashing)
- Low letter-to-character ratio
- Common keyboard patterns: "asdfasdf", "qwerqwer"

**Error detection:**
- Keywords: "error:", "exception:", "failed to", "undefined", "panic:"
- Stack traces and tracebacks

```go
result := validator.ValidateNotGibberish()
require.True(t, result.Passed, result.Reason)

result = validator.ValidateNotErrorMessage()
require.True(t, result.Passed, result.Reason)
```

### Tier 3: Behavioral (SHOULD PASS)

Validates that the output matches expected behavior for the specific test.

**Checks:**
- `ValidateContainsKeywords(words, mode)` - Output contains expected keywords
- `ValidateMatchesPattern(regex, desc)` - Output matches a pattern
- `ValidateDoesNotContain(phrases)` - Output avoids unwanted phrases

**These checks are test-specific and can be warnings instead of failures.**

```go
// For a greeting test
result := validator.ValidateContainsKeywords(
    []string{"hello", "hi", "greetings", "hey"},
    "any", // At least one keyword must be present
)

if result.Passed {
    t.Logf("✓ %s", result.Reason)
} else {
    // Warning only - don't fail test
    t.Logf("⚠️  Warning: %s", result.Reason)
}
```

**Keyword modes:**
- `"any"` - At least one keyword must be present
- `"all"` - All keywords must be present

## Usage Examples

### Example 1: Basic Greeting Test

```go
func TestGreeting(t *testing.T) {
    // Run agent
    execution := runAndWait("test-agent", "--message", "Say hello")
    
    // Create validator
    validator := NewExecutionValidator(execution)
    
    // Tier 1: MUST PASS
    require.True(t, validator.ValidateCompleted().Passed)
    require.True(t, validator.ValidateHasMessages().Passed)
    
    // Tier 2: MUST PASS
    require.True(t, validator.ValidateNotGibberish().Passed)
    require.True(t, validator.ValidateNotErrorMessage().Passed)
    require.True(t, validator.ValidateHasSentenceStructure().Passed)
    
    // Tier 3: SHOULD PASS
    result := validator.ValidateContainsKeywords(
        []string{"hello", "hi", "greetings"},
        "any",
    )
    
    if !result.Passed {
        t.Logf("Warning: %s", result.Reason)
        t.Logf("Response: %s", validator.GetLastMessage())
    }
}
```

### Example 2: Counting Test

```go
func TestCounting(t *testing.T) {
    execution := runAndWait("test-agent", "--message", "Count from 1 to 5")
    validator := NewExecutionValidator(execution)
    
    // Tier 1 & 2: Basic checks
    require.True(t, validator.ValidateCompleted().Passed)
    require.True(t, validator.ValidateNotGibberish().Passed)
    
    // Tier 3: Check for numbers
    result := validator.ValidateContainsKeywords(
        []string{"1", "2", "3", "4", "5"},
        "all", // All numbers must be present
    )
    
    require.True(t, result.Passed, result.Reason)
}
```

### Example 3: Pattern Matching

```go
func TestEmailFormat(t *testing.T) {
    execution := runAndWait("test-agent", 
        "--message", "Generate an email address")
    validator := NewExecutionValidator(execution)
    
    // Basic checks
    require.True(t, validator.ValidateCompleted().Passed)
    
    // Check for email pattern
    result := validator.ValidateMatchesPattern(
        `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`,
        "valid email address",
    )
    
    require.True(t, result.Passed, result.Reason)
}
```

## When to Use Each Tier

### Always Use Tier 1 & 2

Every test should validate:
- ✅ Execution completed successfully
- ✅ Output is not gibberish
- ✅ Output is not an error message

These catch **90% of failures** without needing semantic understanding.

### Use Tier 3 for Specific Tests

Add behavioral checks when testing specific agent capabilities:
- ✅ Greeting agent should use greeting words
- ✅ Math agent should include numbers
- ✅ Code agent should have code blocks
- ✅ Translation should contain target language words

## Advanced: Custom Validators

You can add custom validation methods to the validator:

```go
// Add to validation_test.go
func (v *ExecutionValidator) ValidateIsValidJSON() ValidationResult {
    lastMsg := v.GetLastMessage()
    
    var js json.RawMessage
    if err := json.Unmarshal([]byte(lastMsg), &js); err != nil {
        return ValidationResult{false, "output is not valid JSON"}
    }
    
    return ValidationResult{true, "output is valid JSON"}
}
```

Then use in tests:

```go
result := validator.ValidateIsValidJSON()
require.True(t, result.Passed, result.Reason)
```

## What This Framework Does NOT Do

❌ **Semantic understanding** - Can't determine if "Bonjour" is a valid French greeting  
❌ **Contextual reasoning** - Can't judge if answer is "good enough"  
❌ **Subjective quality** - Can't rate if response is "helpful" or "friendly"  

For those cases, you would need LLM-based validation (future enhancement).

## Benefits of This Approach

✅ **Fast** - No LLM calls, no network latency  
✅ **Deterministic** - Same input = same validation result  
✅ **Debuggable** - Clear failure reasons  
✅ **Catches real bugs** - Gibberish, errors, crashes  
✅ **No dependencies** - Works without external services  

## Future: LLM-Based Validation (Optional)

In the future, we may add **optional LLM validation** as Tier 4:

```go
// Future feature (not implemented yet)
result := validator.ValidateSemanticCorrectness(
    "Agent should politely greet the user",
)

if !result.Passed {
    t.Logf("⚠️  Semantic warning: %s", result.Reason)
    // Don't fail test, just warn
}
```

This would use Ollama to validate semantic correctness, but would be:
- **Optional** - Can be disabled
- **Non-blocking** - Warnings only, not failures
- **Slow** - Extra LLM call per validation

## Summary

**The key principle:** Use deterministic checks to catch most failures, reserve LLM validation for quality gates only.

```
Tier 1: Did execution succeed? (MUST PASS)
Tier 2: Is output sensible? (MUST PASS)
Tier 3: Does output match expectations? (SHOULD PASS)
Tier 4: Is output semantically correct? (FUTURE - OPTIONAL)
```

This gives you **fast, reliable tests** that catch real bugs without depending on LLM evaluation.
