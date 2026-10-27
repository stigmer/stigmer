"use client";

/**
 * The fields every Run evals form shares: the switch between sending no
 * models and picking them, the picked models (one to six, each an engine
 * and a model, the engine's default when none is picked), and a labelled
 * number field with its hint. The form on a plugin and the form on an
 * agent render them alike; only the switch's words differ, since sending
 * no models means each case's own model on a plugin and the agent as it
 * runs on an agent.
 *
 * Internal to the SDK: the forms are the public surface. Pinned through
 * the tab tests.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */

import { HARNESS_OPTIONS, type HarnessOption } from "../models/harness.js";
import { ModelSelector } from "../models/ModelSelector.js";
import { Switch } from "../switch/Switch.js";
import { INPUT_CLASS, QUIET_BUTTON_CLASS } from "../vault/styles.js";
import { MAX_EVAL_TARGETS, type EvalRunSettings } from "./eval-view.js";

/** A form field's label. */
export const LABEL_CLASS =
  "stg:block stg:text-xs stg:font-medium stg:text-foreground";
/** A form field's hint below it. */
export const HINT_CLASS = "stg:text-2xs stg:text-muted-foreground";

/**
 * The models switch and, while it is off, the picked models with Add and
 * Remove. `settings` is the form's; `onChange` receives it with
 * `caseModels` or `targets` changed.
 */
export function EvalModelsField<S extends EvalRunSettings>({
  id,
  switchLabel,
  settings,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly switchLabel: string;
  readonly settings: S;
  readonly disabled: boolean;
  readonly onChange: (next: S) => void;
}) {
  const setTarget = (
    index: number,
    patch: { harness?: HarnessOption; modelName?: string },
  ): void => {
    onChange({
      ...settings,
      targets: settings.targets.map((target, i) =>
        i === index
          ? {
              harness: patch.harness ?? target.harness,
              modelName: patch.modelName ?? target.modelName,
            }
          : target,
      ),
    });
  };

  return (
    <>
      <div className="stg:flex stg:items-center stg:gap-2">
        <Switch
          id={id}
          checked={settings.caseModels}
          onCheckedChange={(caseModels) => onChange({ ...settings, caseModels })}
          disabled={disabled}
        />
        <label
          htmlFor={id}
          className="stg:text-xs stg:font-medium stg:text-foreground"
        >
          {switchLabel}
        </label>
      </div>
      {!settings.caseModels && (
        <fieldset className="stg:flex stg:flex-col stg:gap-2">
          <legend className={LABEL_CLASS}>Models</legend>
          {settings.targets.map((target, index) => (
            <div key={index} className="stg:flex stg:items-center stg:gap-2">
              <ModelSelector
                value={target.modelName === "" ? undefined : target.modelName}
                onValueChange={(modelName) => setTarget(index, { modelName })}
                initialHarness={target.harness}
                availableHarnesses={HARNESS_OPTIONS}
                onHarnessChange={(harness) =>
                  setTarget(index, { harness, modelName: "" })
                }
                compact
                disabled={disabled}
                placeholderLabel="Default model"
              />
              {settings.targets.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove model ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...settings,
                      targets: settings.targets.filter((_, i) => i !== index),
                    })
                  }
                  className={QUIET_BUTTON_CLASS}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {settings.targets.length < MAX_EVAL_TARGETS && (
            <div>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...settings,
                    targets: [
                      ...settings.targets,
                      { harness: "native", modelName: "" },
                    ],
                  })
                }
                className={QUIET_BUTTON_CLASS}
              >
                Add a model
              </button>
            </div>
          )}
        </fieldset>
      )}
    </>
  );
}

/** A labelled number input with its hint; the text is the caller's, read on submit. */
export function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly min: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly onChange: (text: string) => void;
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={INPUT_CLASS}
      />
      <p className={HINT_CLASS}>{hint}</p>
    </div>
  );
}
