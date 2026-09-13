import { useEffect } from "react";
import { ConnectForm } from "./components/ConnectForm";
import { History } from "./components/History";
import { SelectionDetails } from "./components/SelectionDetails";
import { Button } from "./components/ui";
import { usePanel } from "./store";
import { onContentMessage, resolveTargetTab } from "./tab-bridge";

export function App() {
  const connection = usePanel((s) => s.connection);
  const content = usePanel((s) => s.content);
  const notice = usePanel((s) => s.notice);
  const tabId = usePanel((s) => s.tabId);

  useEffect(() => {
    const store = usePanel.getState();
    const bind = async () => store.bindTab(await resolveTargetTab());
    void bind();

    chrome.storage.local.get("companion").then(({ companion }) => {
      const saved = companion as { port?: number; token?: string } | undefined;
      if (saved?.port && saved.token && usePanel.getState().connection.status === "disconnected") void store.connect(saved.port, saved.token);
    });

    const pinned = new URLSearchParams(location.search).has("tabId");
    const onActivated = () => void bind();
    if (!pinned) chrome.tabs.onActivated.addListener(onActivated);

    const unsubscribe = onContentMessage(
      () => usePanel.getState().tabId,
      (message) => {
        const state = usePanel.getState();
        switch (message.type) {
          case "content.selected":
            return void state.receiveSelection(message.selection);
          case "content.cleared":
            return state.clearSelection();
          case "content.mode":
            return usePanel.setState({ content: { active: message.active, selecting: message.active, hasSelection: state.selection !== null } });
          case "content.action":
            if (message.action === "undo") void state.undo();
            return;
        }
      },
    );

    return () => {
      unsubscribe();
      if (!pinned) chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  const active = content?.active ?? false;

  return (
    <div className="flex min-h-screen flex-col gap-5 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold tracking-tight">UIHook</span>
          <span className="truncate text-xs text-bone/50" data-testid="connection">
            {connection.status === "connected"
              ? `${connection.project.name} · ${connection.project.framework}${connection.project.tailwind ? ` · tailwind ${connection.project.tailwind}` : ""}`
              : connection.status}
          </span>
        </div>
        <div className="flex gap-1">
          {connection.status === "connected" ? (
            <Button variant="ghost" onClick={() => usePanel.getState().disconnect()}>
              Disconnect
            </Button>
          ) : null}
          <Button variant={active ? "secondary" : "primary"} disabled={tabId === null} onClick={() => void usePanel.getState().setMode(!active)}>
            {active ? "Stop editing" : "Start editing"}
          </Button>
        </div>
      </header>

      {connection.status !== "connected" ? <ConnectForm /> : null}

      {notice ? (
        <p data-testid="notice" data-kind={notice.kind} className={`rounded-lg bg-bone/5 p-3 text-xs leading-5 ${notice.kind === "info" ? "text-bone" : "text-signal"}`}>
          {notice.text}
        </p>
      ) : null}

      <SelectionDetails />
      <History />

      <footer className="mt-auto text-[11px] text-bone/40">Alt+Shift+S toggles editing. Esc stops selecting.</footer>
    </div>
  );
}
