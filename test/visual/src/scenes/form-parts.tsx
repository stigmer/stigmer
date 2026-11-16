// The kit's form parts on the parts scene, each in the states its drawing
// shows: a text field at rest, filled, with an error, disabled and with a
// leading icon; the small size beside its buttons; a field and the button
// beside it at one height; multi-line and select; checkboxes and switches;
// the choice group segmented, small and as a list; the file drop at rest,
// dragged over and refused; a form's foot (working, a field's error against
// the form's failure, in a dialog); and the inline editor closed, open,
// saving and failed; and the dialog's header, body and footer in four
// dialogs (a destructive confirm, Apply YAML, Run a routine, Manage access),
// drawn in the page's flow (not modal) so the scene shows all four at once.
// The parts are the kit's internal ones, read from its source as the
// from-hooks scene reads an example.

import type { ReactNode } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { Button, ErrorMessage, IconButton } from "@stigmer/react-sdk";
import {
  Checkbox,
  ChoiceGroup,
  Field,
  FieldError,
  FileDrop,
  FormFooter,
  Select,
  SwitchField,
  TextArea,
  TextInput,
} from "../../../../sdk/react/src/internal/form/index.ts";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogShell,
} from "../../../../sdk/react/src/internal/DialogShell.tsx";
import { Tag } from "../../../../sdk/react/src/internal/surface/Tag.tsx";

/** A create the server didn't answer: the failure a form's foot most often meets. */
const UNANSWERED = new ConnectError(
  "the server did not answer in time",
  Code.Unavailable,
);

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/** Columns that stack at a narrow width. */
function Columns({
  children,
  min = "14rem",
}: {
  readonly children: ReactNode;
  readonly min?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}, 100%), 1fr))`,
        gap: "1rem",
      }}
    >
      {children}
    </div>
  );
}

/** An inline editor's row: its label, its value or its open field, its acts. */
function InlineRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "8rem minmax(0, 1fr)",
        gap: "0.5rem 1rem",
        alignItems: "center",
        padding: "0.625rem 0.875rem",
        borderTop: "1px solid var(--stgm-border-muted)",
      }}
    >
      <span className="stg:text-xs stg:text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** The text fields, the small size, multi-line and select, checkboxes and switches, choices and the file drop. */
export function FieldParts({
  Group,
}: {
  readonly Group: (props: {
    readonly label: string;
    readonly children: ReactNode;
  }) => ReactNode;
}) {
  return (
    <>
      <Group label="A text field, in each state">
        <Columns>
          <Field label="Name" hint="The name in links and files.">
            <TextInput placeholder="e.g. daily-fee-reminders" />
          </Field>
          <Field label="Name" hint="The name in links and files.">
            <TextInput defaultValue="daily-variance-report" />
          </Field>
          <Field label="Name">
            <TextInput defaultValue="daily-variance-report" />
          </Field>
          <Field label="Name" error="Give the routine a name.">
            <TextInput />
          </Field>
          <Field label="Name">
            <TextInput defaultValue="daily-variance-report" disabled />
          </Field>
          <Field label="Search" optional>
            <span
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
              }}
            >
              <span
                className="stg:pointer-events-none stg:absolute stg:left-2.5 stg:text-muted-foreground"
                style={{ display: "grid" }}
              >
                <SearchIcon />
              </span>
              <TextInput
                placeholder="Search agents"
                className="stg:w-full stg:pl-8"
              />
            </span>
          </Field>
        </Columns>
      </Group>
      <Group label="Small, for inline rows">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            maxWidth: "24rem",
          }}
        >
          <TextInput
            size="xs"
            aria-label="Slug"
            defaultValue="ledger-reviewer"
            className="stg:flex-1 stg:font-mono"
          />
          <Button size="xs">Save</Button>
          <Button size="xs" variant="ghost">
            Cancel
          </Button>
        </div>
      </Group>
      <Group label="A field and the button beside it: one height">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            maxWidth: "35rem",
          }}
        >
          <TextInput
            aria-label="Address"
            defaultValue="https://ledger.acme.example/mcp"
            className="stg:flex-1 stg:font-mono"
          />
          <Button variant="outline">Add</Button>
          <Button>Connect</Button>
        </div>
      </Group>
      <Group label="Multi-line, select">
        <Columns>
          <Field label="Message" hint="Grows with its words.">
            <TextArea
              rows={4}
              defaultValue="Report yesterday's ledger variances against budget, and save the report as variances.csv."
            />
          </Field>
          <Field label="Time zone">
            <Select defaultValue="Asia/Kolkata">
              <option value="Asia/Kolkata">Asia/Kolkata</option>
              <option value="UTC">UTC</option>
            </Select>
          </Field>
          <Field label="Environment" optional>
            <Select defaultValue="">
              <option value="">Choose an environment</option>
              <option value="data-science">data-science</option>
            </Select>
          </Field>
        </Columns>
      </Group>
      <Group label="Checkbox and switch">
        <Columns min="18rem">
          <label
            style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}
          >
            <Checkbox defaultChecked />
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.125rem",
              }}
            >
              <span className="stg:text-sm stg:font-medium stg:text-foreground">
                Also allow package registries and code hosts
              </span>
              <span className="stg:text-xs stg:text-muted-foreground">
                npm, PyPI, crates.io and the other common hosts. Packages need
                it.
              </span>
            </span>
          </label>
          <label
            style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}
          >
            <Checkbox />
            <span className="stg:text-sm stg:font-medium stg:text-foreground">
              Also allow this agent's MCP servers
            </span>
          </label>
          <SwitchField
            label="Turn it on now"
            hint="Leave off to create it staged."
            checked={false}
            onCheckedChange={() => {}}
          />
          <SwitchField
            label="Create accounts on sign-in"
            hint="Your users join as Member."
            checked
            onCheckedChange={() => {}}
          />
        </Columns>
      </Group>
      <Group label="Choice group: segmented, and as a list">
        <Columns min="18rem">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              alignItems: "flex-start",
            }}
          >
            <ChoiceGroup
              aria-label="Cadence"
              value="daily"
              onChange={() => {}}
              options={[
                "Hourly",
                "Daily",
                "Weekly",
                "Monthly",
                "Custom cron",
              ].map((label) => ({ value: label.toLowerCase(), label }))}
            />
            <ChoiceGroup
              aria-label="Content view mode"
              size="xs"
              value="rendered"
              onChange={() => {}}
              options={[
                { value: "rendered", label: "Rendered" },
                { value: "source", label: "Source" },
              ]}
            />
          </div>
          <ChoiceGroup
            variant="list"
            aria-label="Network"
            value="limited"
            onChange={() => {}}
            options={[
              {
                value: "any",
                label: "Any website",
                description: "The sandbox may reach any website.",
              },
              {
                value: "limited",
                label: "Listed websites only",
                description: "The sandbox may reach only the websites below.",
              },
            ]}
          />
        </Columns>
      </Group>
      <Group label="File drop: at rest, dragged over, refused">
        <Columns min="12rem">
          <FileDrop
            title="Drop a skill's .zip here"
            hint="Up to 10 MB."
            onFiles={() => {}}
            aria-label="Skill package"
          />
          <FileDrop
            title="Drop it to upload"
            hint="Up to 10 MB."
            onFiles={() => {}}
            aria-label="Skill package, dragged over"
          />
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <FileDrop
              title="Drop a plugin's .zip here"
              hint="Up to 50 MB."
              invalid
              onFiles={() => {}}
              aria-label="Plugin package"
            />
            <FieldError>
              This isn't a plugin: there's no plugin.json at its top.
            </FieldError>
          </div>
        </Columns>
      </Group>
    </>
  );
}

/** A form's foot, working, with a field's error and the form's failure, and in a dialog. */
export function FooterParts({
  Group,
}: {
  readonly Group: (props: {
    readonly label: string;
    readonly children: ReactNode;
  }) => ReactNode;
}) {
  return (
    <>
      <Group label="A form's foot: the primary act, then Cancel, one size">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            maxWidth: "35rem",
          }}
        >
          <Field label="Name">
            <TextInput defaultValue="data-science" className="stg:font-mono" />
          </Field>
          <FormFooter
            submitLabel="Create environment"
            submitType="button"
            onCancel={() => {}}
          />
        </div>
      </Group>
      <Group label="Working: the act keeps its words and holds">
        <FormFooter
          submitLabel="Create environment"
          submitType="button"
          busy
          onCancel={() => {}}
        />
      </Group>
      <Group label="A field's error under its field; the form's failure above the acts">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            maxWidth: "35rem",
          }}
        >
          <Field
            label="Name"
            error="acme already has an environment named data-science."
          >
            <TextInput defaultValue="data-science" className="stg:font-mono" />
          </Field>
          <FormFooter
            submitLabel="Create environment"
            submitType="button"
            onCancel={() => {}}
            failure={
              <ErrorMessage
                error={UNANSWERED}
                title="Couldn't create the environment."
                retry={() => {}}
              />
            }
          />
        </div>
      </Group>
      <Group label="In a dialog: the same acts, at the dialog's end">
        <FormFooter
          submitLabel="Remove"
          submitType="button"
          submitVariant="destructive"
          align="end"
          onCancel={() => {}}
        />
      </Group>
    </>
  );
}

/** The inline editor: closed, open, saving and failed. */
export function InlineEditorParts({
  Group,
}: {
  readonly Group: (props: {
    readonly label: string;
    readonly children: ReactNode;
  }) => ReactNode;
}) {
  const open = (value: string, saving = false) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        minWidth: 0,
      }}
    >
      <TextInput
        size="xs"
        aria-label="Slug"
        defaultValue={value}
        className="stg:flex-1 stg:font-mono"
        disabled={saving}
      />
      <Button size="xs" disabled={saving}>
        Save
      </Button>
      <Button size="xs" variant="ghost" disabled={saving}>
        Cancel
      </Button>
    </div>
  );
  return (
    <Group label="The inline editor: closed, open, saving, failed">
      <div
        className="stg:overflow-hidden stg:rounded-xl stg:border stg:border-border stg:bg-card"
        style={{ maxWidth: "40rem" }}
      >
        <InlineRow label="Slug">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
            }}
          >
            <span className="stg:font-mono stg:text-sm">ledger-reviewer</span>
            <IconButton size="xs" label="Edit slug" icon={<PencilIcon />} />
          </div>
        </InlineRow>
        <InlineRow label="Slug">{open("ledger-reviewer-2")}</InlineRow>
        <InlineRow label="Slug">{open("ledger-reviewer-2", true)}</InlineRow>
        <InlineRow label="Slug">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
              minWidth: 0,
            }}
          >
            <Field
              label="Slug"
              labelHidden
              error="Use lowercase letters, numbers and hyphens."
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  minWidth: 0,
                }}
              >
                <TextInput
                  size="xs"
                  defaultValue="Ledger Reviewer"
                  className="stg:flex-1 stg:font-mono"
                />
                <Button size="xs">Save</Button>
                <Button size="xs" variant="ghost">
                  Cancel
                </Button>
              </div>
            </Field>
          </div>
        </InlineRow>
        <InlineRow label="Description">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
              minWidth: 0,
            }}
          >
            <TextInput
              size="xs"
              aria-label="Description"
              defaultValue="Reads the month's ledger…"
              className="stg:flex-1"
            />
            <Button size="xs">Save</Button>
            <Button size="xs" variant="ghost">
              Cancel
            </Button>
          </div>
        </InlineRow>
      </div>
    </Group>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

/** One person or team on the access list, with what they may do. */
function AccessRow({ initial, name, sub, trailing }: { readonly initial: string; readonly name: string; readonly sub: string; readonly trailing: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem 0.875rem" }}>
      <span aria-hidden="true" className="stg:grid stg:size-7 stg:place-items-center stg:rounded-full stg:bg-muted stg:text-xs stg:font-medium stg:text-muted-foreground">
        {initial}
      </span>
      <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <span className="stg:text-sm stg:font-medium stg:text-foreground">{name}</span>
        <span className="stg:text-xs stg:text-muted-foreground">{sub}</span>
      </span>
      {trailing}
    </div>
  );
}

/** The dialog's parts in four dialogs, in the page's flow so all four show at once. */
export function DialogParts({
  Group,
}: {
  readonly Group: (props: {
    readonly label: string;
    readonly children: ReactNode;
  }) => ReactNode;
}) {
  const shown = { open: true, modal: false, onOpenChange: () => {} } as const;
  return (
    <>
      <Group label="A destructive confirm">
        <DialogShell {...shown} width="md">
          <DialogHeader title="Delete Variance reporter?" description="Its versions, evals and channels go with it. Sessions it ran stay." />
          <DialogFooter>
            <Button variant="ghost">Cancel</Button>
            <Button variant="destructive">Delete</Button>
          </DialogFooter>
        </DialogShell>
      </Group>
      <Group label="Apply YAML">
        <DialogShell {...shown} width="xl">
          <DialogHeader
            title="Apply YAML"
            description="Paste or drop a file that describes agents, skills or routines. Each one is created or updated by its name."
          />
          <DialogBody>
            <Field label="YAML" hint="Or drop a .yaml file here.">
              <TextArea
                className="stg:font-mono"
                rows={4}
                defaultValue={"kind: Agent\nmetadata:\n  name: variance-reporter\nspec:\n  instructions: |\n    You review a customer's quarterly ledger…"}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost">Cancel</Button>
            <Button>Apply</Button>
          </DialogFooter>
        </DialogShell>
      </Group>
      <Group label="Run a routine">
        <DialogShell {...shown} width="md">
          <DialogHeader title="Run daily-variance-report now?" description="One run starts now with the routine's message. Its schedule doesn't change." />
          <DialogBody>
            <Field label="Message" optional hint="Leave empty to send the routine's own message.">
              <TextArea rows={4} placeholder="Report yesterday's ledger variances against budget." />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost">Cancel</Button>
            <Button>Run now</Button>
          </DialogFooter>
        </DialogShell>
      </Group>
      <Group label="Manage access">
        <DialogShell {...shown} width="xl">
          <DialogHeader title="Who can use Variance reporter" description="People and teams in acme, and what each may do." />
          <DialogBody>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <Field label="Person or team" labelHidden className="stg:flex-1">
                <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <span className="stg:pointer-events-none stg:absolute stg:left-2.5 stg:text-muted-foreground" style={{ display: "grid" }}>
                    <SearchIcon />
                  </span>
                  <TextInput placeholder="Add a person or a team" className="stg:w-full stg:pl-8" />
                </span>
              </Field>
              <Field label="What they may do" labelHidden className="stg:w-48">
                <Select defaultValue="use">
                  <option value="use">Can use</option>
                </Select>
              </Field>
              <Button variant="outline">Add</Button>
            </div>
            <div className="stg:overflow-hidden stg:rounded-xl stg:border stg:border-border stg:divide-y stg:divide-border-muted">
              <AccessRow initial="A" name="Ada Lovelace" sub="ada@acme.example" trailing={<Tag>Owner</Tag>} />
              <AccessRow
                initial="G"
                name="Grace Hopper"
                sub="grace@acme.example"
                trailing={
                  <>
                    <Field label="What Grace Hopper may do" labelHidden className="stg:w-32">
                      <Select size="xs" defaultValue="change">
                        <option value="change">Can change</option>
                      </Select>
                    </Field>
                    <IconButton label="Remove Grace Hopper" size="xs" icon={<TrashIcon />} />
                  </>
                }
              />
              <AccessRow
                initial="F"
                name="Finance"
                sub="Team · 6 people"
                trailing={
                  <>
                    <Field label="What Finance may do" labelHidden className="stg:w-32">
                      <Select size="xs" defaultValue="use">
                        <option value="use">Can use</option>
                      </Select>
                    </Field>
                    <IconButton label="Remove Finance" size="xs" icon={<TrashIcon />} />
                  </>
                }
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button>Done</Button>
          </DialogFooter>
        </DialogShell>
      </Group>
    </>
  );
}
