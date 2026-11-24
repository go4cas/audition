// Build the dependencies of lib/files.ts from a hook or route's helpers.
import type { FileDeps, Files } from "./files.ts";

export function fileDeps(helpers: { files: Files }): FileDeps {
  return { files: helpers.files };
}
