import { usePanel } from "../store";
import { SourceSnippet } from "./SourceSnippet";
import { Field, Section } from "./ui";
import { VisualControls } from "./VisualControls";

const sides = (...values: (string | undefined)[]) => {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : values.join(" ");
};

export function SelectionDetails() {
  const selection = usePanel((s) => s.selection);
  const context = usePanel((s) => s.context);
  const contextError = usePanel((s) => s.contextError);
  const connected = usePanel((s) => s.connection.status === "connected");

  if (!selection) {
    return <p className="rounded-lg bg-bone/5 p-4 text-xs text-bone/60">Start selecting, then click an element in the page.</p>;
  }

  const { element, rect, styles, source } = selection;
  const fileName = source?.file.split("/").pop();

  return (
    <div className="flex flex-col gap-5" data-testid="selection">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{selection.component ?? `<${element.tag}>`}</h1>
        {selection.instanceCount > 1 ? <p className="text-xs text-bone/60">Rendered {selection.instanceCount} times from the same source. Edits apply to all.</p> : null}
      </div>

      <Section title="Source">
        {source ? (
          <>
            <Field label="Component">{selection.component ? `${selection.component} (${fileName})` : fileName}</Field>
            <Field label="Location">
              <span data-testid="location">
                {source.file}:{source.line}
              </span>
            </Field>
          </>
        ) : (
          <p className="text-xs text-bone/60">No source metadata on this element.</p>
        )}
        {contextError ? <p className="text-xs text-signal">{contextError}</p> : null}
        {!connected && source ? <p className="text-xs text-bone/60">Connect the companion to read source and edit.</p> : null}
      </Section>

      <Section title="Element">
        <Field label="Tag">{element.tag}</Field>
        <Field label="Dimensions">
          {Math.round(rect.width)} x {Math.round(rect.height)}
        </Field>
        <Field label="Classes">
          <span data-testid="classes">{(context?.className.classes ?? element.classes).join(" ") || "none"}</span>
        </Field>
      </Section>

      <Section title="Layout">
        <Field label="Display">{styles.display}</Field>
        {styles.display?.includes("flex") ? <Field label="Direction">{styles.flexDirection}</Field> : null}
        <Field label="Gap">{sides(styles.rowGap, styles.columnGap)}</Field>
      </Section>

      <Section title="Spacing">
        <Field label="Padding">
          <span data-testid="padding">{sides(styles.paddingTop, styles.paddingRight, styles.paddingBottom, styles.paddingLeft)}</span>
        </Field>
        <Field label="Margin">{sides(styles.marginTop, styles.marginRight, styles.marginBottom, styles.marginLeft)}</Field>
      </Section>

      <Section title="Appearance">
        <Field label="Radius">{sides(styles.borderTopLeftRadius, styles.borderTopRightRadius, styles.borderBottomRightRadius, styles.borderBottomLeftRadius)}</Field>
        <Field label="Background">{styles.backgroundColor}</Field>
        <Field label="Text">
          {styles.fontSize} / {styles.fontWeight}
        </Field>
      </Section>

      {context ? (
        <>
          <Section title="Edit">
            <VisualControls />
          </Section>
          <Section title="Code">
            <SourceSnippet context={context} />
          </Section>
        </>
      ) : null}
    </div>
  );
}
