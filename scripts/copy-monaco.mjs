import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = process.argv[2] ?? "dist";
const src = path.join(root, "node_modules", "monaco-editor", "min", "vs");
const dest = path.join(root, targetRoot, "monaco", "vs");

try {
  await stat(src);
} catch (error) {
  console.error("Monaco editor assets not found:", src);
  console.error("Run npm install before building.");
  process.exit(1);
}

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`Copied Monaco assets to ${dest}`);
