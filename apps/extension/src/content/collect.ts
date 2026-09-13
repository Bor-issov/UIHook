import { COMPONENT_ATTR, decodeSource, SOURCE_ATTR } from "@uihook/instrument/attributes";
import type { ComputedStyleSnapshot, ElementSelection } from "@uihook/protocol";

const STYLE_KEYS = [
  "display", "position", "flexDirection", "alignItems", "justifyContent",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "marginTop", "marginRight", "marginBottom", "marginLeft",
  "rowGap", "columnGap", "width", "height", "fontSize", "fontWeight",
  "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
  "backgroundColor", "color",
] as const satisfies readonly (keyof ComputedStyleSnapshot)[];

const MAX_ANCESTORS = 8;

/** Nearest element (self or ancestor) carrying build-time source metadata. */
export function instrumentedElement(target: Element): Element | null {
  return target.closest(`[${SOURCE_ATTR}]`);
}

export function sourceKey(element: Element): string | null {
  return element.getAttribute(SOURCE_ATTR);
}

export function instancesOf(element: Element): Element[] {
  const key = sourceKey(element);
  return key ? instancesByKey(key) : [element];
}

export function instancesByKey(key: string): Element[] {
  return [...document.querySelectorAll(`[${SOURCE_ATTR}="${CSS.escape(key)}"]`)];
}

export function describeElement(element: Element): { label: string; file?: string } {
  const source = decodeSource(sourceKey(element) ?? "");
  const component = element.getAttribute(COMPONENT_ATTR);
  const tag = element.tagName.toLowerCase();
  const name = component ? `${component} <${tag}>` : `<${tag}>`;
  return source ? { label: name, file: `${source.file.split("/").pop()}:${source.line}` } : { label: `${name} (no source)` };
}

/** Deliberately bounded snapshot of one element. Never serialises DOM subtrees. */
export function collectSelection(element: Element): ElementSelection {
  const computed = getComputedStyle(element);
  const styles: ComputedStyleSnapshot = {};
  for (const key of STYLE_KEYS) styles[key] = computed[key].slice(0, 128);

  const rect = element.getBoundingClientRect();
  const source = decodeSource(sourceKey(element) ?? "") ?? undefined;
  const component = element.getAttribute(COMPONENT_ATTR) ?? undefined;
  const id = element.id || undefined;
  const text = element.textContent?.replace(/\s+/g, " ").trim().slice(0, 280) || undefined;

  const ancestors: ElementSelection["ancestors"] = [];
  let cursor = element.parentElement ? instrumentedElement(element.parentElement) : null;
  while (cursor && ancestors.length < MAX_ANCESTORS) {
    const decoded = decodeSource(sourceKey(cursor) ?? "");
    if (decoded) {
      const ancestorComponent = cursor.getAttribute(COMPONENT_ATTR) ?? undefined;
      ancestors.push({ source: decoded, tag: cursor.tagName.toLowerCase(), ...(ancestorComponent ? { component: ancestorComponent } : {}) });
    }
    cursor = cursor.parentElement ? instrumentedElement(cursor.parentElement) : null;
  }

  return {
    ...(source ? { source } : {}),
    ...(component ? { component } : {}),
    element: {
      tag: element.tagName.toLowerCase(),
      ...(id ? { id: id.slice(0, 256) } : {}),
      classes: [...element.classList].slice(0, 256).map((c) => c.slice(0, 512)),
      ...(text ? { text } : {}),
    },
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    styles,
    instanceCount: instancesOf(element).length,
    ancestors,
    pageUrl: location.href.slice(0, 2048),
  };
}
