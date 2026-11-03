/**
 * The picture on the docs' Runners page: how work reaches a runner, with
 * Stigmer opened up, drawn still in the homepage drawing's language.
 *
 * It is drawn in HTML so its words are page text, and it lays out by its own
 * width (it is a size container): an L from 600px, down the page below. The
 * layout, the lines' routes and the frame live in `work-reaches-a-runner.ts`;
 * this file draws the pieces, each named for its grid area. The drawing is
 * hidden from screen readers and its caption tells it in order, the same
 * words the docs' markdown exports carry. It holds no state and no hooks,
 * and the page renders it on the server.
 */
import { Box, Connector, Frame } from "./drawing/Drawing";
import {
  ATTRIBUTE,
  BOXES,
  CAPTION,
  CARRIES,
  CONNECTORS,
  DRAWING_CSS,
  FRAME,
  LABELS,
  PLACES,
  type ConnectorId,
  type LabelId,
} from "./work-reaches-a-runner";

/** Something a run carries, as a small bordered chip. */
function Chip({ children }: { children: string }) {
  return (
    <span className="flex min-h-6 max-w-full items-center rounded border border-subtle bg-background px-2 py-0.5 font-mono text-[11px] leading-4 text-foreground [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}

function WorkReachesARunner() {
  return (
    <figure {...{ [`data-${ATTRIBUTE}`]: "" }} className="@container w-full font-sans text-foreground">
      <style href={ATTRIBUTE} precedence="default">
        {DRAWING_CSS}
      </style>
      <div {...{ [`data-${ATTRIBUTE}-drawing`]: "" }} aria-hidden="true">
        <Frame id={FRAME.id} label={FRAME.label} />
        {BOXES.map((id) => (
          <Box key={id} area={id} name={PLACES[id].name} detail={PLACES[id].detail}>
            {id === "runner" ? (
              <span className="flex flex-col items-center gap-1">
                {CARRIES.map((carried) => (
                  <Chip key={carried}>{carried}</Chip>
                ))}
              </span>
            ) : null}
          </Box>
        ))}
        {(Object.keys(CONNECTORS) as ConnectorId[]).map((id) => (
          <Connector key={id} id={id} connector={CONNECTORS[id]} />
        ))}
        {(Object.keys(LABELS) as LabelId[]).map((id) => (
          <span key={id} data-area={id} className="font-mono text-xs leading-4 text-muted-foreground">
            {LABELS[id]}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{CAPTION}</figcaption>
    </figure>
  );
}

export { WorkReachesARunner };
