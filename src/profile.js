import { parseCsv } from "./catalog.js";

export const PROFILE_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSeV74XBx562DqS_2IUs7E_ckFOlgbGzX6eiZ7oLoi1GvZI7IA/viewform?usp=dialog";
export const PROFILE_SHEET_URL = "https://docs.google.com/spreadsheets/d/18szMfitTrSodicxwEO4Wi5rJa_P0nPza6dvwwdDb-SA/edit?usp=sharing";
export const PROFILE_SHEET_ID = "18szMfitTrSodicxwEO4Wi5rJa_P0nPza6dvwwdDb-SA";
export const PROFILE_SHEET_GID = "802126866";

const PROFILE_SHEET_SOURCES = [
  { url: `https://docs.google.com/spreadsheets/d/${PROFILE_SHEET_ID}/gviz/tq?tqx=out:html&gid=${PROFILE_SHEET_GID}`, format: "html" },
  { url: `https://docs.google.com/spreadsheets/d/${PROFILE_SHEET_ID}/export?format=csv&gid=${PROFILE_SHEET_GID}`, format: "csv" },
  { url: `https://docs.google.com/spreadsheets/d/${PROFILE_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${PROFILE_SHEET_GID}`, format: "csv" },
];

const FIELD_ALIASES = {
  email: ["email", "email address", "e mail", "google account email"],
  timestamp: ["timestamp", "submitted at", "response timestamp"],
  fullName: ["full name", "name", "student name"],
  lastDegree: ["last degree", "degree", "previous degree"],
  university: ["university", "school", "institution"],
  programName: ["program name", "program", "course"],
};

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function readField(row, aliases) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseHtmlRows(text) {
  if (typeof DOMParser === "undefined") return [];
  const parsedDocument = new DOMParser().parseFromString(String(text || ""), "text/html");
  return [...parsedDocument.querySelectorAll("table tr")]
    .map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()))
    .filter((row) => row.some((value) => value));
}

function rowsToProfiles(rows) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map(normalizeHeader);
  const emailHeader = FIELD_ALIASES.email.find((alias) => headers.includes(alias));
  const normalizedRows = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  const records = normalizedRows.map((row, index) => ({
    email: readField(row, FIELD_ALIASES.email),
    fullName: readField(row, FIELD_ALIASES.fullName),
    lastDegree: readField(row, FIELD_ALIASES.lastDegree),
    university: readField(row, FIELD_ALIASES.university),
    programName: readField(row, FIELD_ALIASES.programName),
    submittedAt: readField(row, FIELD_ALIASES.timestamp),
    rowNumber: index + 2,
  })).filter((record) => record.email || record.fullName || record.university || record.programName);
  return { headers, hasEmailColumn: Boolean(emailHeader), records };
}

export function normalizeProfileEmail(value) {
  return normalizedEmail(value);
}

export function parseProfileSheet(text, format = "csv") {
  const rows = format === "html" ? parseHtmlRows(text) : [];
  if (format === "html") return rowsToProfiles(rows);
  const csvRows = parseCsv(text);
  const headers = csvRows.length ? Object.keys(csvRows[0]) : [];
  const emailHeader = FIELD_ALIASES.email.find((alias) => headers.includes(alias));
  const records = csvRows.map((row, index) => ({
    email: readField(row, FIELD_ALIASES.email),
    fullName: readField(row, FIELD_ALIASES.fullName),
    lastDegree: readField(row, FIELD_ALIASES.lastDegree),
    university: readField(row, FIELD_ALIASES.university),
    programName: readField(row, FIELD_ALIASES.programName),
    submittedAt: readField(row, FIELD_ALIASES.timestamp),
    rowNumber: index + 2,
  })).filter((record) => record.email || record.fullName || record.university || record.programName);

  return { headers, hasEmailColumn: Boolean(emailHeader), records };
}

export function findProfileByEmail(records, email) {
  const target = normalizedEmail(email);
  if (!target) return null;
  return [...records].reverse().find((record) => normalizedEmail(record.email) === target) || null;
}

export async function fetchProfileSheet() {
  let lastError;
  for (const source of PROFILE_SHEET_SOURCES) {
    try {
      const response = await fetch(source.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`The profile sheet returned ${response.status}.`);
      const parsed = parseProfileSheet(await response.text(), source.format);
      if (!parsed.headers.length) throw new Error("The profile sheet is empty or unavailable.");
      if (!parsed.hasEmailColumn) {
        throw new Error("Add an Email column by enabling Collect email addresses in the Google Form, then try again.");
      }
      return { ...parsed, sourceUrl: source.url };
    } catch (error) {
      lastError = error;
      if (error.message.includes("Add an Email column")) throw error;
    }
  }
  throw new Error(lastError?.message || "The profile sheet could not be reached. Check that it is shared for viewing.");
}
