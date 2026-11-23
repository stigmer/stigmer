What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The card is a React component receiving `ToolCardProps` (`call` and, for the app's own tools, `answer`).
- The card map is defined at module level, so cards don't remount.
- If the card throws, Stigmer's own body draws instead.
- The card stays in view after the turn finishes.
- Up to two actions with an `icon` sit beside Copy; others go in a "More actions" menu, all reachable by keyboard.
- The action's `onAction` closes over their router, for example navigating to the invoice.
- The message info carries `sessionId` and `runId`.
