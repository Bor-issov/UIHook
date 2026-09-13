/** Project-scoped file access. Implementations are responsible for path confinement. */
export interface FileAccess {
  /** Returns null when the file does not exist. */
  read(file: string): Promise<string | null>;
  write(file: string, content: string): Promise<void>;
  remove(file: string): Promise<void>;
}
