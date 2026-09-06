import { mkdir } from "node:fs/promises";

const artifactToolUrl =
  "file:///C:/Users/Asus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";
const { FileBlob, SpreadsheetFile } = await import(artifactToolUrl);

const inputPath =
  "E:/PROJECTS/web-app-2026/Apply-2027/outputs/kamiunity-program-database/kamiunity-program-database.xlsx";
const outputDir =
  "E:/PROJECTS/web-app-2026/Apply-2027/outputs/italy-master-programs-20260906";
const outputPath = outputDir + "/kamiunity-italy-master-program-database.xlsx";
const catalogueUrl =
  "https://www2.almalaurea.it/cgi-asp/lau/corsi/risultati.aspx?lang=it&tipologie=LS&tipobacheca=2&anni=2025&from=cerca";
const detailBaseUrl =
  "https://www2.almalaurea.it/cgi-asp/lau/corsi/dettaglioCorsi.aspx?lang=it&ID=";
const nextPageTarget = "ctl00$content$paginationBottom$nextPage";
const verifiedDate = "2026-09-06";
const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, code) =>
      String.fromCodePoint(parseInt(code, 10)),
    )
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanHtml(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(value, pattern) {
  const match = String(value ?? "").match(pattern);
  return match ? cleanHtml(match[1]) : "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^{}()|[\]\\$]/g, "\\$&");
}

function extractSummaryValue(segment, label) {
  const pattern = new RegExp(
    "<span\\b[^>]*specchietto-riepilogo-label[^>]*>\\s*" +
      escapeRegExp(label) +
      "\\s*</span>\\s*<br\\s*/?>\\s*<span\\b[^>]*>([\\s\\S]*?)(?:</span>|<span\\s*/>)",
    "i",
  );
  return firstMatch(segment, pattern);
}

function readAttribute(tag, name) {
  const pattern = new RegExp(
    "\\b" + escapeRegExp(name) + "\\s*=\\s*[\"']([^\"']*)[\"']",
    "i",
  );
  const match = String(tag ?? "").match(pattern);
  return match ? decodeEntities(match[1]) : "";
}

function parseHiddenInputs(html) {
  const hidden = {};
  for (const match of String(html).matchAll(
    /<input\b[^>]*type\s*=\s*["']hidden["'][^>]*>/gi,
  )) {
    const tag = match[0];
    const name = readAttribute(tag, "name");
    if (name) hidden[name] = readAttribute(tag, "value");
  }
  return hidden;
}

function parseTotalResults(html) {
  const candidates = [
    /id=["'][^"']*RisultatiTrovatiNumero["'][^>]*>\s*(\d[\d.]*)\s*</i,
    /Corsi\s+trovati[\s\S]{0,180}?(\d[\d.]*)/i,
    /(\d[\d.]*)\s+corsi\s+trovati/i,
    /Risultati[\s\S]{0,120}?(\d[\d.]*)/i,
  ];
  for (const pattern of candidates) {
    const match = String(html).match(pattern);
    if (match) {
      const total = Number(match[1].replace(/\./g, ""));
      if (Number.isFinite(total) && total > 0) return total;
    }
  }
  return 2416;
}

function parsePage(html) {
  const anchors = [
    ...String(html).matchAll(
      /<a\b[^>]*href=["']dettaglioCorsi\.aspx\?lang=it&ID=(\d+)["'][^>]*>/gi,
    ),
  ];
  const records = [];

  for (let index = 0; index < anchors.length; index += 1) {
    const start = anchors[index].index;
    const end = anchors[index + 1]?.index ?? html.length;
    const segment = html.slice(start, end);
    if (!/descAteneoDiv/i.test(segment)) continue;

    const title = firstMatch(
      segment,
      /<span\b[^>]*TitoloCorso[^>]*>([\s\S]*?)<\/span>/i,
    );
    const university = firstMatch(
      segment,
      /<div\b[^>]*descAteneoDiv[^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (!title || !university) continue;

    const id = anchors[index][1];
    const academicYear = firstMatch(
      segment,
      /<span\b[^>]*annoAccademico[^>]*>([\s\S]*?)<\/span>/i,
    );
    const className = firstMatch(
      segment,
      /<div\b[^>]*classeDiLaurea[^>]*>([\s\S]*?)<\/div>/i,
    );
    const location = extractSummaryValue(segment, "Sede del corso");
    const access = extractSummaryValue(segment, "Modalità di accesso");
    const teaching = extractSummaryValue(segment, "Didattica");
    const language = extractSummaryValue(
      segment,
      "Lingue in cui è tenuto il corso",
    );
    const cfu = extractSummaryValue(segment, "CFU rilasciati");
    const cost = extractSummaryValue(segment, "Costo totale");

    records.push({
      id,
      title,
      university,
      academicYear,
      className,
      location,
      access,
      teaching,
      language,
      cfu,
      cost,
    });
  }

  return records;
}

function cityFromLocation(location) {
  return String(location ?? "")
    .replace(/\s*,\s*italia\s*$/i, "")
    .replace(/\s*\([A-Z]{2}\)\s*$/i, "")
    .trim();
}

function studyModeFromTeaching(teaching) {
  const value = String(teaching ?? "").toLowerCase();
  if (value.includes("misto") || value.includes("blended")) return "Hybrid";
  if (value.includes("distanza") || value.includes("online")) return "Online";
  if (value.includes("presenza")) return "On campus";
  return teaching || "";
}

function displayTuition(cost) {
  if (!cost || /^non specificato$/i.test(cost)) return "";
  return cost;
}

function buildNotes(record) {
  const details = [];
  if (record.className) details.push("Class: " + record.className);
  if (record.access) details.push("Access: " + record.access);
  if (record.teaching) details.push("Teaching: " + record.teaching);
  if (record.cfu) details.push("CFU: " + record.cfu);
  if (record.cost) details.push("Total cost: " + record.cost);
  details.push(
    "AlmaLaurea catalogue metadata; verify current admissions requirements and deadlines with the university.",
  );
  return details.join(" | ");
}

function toWorkbookRow(record) {
  const detailUrl = detailBaseUrl + encodeURIComponent(record.id);
  const duration = record.cfu
    ? "2 years (" + record.cfu + " CFU)"
    : "2 years";
  const year = record.academicYear || "2025/2026";
  const language = record.language || "";
  return [
    "alma-2025-" + record.id,
    record.university,
    record.title,
    "Italy",
    cityFromLocation(record.location),
    "",
    "Master’s",
    year,
    duration,
    language,
    studyModeFromTeaching(record.teaching),
    "",
    "2025/2026 catalogue entry; verify the university’s current admissions deadline.",
    detailUrl,
    "",
    "",
    displayTuition(record.cost),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "[]",
    buildNotes(record),
    "AlmaLaurea — Laurea Magistrale 2025/2026",
    catalogueUrl,
    verifiedDate,
  ];
}

const cookieJar = new Map();

function updateCookies(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = String(value).split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) {
      cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

async function request(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const headers = {
        accept: "text/html,application/xhtml+xml",
        "user-agent": userAgent,
        ...(options.headers ?? {}),
      };
      if (cookieJar.size) {
        headers.cookie = [...cookieJar.entries()]
          .map(([name, value]) => name + "=" + value)
          .join("; ");
      }
      const response = await fetch(url, { ...options, headers });
      updateCookies(response);
      const html = await response.text();
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " from " + url);
      }
      return html;
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

async function fetchAllCatalogueRecords() {
  let html = await request(catalogueUrl);
  const total = parseTotalResults(html);
  const pageSize = 20;
  const pageCount = Math.ceil(total / pageSize);
  const records = [];

  console.log(
    "AlmaLaurea reports " +
      total +
      " Laurea Magistrale records across " +
      pageCount +
      " pages.",
  );

  for (let page = 1; page <= pageCount; page += 1) {
    const pageRecords = parsePage(html);
    const expected = Math.min(pageSize, total - (page - 1) * pageSize);
    if (pageRecords.length !== expected) {
      throw new Error(
        "Expected " +
          expected +
          " records on page " +
          page +
          " but parsed " +
          pageRecords.length,
      );
    }
    records.push(...pageRecords);
    if (page === 1 || page % 10 === 0 || page === pageCount) {
      console.log(
        "Fetched page " +
          page +
          "/" +
          pageCount +
          " (" +
          records.length +
          "/" +
          total +
          " records).",
      );
    }

    if (page < pageCount) {
      const payload = parseHiddenInputs(html);
      payload.__EVENTTARGET = nextPageTarget;
      payload.__EVENTARGUMENT = "";
      const body = new URLSearchParams();
      for (const [name, value] of Object.entries(payload)) {
        body.append(name, value ?? "");
      }
      html = await request(catalogueUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          referer: catalogueUrl,
        },
        body: body.toString(),
      });
      await sleep(120);
    }
  }

  const uniqueIds = new Set(records.map((record) => record.id));
  if (records.length !== total || uniqueIds.size !== records.length) {
    throw new Error(
      "Catalogue validation failed: " +
        records.length +
        " rows, " +
        uniqueIds.size +
        " unique IDs, expected " +
        total +
        ".",
    );
  }
  return records;
}

const rawRecords = await fetchAllCatalogueRecords();
rawRecords.sort((a, b) => {
  const left = (a.university + " " + a.title + " " + a.location).toLocaleLowerCase();
  const right = (b.university + " " + b.title + " " + b.location).toLocaleLowerCase();
  return left.localeCompare(right, "it");
});

const headers = [
  "Catalog ID",
  "University",
  "Program",
  "Country",
  "City",
  "Department",
  "Degree level",
  "Intake",
  "Duration",
  "Language",
  "Study mode",
  "Deadline",
  "Deadline note",
  "Program website",
  "Application portal",
  "Admissions email",
  "Tuition",
  "Application fee",
  "Funding",
  "Funding website",
  "Requirements",
  "Language requirements",
  "Minimum GPA",
  "Professor name",
  "Professor email",
  "Professors (JSON)",
  "Notes",
  "Source",
  "Source URL",
  "Last verified",
];

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const programSheet = workbook.worksheets.getItem("Program database");
const existingTable = programSheet.tables.items[0];
if (!existingTable) {
  throw new Error("The Program database sheet does not contain its expected table.");
}
const tableName = existingTable.name;
const tableStyle = existingTable.style;
existingTable.delete();

const rows = rawRecords.map(toWorkbookRow);
if (rows.some((row) => row.length !== headers.length)) {
  throw new Error("One or more imported rows do not match the workbook header width.");
}

const destinationRange = "A1:AD" + (rows.length + 1);
programSheet.getRange(destinationRange).values = [headers, ...rows];
const replacementTable = programSheet.tables.add(destinationRange, true, tableName);
replacementTable.style = tableStyle;

await mkdir(outputDir, { recursive: true });
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

console.log(
  JSON.stringify(
    {
      outputPath,
      importedPrograms: rows.length,
      universities: new Set(rawRecords.map((record) => record.university)).size,
      academicYear: "2025/2026",
      source: catalogueUrl,
    },
    null,
    2,
  ),
);
