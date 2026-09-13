import type { ElementContext } from "@uihook/protocol";

export function SourceSnippet({ context }: { context: ElementContext }) {
  const { snippet, source } = context;
  return (
    <pre className="overflow-x-auto rounded-lg bg-bone/5 py-2 font-mono text-[11px] leading-5">
      {snippet.lines.map((line, index) => {
        const number = snippet.startLine + index;
        const current = number === source.line;
        return (
          <div key={number} className={`flex gap-3 px-3 ${current ? "bg-signal/10" : ""}`}>
            <span className={`w-6 shrink-0 text-right select-none ${current ? "text-signal" : "text-bone/30"}`}>{number}</span>
            <span className="whitespace-pre text-bone/90">{line || " "}</span>
          </div>
        );
      })}
    </pre>
  );
}
