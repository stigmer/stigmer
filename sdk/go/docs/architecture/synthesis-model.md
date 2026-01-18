# Synthesis Model: Why `defer stigmer.Complete()` is Required

## TL;DR

Unlike Python (which has `atexit` hooks), **Go doesn't provide automatic program exit callbacks**. This means we need one line of boilerplate:

```go
import stigmer "github.com/leftbin/stigmer-sdk/go"

func main() {
    defer stigmer.Complete()  // ← Required in Go, not in Python/TypeScript
    
    agent.New(...)
}
```

This is the **cleanest possible API** given Go's language constraints.

---

## Background: The Original Design

The original design envisioned an **"Implicit Synthesis"** architecture where:

**Python Example:**
```python
from stigmer import Agent

researcher = Agent(
    name="researcher",
    instructions="prompts/researcher.md"
)

# THAT'S IT. No "app.synth()" required.
```

The Python SDK uses `atexit.register(_auto_synth)` to automatically write `manifest.pb` when the program exits - **no user code needed**.

---

## Why Go is Different

### Language Limitations

| Language | Exit Hook Mechanism | Automatic? |
|---|---|---|
| **Python** | `atexit.register()` | ✅ Yes |
| **TypeScript** | `process.on('exit')` | ✅ Yes |
| **Go** | None (before 1.24) | ❌ No |
| **Go 1.24+** | `runtime.AddExitHook()` | ⚠️ Version-specific |

### What We Tried

1. **Finalizers** (`runtime.SetFinalizer`)
   - Problem: Runs during GC, not at program exit
   - Unreliable timing, might not run at all

2. **Signal Handlers** (`signal.Notify`)
   - Problem: Only catches SIGINT/SIGTERM, not normal `os.Exit(0)`
   - Doesn't work for `go run` or normal program completion

3. **Background Goroutine**
   - Problem: Can't detect when `main()` completes
   - Would require channels/sync primitives, adding complexity

4. **Go 1.24+ `runtime.AddExitHook()`**
   - Problem: Version-specific (Go 1.24 released Q1 2025)
   - Can't use as default until Go 1.26+ is mainstream (~2027)

### The Reality

**Go simply doesn't have `atexit` semantics.** The language was designed for explicit control flow, not implicit magic.

---

## Our Solution: Minimal Boilerplate

We chose the cleanest possible API given Go's constraints:

```go
import stigmer "github.com/leftbin/stigmer-sdk/go"
import "github.com/leftbin/stigmer-sdk/go/agent"

func main() {
    defer stigmer.Complete()  // Single line, clear intent
    
    agent.New(
        agent.WithName("code-reviewer"),
        agent.WithInstructions("Review code..."),
    )
}
```

### Why This is Good

1. **One line of code** - trivial overhead
2. **Crystal clear intent** - "complete synthesis on exit"
3. **Root package import** - clean separation from agent construction
4. **Works across all Go versions** - no version-specific hacks
5. **Predictable** - `defer` is a core Go pattern developers understand

### Alternative: What If We Didn't Do This?

Without `defer stigmer.Complete()`, users would need:

```go
// ❌ Verbose manual approach
func main() {
    a := agent.New(...)
    
    manifest := synth.ToManifest(a)
    data, _ := proto.Marshal(manifest)
    os.WriteFile("manifest.pb", data, 0644)
}
```

**20+ lines vs 1 line** - the tradeoff is clear.

---

## Comparison to Original Design

| Aspect | Original Vision | Go Reality | Our Implementation |
|---|---|---|---|
| **User Experience** | Zero boilerplate | Needs exit hook | Minimal (1 line) |
| **Synthesis Trigger** | Automatic (`atexit`) | Manual (`defer`) | `defer Complete()` |
| **Import Complexity** | Just `agent` | Just `agent` | Root + `agent` |
| **Cross-Language** | ✅ Works in Py/TS | ❌ Not in Go | ⚠️ Go needs defer |

### What We Preserved

✅ **Global registry** - agents auto-register  
✅ **Environment detection** - `STIGMER_OUT_DIR` controls synthesis mode  
✅ **Silent operation** - no verbose logging unless synthesis mode  
✅ **Clean errors** - validation errors printed to stderr  
✅ **Dry-run mode** - run locally without CLI  

### What We Couldn't Preserve

❌ **Zero boilerplate** - Go requires `defer` line  

But we made it as close as possible: `defer stigmer.Complete()` is **6 words**.

---

## Future: Go 1.24+ Support

When Go 1.24 becomes mainstream (2-3 years), we can offer truly automatic synthesis:

```go
// go.mod: go 1.24

// Future: No defer needed with build tag
//go:build go1.24

func init() {
    runtime.AddExitHook(synth.AutoSynth)
}
```

Users on Go 1.24+ won't need `defer stigmer.Complete()` at all.

**Until then:** The one-line defer is the best we can do.

---

## FAQ

### Q: Why not make it fully automatic using [technique X]?

**A:** We explored all options. Go's language design doesn't support automatic exit hooks reliably. The `defer` pattern is:
- **Explicit** - Go values clarity over magic
- **Reliable** - Works 100% of the time
- **Familiar** - `defer` is idiomatic Go

### Q: Can I avoid the defer line?

**A:** Not reliably. You could manually call `synth.AutoSynth()`, but then you lose the automatic guarantee.

### Q: What if I forget the defer line?

**A:** The CLI will fail with:
```
Error: manifest.pb not found
Hint: Add 'defer stigmer.Complete()' to your main() function
```

### Q: Why not detect missing defer and print a warning?

**A:** We can't. By the time we detect agents were registered but synthesis didn't run, the program has already exited.

### Q: Other languages don't need this?

**A:** Correct. Python and TypeScript have native exit hooks. **This is a Go-specific limitation.**

---

## Summary

The original design describes the **ideal** UX (zero boilerplate). We implemented the **closest possible** version in Go:

- ✅ Global registry (automatic agent registration)
- ✅ Environment-driven synthesis (CLI sets `STIGMER_OUT_DIR`)
- ✅ Clean API (`defer stigmer.Complete()` - 1 line)
- ⚠️ Minimal boilerplate (required by Go's language design)

**This is not a compromise in implementation quality - it's a reflection of Go's language philosophy.**

Go values **explicit control flow** over **implicit magic**. Our `defer stigmer.Complete()` follows Go's design principles while staying as close to the original vision as possible.

---

*"In Go, we write what we mean. One `defer` line is honest about the program's control flow."*
