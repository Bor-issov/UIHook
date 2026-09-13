export function DiffView({ patch }: { patch: string }) {
  const lines = patch.split("\n").filter((line, i, all) => !(i === all.length - 1 && line === ""));
  return (
    <pre data-testid="diff" className="overflow-x-auto rounded-lg bg-bone/5 py-2 font-mono text-[11px] leading-5">
      {lines.map((line, index) => {
        const tone = line.startsWith("+++") || line.startsWith("---") ? "text-bone/50" : line.startsWith("@@") ? "text-bone/40" : line.startsWith("+") ? "bg-signal/10 text-signal" : line.startsWith("-") ? "text-bone/45" : "text-bone/80";
        return (
          <div key={index} className={`px-3 whitespace-pre ${tone}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
