// The desktop app's last resort, drawn by main.tsx's boundary when the app
// fails while it draws itself: the kit's standalone frame with the failure in
// the console's words, the stack in Copy details and never on the screen, and
// Try again reloading the window. It renders before every provider.

import { ErrorMessage } from "@stigmer/react-sdk";
import { StandaloneScreen } from "@stigmer/react-sdk/console";
import { ServerScreen } from "../server/ServerScreen";
import { GateMark } from "./GateMark";

/** The boot failure: what failed, what wasn't lost, and Try again. */
export function BootFailure({ error }: { error: Error }) {
  return (
    <ServerScreen>
      <StandaloneScreen mark={<GateMark />}>
        <ErrorMessage
          error={error}
          title="Stigmer Desktop couldn't start."
          comfort="Your conversations are safe on your server."
          retry={() => window.location.reload()}
          reference={error.stack}
        />
      </StandaloneScreen>
    </ServerScreen>
  );
}
