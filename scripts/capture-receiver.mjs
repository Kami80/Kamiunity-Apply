import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(process.cwd(), "design");
const allowedNames = new Set([
  "implementation-today-v1.png",
  "implementation-today-final.png",
  "implementation-today-final.jpg",
  "implementation-mobile.png",
  "implementation-mobile.jpg",
  "implementation-tablet.png",
  "implementation-tablet.jpg",
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:4174");
  const name = url.searchParams.get("name");
  if (request.method !== "POST" || !allowedNames.has(name)) {
    response.writeHead(400, { "content-type": "text/plain" });
    response.end("Unsupported capture request.");
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, name), Buffer.concat(chunks));
  response.writeHead(200, {
    "access-control-allow-origin": "*",
    "content-type": "text/plain",
  });
  response.end(`Saved ${name}`);
});

server.listen(4174, "127.0.0.1", () => {
  console.log("Capture receiver listening on http://127.0.0.1:4174");
});
