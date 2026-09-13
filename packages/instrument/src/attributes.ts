/** DOM attribute names shared by the instrumentation and the browser-side resolver. */
export const SOURCE_ATTR = "data-uihook-src";
export const COMPONENT_ATTR = "data-uihook-component";

export interface EncodedSource {
  file: string;
  line: number;
  column: number;
}

export function encodeSource({ file, line, column }: EncodedSource): string {
  return `${file}:${line}:${column}`;
}

/** Parses `path/to/File.tsx:12:5`. Splits from the right so paths containing ':' survive. */
export function decodeSource(value: string): EncodedSource | null {
  const match = /^(.+):(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const [, file, line, column] = match;
  const lineNum = Number(line);
  const columnNum = Number(column);
  if (!file || lineNum < 1 || columnNum < 1) return null;
  return { file, line: lineNum, column: columnNum };
}
