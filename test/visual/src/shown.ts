// The pictures the site and the docs show: gallery scenes drawn sharp enough
// for a retina screen, approved in review like every other screenshot.
//
// An entry names a scene of the catalogue (catalog.ts), the CSS size it is
// drawn at, and optionally the rectangle inside it to keep, for a picture
// of one card rather than a whole screen. The suite's `shown` project draws
// each one at `SHOWN_SCALE` device pixels per CSS pixel and compares it with
// tests/__shown__/<name>.png; the site's build converts those files into the
// sizes it serves (site/scripts/generate-screens.ts), and `<Screen name>`
// embeds one by its name.
//
// It imports nothing, not even the catalogue's types: the site reads this
// file into its own build and typecheck, where the kit's sources do not
// load. `src/__tests__/shown.test.ts` holds every entry to the catalogue.

/** Device pixels per CSS pixel in a shown picture: the 1x and 2x files the site serves both come from it. */
export const SHOWN_SCALE = 2;

/** The colour mode every shown picture is drawn in: the site is dark only. */
export const SHOWN_MODE = "dark";

/** A size in CSS pixels. */
export interface ShownSize {
  readonly width: number;
  readonly height: number;
}

/** A rectangle in CSS pixels, from the top left of the drawn viewport. */
export interface ShownClip extends ShownSize {
  readonly x: number;
  readonly y: number;
}

/** One picture the site may show. */
export interface Shown {
  /** The handle pages use (`<Screen name="approval">`), kept apart from the scene so a scene can be swapped under it. */
  readonly name: string;
  /** The catalogue's scene it draws. */
  readonly scene: string;
  /** What the picture shows, as a reviewer would say it. */
  readonly title: string;
  /** The CSS size the scene is drawn at. */
  readonly viewport: ShownSize;
  /** The part of the viewport kept, when the picture is one card rather than the whole screen. */
  readonly clip?: ShownClip;
}

/** Every picture the site may show. */
export const SHOWN: readonly Shown[] = [
  {
    name: "approval",
    scene: "session-approval",
    title: "A tool call waits for approval, in the console's session view",
    viewport: { width: 1280, height: 800 },
  },
  {
    name: "asks-first",
    scene: "story-asks-first",
    title:
      "Northwind's ledger agent asks before it posts an adjustment, as the customer sees it",
    viewport: { width: 1280, height: 800 },
    // The agent's reason and the approval card, measured from the drawn
    // screen: the card spans x 288 to 992 and y 300 to 541, the reason sits
    // above it from y 201, and the turn's status bar starts at y 559.
    clip: { x: 272, y: 186, width: 736, height: 366 },
  },
  {
    name: "in-product",
    scene: "story-in-product",
    title:
      "Stigmer's chat panel docked beside a product's ledger screen for Northwind Books, its agent asking before it posts an adjustment",
    // Tall enough that the panel holds the whole conversation, from the
    // person's message to the composer, without scrolling.
    viewport: { width: 1280, height: 1000 },
    // The product's window, measured from the drawn screen: its ring at
    // x 23 and 1256, y 23 and 976; the page's margin around it is left off,
    // so the picture sits on the site's own ground.
    clip: { x: 23, y: 23, width: 1234, height: 954 },
  },
  {
    name: "in-product-panel",
    scene: "story-in-product",
    title: "Stigmer's chat panel inside a product, its agent asking before it posts an adjustment to Northwind's ledger",
    viewport: { width: 1280, height: 1000 },
    // The panel's column, measured from the drawn screen: its left border
    // at x 866, the window's ring at x 1256 and at y 23 and 976.
    clip: { x: 866, y: 23, width: 391, height: 954 },
  },
  // The homepage's first screen steps through one moment per hard part, the
  // ask (`in-product`) beneath the others. Every moment is drawn in the same
  // window as the ask, so each whole picture is the ask's size and each
  // narrow one its panel crop's: a moment that shows over another covers it
  // exactly (the site's hero test holds the sizes).
  {
    name: "own-computer",
    scene: "story-own-computer",
    title: "After the yes, Stigmer's panel hands back the variance report the agent wrote in its outputs folder, beside Northwind's ledger",
    viewport: { width: 1280, height: 1000 },
    // The product's window, as `in-product`: its ring at x 23 and 1256, y 23 and 976.
    clip: { x: 23, y: 23, width: 1234, height: 954 },
  },
  {
    name: "own-computer-panel",
    scene: "story-own-computer",
    title: "Stigmer's panel inside a product, handing back the variance report its agent wrote",
    viewport: { width: 1280, height: 1000 },
    // The panel's column, as `in-product-panel`: its left border at x 866.
    clip: { x: 866, y: 23, width: 391, height: 954 },
  },
  {
    name: "hours",
    scene: "story-hours",
    title: "Two hours into reconciling Northwind's year month by month, in Stigmer's panel beside the year's ledger",
    viewport: { width: 1280, height: 1000 },
    // The product's window, as `in-product`.
    clip: { x: 23, y: 23, width: 1234, height: 954 },
  },
  {
    name: "hours-panel",
    scene: "story-hours",
    title: "Stigmer's panel inside a product, two hours into reconciling Northwind's year, six months of nine done",
    viewport: { width: 1280, height: 1000 },
    // The panel's column, as `in-product-panel`.
    clip: { x: 866, y: 23, width: 391, height: 954 },
  },
  {
    name: "walls",
    scene: "story-walls",
    title: "Two customers of one product, Northwind Books and Fernhill Bakery, each asking the same agent about its own books in its own window",
    viewport: { width: 1280, height: 1000 },
    // Both windows, measured from the drawn screen: the first ring at x 23,
    // the second's right edge at x 1256, both from y 23 to 976.
    clip: { x: 23, y: 23, width: 1234, height: 954 },
  },
  {
    name: "walls-panel",
    scene: "story-walls",
    title: "Northwind's window with its own conversation, and Fernhill Bakery's window below it with its own",
    // Narrow enough that the windows stack, each its bar over its panel:
    // 437 less the page's 24 px margins is the panel crop's 389 px and the
    // ring's 1 px each side.
    viewport: { width: 437, height: 1000 },
    clip: { x: 23, y: 23, width: 391, height: 954 },
  },
  {
    name: "keys",
    scene: "story-keys",
    title: "The integrator's Stigmer console, Models & providers: Anthropic and OpenAI on the organization's own keys",
    viewport: { width: 1280, height: 1000 },
    // The console's window, as `in-product`.
    clip: { x: 23, y: 23, width: 1234, height: 954 },
  },
  {
    name: "keys-panel",
    scene: "story-keys",
    title: "Models & providers on a phone's width: the integrator's own Anthropic key",
    // Narrow enough that the hub lays out as on a phone, framed as `walls-panel`.
    viewport: { width: 437, height: 1000 },
    clip: { x: 23, y: 23, width: 391, height: 954 },
  },
  // The docs' pictures: each the part of a console screen one step of a
  // docs page acts on, drawn at the console's desktop width so it lays out as
  // on the reader's screen, cropped so it shows near 1:1 in the docs column.
  // The routines page (docs/guides/routines/run-an-agent-on-a-schedule.mdx).
  {
    name: "routine-new",
    scene: "routine-new",
    title: "New routine, filled in with the routines page's daily variance report: its Agent, message, every day at 09:00, Asia/Kolkata",
    // Tall enough that the whole form shows: it ends at y 1303.
    viewport: { width: 1280, height: 1360 },
    // The form, measured from the drawn screen: x 216 to 888, y 56 to 1303,
    // with 16 px of the page around it.
    clip: { x: 200, y: 40, width: 704, height: 1279 },
  },
  {
    name: "routine-disabled",
    scene: "routine-disabled",
    title: "The new routine's page: Routine is disabled, with Enable & run now beside its name",
    viewport: { width: 1280, height: 800 },
    // The banner, the header and the tabs, measured from the drawn screen:
    // the column spans x 216 to 1064, the banner starts at y 56 and the tabs
    // end at y 329.
    clip: { x: 200, y: 40, width: 880, height: 305 },
  },
  {
    name: "routine-history",
    scene: "routine-history",
    title: "The routine's History tab after Enable & run now: one start, Manual, by Ada Lovelace",
    viewport: { width: 1280, height: 800 },
    // The header, the tabs and the history, measured from the drawn screen:
    // the column spans x 216 to 1064, the history's table ends at y 284.
    clip: { x: 200, y: 40, width: 880, height: 260 },
  },
  // The agents page (docs/concepts/agents.mdx).
  {
    name: "agent",
    scene: "agent-profile-variance-reporter",
    title: "The agents page's variance-reporter on its page in the console: its header, description and instructions",
    viewport: { width: 1280, height: 800 },
    // The header through the Instructions section, measured from the drawn
    // screen: the column spans x 216 to 1064, the header starts at y 56 and
    // Instructions ends at y 781.
    clip: { x: 200, y: 40, width: 880, height: 757 },
  },
  // The skills page (docs/concepts/skills.mdx).
  {
    name: "skill",
    scene: "skill-detail",
    title: "The skills page's variance-report Skill on its page in the console: its description over its rendered body",
    viewport: { width: 1280, height: 900 },
    // The header, Description and Skill content, measured from the drawn
    // screen: the column spans x 216 to 1064, Skill content ends at y 825.
    clip: { x: 200, y: 40, width: 880, height: 801 },
  },
  // The environments page (docs/guides/environments/set-up-an-environment.mdx).
  {
    name: "environment-new",
    scene: "environment-new",
    title: "New environment, filled in with data-science: limited to api.github.com and our-api.example.com, poppler-utils from apt, pandas and sqlalchemy from pip",
    // Tall enough that the whole form shows: it ends at y 1017.
    viewport: { width: 1280, height: 1080 },
    // The form, measured from the drawn screen: x 216 to 888, y 56 to 1017.
    clip: { x: 200, y: 40, width: 704, height: 993 },
  },
  {
    name: "agent-environment",
    scene: "environment-agent",
    title: "The data team's Agent's Environment section, naming Data science, with its edit button",
    // Tall enough to hold the section: it ends at y 981.
    viewport: { width: 1280, height: 1000 },
    // The Environment section, measured from the drawn screen: x 216 to
    // 1064, y 859 to 981.
    clip: { x: 200, y: 843, width: 880, height: 154 },
  },
  {
    name: "run-settings",
    scene: "environment-run-settings",
    title: "A conversation's Run settings, opened from the composer's configure button: Environment data-science, the agent's default",
    viewport: { width: 1280, height: 800 },
    // The Run settings panel and the composer's buttons under it, measured
    // from the drawn screen: the panel spans x 927 to 1228 and y 518 to 715,
    // the composer ends at y 764.
    clip: { x: 860, y: 502, width: 400, height: 278 },
  },
  // The channel pages (docs/guides/channels/). A dialog is drawn in a window
  // tall enough to hold it whole, and kept with 8 px of the dimmed page
  // around its ring, measured from the drawn screen.
  {
    name: "channels-add",
    scene: "channel-add",
    title: "The Agent's Channels tab with its chat link, Add channel open on Chat link, Slack and WhatsApp",
    viewport: { width: 1280, height: 800 },
    // The tab's header row from y 252 and the chat link card to y 418, the menu at x 840 to 1064 over it.
    clip: { x: 200, y: 240, width: 880, height: 186 },
  },
  {
    name: "chat-link-link",
    scene: "channel-chat-link",
    title: "The chat link's dialog on its Link tab: Anyone with the link can chat, the public link with Copy and Open, Reset link and Tool credentials",
    viewport: { width: 1280, height: 1000 },
    // The dialog: x 384 to 896, y 36 to 964.
    clip: { x: 376, y: 28, width: 528, height: 944 },
  },
  {
    name: "chat-link-card",
    scene: "channel-list",
    title: "The chat link's card on the Channels tab: its link with a copy button, Anyone with the link, the on switch and its menu",
    viewport: { width: 1280, height: 800 },
    // The first card: x 216 to 1064, y 301 to 418.
    clip: { x: 208, y: 293, width: 864, height: 133 },
  },
  {
    name: "chat-link-embed",
    scene: "channel-chat-link-embed",
    title: "The chat link's dialog on its Embed tab: the two-line snippet with Copy, and https://acme.com under Allowed embed origins",
    viewport: { width: 1280, height: 1000 },
    // The dialog: x 384 to 896, y 106 to 895.
    clip: { x: 376, y: 97, width: 528, height: 806 },
  },
  {
    name: "embed-widget",
    scene: "story-embed",
    title: "The embedded chat on a help page of acme.com: the variance reporter's name and description over Chat with variance-reporter, at 400×600",
    // Narrow enough that the host page's text sits beside the widget without a gulf between them.
    viewport: { width: 1000, height: 712 },
    // The host page's window, its ring at x 23 and 977, y 23 and 689.
    clip: { x: 23, y: 23, width: 954, height: 666 },
  },
  {
    name: "connect-slack",
    scene: "channel-connect-slack",
    title: "Connect to Slack: Channel name variance-reporter-slack, Connect as the platform Stigmer app, and Tool credentials",
    viewport: { width: 1280, height: 1000 },
    // The dialog: x 416 to 864, y 100 to 900.
    clip: { x: 408, y: 92, width: 464, height: 816 },
  },
  {
    name: "slack-card",
    scene: "channel-list",
    title: "The Slack channel's card: variance-reporter-slack, Installed in the Acme workspace, serving through the Stigmer app",
    viewport: { width: 1280, height: 800 },
    // The second card: x 216 to 1064, y 427 to 538.
    clip: { x: 208, y: 419, width: 864, height: 127 },
  },
  {
    name: "connect-whatsapp",
    scene: "channel-connect-whatsapp",
    title: "Connect to WhatsApp: variance-reporter-whatsapp, phone number ID 106540352242922, Connect as acme-whatsapp, and Tool credentials",
    viewport: { width: 1280, height: 1000 },
    // The dialog: x 416 to 864, y 51 to 949.
    clip: { x: 408, y: 43, width: 464, height: 914 },
  },
  {
    name: "whatsapp-card",
    scene: "channel-list",
    title: "The WhatsApp channel's card: variance-reporter-whatsapp, Installed, its number and verified business name, serving through acme-whatsapp",
    viewport: { width: 1280, height: 800 },
    // The third card: x 216 to 1064, y 547 to 658.
    clip: { x: 208, y: 539, width: 864, height: 127 },
  },
  {
    name: "channel-app-new",
    scene: "channel-app-new",
    title: "Settings, Channel Apps, the register form: Provider Slack, Name Acme Books, the Slack app manifest for that name, and the three credentials",
    // Tall enough for the whole form: it ends at y 932.
    viewport: { width: 1280, height: 1000 },
    // The form's card: x 152 to 1128, from y 176.
    clip: { x: 144, y: 168, width: 992, height: 776 },
  },
  {
    name: "channel-app-setup",
    scene: "channel-app-setup",
    title: "The Acme Books app's panel: its slug, and Finish setup in Slack with the Events request URL to copy",
    viewport: { width: 1280, height: 800 },
    // The panel's card from y 176 through the Events request URL row; the
    // OAuth redirect row below it names the drawing machine's own address.
    clip: { x: 144, y: 168, width: 992, height: 338 },
  },
  {
    name: "conversations-needs-human",
    scene: "channel-conversations-needs-human",
    title: "Conversations on Needs human: Northwind Books, its escalation banner with Take over, and the conversation as the customer's phone shows it",
    // Narrow enough to show near 1:1 in the docs column.
    viewport: { width: 1000, height: 808 },
    // The workbench: x 24 to 976, y 24 to 784.
    clip: { x: 24, y: 24, width: 952, height: 760 },
  },
  {
    name: "conversation-taken-over",
    scene: "channel-conversation-taken-over",
    title: "Conversations: you have Northwind's conversation, the platform's acknowledgment sent, Hand back to agent, and a reply typed",
    viewport: { width: 1000, height: 808 },
    // The workbench, as `conversations-needs-human`.
    clip: { x: 24, y: 24, width: 952, height: 760 },
  },
];

/** The CSS size of one shown picture: its clip, or the whole viewport. */
export function shownSize(shown: Shown): ShownSize {
  const { width, height } = shown.clip ?? shown.viewport;
  return { width, height };
}
