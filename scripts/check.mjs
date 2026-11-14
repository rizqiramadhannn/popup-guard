// Static checks: manifest references, permissions, and no remote or dynamic code.
// Usage: node scripts/check.mjs
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const problems = [];
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

const exists = async (relative) => stat(path.join(root, relative)).then(() => true, () => false);
const referenced = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap((script) => script.js),
];
for (const file of referenced) if (!(await exists(file))) problems.push(`Missing file referenced by manifest: ${file}`);

const expectedPermissions = ["storage", "webNavigation"];
if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify(expectedPermissions))
  problems.push(`Permissions changed: ${manifest.permissions.join(", ")}. Update README "Permissions" and this check together.`);
if (manifest.host_permissions?.length) problems.push("Unexpected host_permissions.");
if (manifest.manifest_version !== 3) problems.push("Manifest version must be 3.");

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(relative)));
    else out.push(relative);
  }
  return out;
}
for (const file of await walk("src")) {
  if (file.endsWith("psl-data.js")) continue;
  const text = await readFile(path.join(root, file), "utf8");
  if (/\beval\s*\(|new Function\s*\(|\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(text)) problems.push(`Dynamic code or HTML injection in ${file}`);
  if (/<script[^>]+src=["']https?:/i.test(text) || /import\s[^;]*from\s+["']https?:/.test(text)) problems.push(`Remote code in ${file}`);
  if (/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/.test(text)) problems.push(`Network call in ${file}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`OK: ${referenced.length} manifest files present, permissions ${expectedPermissions.join(", ")}, no remote/dynamic code or network calls in src/.`);
