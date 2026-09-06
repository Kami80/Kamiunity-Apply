import http from "node:http";
import fs from "node:fs/promises";

const port = Number(process.argv[2] || 4178);
const csvPath =
  "E:/PROJECTS/web-app-2026/Apply-2027/outputs/european-master-programs-20260906/european-master-programs.csv";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const csv = await fs.readFile(csvPath, "utf8");
const rows = parseCsv(csv);
const tsv = rows
  .map((row) =>
    row
      .map((value) =>
        String(value ?? "")
          .replace(/\t/g, " ")
          .replace(/\r?\n/g, " "),
      )
      .join("\t"),
  )
  .join("\n");
const html =
  "<!doctype html><meta charset=\"utf-8\"><title>Kamiunity catalogue copy</title>" +
  "<textarea id=\"catalog\" style=\"width:100%;height:90vh\">" +
  escapeHtml(tsv) +
  "</textarea>";

const server = http.createServer((request, response) => {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
});

server.listen(port, "127.0.0.1", () => {
  console.log("Catalog copy server listening on http://127.0.0.1:" + port);
});
