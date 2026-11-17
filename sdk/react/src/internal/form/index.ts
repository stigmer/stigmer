// The kit's form parts, internal: the kit's own forms render them, and no
// app or embedder imports them (a host that needs one is a reason to export
// it then). Every raw <input>, <textarea> and <select> outside this folder is
// refused by the `stigmer/no-handrolled-field` lint rule.

export {
  Field,
  FieldError,
  FieldHint,
  FieldLegend,
  useFieldWiring,
  type FieldProps,
} from "./Field.js";
export {
  TextInput,
  TextArea,
  Select,
  Checkbox,
  Radio,
  HiddenFileInput,
} from "./controls.js";
export type {
  TextInputProps,
  TextAreaProps,
  SelectProps,
  CheckProps,
  HiddenFileInputProps,
} from "./controls.js";
export {
  ChoiceGroup,
  type ChoiceGroupProps,
  type ChoiceOption,
} from "./ChoiceGroup.js";
export { SwitchField, type SwitchFieldProps } from "./SwitchField.js";
export { FileDrop, type FileDropProps } from "./FileDrop.js";
export { FormFooter, type FormFooterProps } from "./FormFooter.js";
export {
  ReadOnlyField,
  ReadOnlyFields,
  type ReadOnlyFieldProps,
  type ReadOnlyFieldsProps,
} from "./ReadOnlyField.js";
export {
  fieldControlClasses,
  areaControlClasses,
  FIELD_SIZE_CLASSES,
  FIELD_LABEL_CLASSES,
  FIELD_HINT_CLASSES,
  type FieldSize,
  type FieldAppearance,
} from "./fieldClasses.js";
