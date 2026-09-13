import type { ComputedStyleSnapshot, VisualProperty } from "@uihook/protocol";
import { type KeyboardEvent, useEffect, useState } from "react";
import { px } from "../observed";
import { usePanel } from "../store";

interface Control {
  property: VisualProperty;
  label: string;
  read: (s: ComputedStyleSnapshot) => (string | undefined)[];
}

const CONTROLS: Control[] = [
  { property: "padding", label: "Padding", read: (s) => [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft] },
  { property: "paddingX", label: "Padding X", read: (s) => [s.paddingLeft, s.paddingRight] },
  { property: "paddingY", label: "Padding Y", read: (s) => [s.paddingTop, s.paddingBottom] },
  { property: "gap", label: "Gap", read: (s) => [s.rowGap, s.columnGap] },
  { property: "borderRadius", label: "Radius", read: (s) => [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius] },
];

/** Uniform value across sides, or null when sides differ or cannot be read. */
function uniform(values: (string | undefined)[]): number | null {
  const numbers = values.map(px);
  return numbers.every((n) => n >= 0 && n === numbers[0]) ? numbers[0]! : null;
}

export function VisualControls() {
  const selection = usePanel((s) => s.selection);
  const context = usePanel((s) => s.context);
  const busy = usePanel((s) => s.busy);
  const applyChanges = usePanel((s) => s.applyChanges);
  if (!selection || !context) return null;

  const limitation = !context.styling.tailwind
    ? "Deterministic edits need Tailwind CSS in this project."
    : context.className.limitation && context.editable.length === 0
      ? `className cannot be edited directly: ${context.className.limitation}.`
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      {CONTROLS.map((control) => (
        <ControlRow
          key={`${control.property}:${context.hash}`}
          label={control.label}
          current={uniform(control.read(selection.styles))}
          disabled={busy || !context.editable.includes(control.property)}
          onCommit={(value) => applyChanges([{ property: control.property, px: value }])}
        />
      ))}
      {limitation ? <p className="text-xs text-bone/60">{limitation}</p> : null}
    </div>
  );
}

function ControlRow({ label, current, disabled, onCommit }: { label: string; current: number | null; disabled: boolean; onCommit: (px: number) => void }) {
  const [draft, setDraft] = useState(current === null ? "" : String(current));
  useEffect(() => setDraft(current === null ? "" : String(current)), [current]);

  const commit = () => {
    const value = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(value) || value < 0 || value === current) return;
    onCommit(value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") setDraft(current === null ? "" : String(current));
  };

  return (
    <label className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-xs">
      <span className="text-bone/60">{label}</span>
      <input
        aria-label={label}
        value={draft}
        placeholder={current === null ? "mixed" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        disabled={disabled}
        inputMode="decimal"
        className="w-full rounded-md bg-bone/10 px-2 py-1.5 font-mono text-bone outline-none placeholder:text-bone/40 disabled:opacity-40"
      />
      <span className="font-mono text-bone/40">px</span>
    </label>
  );
}
