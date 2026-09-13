import { inspectElement } from "@uihook/ast-editor";
import { contentHash } from "@uihook/git-engine";
import type { ClientPayload, ElementContext } from "@uihook/protocol";
import { RequestError } from "../errors.js";
import type { Services } from "../services.js";

const SNIPPET_PADDING = 4;
const SNIPPET_MAX_LINES = 80;

export async function handleElementContext(services: Services, payload: ClientPayload<"element.context.request">): Promise<ElementContext> {
  const { selection } = payload;
  if (!selection.source) {
    throw new RequestError("not_found", "element has no source metadata; is the uihook Vite plugin installed?");
  }
  const { file, line, column } = selection.source;
  const code = await services.workspace.read(file);
  if (code === null) throw new RequestError("not_found", `${file} does not exist in ${services.project.name}`);

  const info = inspectElement(code, file, line, column);
  if (!info) throw new RequestError("stale_source", `no JSX element at ${file}:${line}:${column}; the page may be out of date`);
  if (info.tag !== selection.element.tag) {
    throw new RequestError("stale_source", `source has <${info.tag}> at ${file}:${line} but the page rendered <${selection.element.tag}>`);
  }

  const lines = code.split("\n");
  const startLine = Math.max(1, info.startLine - SNIPPET_PADDING);
  const endLine = Math.min(lines.length, info.endLine + SNIPPET_PADDING, startLine + SNIPPET_MAX_LINES - 1);

  return {
    source: selection.source,
    hash: contentHash(code),
    ...(selection.component ? { component: selection.component } : {}),
    openingTag: info.openingTag,
    snippet: { startLine, lines: lines.slice(startLine - 1, endLine) },
    className: info.className,
    editable: services.project.tailwind ? info.editable : [],
    styling: { tailwind: services.project.tailwind },
  };
}
