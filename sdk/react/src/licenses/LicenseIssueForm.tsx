"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { Violation } from "@bufbuild/protovalidate";
import { pathToString } from "@bufbuild/protobuf/reflect";
import { cn } from "@stigmer/theme";
import {
  buildLicenseProto,
  getUserMessage,
  StigmerError,
  type LicenseCustomerInput,
  type LicenseInput,
} from "@stigmer/sdk";
import { LicenseSchema, type License } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import { LicenseTerm } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import { Button } from "../button/index.js";
import { UNSTYLED_FIELDSET, UNSTYLED_LIST } from "../internal/element-resets.js";
import { Field, INPUT_CLASSES } from "../internal/form-primitives.js";
import { validateMessage } from "../internal/validate.js";
import {
  DEFAULT_GRACE_DAYS,
  coverageStartDay,
  graceDaysOf,
  isPastDay,
  licenseName,
  mintCustomerId,
  parseGraceDays,
  parseLimit,
  presetLastCoveredDay,
  toLicenseInput,
  type LicenseDraft,
} from "./license-draft.js";
import { findCustomerMatches, type LicenseCustomerSummary } from "./license-customers.js";
import {
  FEATURE_LABELS,
  GRANTABLE_FEATURES,
  TERM_LABELS,
  featureNames,
  limitPart,
  utcDay,
  type GrantableFeature,
  type IssuableTerm,
} from "./license-format.js";

/** Props for {@link LicenseIssueForm}. */
export interface LicenseIssueFormProps {
  /** The customers licenses have been issued to, for the picker. */
  readonly customers: readonly LicenseCustomerSummary[];
  /** The license this issue renews; its terms pre-fill the form. */
  readonly renewing?: License;
  /** The clock the date presets and the past-day check read. */
  readonly now: Date;
  /** `true` while the issue is in flight. */
  readonly isSubmitting: boolean;
  /** The failure of the last issue, or `null`. */
  readonly submitError: Error | null;
  /** Called with the SDK input once every rule holds. */
  readonly onSubmit: (input: LicenseInput) => void;
  /** Called when the operator cancels. */
  readonly onCancel: () => void;
  readonly className?: string;
}

type CustomerMode = "existing" | "new";

/**
 * Native checkboxes and radios take the theme's primary through
 * `accent-color`, the `SelectionCheckbox` idiom, so no preset renders a
 * browser-blue control inside its brand.
 */
const NATIVE_CONTROL =
  "stg:size-3.5 stg:shrink-0 stg:cursor-pointer stg:accent-primary stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-1";

const TERM_PRESET_HINT: Readonly<Record<IssuableTerm, string>> = {
  [LicenseTerm.trial]: "30 days",
  [LicenseTerm.paid]: "1 year",
};

/**
 * The operator's words for a contract rule the form's draft broke, keyed
 * by the violation's field path. The rule is the contract's (validated
 * with the same engine the server runs); only the sentence is ours.
 */
const VIOLATION_COPY: Readonly<Record<string, string>> = {
  "spec.customer.display_name": "Name the customer.",
  "spec.customer.contact_email": "Enter the address renewal notices go to.",
  "spec.entitlements.limits.max_users": "Enter at least 1, or leave it empty for unlimited.",
  "spec.entitlements.limits.max_organizations": "Enter at least 1, or leave it empty for unlimited.",
  "spec.notes": "Notes are limited to 4,096 characters.",
};

/**
 * The issue form: who the license is for, the term, what it permits and
 * for how long. Its output is the SDK's `LicenseInput`, checked against the
 * contract's own rules before it is sent.
 *
 * The customer is picked from those already licensed whenever there are
 * any, so a renewal reuses the customer's id and its history stays whole;
 * a new customer gets a freshly minted id, with a warning when the name or
 * address already belongs to someone on the list. The coverage and the
 * grace follow the term's presets until the operator edits them.
 */
export function LicenseIssueForm({
  customers,
  renewing,
  now,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
  className,
}: LicenseIssueFormProps) {
  const ids = useId();
  const renewingCustomerId = renewing?.spec?.customer?.id ?? "";
  const renewingTerm = issuableTerm(renewing?.spec?.term);

  const [mode, setMode] = useState<CustomerMode>(
    renewingCustomerId !== "" || customers.length > 0 ? "existing" : "new",
  );
  const [customerId, setCustomerId] = useState(renewingCustomerId);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newOrganization, setNewOrganization] = useState("");
  const [mintedId] = useState(() => mintCustomerId());
  const [term, setTerm] = useState<IssuableTerm>(renewingTerm ?? LicenseTerm.trial);
  // `null` follows the term's preset; a value is the operator's edit.
  const [editedLastDay, setEditedLastDay] = useState<string | null>(null);
  const [editedGrace, setEditedGrace] = useState<string | null>(() => {
    if (!renewing || renewingTerm === undefined) return null;
    const grace = graceDaysOf(renewing);
    return grace === DEFAULT_GRACE_DAYS[renewingTerm] ? null : String(grace);
  });
  const [maxUsers, setMaxUsers] = useState(limitText(renewing?.spec?.entitlements?.limits?.maxUsers));
  const [maxOrganizations, setMaxOrganizations] = useState(
    limitText(renewing?.spec?.entitlements?.limits?.maxOrganizations),
  );
  const [features, setFeatures] = useState<readonly GrantableFeature[]>(() =>
    (renewing?.spec?.entitlements?.features ?? []).filter(isGrantable),
  );
  const [notes, setNotes] = useState("");
  const [attempted, setAttempted] = useState(false);

  const today = utcDay(now);
  const startDay = coverageStartDay(now, renewing);
  const lastCoveredDay = editedLastDay ?? presetLastCoveredDay(term, startDay);
  const graceText = editedGrace ?? String(DEFAULT_GRACE_DAYS[term]);

  const selected = customers.find((c) => c.customer.id === customerId);
  const customer: LicenseCustomerInput | undefined =
    mode === "existing"
      ? selected && {
          id: selected.customer.id,
          displayName: selected.customer.displayName,
          contactEmail: selected.customer.contactEmail,
          organization: selected.customer.organization,
        }
      : { id: mintedId, displayName: newName, contactEmail: newEmail, organization: newOrganization };
  const matches =
    mode === "new" ? findCustomerMatches(customers, { displayName: newName, contactEmail: newEmail }) : [];

  const grace = parseGraceDays(graceText);
  const users = parseLimit(maxUsers);
  const organizations = parseLimit(maxOrganizations);
  const coverageError =
    lastCoveredDay === ""
      ? "Choose the last day the license covers."
      : isPastDay(lastCoveredDay, now)
        ? "The last covered day cannot be in the past."
        : null;

  let input: LicenseInput | undefined;
  let violations: readonly Violation[] = [];
  if (customer && grace.ok && users.ok && organizations.ok && coverageError === null) {
    const draft: LicenseDraft = {
      customer,
      term,
      lastCoveredDay,
      graceDays: grace.value,
      maxUsers: users.value,
      maxOrganizations: organizations.value,
      features,
      notes,
    };
    input = toLicenseInput(draft);
    violations = validateMessage(LicenseSchema, buildLicenseProto(input));
  }

  const violationAt = (path: string): string | null => {
    const hit = violations.find((v) => pathToString(v.field) === path);
    return hit ? (VIOLATION_COPY[path] ?? hit.message) : null;
  };
  // A field speaks once it has content or once the operator tried to submit.
  const shown = (hasContent: boolean, error: string | null) =>
    hasContent || attempted ? error : null;
  const unmappedViolations = violations.filter(
    (v) => !(pathToString(v.field) in VIOLATION_COPY),
  );

  const ready = input !== undefined && violations.length === 0;
  // An existing customer's fields are not editable here, so a rule their
  // stored value breaks is said under the picker rather than lost.
  const customerProblem = !selected
    ? "Choose a customer, or enter a new one."
    : violationAt("spec.customer.contact_email") !== null || violationAt("spec.customer.display_name") !== null
      ? "This customer's stored name or address does not pass validation. Issue to them as a new customer with corrected details."
      : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!ready || !input) {
      setAttempted(true);
      return;
    }
    onSubmit(input);
  };

  const toggleFeature = (feature: GrantableFeature, on: boolean) =>
    setFeatures((current) =>
      on
        ? GRANTABLE_FEATURES.filter((f) => f === feature || current.includes(f))
        : current.filter((f) => f !== feature),
    );

  const previewName = customer?.displayName.trim()
    ? licenseName(term, customer.displayName, lastCoveredDay || today)
    : null;

  return (
    <form
      className={cn("stg:max-w-xl stg:space-y-5", className)}
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby={`${ids}-title`}
    >
      <div className="stg:space-y-2">
        <Button
          variant="ghost"
          size="xs"
          icon={<ArrowLeft className="stg:size-3.5" aria-hidden="true" />}
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Licenses
        </Button>
        <div>
          <h3 id={`${ids}-title`} className="stg:m-0 stg:text-base stg:font-semibold stg:text-foreground">
            {renewing ? "Renew license" : "Issue license"}
          </h3>
          <p className="stg:m-0 stg:mt-1 stg:text-sm stg:text-muted-foreground">
            {renewing
              ? "The renewal is a new license. Once it is issued, the calendar shows the current one as renewed."
              : "A license is final once issued. To change one, issue a new license; the calendar shows the old one as renewed."}
          </p>
        </div>
      </div>

      <FormSection title="Customer">
        {renewing && selected ? (
          // A renewal's customer is fixed: said as text, not a disabled control.
          <p className="stg:m-0 stg:text-sm">
            <span className="stg:block stg:text-foreground">{selected.customer.displayName}</span>
            <span className="stg:block stg:text-muted-foreground">{selected.customer.contactEmail}</span>
          </p>
        ) : null}
        {customers.length > 0 && !renewing && (
          <fieldset className={cn(UNSTYLED_FIELDSET, "stg:flex stg:flex-wrap stg:gap-4")}>
            <legend className="stg:sr-only">Customer</legend>
            <Choice
              name={`${ids}-mode`}
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              label="Existing customer"
              disabled={isSubmitting}
            />
            <Choice
              name={`${ids}-mode`}
              checked={mode === "new"}
              onChange={() => setMode("new")}
              label="New customer"
              disabled={isSubmitting}
            />
          </fieldset>
        )}

        {renewing ? (
          <FieldError message={customerProblem} />
        ) : mode === "existing" ? (
          <Field label="Licensed customer" required>
            <select
              className={INPUT_CLASSES}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={isSubmitting}
            >
              <option value="">Choose a customer</option>
              {customers.map(({ customer: c, licenseCount }) => (
                <option key={c.id} value={c.id}>
                  {`${c.displayName} — ${c.contactEmail} · ${licenseCount} ${licenseCount === 1 ? "license" : "licenses"}`}
                </option>
              ))}
            </select>
            <FieldError message={shown(selected !== undefined, customerProblem)} />
          </Field>
        ) : (
          <>
            <Field label="Display name" required>
              <input
                className={INPUT_CLASSES}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="As the licensed server shows it, e.g. Acme Corp"
                disabled={isSubmitting}
                autoComplete="off"
              />
              <FieldError message={shown(newName !== "", violationAt("spec.customer.display_name"))} />
            </Field>
            <Field label="Contact email" required>
              <input
                className={INPUT_CLASSES}
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Where renewal and expiry notices go"
                disabled={isSubmitting}
                autoComplete="off"
              />
              <FieldError message={shown(newEmail !== "", violationAt("spec.customer.contact_email"))} />
            </Field>
            <Field label="Cloud organization">
              <input
                className={INPUT_CLASSES}
                value={newOrganization}
                onChange={(e) => setNewOrganization(e.target.value)}
                placeholder="Its slug, if the customer also holds one"
                disabled={isSubmitting}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {matches.length > 0 && (
              <div
                role="status"
                className="stg:space-y-1.5 stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2"
              >
                <p className="stg:text-xs stg:text-foreground">
                  {matches.length === 1
                    ? "A customer with this name or address already holds licenses."
                    : "Customers with this name or address already hold licenses."}{" "}
                  Pick them instead, so their renewals stay in one history.
                </p>
                <div className="stg:flex stg:flex-wrap stg:gap-2">
                  {matches.map(({ customer: c }) => (
                    <Button
                      key={c.id}
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setCustomerId(c.id);
                        setMode("existing");
                      }}
                    >
                      {`Use ${c.displayName}`}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </FormSection>

      <FormSection title="Term">
        <fieldset className={cn(UNSTYLED_FIELDSET, "stg:flex stg:flex-wrap stg:gap-4")}>
          <legend className="stg:sr-only">Term</legend>
          {([LicenseTerm.trial, LicenseTerm.paid] as const).map((t) => (
            <Choice
              key={t}
              name={`${ids}-term`}
              checked={term === t}
              onChange={() => setTerm(t)}
              label={`${TERM_LABELS[t]} · ${TERM_PRESET_HINT[t]}`}
              disabled={isSubmitting}
            />
          ))}
        </fieldset>
        <div className="stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-2">
          <Field label="Covered through (UTC)" required>
            <input
              className={INPUT_CLASSES}
              type="date"
              min={today}
              value={lastCoveredDay}
              onChange={(e) => setEditedLastDay(e.target.value)}
              disabled={isSubmitting}
            />
            <FieldError message={shown(true, coverageError)} />
          </Field>
          <Field label="Grace period (days)" required>
            <input
              className={INPUT_CLASSES}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={graceText}
              onChange={(e) => setEditedGrace(e.target.value)}
              disabled={isSubmitting}
            />
            <FieldError message={shown(true, grace.ok ? null : grace.error)} />
          </Field>
        </div>
        <p className="stg:text-xs stg:text-muted-foreground">
          {editedLastDay === null
            ? renewing
              ? `Continues from the renewed license: ${TERM_PRESET_HINT[term]} from ${startDay}.`
              : `${TERM_PRESET_HINT[term]} from today.`
            : "Set by hand."}{" "}
          During the grace period the licensed server keeps serving and warns
          that the license has expired.
          {editedLastDay !== null && (
            <>
              {" "}
              <button
                type="button"
                className="stg:cursor-pointer stg:font-medium stg:text-foreground stg:underline stg:underline-offset-2"
                onClick={() => setEditedLastDay(null)}
                disabled={isSubmitting}
              >
                {`Use the ${TERM_LABELS[term].toLowerCase()} preset`}
              </button>
            </>
          )}
        </p>
      </FormSection>

      <FormSection title="Entitlements">
        <div className="stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-2">
          <Field label="Max users">
            <input
              className={INPUT_CLASSES}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={maxUsers}
              onChange={(e) => setMaxUsers(e.target.value)}
              placeholder="Unlimited"
              disabled={isSubmitting}
            />
            <FieldError
              message={shown(
                maxUsers !== "",
                users.ok ? violationAt("spec.entitlements.limits.max_users") : users.error,
              )}
            />
          </Field>
          <Field label="Max organizations">
            <input
              className={INPUT_CLASSES}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={maxOrganizations}
              onChange={(e) => setMaxOrganizations(e.target.value)}
              placeholder="Unlimited"
              disabled={isSubmitting}
            />
            <FieldError
              message={shown(
                maxOrganizations !== "",
                organizations.ok
                  ? violationAt("spec.entitlements.limits.max_organizations")
                  : organizations.error,
              )}
            />
          </Field>
        </div>
        <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-2")}>
          <legend className="stg:mb-1 stg:text-[11px] stg:font-medium stg:text-muted-foreground">
            Features
          </legend>
          {GRANTABLE_FEATURES.map((feature) => (
            <label key={feature} className="stg:flex stg:items-start stg:gap-2 stg:text-sm">
              <input
                type="checkbox"
                className={cn(NATIVE_CONTROL, "stg:mt-0.5")}
                checked={features.includes(feature)}
                onChange={(e) => toggleFeature(feature, e.target.checked)}
                disabled={isSubmitting}
              />
              <span>
                <span className="stg:block stg:text-foreground">{FEATURE_LABELS[feature].label}</span>
                <span className="stg:block stg:text-xs stg:text-muted-foreground">
                  {FEATURE_LABELS[feature].description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </FormSection>

      <FormSection title="Notes">
        <Field label="Internal note">
          <textarea
            className={cn(INPUT_CLASSES, "stg:min-h-16")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="The order, the contact, the reason for a bespoke entitlement"
            disabled={isSubmitting}
          />
          <FieldError message={shown(notes !== "", violationAt("spec.notes"))} />
        </Field>
        <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
          Never signed into the ticket and never shown to the customer.
        </p>
      </FormSection>

      {/* The last check before an irreversible act: the whole license, restated. */}
      <section
        aria-label="What will be issued"
        className="stg:space-y-1 stg:rounded-lg stg:border stg:border-border stg:bg-muted-subtle stg:p-4"
      >
        {previewName ? (
          <>
            <p className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">{previewName}</p>
            <p className="stg:m-0 stg:text-sm stg:text-foreground">
              {[
                users.ok ? limitPart(users.value, "user") : null,
                organizations.ok ? limitPart(organizations.value, "organization") : null,
                featureNames(features),
              ]
                .filter((part): part is string => part !== null)
                .join(" · ")}
            </p>
            {grace.ok && (
              <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
                {grace.value === 0
                  ? "No grace period: the licensed server stops the day after."
                  : `Then ${grace.value} days of grace, while the licensed server keeps serving and warns.`}
              </p>
            )}
          </>
        ) : (
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            Choose the customer to see the license this will issue.
          </p>
        )}
      </section>

      {attempted && unmappedViolations.length > 0 && (
        <ul className={cn(UNSTYLED_LIST, "stg:space-y-1")} role="alert">
          {unmappedViolations.map((v) => (
            <li key={`${pathToString(v.field)}:${v.ruleId}`} className="stg:text-xs stg:text-destructive">
              {v.message}
            </li>
          ))}
        </ul>
      )}
      {submitError && (
        <p className="stg:text-xs stg:text-destructive" role="alert">
          {submitErrorMessage(submitError)}
        </p>
      )}

      <div className="stg:flex stg:gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Issuing…" : renewing ? "Issue renewal" : "Issue license"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function FormSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section
      className="stg:space-y-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4"
      aria-label={title}
    >
      <h4 className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">{title}</h4>
      {children}
    </section>
  );
}

function Choice({
  name,
  checked,
  onChange,
  label,
  disabled,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly label: string;
  readonly disabled: boolean;
}) {
  return (
    <label className="stg:flex stg:items-center stg:gap-1.5 stg:text-sm stg:text-foreground">
      <input
        type="radio"
        className={NATIVE_CONTROL}
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      {label}
    </label>
  );
}

function FieldError({ message }: { readonly message: string | null }) {
  if (!message) return null;
  return <span className="stg:block stg:text-xs stg:text-destructive">{message}</span>;
}

function submitErrorMessage(error: Error): string {
  if (error instanceof StigmerError && error.code === "already-exists") {
    return "This license was already issued: same customer, term and last covered day. Open it from the list instead of issuing it twice.";
  }
  return getUserMessage(error);
}

function issuableTerm(term: LicenseTerm | undefined): IssuableTerm | undefined {
  return term === LicenseTerm.trial || term === LicenseTerm.paid ? term : undefined;
}

function isGrantable(feature: number): feature is GrantableFeature {
  return feature in FEATURE_LABELS;
}

function limitText(limit: number | undefined): string {
  return limit === undefined ? "" : String(limit);
}
