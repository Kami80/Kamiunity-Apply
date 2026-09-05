import { db } from "./db.js";
import { cleanProgram } from "./workflow.js";
import { CATALOG_SOURCE_SETTING_KEY } from "./catalog-data.js";

const fieldAliases = {
  catalogId: ["catalog id", "program id", "id", "slug"],
  name: ["university", "institution", "school", "name"],
  program: ["program", "course", "degree", "major"],
  country: ["country", "location", "country region"],
  city: ["city", "campus"],
  department: ["department", "faculty", "school department"],
  degreeLevel: ["degree level", "level", "degree"],
  intake: ["intake", "term", "entry term"],
  duration: ["duration", "length"],
  language: ["language", "teaching language"],
  studyMode: ["study mode", "mode", "delivery"],
  deadline: ["deadline", "application deadline", "due date", "due"],
  deadlineNote: ["deadline note", "deadline time", "time zone"],
  url: ["program website", "program url", "url", "link", "website"],
  portalUrl: ["application portal", "portal url", "portal"],
  admissionsEmail: ["admissions email", "admissions contact", "email"],
  tuition: ["tuition", "tuition fee", "cost"],
  applicationFee: ["application fee", "fee"],
  funding: ["funding", "scholarship", "funding options"],
  fundingUrl: ["funding url", "funding website", "scholarship website"],
  requirements: ["requirements", "required documents", "prerequisites"],
  languageRequirements: ["language requirements", "english requirements", "test requirements"],
  minimumGpa: ["minimum gpa", "gpa", "academic requirement"],
  professorName: ["professor name", "professor", "supervisor", "faculty contact"],
  professorEmail: ["professor email", "supervisor email", "faculty email"],
  professorWebsite: ["professor website", "supervisor website", "faculty website"],
  lab: ["lab", "research lab", "research group"],
  professorsJson: ["professors json", "professors", "contacts json"],
  notes: ["notes", "note", "research notes"],
  source: ["source", "source label"],
  sourceUrl: ["source url", "source website"],
  lastVerified: ["last verified", "verified", "verified date", "updated"],
};

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function valueText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function rowValue(row, aliases) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value !== undefined && value !== null && valueText(value)) return valueText(value);
  }
  return "";
}

export function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
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
      if (row.some((value) => valueText(value))) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => valueText(value))) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function normalizeDate(value) {
  const text = valueText(value);
  if (!text) return "";
  if (isIsoDate(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("The deadline is not a valid date.");
  const slashMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!isIsoDate(candidate)) throw new Error("The deadline is not a valid date.");
    return candidate;
  }
  const date = new Date(text);
  if (Number.isNaN(date.valueOf())) throw new Error("The deadline could not be read as a date.");
  const candidate = date.toISOString().slice(0, 10);
  if (!isIsoDate(candidate)) throw new Error("The deadline is not a valid date.");
  return candidate;
}

function slug(value) {
  return valueText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function professorsFromRow(row) {
  const json = rowValue(row, fieldAliases.professorsJson);
  if (json) {
    try {
      const contacts = JSON.parse(json);
      if (Array.isArray(contacts)) return contacts;
    } catch {
      // Fall back to the simple contact columns below.
    }
  }
  const name = rowValue(row, fieldAliases.professorName);
  const email = rowValue(row, fieldAliases.professorEmail);
  const url = rowValue(row, fieldAliases.professorWebsite);
  const lab = rowValue(row, fieldAliases.lab);
  return name || email || url || lab ? [{ name, email, url, lab, notes: "", status: "Not contacted" }] : [];
}

function rawCatalogProgram(row, index, source) {
  const name = rowValue(row, fieldAliases.name);
  const program = rowValue(row, fieldAliases.program);
  const suppliedId = rowValue(row, fieldAliases.catalogId);
  const baseId = slug(suppliedId || `${name}-${program}`) || `program-${index + 1}`;
  return {
    name,
    program,
    country: rowValue(row, fieldAliases.country),
    city: rowValue(row, fieldAliases.city),
    department: rowValue(row, fieldAliases.department),
    degreeLevel: rowValue(row, fieldAliases.degreeLevel),
    intake: rowValue(row, fieldAliases.intake),
    duration: rowValue(row, fieldAliases.duration),
    language: rowValue(row, fieldAliases.language),
    studyMode: rowValue(row, fieldAliases.studyMode),
    deadline: normalizeDate(rowValue(row, fieldAliases.deadline)),
    deadlineNote: rowValue(row, fieldAliases.deadlineNote),
    priority: rowValue(row, ["priority"]) || "Medium",
    url: rowValue(row, fieldAliases.url),
    portalUrl: rowValue(row, fieldAliases.portalUrl),
    admissionsEmail: rowValue(row, fieldAliases.admissionsEmail),
    tuition: rowValue(row, fieldAliases.tuition),
    applicationFee: rowValue(row, fieldAliases.applicationFee),
    funding: rowValue(row, fieldAliases.funding),
    fundingUrl: rowValue(row, fieldAliases.fundingUrl),
    requirements: rowValue(row, fieldAliases.requirements),
    languageRequirements: rowValue(row, fieldAliases.languageRequirements),
    minimumGpa: rowValue(row, fieldAliases.minimumGpa),
    professors: professorsFromRow(row),
    notes: rowValue(row, fieldAliases.notes),
    catalogId: baseId,
    catalogSource: rowValue(row, fieldAliases.source) || source.label,
    catalogSourceUrl: rowValue(row, fieldAliases.sourceUrl) || source.url,
    catalogLastVerified: rowValue(row, fieldAliases.lastVerified),
  };
}

export function parseCatalogRows(rows, options = {}) {
  const source = { label: options.sourceLabel || "Google Sheet", url: options.sourceUrl || "" };
  const skipped = [];
  const records = [];
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    try {
      const record = cleanProgram(rawCatalogProgram(row, index, source));
      if (!record.name || !record.program) {
        skipped.push({ row: index + 2, reason: "University and program are required." });
        continue;
      }
      let catalogId = record.catalogId || `program-${index + 1}`;
      let suffix = 2;
      while (ids.has(catalogId)) catalogId = `${record.catalogId}-${suffix++}`;
      ids.add(catalogId);
      records.push({ ...record, catalogId });
    } catch (error) {
      skipped.push({ row: index + 2, reason: error.message || "The row could not be read." });
    }
  }
  return { records, skipped };
}

export function parseCatalogCsv(text, options = {}) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("The catalog CSV is empty.");
  return parseCatalogRows(rows, options);
}

export function googleSheetCsvUrl(input) {
  const value = valueText(input);
  if (!value) throw new Error("Paste a Google Sheet or public CSV URL.");
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error("Enter a valid http or https URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("Enter a valid http or https URL.");
  if (url.hostname === "docs.google.com" && url.pathname.includes("/spreadsheets/d/")) {
    const match = url.pathname.match(/\/spreadsheets\/d\/(?:e\/)?([^/]+)/);
    if (!match) throw new Error("That Google Sheet URL could not be recognized.");
    if (url.pathname.includes("/d/e/") || url.pathname.includes("/pub")) {
      url.searchParams.set("output", "csv");
      return url.href;
    }
    const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`);
    exportUrl.searchParams.set("format", "csv");
    const gid = url.searchParams.get("gid") || url.hash.match(/gid=(\d+)/)?.[1];
    if (gid) exportUrl.searchParams.set("gid", gid);
    return exportUrl.href;
  }
  return url.href;
}

export function catalogToProgram(record) {
  const { id, ...program } = record || {};
  return { ...program, id: undefined };
}

export function programKey(record) {
  return `${valueText(record?.name).toLowerCase().replace(/\s+/g, " ")}::${valueText(record?.program).toLowerCase().replace(/\s+/g, " ")}`;
}

export async function replaceCatalog(records, source) {
  const nextSource = {
    mode: source.mode || "google-sheet",
    label: source.label || "Google Sheet",
    inputUrl: source.inputUrl || source.url || "",
    url: source.url || "",
    rowCount: records.length,
    skippedRows: source.skippedRows || 0,
    lastSyncedAt: source.lastSyncedAt === undefined ? new Date().toISOString() : source.lastSyncedAt,
  };
  await db.transaction("rw", db.catalogPrograms, db.settings, async () => {
    await db.catalogPrograms.clear();
    await db.catalogPrograms.bulkAdd(records);
    await db.settings.put({ key: CATALOG_SOURCE_SETTING_KEY, value: nextSource });
  });
  return nextSource;
}

export async function syncCatalogFromUrl(input) {
  const url = googleSheetCsvUrl(input);
  let response;
  try {
    response = await fetch(url, { cache: "no-store", headers: { Accept: "text/csv" } });
  } catch {
    throw new Error("The sheet could not be reached. Publish it as CSV and check that it is accessible without signing in.");
  }
  if (!response.ok) throw new Error(`The catalog returned ${response.status}. Publish the sheet to the web and try again.`);
  const parsed = parseCatalogCsv(await response.text(), { sourceLabel: "Google Sheet", sourceUrl: url });
  if (!parsed.records.length) throw new Error("No usable program rows were found. Add University and Program columns, then try again.");
  const source = await replaceCatalog(parsed.records, { mode: "google-sheet", label: "Google Sheet", inputUrl: input, url, skippedRows: parsed.skipped.length });
  return { ...parsed, source };
}

export async function importCatalogCsv(text, label = "Imported CSV") {
  const parsed = parseCatalogCsv(text, { sourceLabel: label });
  if (!parsed.records.length) throw new Error("No usable program rows were found. Add University and Program columns, then try again.");
  const source = await replaceCatalog(parsed.records, { mode: "file", label, skippedRows: parsed.skipped.length });
  return { ...parsed, source };
}
