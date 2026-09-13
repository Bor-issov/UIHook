export { applyVisualEdit, ALL_VISUAL_PROPERTIES, type AppliedChange, type VisualEditInput, type VisualEditOutcome } from "./visual-edit.js";
export { inspectElement, type ElementInspection } from "./inspect.js";
export { DEFAULT_EDITOR_CONFIG, type EditorConfig, type TailwindVersion } from "./tailwind/families.js";
export { mutateClasses, type MutableLiteral, type MutationOutcome } from "./tailwind/mutate.js";
export { parseClassToken } from "./tailwind/tokens.js";
export { parseSource, SourceParseError } from "./parse.js";
