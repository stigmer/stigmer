"use client";

// Choosing a server: the address of the Stigmer server a person's team uses,
// on the kit's field, with Connect and Back. The desktop app shows it as a
// screen when there is nothing to go back to (the app's own server can't be
// used), and as a dialog over the running app otherwise, which holds the
// keyboard's focus and leaves the app (and the conversations its agents
// hold) as it was on Back. The host decides whether an address may be used
// and says why not; the form draws the refusal under the field. It renders
// before any `StigmerProvider`: it picks the server the kit will talk to.

import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../internal/DialogShell.js";
import { Field, TextInput } from "../internal/form/index.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { StandaloneScreen } from "../standalone-screen/StandaloneScreen.js";

/** Props for {@link ServerChooserForm}. */
export interface ServerChooserFormProps {
  /**
   * Chooses the address: resolves `null` once the host accepts it (and
   * connects), or the reason it refused the address, drawn under the field.
   */
  readonly onChoose: (address: string) => Promise<string | null>;
  /** Returns to where the person was. Without it the form offers no Back (nothing to go back to). */
  readonly onBack?: () => void;
  /** `screen` in place of the app; `dialog` over it, open while `open` is true. */
  readonly presentation?: "screen" | "dialog";
  /** Whether the dialog is open (`presentation="dialog"`). */
  readonly open?: boolean;
  /** The server that can't be used, and why: said above the field, in place of the line under the title. */
  readonly unusable?: { readonly host: string; readonly detail: string };
  /** The app's name, as the person knows it. */
  readonly appName?: string;
  /** The host's mark, on top of the screen. */
  readonly mark?: ReactNode;
}

const TITLE = "Use another server";

/**
 * The address of another Stigmer server, as a screen or a dialog over the app.
 *
 * @example
 * ```tsx
 * function Choose({ choose, back }: { choose: (address: string) => Promise<string | null>; back: () => void }) {
 *   return <ServerChooserForm onChoose={choose} onBack={back} />;
 * }
 * ```
 */
export function ServerChooserForm({
  onChoose,
  onBack,
  presentation = "screen",
  open = true,
  unusable,
  appName = "Stigmer Desktop",
  mark,
}: ServerChooserFormProps) {
  const formId = useId();
  const [address, setAddress] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isChoosing, setIsChoosing] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsChoosing(true);
    setRefusal(null);
    const refused = await onChoose(address.trim());
    setIsChoosing(false);
    if (refused !== null) setRefusal(refused);
  };

  const field = (
    <form id={formId} onSubmit={(event) => void submit(event)} noValidate>
      <Field label="Server address" hint="The address your team uses for Stigmer." error={refusal ?? undefined}>
        <TextInput
          type="url"
          inputMode="url"
          autoComplete="url"
          autoFocus
          // In the dialog the shell focuses this on open, not its Close.
          data-autofocus=""
          spellCheck={false}
          placeholder="https://stigmer.example.com"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="stg:w-full stg:font-mono"
        />
      </Field>
    </form>
  );
  const connect = (
    <Button
      type="submit"
      form={formId}
      disabled={isChoosing || address.trim() === ""}
      aria-busy={isChoosing}
      icon={isChoosing ? <SpinnerIcon size={14} /> : undefined}
    >
      Connect
    </Button>
  );
  const back =
    onBack !== undefined ? (
      <Button variant="ghost" onClick={onBack} disabled={isChoosing}>
        Back
      </Button>
    ) : null;

  if (presentation === "dialog") {
    return (
      <DialogShell open={open} onOpenChange={(next) => !next && onBack?.()} width="md">
        <DialogHeader
          title={TITLE}
          description={`${appName} works with any Stigmer server. Your conversations here stay as they are.`}
          onClose={onBack}
        />
        <DialogBody>{field}</DialogBody>
        <DialogFooter>
          {back}
          {connect}
        </DialogFooter>
      </DialogShell>
    );
  }

  return (
    <StandaloneScreen
      mark={mark}
      title={TITLE}
      lead={unusable === undefined ? `${appName} works with any Stigmer server.` : undefined}
      acts={
        <>
          {connect}
          {back}
        </>
      }
    >
      {unusable !== undefined && (
        <ErrorMessage error={new Error(unusable.detail)} title={`${unusable.host} can't be used.`} />
      )}
      {field}
    </StandaloneScreen>
  );
}
