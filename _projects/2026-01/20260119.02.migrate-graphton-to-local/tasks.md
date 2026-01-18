# Tasks

## T1: Copy Graphton Source to backend/libs/python/graphton/
✅ DONE

**Goal:** Copy all Graphton source files from external repo to Stigmer monorepo

**Completed:**
1. ✅ Created `backend/libs/python/graphton/src/graphton/` directory structure
2. ✅ Copied all source files from `/Users/suresh/scm/github.com/plantonhq/graphton/src/graphton`
3. ✅ Copied supporting files (pyproject.toml, README, LICENSE, poetry.lock)
4. ✅ Updated pyproject.toml for Stigmer (removed external URLs, updated authors)
5. ✅ Fixed package structure to use `src/graphton/` layout

---

## T2: Update agent-runner pyproject.toml to use local path dependency
✅ DONE

**Goal:** Change dependency from GitHub URL to local path

**Completed:**
1. ✅ Updated `backend/services/agent-runner/pyproject.toml`
2. ✅ Changed from: `graphton = {git = "https://github.com/plantonhq/graphton.git", branch = "main"}`
3. ✅ To: `graphton = {path = "../../libs/python/graphton", develop = true}`
4. ✅ Created `apis/stubs/python/stigmer/pyproject.toml` to fix dependency resolution
5. ✅ Ran `poetry lock` successfully
6. ✅ Ran `poetry install` - all dependencies installed

---

## T3: Verify imports and references work
✅ DONE

**Goal:** Ensure all graphton imports resolve correctly

**Completed:**
1. ✅ Verified imports in agent-runner: `from graphton import create_deep_agent`
2. ✅ Confirmed imports resolve to local path (not external GitHub)
3. ✅ Ran import test: `poetry run python -c "from graphton import create_deep_agent"` - SUCCESS
4. ✅ Ran type checking - graphton imports work correctly (pre-existing type errors are unrelated)

---

## T4: Test agent-runner with local graphton
⏸️ TODO

**Goal:** Verify agent execution works with local library

**Steps:**
1. Run agent-runner locally
2. Execute a test agent execution
3. Verify Graphton agent creation works
4. Check logs for any errors
5. Confirm no regressions

---

## T5: Update documentation
⏸️ TODO

**Goal:** Update references to Graphton in documentation

**Steps:**
1. Update `backend/services/agent-runner/README.md` - note local dependency
2. Add migration note to changelog
3. Document how to make changes to local graphton
4. Update any architecture docs mentioning graphton
