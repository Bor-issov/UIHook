import { usePanel } from "../store";
import { DiffView } from "./DiffView";
import { Button, Section } from "./ui";

export function History() {
  const sessions = usePanel((s) => s.sessions);
  const openDiff = usePanel((s) => s.openDiff);
  const busy = usePanel((s) => s.busy);
  const { undo, accept, toggleDiff } = usePanel.getState();
  if (sessions.length === 0) return null;

  return (
    <Section title="History">
      <ol className="flex flex-col gap-2">
        {sessions.map((session) => {
          const additions = session.files.reduce((n, f) => n + f.additions, 0);
          const deletions = session.files.reduce((n, f) => n + f.deletions, 0);
          return (
            <li key={session.id} data-testid="history-item" data-status={session.status} className="flex flex-col gap-2 rounded-lg bg-bone/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className={`text-xs leading-5 ${session.status === "undone" ? "text-bone/40 line-through" : "text-bone"}`}>{session.instruction}</p>
                <span className="shrink-0 font-mono text-[11px] text-bone/50">{session.status}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-bone/50">
                  {session.files.length} file{session.files.length === 1 ? "" : "s"} <span className="text-signal">+{additions}</span> -{deletions}
                </span>
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => toggleDiff(session.id)}>
                    {openDiff === session.id ? "Hide diff" : "View diff"}
                  </Button>
                  {session.status === "applied" ? (
                    <>
                      <Button onClick={() => void accept(session.id)} disabled={busy}>
                        Accept
                      </Button>
                      <Button variant="primary" onClick={() => void undo(session.id)} disabled={busy}>
                        Undo
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              {openDiff === session.id ? <DiffView patch={session.patch} /> : null}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
