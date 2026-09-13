export type ToolbarAction = "select" | "area" | "inspect" | "askAi" | "undo";

interface ToolbarItem {
  action: ToolbarAction;
  label: string;
  /** Tools that are not built yet stay visible but inert, and say so. */
  available: boolean;
}

const TOOLBAR: ToolbarItem[] = [
  { action: "select", label: "Select", available: true },
  { action: "area", label: "Area", available: false },
  { action: "inspect", label: "Inspect", available: true },
  { action: "askAi", label: "Ask AI", available: true },
  { action: "undo", label: "Undo", available: true },
];

const STYLES = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font: 12px/1.3 ui-sans-serif, system-ui, sans-serif; }
  .box { position: fixed; display: none; box-sizing: border-box; }
  .hover { background: rgba(236, 249, 77, 0.12); outline: 1px solid rgba(236, 249, 77, 0.9); }
  .instance { outline: 1px dashed rgba(236, 249, 77, 0.55); }
  .selected { outline: 2px solid #ecf94d; }
  .label { position: fixed; display: none; padding: 4px 8px; border-radius: 6px; background: #44423e; color: #ebe7e3; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
  .label b { font-weight: 600; }
  .label span { opacity: 0.7; margin-left: 6px; }
  .toolbar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: none; gap: 2px; padding: 4px; border-radius: 10px; background: #44423e; color: #ebe7e3; pointer-events: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
  .toolbar.visible { display: flex; }
  .toast { position: fixed; left: 50%; bottom: 68px; transform: translateX(-50%); display: none; max-width: min(480px, 90vw); padding: 8px 12px; border-radius: 8px; background: #ecf94d; color: #44423e; font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; }
  button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 7px; font: 500 12px/1 ui-sans-serif, system-ui, sans-serif; color: #ebe7e3; }
  button[aria-pressed="true"] { background: #ecf94d; color: #44423e; }
  button[aria-disabled="true"] { opacity: 0.4; cursor: default; }
`;

/**
 * Visual layer rendered in a closed shadow root on <html>. Uses fixed positioning and
 * pointer-events: none, so it never affects page layout or hit testing (except the toolbar).
 */
export class Overlay {
  readonly host: HTMLElement;
  private readonly hoverBox: HTMLDivElement;
  private readonly selectedBox: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly toolbar: HTMLDivElement;
  private readonly instanceLayer: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private toastTimer = 0;
  private readonly buttons = new Map<ToolbarAction, HTMLButtonElement>();

  constructor(onAction: (action: ToolbarAction) => void) {
    this.host = document.createElement("uihook-overlay");
    const shadow = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    const layer = div("layer");
    this.instanceLayer = div("");
    this.hoverBox = div("box hover");
    this.selectedBox = div("box selected");
    this.label = div("label");
    this.toolbar = div("toolbar");
    this.toast = div("toast");
    this.toast.setAttribute("role", "status");

    for (const item of TOOLBAR) {
      const button = document.createElement("button");
      button.textContent = item.label;
      button.title = item.available ? item.label : `${item.label}: not available yet`;
      if (!item.available) button.setAttribute("aria-disabled", "true");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (item.available && event.isTrusted) onAction(item.action);
      });
      this.buttons.set(item.action, button);
      this.toolbar.append(button);
    }

    layer.append(this.instanceLayer, this.hoverBox, this.selectedBox, this.label, this.toolbar, this.toast);
    shadow.append(style, layer);
  }

  mount() {
    if (!this.host.isConnected) document.documentElement.append(this.host);
  }

  unmount() {
    this.host.remove();
  }

  setToolbarVisible(visible: boolean) {
    this.toolbar.classList.toggle("visible", visible);
  }

  /** Short visible message for failures the page user must see (e.g. the browser refused to open the panel). */
  notify(text: string) {
    this.mount();
    this.toast.textContent = text;
    this.toast.style.display = "block";
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.style.display = "none"), 6000);
  }

  setSelecting(selecting: boolean) {
    this.buttons.get("select")!.setAttribute("aria-pressed", String(selecting));
  }

  showHover(element: Element | null, text?: { label: string; file?: string }) {
    if (!element) {
      this.hoverBox.style.display = "none";
      this.label.style.display = "none";
      return;
    }
    const rect = place(this.hoverBox, element);
    if (!text) return;
    this.label.replaceChildren();
    const name = document.createElement("b");
    name.textContent = text.label;
    const meta = document.createElement("span");
    meta.textContent = `${text.file ? `${text.file}  ` : ""}${Math.round(rect.width)} x ${Math.round(rect.height)}`;
    this.label.append(name, meta);
    this.label.style.display = "block";
    const top = rect.top > 28 ? rect.top - 26 : Math.min(rect.bottom + 4, innerHeight - 24);
    this.label.style.top = `${top}px`;
    this.label.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - this.label.offsetWidth - 4))}px`;
  }

  showSelected(element: Element | null, instances: Element[] = []) {
    if (!element) {
      this.selectedBox.style.display = "none";
      this.instanceLayer.replaceChildren();
      return;
    }
    place(this.selectedBox, element);
    const others = instances.filter((i) => i !== element).slice(0, 50);
    while (this.instanceLayer.children.length > others.length) this.instanceLayer.lastChild!.remove();
    others.forEach((instance, index) => {
      const box = (this.instanceLayer.children[index] as HTMLDivElement | undefined) ?? this.instanceLayer.appendChild(div("box instance"));
      place(box, instance);
    });
  }

  contains(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function place(box: HTMLElement, element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  Object.assign(box.style, { display: "block", top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  return rect;
}
