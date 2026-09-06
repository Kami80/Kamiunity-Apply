import fs from "node:fs/promises";
import { parseCatalogCsv, programKey } from "../src/catalog.js";
import { inferProgramCategory, normalizeIntake } from "../src/program-taxonomy.js";
import { POLIMI_CATALOG } from "../src/polimi-data.js";

const inputPath = "E:/PROJECTS/web-app-2026/Apply-2027/outputs/european-master-programs-20260906/european-master-programs.csv";
const outputDir = "E:/PROJECTS/web-app-2026/Apply-2027/outputs/normalized-european-master-programs-20260906";
const outputPath = `${outputDir}/normalized-european-master-programs.csv`;
const polimiPath = `${outputDir}/politecnico-di-milano-programs.csv`;

const headers = [
  "Catalog ID",
  "University",
  "Program",
  "Country",
  "City",
  "Degree level",
  "Category",
  "Intake",
  "Language",
  "Deadline",
  "Program website",
  "QS Ranking",
];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function asEssentialRow(program) {
  return {
    "Catalog ID": program.catalogId || "",
    University: program.name || "",
    Program: program.program || "",
    Country: program.country || "",
    City: program.city || "",
    "Degree level": program.degreeLevel || "",
    Category: program.category || inferProgramCategory(program),
    Intake: normalizeIntake(program.intake),
    Language: program.language || "",
    Deadline: program.deadline || "",
    "Program website": program.url || "",
    "QS Ranking": program.qsRanking || "",
  };
}

function sortRows(first, second) {
  const firstPolimi = /^politecnico di milano$/i.test(first.University);
  const secondPolimi = /^politecnico di milano$/i.test(second.University);
  if (firstPolimi !== secondPolimi) return firstPolimi ? -1 : 1;
  return (first.Deadline || "9999-12-31").localeCompare(second.Deadline || "9999-12-31") || first.University.localeCompare(second.University) || first.Program.localeCompare(second.Program);
}

const sourceCsv = await fs.readFile(inputPath, "utf8");
const parsed = parseCatalogCsv(sourceCsv, { sourceLabel: "European catalogue snapshot" });
const rows = parsed.records.map(asEssentialRow);
const keys = new Set(rows.map((row) => programKey({ name: row.University, program: row.Program })));
for (const program of POLIMI_CATALOG) {
  const key = programKey(program);
  if (!keys.has(key)) {
    rows.push(asEssentialRow(program));
    keys.add(key);
  }
}
rows.sort(sortRows);

const render = (records) => [headers, ...records.map((row) => headers.map((header) => row[header] ?? ""))]
  .map((row) => row.map(csvCell).join(","))
  .join("\r\n") + "\r\n";

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, render(rows), "utf8");
await fs.writeFile(polimiPath, render(POLIMI_CATALOG.map(asEssentialRow).sort(sortRows)), "utf8");
console.log(JSON.stringify({ outputPath, polimiPath, inputRows: parsed.records.length, outputRows: rows.length, polimiRows: POLIMI_CATALOG.length }));
