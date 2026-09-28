<<< tool 1 of 11: think >>>

Use this tool to think through a problem step-by-step. The think tool does not read files, execute commands, or make any changes — it simply records your reasoning. Call it when you need to pause and work something out before acting.

Good times to use think:
- After reading files or tool output, to analyse what you learned
- Before a complex or multi-step operation, to plan your approach
- When you need to choose between several possible strategies
- When debugging — to reason about what might have gone wrong

You do NOT need to use think for every step — only when genuine reasoning will improve the quality of your next action.

input_schema:

```json
{
  "type": "object",
  "properties": {
    "thought": {
      "type": "string",
      "description": "Your reasoning, analysis, or plan."
    }
  },
  "required": [
    "thought"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

<<< tool 2 of 11: web_fetch >>>

Fetch the contents of a URL over http(s). HTML pages are converted to Markdown; plain text, Markdown, JSON, and other text formats are returned as-is. Binary content is not supported.

Large pages are windowed: at most max_length characters are returned per call (default 20000). If the result ends with a truncation notice, call web_fetch again with the same url and the start_index the notice gives you to continue reading.

input_schema:

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "The http(s) URL to fetch."
    },
    "max_length": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 100000,
      "description": "Maximum characters to return (default 20000)."
    },
    "start_index": {
      "type": "integer",
      "minimum": 0,
      "description": "Character offset to start from, for paginating large pages (default 0)."
    }
  },
  "required": [
    "url"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

<<< tool 3 of 11: ls >>>

Lists all files in a directory.

This is useful for exploring the filesystem and finding the right file to read or edit.
You should almost ALWAYS use this tool before using the read_file or edit_file tools.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "path": {
      "default": "/",
      "type": "string"
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false
}
```

<<< tool 4 of 11: read_file >>>

Reads a file from the filesystem. Assume any path the user provides is valid; reading a missing file returns an error.

Usage:
- By default, it reads up to 100 lines starting from the beginning of the file. Use `offset`/`limit` to page through large files instead of reading them whole.
- A status header, `@@ field | field | ... @@`, sits above the file content, and every line after it is unmodified file content. When content is truncated, there may be an explanation before the header. Never include the header when editing.
- Speculatively batch multiple `read_file` calls in one response when several files may be useful.
- An empty file returns a system-reminder warning in place of contents.
- Large tool results may be offloaded to a file; the tool message gives the path. Read that path here, paging with `offset`/`limit`.
- Images (`.png`, `.jpg`, etc.), audio, video, and PDFs return multimodal content blocks (https://docs.langchain.com/javascript/langchain/messages#multimodal).
- For images and PDFs, pagination via `offset`/`limit` is text-only - supply `file_path` only.
- Always read a file before editing it.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string"
    },
    "offset": {
      "default": 0,
      "type": "number"
    },
    "limit": {
      "default": 100,
      "type": "number"
    }
  },
  "required": [
    "file_path",
    "offset",
    "limit"
  ],
  "additionalProperties": false
}
```

<<< tool 5 of 11: write_file >>>

Writes content to a file. Creates the file if it does not exist; replaces it entirely if it does.

Usage:
- Use this tool when you intend to create a new file or replace the whole file. You do not need to read the file first.
- Prefer to edit existing files (with the edit_file tool) over creating new ones when possible.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string"
    },
    "content": {
      "type": "string"
    }
  },
  "required": [
    "file_path",
    "content"
  ],
  "additionalProperties": false
}
```

<<< tool 6 of 11: edit_file >>>

Performs exact string replacements in files.

Usage:
- You must read the file before editing; this tool errors otherwise.
- Preserve the exact source indentation from the read output, and never include the read status header in old_string or new_string.
- Prefer editing an existing file over creating a new one.
- Only use emojis if the user explicitly requests it.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string"
    },
    "old_string": {
      "type": "string"
    },
    "new_string": {
      "type": "string"
    },
    "replace_all": {
      "default": false,
      "type": "boolean"
    }
  },
  "required": [
    "file_path",
    "old_string",
    "new_string",
    "replace_all"
  ],
  "additionalProperties": false
}
```

<<< tool 7 of 11: glob >>>

Find files matching a glob pattern, returning absolute paths.

Supports `*` (any characters), `**` (any directories), `?` (single character), e.g. `**/*.py`, `*.txt`, `/subdir/**/*.md`.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string"
    },
    "path": {
      "type": "string"
    }
  },
  "required": [
    "pattern"
  ],
  "additionalProperties": false
}
```

<<< tool 8 of 11: grep >>>

Search for a LITERAL text pattern across files (NOT regex).

The pattern is matched verbatim: regex metacharacters are ordinary characters, not operators. To match any of several strings, run a separate grep for each; `grep(pattern="foo|bar")` searches for the literal text "foo|bar", and `.*` or `\\.` match those characters literally.
- If you genuinely need regex, use the execute tool with `rg '<regex>'` instead.

Returns matching files or content per `output_mode`. Offloaded large tool results live under the artifacts root (`/large_tool_results/` by default); grep that directory to search them when you do not know the exact path.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string"
    },
    "path": {
      "default": "/",
      "type": "string"
    },
    "glob": {
      "default": null,
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "max_count": {
      "default": null,
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ]
    },
    "output_mode": {
      "default": "content",
      "type": "string",
      "enum": [
        "files_with_matches",
        "content",
        "count"
      ]
    }
  },
  "required": [
    "pattern",
    "path",
    "glob",
    "max_count",
    "output_mode"
  ],
  "additionalProperties": false
}
```

<<< tool 9 of 11: execute >>>

Executes a shell command in an isolated sandbox and returns combined stdout/stderr with the exit code (truncated if very large).

Usage:
- Quote paths containing spaces (e.g. cd "/path/with spaces").
- Chain commands with ';' or '&&' (use '&&' when a command depends on the previous); do not use newlines except inside quoted strings.
- Use absolute paths and avoid `cd` so the working directory stays stable.
- You MUST avoid using search commands like find and grep. Instead use the grep, glob tools to search. Use read_file rather than cat/head/tail.
- execute(command="find . -name '*.py'") # Use glob tool instead
- execute(command="grep -r 'pattern' .") # Use grep tool instead

Only available on backends implementing SandboxBackendProtocol; otherwise it returns an error.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "command": {
      "type": "string"
    },
    "description": {
      "type": "string",
      "description": "A short present-tense phrase describing what this command does and why, shown to the user as the title of this action (5-10 words, e.g. 'Run unit tests for the parser'). Do not restate the command syntax."
    }
  },
  "required": [
    "command"
  ],
  "additionalProperties": false
}
```

<<< tool 10 of 11: task >>>

Launch an ephemeral subagent to handle a complex, multi-step task.

Available agent types and the tools they have access to:
- explore: Read-only codebase exploration specialist. Use for searching, reading files, finding patterns, and understanding code structure. Cannot write files or execute commands.
- shell: Command execution specialist. Use for running shell commands, build operations, and system tasks. Has minimal file read access.
- general-purpose: General-purpose agent for researching complex questions, searching for files and content, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. This agent has access to all tools as the main agent.

Specify subagent_type to select the agent. Usage notes:
- Launch multiple agents concurrently when their tasks are independent, using a single message with multiple tool calls.
- Each invocation is stateless by default: the agent sees only the prompt you give it and returns a single final report. Put full detail in the prompt and state exactly what it should return — unless an agent type below says it inherits your conversation instead.
- The agent's report is not shown to the user; relay a summary yourself.
- Tell the agent whether to create content, analyze, or only research, since it can't necessarily see the user's intent unless it inherits your conversation, as noted per agent type below.
- If an agent's description says to use it proactively, do so without waiting to be asked.
- When only general-purpose is available, use it for any complex, context-heavy task; it has the same capabilities as the main agent.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "description": {
      "type": "string"
    },
    "subagent_type": {
      "type": "string"
    }
  },
  "required": [
    "description",
    "subagent_type"
  ],
  "additionalProperties": false
}
```

<<< tool 11 of 11: write_todos >>>

Use this tool to create and manage a structured task list for your current work session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.
Only use this tool if you think it will be helpful in staying organized. If the user's request is trivial and takes less than 3 steps, it is better to NOT use this tool and just do the task directly.

## When to Use This Tool
Use this tool in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. The plan may need future revisions or updates based on results from the first few steps. Keeping track of this in a list is helpful.

## How to Use This Tool
1. When you start working on a task - Mark it as in_progress BEFORE beginning work.
2. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation.
3. You can also update future tasks, such as deleting them if they are no longer necessary, or adding new tasks that are necessary. Don't change previously completed tasks.
4. You can make several updates to the todo list at once. For example, when you complete a task, you can mark the next task you need to start as in_progress.

## When NOT to Use This Tool
It is important to skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Examples of When to Use the Todo List

<example>
User: I want to add a dark mode toggle to the application settings. Make sure you run the tests and build when you're done!
Assistant: I'll help add a dark mode toggle to your application settings. Let me create a todo list to track this implementation.
*Creates todo list with the following items:*
1. Create dark mode toggle component in Settings page
2. Add dark mode state management (context/store)
3. Implement CSS-in-JS styles for dark theme
4. Update existing components to support theme switching
5. Run tests and build process, addressing any failures or errors that occur
*Begins working on the first task*

<reasoning>
The assistant used the todo list because:
1. Adding dark mode in it of itself is a multi-step feature requiring UI, state management, and styling changes
2. The assistant inferred that tests and build need to pass by adding "Ensure tests and build succeed" as the final task
3. Both of the user's requests are complex and require multiple steps to complete.
</reasoning>
</example>

<example>
User: Help me plan a comprehensive marketing campaign for our new product launch, including social media, email marketing, and press releases.
Assistant: I'll help you plan a comprehensive marketing campaign for your product launch. Let me create a todo list to organize all the components.
*Creates todo list with the following items:*
1. Define target audience and key messaging
2. Create social media content calendar and posting schedule
3. Design email marketing sequence and automation flows
4. Draft press release and identify media contacts
5. Set up tracking and analytics for campaign performance
6. Create visual assets and brand materials
7. Coordinate launch timeline and deliverables
*Begins working on the first task*

<reasoning>
The assistant used the todo list because:
1. Marketing campaign planning involves multiple distinct channels and activities
2. Each component requires careful coordination and planning
3. The systematic approach ensures all aspects of the launch are covered
</reasoning>
</example>

<example>
User: Help me rename the function getCwd to getCurrentWorkingDirectory across my project
Assistant: Let me first search through your codebase to find all occurrences of 'getCwd'.
*Uses search tools to locate all instances of getCwd in the codebase*
Assistant: I've found 15 instances of 'getCwd' across 8 different files. Let me create a todo list to track these changes.
*Creates todo list with specific items for each file that needs updating*

<reasoning>
The assistant used the todo list because:
1. The assistant searched to understand the scope of the task
2. Upon finding multiple occurrences across different files, it determined this was a complex task with multiple steps (>3)
3. The todo list helps ensure every instance is tracked and updated systematically
4. This approach prevents missing any occurrences and maintains consistency.
</reasoning>
</example>

<example>
User: I need help organizing my home office: decluttering the desk, setting up a filing system, organizing digital files, and creating a daily workflow.
Assistant: I'll help you organize your home office systematically. Let me create a todo list to track each area of organization.
*Creates todo list with items like: 1) Sort and declutter desk items, 2) Set up physical filing system for documents, 3) Organize digital files and folders, 4) Create daily workflow and productivity systems, 5) Establish maintenance routines*
Let's start with decluttering your desk space to create a clean foundation for the other organizational systems.

<reasoning>
The assistant used the todo list because:
1. The user provided multiple distinct organizational tasks
2. Each area requires different approaches and careful planning
3. Home organization benefits from systematic, step-by-step completion
4. Progress tracking ensures all areas are addressed thoroughly
</reasoning>
</example>

## Examples of When NOT to Use the Todo List

<example>
User: How do I print 'Hello World' in Python?
Assistant: In Python, you can print "Hello World" with this simple code:

```python
print("Hello World")
```

This will output the text "Hello World" to the console when executed.</assistant>

<reasoning>
The assistant did not use the todo list because this is a single, trivial task that can be completed in one step. There's no need to track multiple tasks or steps for such a straightforward request.
</reasoning>
</example>

<example>
User: What's the best way to water houseplants?
Assistant: The best way to water houseplants depends on the specific plant type, but here are some general guidelines:

- Check soil moisture by inserting your finger about 1-2 inches into the soil
- Water thoroughly when the top inch feels dry, allowing water to drain from the bottom
- Use room temperature water and water in the morning when possible
- Avoid overwatering, which is more harmful than underwatering for most plants

Different plants have different needs, so it's important to research your specific varieties for optimal care.

<reasoning>
The assistant did not use the todo list because this is an informational request with no actual tasks to complete. The user is simply asking for advice and explanation, not for the assistant to perform multiple steps or activities.
</reasoning>
</example>

<example>
User: Can you add a comment to the calculateTotal function to explain what it does?
Assistant: Sure, let me add a comment to the calculateTotal function to explain what it does.
* Uses the Edit tool to add a comment to the calculateTotal function *

<reasoning>
The assistant did not use the todo list because this is a single, straightforward task confined to one location. Adding a comment doesn't require tracking multiple steps or systematic organization.
</reasoning>
</example>

<example>
User: What time is it in Tokyo right now?
Assistant: I'll check the current time in Tokyo for you.

*Searches for current time in Tokyo*

The current time in Tokyo, Japan is [current time]. Tokyo is in the Japan Standard Time (JST) zone, which is UTC+9.

<reasoning>
The assistant did not use the todo list because this is a single information lookup with immediate results. There are no multiple steps to track or organize, making the todo list unnecessary for this straightforward request.
</reasoning>
</example>

<example>
User: I need to write a function that checks if a number is prime and then test it out.
Assistant: I'll help you write a function that checks if a number is prime and then test it out.
*Writes function that checks if a number is prime*
*Tests the function*

<reasoning>
Even though this is a multi-step task, it is very straightforward and can be completed in two trivial steps (which is less than 3 steps!). Using the todo list here is overkill and wastes time and tokens.
</reasoning>
</example>

<example>
User: I want you to order a pizza from Dominos, order a burger from McDonald's, and order a salad from Subway.
Assistant: I'll help you order a pizza from Dominos, order a burger from McDonald's, and order a salad from Subway.
*Orders a pizza from Dominos*
*Orders a burger from McDonald's*
*Orders a salad from Subway*

<reasoning>
Even though this is a multi-step task, assuming the assistant has the ability to order from these restaurants, it is very straightforward and can be completed in three trivial tool calls. 
Using the todo list here is overkill and wastes time and tokens. These three tool calls should be made in parallel, in fact.
</reasoning>
</example>


## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (you can have multiple tasks in_progress at a time if they are not related to each other and can be run in parallel)
   - completed: Task finished successfully

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely
   - IMPORTANT: When you write this todo list, you should mark your first task (or tasks) as in_progress immediately!.
   - IMPORTANT: Unless all tasks are completed, you should always have at least one task in_progress to show the user that you are working on something.

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - There are unresolved issues or errors
     - Work is partial or incomplete
     - You encountered blockers that prevent completion
     - You couldn't find necessary resources or dependencies
     - Quality standards haven't been met

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names

Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully
Remember: If you only need to make a few tool calls to complete a task, and it is clear what you need to do, it is better to just do the task directly and NOT call this tool at all.

input_schema:

```json
{
  "type": "object",
  "properties": {
    "todos": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "content": {
            "type": "string",
            "description": "Content of the todo item"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "in_progress",
              "completed"
            ],
            "description": "Status of the todo"
          }
        },
        "required": [
          "content",
          "status"
        ],
        "additionalProperties": false
      },
      "description": "List of todo items to update"
    }
  },
  "required": [
    "todos"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
