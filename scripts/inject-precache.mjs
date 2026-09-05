import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(process.cwd(), "dist", "client");
const manifestPath = resolve(outputDirectory, ".vite", "manifest.json");
const serviceWorkerPath = resolve(outputDirectory, "sw.js");
const manifestSource = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestSource);
const assets = new Set();

for (const entry of Object.values(manifest)) {
  if (entry.file) assets.add(`./${entry.file}`);
  for (const file of entry.css || []) assets.add(`./${file}`);
  for (const file of entry.assets || []) assets.add(`./${file}`);
}

const startMarker = "  // __PRECACHE_START__";
const endMarker = "  // __PRECACHE_END__";
const assetLines = [...assets]
  .sort()
  .map((asset) => `  ${JSON.stringify(asset)},`)
  .join("\n");
const buildHash = createHash("sha256").update(manifestSource).digest("hex").slice(0, 10);
let serviceWorker = await readFile(serviceWorkerPath, "utf8");
serviceWorker = serviceWorker.replace(
  new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`),
  `${startMarker}\n${assetLines}\n${endMarker}`,
);
serviceWorker = serviceWorker.replace("__BUILD_HASH__", buildHash);
await writeFile(serviceWorkerPath, serviceWorker);

console.log(`Prepared offline cache ${buildHash} with ${assets.size} generated assets.`);
