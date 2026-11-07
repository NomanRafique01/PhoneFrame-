import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";

// Resolves asset paths reliably across development (npm start), packaged installs
// (NSIS / electron-builder), and standalone unpacked directories.
export function assetPath(...segments: string[]): string {
  const candidates: string[] = [];

  // 1. Packaged installation resources directory (<installDir>/resources/assets)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "assets", ...segments));
  }

  // 2. Project root relative to dist/main/ (development mode)
  candidates.push(path.resolve(__dirname, "../../assets", ...segments));

  // 3. Fallback for unpacked app.asar directory (<installDir>/resources/app.asar/../../assets)
  candidates.push(path.resolve(__dirname, "../../../assets", ...segments));

  // 4. Fallback based on current working directory
  candidates.push(path.join(process.cwd(), "assets", ...segments));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Continue to next candidate
    }
  }

  // Final fallback to standard base
  const base = app.isPackaged ? process.resourcesPath : process.cwd();
  return path.join(base, "assets", ...segments);
}
