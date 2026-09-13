import type { ContentToPanel, ElementSelection } from "@uihook/protocol";
import { collectSelection, describeElement, instancesByKey, instancesOf, instrumentedElement, sourceKey } from "./collect.js";
import { Overlay, type ToolbarAction } from "./overlay.js";

/**
 * Content script controller. Runs in Chrome's isolated world: page scripts cannot call into it,
 * and it never listens to window.postMessage. It only talks to our own extension via chrome.runtime.
 */
class VisualLayer {
  private readonly overlay = new Overlay((action) => this.onToolbar(action));
  private active = false;
  private selecting = false;
  private hovered: Element | null = null;
  private selected: { element: Element; key: string | null; index: number } | null = null;
  private lastSent = "";
  private frame = 0;
  private refreshTimer = 0;
  private readonly observer = new MutationObserver(() => this.scheduleRefresh());

  private readonly intercept = (event: Event) => {
    if (!this.selecting || this.overlay.contains(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "click" && event.isTrusted && this.hovered) {
      this.select(this.hovered);
      this.setSelecting(false);
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.selecting || this.overlay.contains(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    const element = target ? (instrumentedElement(target) ?? target) : null;
    if (element === this.hovered) return;
    this.hovered = element;
    this.overlay.showHover(element, element ? describeElement(element) : undefined);
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !event.isTrusted || !this.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.selecting) this.setSelecting(false);
    else this.setActive(false);
  };

  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    const listen = active ? addEventListener : removeEventListener;
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"]) {
      listen(type, this.intercept, { capture: true });
    }
    listen("pointermove", this.onPointerMove as EventListener, { capture: true });
    listen("keydown", this.onKeyDown as EventListener, { capture: true });

    if (active) {
      this.overlay.mount();
      this.overlay.setToolbarVisible(true);
      this.setSelecting(true);
      this.frame = requestAnimationFrame(this.track);
    } else {
      this.setSelecting(false);
      this.clearSelection();
      cancelAnimationFrame(this.frame);
      this.overlay.unmount();
    }
    this.send({ type: "content.mode", active });
  }

  setSelecting(selecting: boolean) {
    this.selecting = selecting && this.active;
    this.overlay.setSelecting(this.selecting);
    document.documentElement.style.cursor = this.selecting ? "crosshair" : "";
    if (!this.selecting) {
      this.hovered = null;
      this.overlay.showHover(null);
    }
  }

  select(element: Element, reason: "user" | "refresh" = "user") {
    const key = sourceKey(element);
    this.selected = { element, key, index: Math.max(0, instancesOf(element).indexOf(element)) };
    this.observer.disconnect();
    this.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "data-uihook-src"] });
    this.publish(reason);
  }

  clearSelection() {
    if (!this.selected) return;
    this.selected = null;
    this.lastSent = "";
    this.observer.disconnect();
    this.overlay.showSelected(null);
    this.send({ type: "content.cleared" });
  }

  /** Re-collects the selection and notifies the panel if anything observable changed. */
  publish(reason: "user" | "refresh") {
    if (!this.selected) return;
    const selection: ElementSelection = collectSelection(this.selected.element);
    const fingerprint = JSON.stringify({ ...selection, rect: undefined, pageUrl: undefined });
    if (reason === "refresh" && fingerprint === this.lastSent) return;
    this.lastSent = fingerprint;
    this.send({ type: "content.selected", selection, reason });
  }

  private scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refresh(), 120);
  }

  /** HMR may replace DOM nodes; re-find the selection by source key and instance index. */
  private refresh() {
    if (!this.selected) return;
    let { element } = this.selected;
    if (!element.isConnected) {
      const candidates = this.selected.key ? instancesByKey(this.selected.key) : [];
      const replacement = candidates[this.selected.index] ?? candidates[0];
      if (!replacement) return this.clearSelection();
      element = replacement;
      this.selected = { ...this.selected, element };
    }
    this.publish("refresh");
  }

  private readonly track = () => {
    if (!this.active) return;
    if (this.selected) this.overlay.showSelected(this.selected.element, instancesOf(this.selected.element));
    if (this.hovered) this.overlay.showHover(this.hovered, describeElement(this.hovered));
    this.frame = requestAnimationFrame(this.track);
  };

  private onToolbar(action: ToolbarAction) {
    switch (action) {
      case "select":
        return this.setSelecting(!this.selecting);
      case "inspect":
        this.publish("user");
        return this.send({ type: "content.action", action: "inspect" });
      case "undo":
        return this.send({ type: "content.action", action: "undo" });
      case "area":
      case "askAi":
        return;
    }
  }

  handlePanelMessage(message: { type?: unknown; active?: unknown }): unknown {
    switch (message.type) {
      case "panel.setMode":
        if (typeof message.active === "boolean") this.setActive(message.active);
        return this.state();
      case "panel.toggleMode":
        this.setActive(!this.active);
        return this.state();
      case "panel.refreshSelection":
        this.publish("user");
        return this.state();
      case "panel.clearSelection":
        this.clearSelection();
        return this.state();
      case "panel.getMode":
        return this.state();
      default:
        return undefined;
    }
  }

  private state() {
    return { active: this.active, selecting: this.selecting, hasSelection: this.selected !== null };
  }

  private send(message: ContentToPanel) {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  }
}

const layer = new VisualLayer();

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Messages to content scripts can only originate from our extension; tab senders are other content scripts.
  if (sender.id !== chrome.runtime.id || sender.tab || typeof message !== "object" || message === null) return;
  const response = layer.handlePanelMessage(message as { type?: unknown; active?: unknown });
  if (response !== undefined) sendResponse(response);
});
