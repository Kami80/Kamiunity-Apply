import fs from "node:fs/promises";
import { parseCsv } from "../src/catalog.js";
import { inferProgramCategory, normalizeIntake } from "../src/program-taxonomy.js";

const templatePath = "E:/PROJECTS/web-app-2026/Apply-2027/public/kamiunity-program-database-template.csv";
const headers = [
  "Catalog ID", "University", "Program", "Country", "City", "Department", "Degree level", "Category", "Intake", "Duration", "Language", "QS Ranking", "Study mode", "Deadline", "Deadline note", "Program website", "Application portal", "Admissions email", "Tuition", "Application fee", "Funding", "Funding website", "Requirements", "Language requirements", "Minimum GPA", "Professor name", "Professor email", "Professors (JSON)", "Notes", "Source", "Source URL", "Last verified",
];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const rows = parseCsv(await fs.readFile(templatePath, "utf8"));
const outputRows = rows.map((row) => {
  const program = {
    name: row.university,
    program: row.program,
    department: row.department,
  };
  return {
    "Catalog ID": row["catalog id"],
    University: row.university,
    Program: row.program,
    Country: row.country,
    City: row.city,
    Department: row.department,
    "Degree level": row["degree level"],
    Category: row.category || inferProgramCategory(program),
    Intake: normalizeIntake(row.intake),
    Duration: row.duration,
    Language: row.language,
    "QS Ranking": row["qs ranking"],
    "Study mode": row["study mode"],
    Deadline: row.deadline,
    "Deadline note": row["deadline note"],
    "Program website": row["program website"],
    "Application portal": row["application portal"],
    "Admissions email": row["admissions email"],
    Tuition: row.tuition,
    "Application fee": row["application fee"],
    Funding: row.funding,
    "Funding website": row["funding website"],
    Requirements: row.requirements,
    "Language requirements": row["language requirements"],
    "Minimum GPA": row["minimum gpa"],
    "Professor name": row["professor name"],
    "Professor email": row["professor email"],
    "Professors (JSON)": row["professors (json)"],
    Notes: row.notes,
    Source: row.source,
    "Source URL": row["source url"],
    "Last verified": row["last verified"],
  };
});
const output = [headers.map(csvCell).join(","), ...outputRows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\r\n") + "\r\n";
await fs.writeFile(templatePath, output, "utf8");
console.log(`Updated ${rows.length} template records with Category and season-only Intake fields.`);
