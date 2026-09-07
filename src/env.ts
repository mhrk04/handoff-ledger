import { readFileSync } from "node:fs";

export function loadEnv(): void {
  const loader = (process as typeof process & { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  if (loader) {
    try {
      loader(".env");
      return;
    } catch {
      // .env is optional for mock mode.
    }
  }
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) {
        const [, key, rawValue] = match;
        if (key && process.env[key] === undefined) process.env[key] = (rawValue ?? "").replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    // No .env is a valid state for npm run verify and MODE=mock.
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}; claim a separate key and set it in .env`);
  return value;
}
