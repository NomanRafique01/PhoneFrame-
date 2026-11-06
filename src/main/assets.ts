import { app } from "electron";
import * as path from "node:path";

// Packaged builds keep assets outside app.asar (see build.extraResources), so
// they must be resolved from the install's resources directory. Dev runs keep
// using the project root, matching how the mirror manager was originally run.
export function assetPath(...segments: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : process.cwd();
  return path.join(base, "assets", ...segments);
}
