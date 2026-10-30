# @stigmer/react-core

React hooks for [Stigmer](https://stigmer.ai), the open-source backend for the agents in your product. This is the conversation layer of Stigmer's React kits: the client context, the fetch cache, and the hooks that start a run, follow a session, answer an approval and review a file change, with nothing that draws. A chat that does not render HTML (a terminal, a native app) builds on this package alone; [`@stigmer/react-sdk`](../react/README.md) builds its components over it, and [`@stigmer/ink-ui`](../ink/) its terminal views.

## Install

```bash
npm install @stigmer/react-core @stigmer/client @stigmer/apis @bufbuild/protobuf react
```

Its peers are `react` 19, `@stigmer/client`, `@stigmer/apis` and `@bufbuild/protobuf`. It installs no rendering package: no `react-dom`, no component library, no icons.

If you already use `@stigmer/react-sdk`, you have this package: the React kit re-exports every name here from its root and `./headless`, so import from whichever you install.

## Use

Give the hooks a client through `StigmerContext` (the React kit's `StigmerProvider` and the terminal kit's `InkStigmerProvider` do it for you), then call them:

```tsx
import { Stigmer } from "@stigmer/client";
import { StigmerContext, useSessionConversation } from "@stigmer/react-core";

const client = new Stigmer({ baseUrl: "http://localhost:7234" });

function Conversation({ sessionId, org }: { sessionId: string; org: string }) {
  const conversation = useSessionConversation(sessionId, org);
  return <pre>{conversation.turns.at(-1)?.answer ?? "Waiting for the agent"}</pre>;
}

export function App() {
  return (
    <StigmerContext.Provider value={client}>
      <Conversation sessionId="ses_01j..." org="acme" />
    </StigmerContext.Provider>
  );
}
```

The hooks are documented in the [React SDK reference](https://stigmer.ai/docs/sdk/react), which lists them where the React kit re-exports them.

## Entries

| Entry | What it holds |
| --- | --- |
| `@stigmer/react-core` | The public hooks, contexts and helpers. Every name here is a public API. |
| `@stigmer/react-core/test` | Sample data for tests, galleries and screenshots (`samples`, `sampleInstant`), built through the same schemas the server answers with, at a fixed instant. |
| `@stigmer/react-core/internal` | The React kit's own plumbing (the data-fetch hook and cache, the error mapper, the paging walks). For `@stigmer/react-sdk` only. |

`@stigmer/react-core/internal` carries no compatibility promise: a name may change or leave in any release. It exists so the React kit's hooks and components share one fetch cache and one error mapping with the conversation hooks. It is safe for the kit because every `@stigmer/*` package ships in lockstep and pins the others at the exact same version. Nothing else imports it, and a repository test (`scripts/react-core-internal.test.mjs`) fails if anything does. It stays one entry with one consumer: a second internal entry, or a second package reading this one, is a design change to make in the open, not a convenience.

## Develop

```bash
npm run typecheck -w @stigmer/react-core
npm run test -w @stigmer/react-core
```

`src/__tests__/boundary.test.ts` holds the package's line: its sources import only their own files and the packages above.

The package's TypeDoc run (`npm run tsdoc:check`) checks what it exports but not where its comments link: they link to the React kit's components that use each hook, which only the React kit's run can resolve, and that run checks them, since it documents every name here.
