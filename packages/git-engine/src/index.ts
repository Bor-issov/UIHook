export { EditConflictError, EditHistory, EditTransaction, SessionStateError } from "./history.js";
export type { FileAccess } from "./file-access.js";
export { GitClient, type GitFileState } from "./git.js";
export { contentHash } from "./hash.js";
export { buildPatch, revertOnto } from "./patch.js";
export { InMemorySessionStore, summarize, type EditSession, type EditStatus, type EditType, type FileChange, type SessionStore } from "./session.js";
