# Systematic Debugging Plan - Context Variable Expression Issue

## 🎯 Goal
Find exactly where the expression evaluation fails for `${ $context.apiBase + "/posts/1" }`

## ✅ Known Working
- **Hardcoded URL**: `uri: https://jsonplaceholder.typicode.com/posts/1` ✅ WORKS

## ❌ Known Failing  
- **Context + Concatenation**: `uri: ${ $context.apiBase + "/posts/1" }` ❌ FAILS
- Error: "unable to decode: failed to unmarshal Endpoint: data does not match any known schema"

## 🧪 Debug Tests (Check Temporal UI)

| Test ID | Workflow ID | What It Tests | Expected |
|---------|-------------|---------------|----------|
| **Test 1** | wfx-test-step1-set-only | SET context var + READ it (no HTTP) | ✅ Should PASS |
| **Test 2** | wfx-test-step2-http-no-concat | Use `${ $context.fullUrl }` in HTTP (no +) | ⚠️ If PASS → Concatenation is the issue |
| **Test 3** | wfx-test-step3-concat | Use `${ $context.apiBase + "/posts/1" }` | ❌ Will likely FAIL |

## 🔍 Analysis Based on Results

### Scenario A: Test 1 PASS, Test 2 PASS, Test 3 FAIL
**Conclusion**: The issue is **string concatenation** in the endpoint field  
**Root Cause**: The `+` operator expression isn't being evaluated before Zigflow unmarshals the endpoint  
**Next Steps**: 
- Check when endpoint expressions are evaluated
- Verify if evaluateEndpoint() is handling `+` expressions correctly

### Scenario B: Test 1 PASS, Test 2 FAIL, Test 3 FAIL  
**Conclusion**: The issue is **any expression in endpoint.uri field**  
**Root Cause**: Expressions in endpoint.uri aren't evaluated at all  
**Next Steps**:
- Check YAML->Proto->Model conversion flow
- Verify endpoint field handling in converter

### Scenario C: Test 1 FAIL, Test 2 FAIL, Test 3 FAIL
**Conclusion**: **Context variables aren't being set** at all  
**Root Cause**: SET task isn't executing or context isn't being populated  
**Next Steps**:
- Check if SET tasks execute
- Verify $context scope in state

## 📊 Quick Check Commands

Check Test 1 (should complete fast):
```bash
temporal workflow describe -w wfx-test-step1-set-only
```

Check Test 2:
```bash
temporal workflow describe -w wfx-test-step2-http-no-concat
```

Check Test 3:
```bash
temporal workflow describe -w wfx-test-step3-concat
```

Or use Temporal UI: `http://localhost:8088`

## 🎯 What to Look For

1. **Test 1 Result** (SET/READ only):
   - If PASS → Context variables work ✅
   - If FAIL → Context mechanism broken ❌

2. **Test 2 Result** (Full URL from context):
   - If PASS → Simple variable substitution works ✅
   - If FAIL → Issue with ANY expression in endpoint ❌

3. **Test 3 Result** (Concatenation):
   - If PASS → Everything works! 🎉
   - If FAIL → Concatenation expression is the culprit ❌

## 🔧 Potential Root Causes (Priority Order)

1. **Expression evaluation timing** - Expressions evaluated AFTER unmarshal instead of before
2. **JQ expression syntax** - The `+` operator might not be valid in endpoint context
3. **Zigflow SDK Endpoint.UnmarshalJSON** - Doesn't recognize the expression pattern
4. **Context state propagation** - SET task output not being added to $context

## 📝 Next Steps After Diagnosis

Based on which test fails, we'll:
- Add logging to see what value the endpoint receives
- Check the evaluateEndpoint() function
- Verify when/where expressions are evaluated
- Test alternative expression syntax
