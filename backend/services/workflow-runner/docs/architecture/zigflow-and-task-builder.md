# Zigflow and Task Builder Architecture

This document describes **what zigflow is**, how workflows are loaded and built, and how the **task builder** system turns Serverless Workflow (YAML) tasks into Temporal workflow/activity execution. It focuses on the `pkg/zigflow` package and the `tasks` subpackage, with detailed coverage of the task builder pattern and specific builders (Switch, Run).

---

## 1. What is Zigflow?

**Zigflow** is the workflow-runner’s engine that:

1. **Loads** Serverless Workflow DSL (YAML/JSON) into a `*model.Workflow` (from [serverlessworkflow/sdk-go](https://github.com/serverlessworkflow/sdk-go)).
2. **Builds** a Temporal workflow function from that document by turning each `do` task into a **task builder**, and each task builder into a `TemporalWorkflowFunc`.
3. **Runs** the workflow by executing those functions in sequence (or following flow directives like `then`), calling Temporal activities where needed.

So: **Zigflow = load workflow document → build task graph → execute via Temporal**.

---

## 2. High-Level Flow

```
YAML/JSON (file or string)
        ↓
   zigflow.LoadFromFile / LoadFromString
        ↓
   *model.Workflow  (+ newWorkflowPostLoad)
        ↓
   zigflow.NewWorkflow(worker, doc, envvars)
        ↓
   tasks.NewDoTaskBuilder(..., doc.Do, ...)   ← workflow root is a Do task
        ↓
   doBuilder.Build()
        ↓
   For each item in do: NewTaskBuilder(key, task, worker, doc)
        ↓
   Each TaskBuilder.Build() → TemporalWorkflowFunc
        ↓
   workflowExecutor(tasks) → single Temporal workflow function
        ↓
   worker.RegisterWorkflow(wf) + worker.RegisterActivity(activities)
```

- **Entry points**: `LoadFromFile`, `LoadFromString` (in `loader.go`).
- **Workflow registration**: `workflow_builder.go` → `NewWorkflow` creates a **Do** task builder from `doc.Do`, builds it, registers the resulting function and all activities.

---

## 3. Loader and Workflow Builder

### 3.1 Loader (`loader.go`)

- Reads YAML, converts to JSON, unmarshals into `*model.Workflow`.
- Calls `newWorkflowPostLoad(wf)` to do post-load fixups (e.g. prepare Do structure).
- Validates DSL version (e.g. `>= 1.0.0, <2.0.0`).

### 3.2 Workflow Builder (`workflow_builder.go`)

- **NewWorkflow(worker, doc, envvars)**:
  - Creates **one** top-level task: `tasks.NewDoTaskBuilder(worker, &model.DoTask{Do: doc.Do}, workflowName, doc, DoTaskOpts{Envvars: envvars, ...})`.
  - Calls `doBuilder.Build()` to get the single `TemporalWorkflowFunc`.
  - Registers that function as the Temporal workflow and registers all activities from `tasks.ActivitiesList()`.

So the entire workflow is **one Do task** whose `Do` list is the sequence of steps from the YAML. Each step is implemented by a dedicated task builder.

### 3.3 Post-load (`newWorkflowPostLoad`)

- Uses a **nil** worker and a Do builder only to run **PostLoad()** on every task in `doc.Do`. That allows task builders to do one-time preparation (e.g. resolving references, validating structure) after the document is parsed.

---

## 4. Task Builder System

### 4.1 Concepts

- **Task (model)**  
  One step in the workflow: e.g. `CallHTTP`, `RunTask`, `SwitchTask`, `DoTask`, `SetTask`, etc. (Serverless Workflow types.)

- **TaskBuilder (interface)**  
  Something that can:
  - **Build()** → `(TemporalWorkflowFunc, error)`  
    Returns the function that runs this task inside a Temporal workflow.
  - **GetTask()** → `model.Task`  
  - **GetTaskName()** → string  
  - **NeverSkipCAN()** → bool (for continue-as-new)  
  - **ParseMetadata(ctx, state)**  
  - **PostLoad()**  
  - **ShouldRun(state)** → (bool, error) (for `if` conditions)

- **TemporalWorkflowFunc**  
  `func(ctx workflow.Context, input any, state *utils.State) (any, error)`  
  This is what actually runs in Temporal workflow code. It may call activities, child workflows, or only mutate `state`.

- **builder[T]**  
  Generic struct used by almost every concrete task builder. It holds:
  - `doc *model.Workflow`
  - `name string` (task name)
  - `task T` (the concrete task, e.g. `*model.RunTask`)
  - `temporalWorker worker.Worker`

  It provides:
  - **executeActivity** (evaluate args, set activity ID, execute activity, put result in `state.Data`).
  - **evaluateTaskArguments** (type switch: HTTP, gRPC, Run, CallFunction get their expressions evaluated in workflow context).
  - **GetTask / GetTaskName / NeverSkipCAN**, **ParseMetadata**, **ShouldRun**, **PostLoad**, **maybeRetrieveStateData** (claim check).

So: **each task type has a “task builder” struct that embeds `builder[ConcreteTask]` and implements `Build()` (and optionally overrides other interface methods).**

### 4.2 Factory: NewTaskBuilder

**Single entry point** for creating a task builder:

```go
NewTaskBuilder(taskName string, task model.Task, temporalWorker worker.Worker, doc *model.Workflow) (TaskBuilder, error)
```

It **switches on the concrete task type** and returns the right builder:

- `*model.CallFunction` → CallActivity or CallAgent (by `Call` kind)
- `*model.CallGRPC` → CallGRPCTaskBuilder
- `*model.CallHTTP` → CallHTTPTaskBuilder
- `*model.DoTask` → DoTaskBuilder
- `*model.ForTask` → ForTaskBuilder
- `*model.ForkTask` → ForkTaskBuilder
- `*model.ListenTask` → ListenTaskBuilder
- `*model.RaiseTask` → RaiseTaskBuilder
- `*model.RunTask` → **RunTaskBuilder**
- `*model.SetTask` → SetTaskBuilder
- `*model.SwitchTask` → **SwitchTaskBuilder**
- `*model.TryTask` → TryTaskBuilder
- `*model.WaitTask` → WaitTaskBuilder

So **“everything has this thing”**: every task kind has a dedicated builder type and a `NewXxxTaskBuilder` constructor; the Do builder iterates over `do` and calls `NewTaskBuilder` for each step.

---

## 5. Do Task Builder: The Workflow Root and Runner

The **Do** task is special: it is the **root** of the workflow and the **iterator** over steps.

- **NewDoTaskBuilder** builds a builder for `model.DoTask{Do: doc.Do}` (the list of steps).
- **Build()**:
  - Iterates over `*t.task.Do` (each step).
  - For each step: `NewTaskBuilder(task.Key, task.Task, t.temporalWorker, t.doc)` → then `builder.Build()` → get `TemporalWorkflowFunc`.
  - Collects these into a slice `tasks []workflowFunc`.
  - Returns `t.workflowExecutor(tasks)` as the single workflow function.
- **workflowExecutor**:
  - Ensures state exists (creates `utils.NewState()`, sets `state.Env`, validates input).
  - Handles continue-as-new (restore `CANStartFrom` from state).
  - Calls **iterateTasks(ctx, tasks, input, state)**.

### 5.1 iterateTasks and Flow Control

For each task in order:

1. **Continue-as-new**: if needed, trigger continue-as-new and return.
2. **Skip after CAN**: if we’re resuming and this task is before the resume point, skip.
3. **Flow directive (Then)**: if a previous step set `nextTargetName` (see below), only run the task whose name matches; others are skipped until we hit that target.
4. **ShouldRun(state)**: task’s `if` condition; if false, skip.
5. **Input validation**, **ParseMetadata**, **SetActivityOptions**.
6. **runTask(ctx, task, input, state)** → `task.Func(ctx, input, state)` (the TemporalWorkflowFunc from Build()).
7. **handleFlowDirective(taskBase)**:
   - If `taskBase.Then` is set:
     - If **termination** → break the loop.
     - If **next task** (not enum) → set `nextTargetName = then.Value` and continue (so the next iteration will skip until it finds that task).

So **flow control** is: each task can set `Then` on its **base**; Do’s iterator reads it after `runTask` and either terminates or sets the next task name. **Switch** uses this: when a branch matches, it sets `base.Then = then` and returns; Do then sees `Then` and sets `nextTargetName` to the branch target (or runs it as child workflow if not in Do context).

---

## 6. Switch Task Builder (task_builder_switch.go)

Switch implements **conditional branching**: evaluate `when` conditions and either run a **then** (task reference or child workflow) or fall through.

### 6.1 Structure

- **NewSwitchTaskBuilder(worker, task *model.SwitchTask, taskName, doc)**  
  Returns a `SwitchTaskBuilder` that embeds `builder[*model.SwitchTask]`.

- **Build()** returns a `TemporalWorkflowFunc` that:
  1. **Validation**: Ensures at most one branch has no `when` (default branch).
  2. **Execution**:
     - For each `switch` item (map of name → branch):
       - **Check `when`**: `utils.CheckIfStatement(item.When, state)`. If false, continue to next branch.
       - **Then**: `item.Then`. If nil or termination, return nil.
       - **Target**: `then.Value` is the task name or child workflow name.
    3. **Integration with Do**:
       - If **inside a Do** (`t.doc != nil`), the switch does **not** execute the target itself. It sets **flow control** on the current task’s base:
         - `base := baseTask.GetBase(); base.Then = then`.
         - Returns `nil, nil`. The Do iterator’s **handleFlowDirective** will then set `nextTargetName = then.Value`, so the next matching step in the Do list will run (task reference).
       - If **not** in a Do (standalone switch), it runs the target as a **child workflow**: `workflow.ExecuteChildWorkflow(ctx, targetTask, input, state).Get(ctx, &res)` and returns the result.

So: **inside Do**, switch only selects the next task and sets `Then`; **outside Do**, switch runs the chosen branch as a child workflow.

---

## 7. Run Task Builder (task_builder_run.go)

Run tasks execute **scripts** (JS/Python), **shell** commands, or **child workflows**. They share the same “run” config (`model.RunTask`) and the same builder, but the execution path differs by `Run.Script`, `Run.Shell`, or `Run.Workflow`.

### 7.1 Construction and Build()

- **NewRunTaskBuilder(worker, task *model.RunTask, taskName, doc)**  
  Returns `RunTaskBuilder` with `builder[*model.RunTask]`.

- **Build()**:
  - Defaults `Run.Await` to `true` if nil.
  - Picks implementation:
    - **Script**: `Run.Script` present → language must be `js` or `python`, `await` must be true, `InlineCode` must be set → factory = `runScript`.
    - **Shell**: `Run.Shell` present → factory = `runShell`.
    - **Workflow**: `Run.Workflow` present → factory = `runWorkflow`.
  - Returns a closure that:
    - Calls `factory(ctx, input, state)` (runScript / runShell / runWorkflow).
    - Puts the result in `state.AddData(map[string]any{t.name: res})`.
    - Returns the result.

### 7.2 Expression Evaluation (Workflow-Side)

Before scheduling any **activity**, expressions in the Run task are evaluated in the **workflow** context:

- **evaluateRunTaskExpressions(ctx, task, state)**:
  - **Script**: `InlineCode`, `Arguments`, `Environment` (if they are strict expressions).
  - **Shell**: `Command`, `Arguments`, `Environment`.

So script/shell content, args, and env are resolved using `state` (and `utils.EvaluateString` / `TraverseAndEvaluateObj`) so that activity inputs are **evaluated**, not raw expressions. The **base** `builder[T].evaluateTaskArguments` type-switches on `*model.RunTask` and calls `evaluateRunTaskExpressions`.

### 7.3 executeCommand (Script and Shell)

- **runScript** / **runShell** both go through **executeCommand**:
  - Call **evaluateTaskArguments** (which for Run calls `evaluateRunTaskExpressions`).
  - `workflow.ExecuteActivity(ctx, activityFn, evaluatedTask, input, state.Env).Get(ctx, &res)`.
- So the **activity** receives the **evaluated** task (and `state.Env` for JIT secret resolution in activities). The **resolver** (`resolver.go`) is used **inside activities** to replace placeholders like `${.secrets.KEY}` and `${.env_vars.VAR}` so secrets never appear in workflow history.

### 7.4 runWorkflow

- If `Run.Workflow` is set, the builder runs a **child workflow** by name: `workflow.ExecuteChildWorkflow(ctx, t.task.Run.Workflow.Name, input, state)`.
- If `await` is false, child is started with `ParentClosePolicy: ABANDON` and the Run task returns without waiting.

### 7.5 Run Activities (task_builder_run_activities.go)

- **RunActivities** is an activity struct registered with the worker.
- **CallScriptActivity**: Resolves JIT placeholders via `ResolveObject(task, runtimeEnv)`, writes inline code to a temp file, runs `node`/`python`, returns stdout; optionally **SanitizeOutput** for secret leakage warnings.
- **CallShellActivity**: Same JIT resolution, then runs the shell command (and args/env) via **runExecCommand**; same sanitization.

So: **workflow** = evaluate expressions + schedule activity with evaluated task + env; **activity** = resolve secrets/env placeholders + run script/shell + sanitize output.

---

## 8. Summary Table

| Component            | Role |
|----------------------|------|
| **zigflow loader**   | YAML/JSON → `*model.Workflow`, post-load, version check. |
| **zigflow NewWorkflow** | Create Do builder from `doc.Do`, build one workflow func, register workflow + activities. |
| **DoTaskBuilder**    | Root: turns `doc.Do` list into a sequence of task builders; runs them via **iterateTasks** and handles **Then** (next task / terminate). |
| **NewTaskBuilder**   | Factory: one task type → one builder (Switch, Run, HTTP, Set, …). |
| **builder[T]**       | Shared: executeActivity, evaluateTaskArguments, GetTask/GetTaskName, ParseMetadata, ShouldRun, claim-check hooks. |
| **SwitchTaskBuilder**| Evaluates `when`; in Do context sets `base.Then` for flow control; otherwise runs child workflow. |
| **RunTaskBuilder**   | Script/Shell/Workflow; evaluates expressions in workflow; runs script/shell via activities (with JIT secret resolution in activities). |

---

## 9. File Reference

| File | Purpose |
|------|--------|
| `pkg/zigflow/loader.go` | LoadFromFile, LoadFromString, newWorkflowPostLoad. |
| `pkg/zigflow/workflow_builder.go` | NewWorkflow (Do builder, register workflow + activities). |
| `pkg/zigflow/tasks/task_builder.go` | TaskBuilder interface, builder[T], NewTaskBuilder factory, evaluateTaskArguments, executeActivity. |
| `pkg/zigflow/tasks/task_builder_do.go` | Do root: Build, workflowExecutor, iterateTasks, handleFlowDirective, runTask, continue-as-new. |
| `pkg/zigflow/tasks/task_builder_switch.go` | Switch: when/then, set Then for Do or execute child workflow. |
| `pkg/zigflow/tasks/task_builder_run.go` | Run: script/shell/workflow, expression eval, executeCommand, runScript/runShell/runWorkflow. |
| `pkg/zigflow/tasks/task_builder_run_activities.go` | Run activities: CallScriptActivity, CallShellActivity, JIT resolve, runExecCommand, SanitizeOutput. |
| `pkg/zigflow/tasks/resolver.go` | JIT placeholder resolution (secrets/env) and output sanitization. |

This is the full picture of what happens in zigflow and in the task builder layer, with Switch and Run described in detail.
