// Builds dist/popup-guard-<version>.zip with only the files the browser loads.
// Usage: node scripts/package.mjs
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const include = ["manifest.json", "README.md", "LICENSE", "THIRD_PARTY.md", "icons", "src"];

async function collect(relative) {
  const full = path.join(root, relative);
  const entries = await readdir(full, { withFileTypes: true }).catch(() => null);
  if (!entries) return [relative];
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) files.push(...(await collect(path.join(relative, entry.name))));
  return files;
}

const files = [];
for (const item of include) files.push(...(await collect(item)));

// Minimal ZIP writer (deflate, fixed 1980-01-01 timestamps for reproducible output).
const local = [];
const central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(file.split(path.sep).join("/"));
  const data = await readFile(path.join(root, file));
  const compressed = zlib.deflateRawSync(data, { level: 9 });
  const crc = zlib.crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8 names
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x21, 12); // 1980-01-01
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  local.push(header, name, compressed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(0, 12);
  entry.writeUInt16LE(0x21, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(compressed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += header.length + name.length + compressed.length;
}
const centralSize = central.reduce((sum, part) => sum + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...local, ...central, end]);
const out = path.join(root, "dist", `popup-guard-${manifest.version}.zip`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, zip);
const sha256 = createHash("sha256").update(zip).digest("hex");
await writeFile(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`);
console.log(`${out}\n${files.length} files, ${zip.length} bytes, SHA-256 ${sha256}`);
