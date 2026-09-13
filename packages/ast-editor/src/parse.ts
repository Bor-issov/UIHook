import { parse } from "@babel/parser";
import type { File } from "@babel/types";

export class SourceParseError extends Error {
  override name = "SourceParseError";
}

/** Parser configuration must stay in sync with @uihook/instrument so locations agree. */
export function parseSource(code: string, file: string): File {
  const typescript = /\.[cm]?tsx?$/.test(file);
  try {
    return parse(code, { sourceType: "module", plugins: typescript ? ["jsx", "typescript"] : ["jsx"] });
  } catch (error) {
    throw new SourceParseError(`Failed to parse ${file}: ${(error as Error).message}`);
  }
}
