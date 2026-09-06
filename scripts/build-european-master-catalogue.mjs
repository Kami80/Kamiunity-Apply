import fs from "node:fs/promises";
import XLSX from "xlsx";
import { inferProgramCategory, normalizeIntake } from "../src/program-taxonomy.js";
import { POLIMI_CATALOG } from "../src/polimi-data.js";

const runtimeNodeModules =
  "C:/Users/Asus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const artifactToolUrl =
  "file:///" +
  runtimeNodeModules.replace(/\\/g, "/") +
  "/@oai/artifact-tool/dist/artifact_tool.mjs";
const { SpreadsheetFile, Workbook } = await import(artifactToolUrl);

const verifiedDate = "2026-09-06";
const qsSourceUrl = "https://www.topuniversities.com/world-university-rankings";
const qsCsvPath =
  "C:/Users/Asus/AppData/Local/Temp/kamiunity-qs-2027/unzipped/2027 QS World University Rankings.csv";
const italyWorkbookPath =
  "E:/PROJECTS/web-app-2026/Apply-2027/outputs/italy-master-programs-20260906/kamiunity-italy-master-program-database.xlsx";
const outputDir =
  "E:/PROJECTS/web-app-2026/Apply-2027/outputs/european-master-programs-20260906";
const csvPath = outputDir + "/european-master-programs.csv";
const xlsxPath = outputDir + "/european-master-programs.xlsx";
const summaryPath = outputDir + "/summary.json";

const headers = [
  "Catalog ID",
  "University",
  "Program",
  "Category",
  "Country",
  "City",
  "Degree level",
  "Intake",
  "Language",
  "Deadline",
  "Program website",
  "QS Ranking",
];

const sources = {
  Italy: {
    label: "AlmaLaurea Laurea Magistrale catalogue",
    url:
      "https://www2.almalaurea.it/cgi-asp/lau/corsi/risultati.aspx?lang=it&tipologie=LS&tipobacheca=2&anni=2025&from=cerca",
  },
  Germany: {
    label: "DAAD International Programmes",
    url:
      "https://www.daad.de/en/studying-in-germany/universities/all-degree-programmes/",
    api:
      "https://www2.daad.de/deutschland/studienangebote/international-programmes/api/solr/en/search.json?degree%5B%5D=2&limit=2000&offset=0&display=list",
  },
  France: {
    label: "Trouver Mon Master catalogue",
    url:
      "https://data.enseignementsup-recherche.gouv.fr/explore/dataset/fr-esr-tmm-donnees-du-portail-dinformation-trouver-mon-master-parcours-de-format/",
    csv:
      "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-tmm-donnees-du-portail-dinformation-trouver-mon-master-parcours-de-format/exports/csv",
  },
  Netherlands: {
    label: "DUO CROHO / higher-education programme register",
    url:
      "https://duo.nl/zakelijk/hoger-onderwijs/studentenadministratie/opleidingsgegevens-in-croho/raadplegen-en-downloaden.jsp",
    csv:
      "https://onderwijsdata.duo.nl/dataset/7c0686f4-b5c2-418e-8e44-7be0057d8084/resource/ffffa7ad-e6a2-4ba7-9fc2-a09df4128555/download/ho_opleidingsoverzicht.csv",
  },
  Belgium: {
    label: "Study in Flanders programme catalogue",
    url: "https://www.studyinflanders.be/programmes",
  },
};

function clean(value) {
  return remove2026(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " ")
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
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function remove2026(value) {
  return String(value ?? "")
    .replace(/\s*\(2026\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseWebsite(value) {
  return clean(value).replace(/^h+(?=https?:\/\/)/i, "");
}

function normalise(value) {
  return remove2026(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return normalise(value).replace(/\s+/g, "-").slice(0, 76) || "program";
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseDelimited(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");
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
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => String(value).trim())) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((value) => clean(value));
  return rows.slice(1).map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    ),
  );
}

function parseRank(value) {
  const match = String(value ?? "")
    .replace(/,/g, "")
    .match(/\d+/);
  if (!match) return null;
  const rank = Number(match[0]);
  return Number.isFinite(rank) && rank <= 1000 ? rank : null;
}

async function fetchText(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
          accept: "*/*",
          ...(options.headers ?? {}),
        },
        signal: AbortSignal.timeout(180000),
      });
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " from " + url);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

async function fetchJson(url, options = {}) {
  return JSON.parse(await fetchText(url, options));
}

function isoDeadline(value) {
  const match = String(value ?? "").match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  );
  if (!match) return "";
  const months = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  const day = Number(match[1]);
  const month = months[match[2].toLowerCase()];
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) {
    return "";
  }
  return (
    String(year).padStart(4, "0") +
    "-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}

function isoYear(value) {
  const match = String(value ?? "").match(/\b(\d{4})/);
  return match ? Number(match[1]) : 0;
}

function languageList(value) {
  const map = {
    ENG: "English",
    NLD: "Dutch",
    DEU: "German",
    FRA: "French",
    ITA: "Italian",
    SPA: "Spanish",
    POR: "Portuguese",
    DAN: "Danish",
    SWE: "Swedish",
    FIN: "Finnish",
    NOR: "Norwegian",
  };
  return [...new Set(
    String(value ?? "")
      .split(/[,;/|\s]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => map[part.toUpperCase()] || part),
  )].join(" / ");
}

function findValue(row, names) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return clean(value);
    }
  }
  return "";
}

function findQsRow(qsRows, country, target) {
  const wanted = normalise(target);
  return (
    qsRows.find(
      (row) =>
        row.country === country && normalise(row.name) === wanted,
    ) ||
    qsRows.find(
      (row) =>
        row.country === country &&
        (normalise(row.name).includes(wanted) ||
          wanted.includes(normalise(row.name))),
    ) ||
    null
  );
}

const matchers = {
  Italy: [
    { qs: "Politecnico di Milano", aliases: ["Politecnico di Milano"] },
    { qs: "Sapienza University of Rome", aliases: ["Sapienza Università di Roma", "Sapienza University of Rome"] },
    { qs: "Alma Mater Studiorum - Università di Bologna", aliases: ["Alma Mater Studiorum", "University of Bologna"] },
    { qs: "Università di Padova", aliases: ["Università degli Studi di Padova", "University of Padua"] },
    { qs: "Politecnico di Torino", aliases: ["Politecnico di Torino"] },
    { qs: "University of Milan", aliases: ["Università degli Studi di Milano"] },
    { qs: "University of Pisa", aliases: ["Università degli Studi di Pisa"] },
    { qs: "University of Rome “Tor Vergata”", aliases: ["Università degli Studi di Roma Tor Vergata", "Università degli Studi di Roma \"Tor Vergata\""] },
    { qs: "Università Cattolica del Sacro Cuore", aliases: ["Università Cattolica del Sacro Cuore"] },
    { qs: "Università degli Studi di Pavia", aliases: ["Università di Pavia"] },
    { qs: "University of Naples - Federico II", aliases: ["Università degli Studi di Napoli Federico II", "Università degli Studi di Napoli \"Federico II\""] },
    { qs: "University of Turin", aliases: ["Università degli Studi di Torino", "Università di Torino"] },
    { qs: "University of Florence", aliases: ["Università degli Studi di Firenze", "Università di Firenze"] },
    { qs: "University of Trento", aliases: ["Università di Trento"] },
    { qs: "Università Vita-Salute San Raffaele", aliases: ["Università \"Vita-Salute San Raffaele\" di Milano", "Vita-Salute San Raffaele"] },
    { qs: "University of Genoa", aliases: ["Università di Genova"] },
    { qs: "University of Milano-Bicocca", aliases: ["Università degli Studi di Milano - Bicocca", "Università di Milano-Bicocca"] },
    { qs: "University of Siena", aliases: ["Università di Siena"] },
    { qs: "University of Brescia", aliases: ["Università degli Studi di Brescia"] },
    { qs: "Ca’ Foscari University of Venice", aliases: ["Università Ca' Foscari Venezia", "Ca' Foscari"] },
    { qs: "Free University of Bozen-Bolzano", aliases: ["Libera Università di Bolzano", "Free University of Bozen-Bolzano"] },
    { qs: "Universita’ Politecnica delle Marche", aliases: ["Università Politecnica delle Marche"] },
  ],
  Germany: [
    { qs: "Technical University of Munich", aliases: ["Technical University of Munich", "TU Munich", "Technische Universität München"] },
    { qs: "Ludwig-Maximilians-Universität München", aliases: ["Ludwig-Maximilians-Universität München", "LMU Munich", "Ludwig Maximilians University"] },
    { qs: "Universität Heidelberg", aliases: ["Universität Heidelberg", "Heidelberg University", "University of Heidelberg"] },
    { qs: "Freie Universitaet Berlin", aliases: ["Freie Universitaet Berlin", "Free University of Berlin"] },
    { qs: "RWTH Aachen University", aliases: ["RWTH Aachen University"] },
    { qs: "KIT, Karlsruhe Institute of Technology", aliases: ["Karlsruhe Institute of Technology", "Karlsruher Institut für Technologie", "KIT"] },
    { qs: "Humboldt-Universität zu Berlin", aliases: ["Humboldt-Universität zu Berlin", "Humboldt University of Berlin"] },
    { qs: "Technische Universität Berlin", aliases: ["Technische Universität Berlin", "Technical University of Berlin", "TU Berlin"] },
    { qs: "Technische Universität Dresden", aliases: ["Technische Universität Dresden", "TU Dresden"] },
    { qs: "Universität Hamburg", aliases: ["Universität Hamburg", "University of Hamburg"] },
    { qs: "Universität Bonn", aliases: ["Universität Bonn", "University of Bonn"] },
    { qs: "Friedrich-Alexander-Universität Erlangen-Nürnberg", aliases: ["FAU Erlangen-Nürnberg", "Friedrich-Alexander-Universität Erlangen-Nürnberg", "University of Erlangen-Nuremberg"] },
    { qs: "Universität Tübingen", aliases: ["Universität Tübingen", "University of Tübingen"] },
    { qs: "Albert-Ludwigs-Universitaet Freiburg", aliases: ["University of Freiburg", "Albert-Ludwigs-Universität Freiburg"] },
    { qs: "Technical University of Darmstadt", aliases: ["Technische Universität Darmstadt", "TU Darmstadt"] },
    { qs: "University of Göttingen", aliases: ["University of Göttingen", "Georg-August-Universität Göttingen"] },
    { qs: "University of Cologne", aliases: ["University of Cologne", "Universität zu Köln"] },
    { qs: "Universität Stuttgart", aliases: ["University of Stuttgart", "Universität Stuttgart"] },
    { qs: "University of Münster", aliases: ["University of Münster", "Westfälische Wilhelms-Universität Münster"] },
    { qs: "Goethe-University Frankfurt am Main", aliases: ["Goethe University Frankfurt", "Goethe-Universität Frankfurt am Main"] },
    { qs: "Ruhr-Universität Bochum", aliases: ["Ruhr University Bochum", "Ruhr-Universität Bochum"] },
    { qs: "Universität Konstanz", aliases: ["University of Konstanz", "Universität Konstanz"] },
    { qs: "Universität Mannheim", aliases: ["University of Mannheim", "Universität Mannheim"] },
    { qs: "Julius-Maximilians-Universität Würzburg", aliases: ["Julius-Maximilians-Universität Würzburg", "University of Würzburg"] },
    { qs: "Leibniz University Hannover", aliases: ["Leibniz University Hannover", "Leibniz Universität Hannover"] },
    { qs: "University of Bayreuth", aliases: ["University of Bayreuth", "Universität Bayreuth"] },
    { qs: "Johannes Gutenberg Universität Mainz", aliases: ["Johannes Gutenberg University Mainz", "Johannes Gutenberg-Universität Mainz"] },
    { qs: "Universität Potsdam", aliases: ["University of Potsdam", "Universität Potsdam"] },
    { qs: "Justus Liebig University Giessen", aliases: ["Justus Liebig University Giessen", "Justus-Liebig-Universität Gießen"] },
    { qs: "Universität  Leipzig", aliases: ["Leipzig University", "Universität Leipzig"] },
    { qs: "Universität Jena", aliases: ["Friedrich Schiller University Jena", "Friedrich-Schiller-Universität Jena", "Universität Jena"] },
    { qs: "Ulm University", aliases: ["Ulm University", "Universität Ulm"] },
    { qs: "Universität Bremen", aliases: ["University of Bremen", "Universität Bremen"] },
    { qs: "Saarland University", aliases: ["Saarland University", "Universität des Saarlandes"] },
    { qs: "Technische Universität Bergakademie Freiberg", aliases: ["TU Bergakademie Freiberg", "Technische Universität Bergakademie Freiberg"] },
    { qs: "Christian-Albrechts-University zu Kiel", aliases: ["University of Kiel", "Christian-Albrechts-Universität zu Kiel"] },
    { qs: "Otto-von-Guericke-Universität Magdeburg", aliases: ["Otto von Guericke University Magdeburg", "Otto-von-Guericke-Universität Magdeburg"] },
    { qs: "TU Dortmund University", aliases: ["TU Dortmund University", "Technische Universität Dortmund"] },
    { qs: "Universität Regensburg", aliases: ["University of Regensburg", "Universität Regensburg"] },
  ],
  France: [
    { qs: "Université PSL", aliases: ["Université PSL", "Paris Sciences et Lettres", "PSL"] },
    { qs: "Institut Polytechnique de Paris", aliases: ["Institut Polytechnique de Paris"] },
    { qs: "Sorbonne University", aliases: ["Sorbonne Université", "Sorbonne University"] },
    { qs: "Université Paris-Saclay", aliases: ["Université Paris-Saclay", "Paris-Saclay University"] },
    { qs: "École Normale Supérieure de Lyon", aliases: ["École Normale Supérieure de Lyon", "ENS de Lyon", "ENS Lyon"] },
    { qs: "Université Paris 1 Panthéon-Sorbonne", aliases: ["Université Paris 1 Panthéon-Sorbonne", "Paris 1 Panthéon-Sorbonne"] },
    { qs: "Université Paris Cité", aliases: ["Université Paris Cité", "Université de Paris", "Paris Cité"] },
    { qs: "Sciences Po", aliases: ["Sciences Po"] },
    { qs: "Université Grenoble Alpes", aliases: ["Université Grenoble Alpes", "University Grenoble Alpes"] },
    { qs: "Aix-Marseille University", aliases: ["Aix-Marseille Université", "Aix-Marseille University"] },
    { qs: "Université de Strasbourg", aliases: ["Université de Strasbourg", "University of Strasbourg"] },
    { qs: "Université de Montpellier", aliases: ["Université de Montpellier", "University of Montpellier"] },
    { qs: "University of Bordeaux", aliases: ["Université de Bordeaux", "University of Bordeaux"] },
    { qs: "Conservatoire National des Arts et Métiers (CNAM)", aliases: ["Conservatoire national des arts et métiers", "CNAM"] },
    { qs: "Université Paul Sabatier Toulouse III", aliases: ["Université Toulouse III - Paul Sabatier", "Université Toulouse III Paul Sabatier", "Paul Sabatier University"] },
    { qs: "Université Claude Bernard Lyon 1", aliases: ["Université Claude Bernard Lyon 1", "Claude Bernard University Lyon 1"] },
    { qs: "Institut National Polytechnique de Toulouse", aliases: ["Institut National Polytechnique de Toulouse", "Toulouse INP"] },
    { qs: "École Centrale de Lyon", aliases: ["École Centrale de Lyon", "Centrale Lyon"] },
    { qs: "Université de Lille", aliases: ["Université de Lille", "University of Lille"] },
  ],
  Netherlands: [
    { qs: "Delft University of Technology", aliases: ["Technische Universiteit Delft", "Delft University of Technology", "TU Delft"] },
    { qs: "University of Amsterdam", aliases: ["Universiteit van Amsterdam", "University of Amsterdam"] },
    { qs: "Utrecht University", aliases: ["Universiteit Utrecht", "Utrecht University"] },
    { qs: "Leiden University", aliases: ["Universiteit Leiden", "Leiden University"] },
    { qs: "Erasmus University Rotterdam", aliases: ["Erasmus Universiteit Rotterdam", "Erasmus University Rotterdam"] },
    { qs: "Eindhoven University of Technology", aliases: ["Technische Universiteit Eindhoven", "Eindhoven University of Technology", "TU Eindhoven"] },
    { qs: "Wageningen University & Research", aliases: ["Wageningen University & Research", "Wageningen University"] },
    { qs: "University of Groningen", aliases: ["Rijksuniversiteit Groningen", "University of Groningen"] },
    { qs: "Vrije Universiteit Amsterdam", aliases: ["Vrije Universiteit Amsterdam", "Vrije Universiteit"] },
    { qs: "University of Twente", aliases: ["Universiteit Twente", "University of Twente"] },
    { qs: "Maastricht University", aliases: ["Universiteit Maastricht", "Maastricht University"] },
    { qs: "Radboud University Nijmegen", aliases: ["Radboud Universiteit", "Radboud University Nijmegen"] },
    { qs: "Tilburg University", aliases: ["Tilburg University", "Universiteit van Tilburg"] },
  ],
  Belgium: [
    { qs: "KU Leuven", aliases: ["KU Leuven", "Katholieke Universiteit Leuven"] },
    { qs: "Ghent University", aliases: ["Ghent University", "Universiteit Gent"] },
    { qs: "UCLouvain", aliases: ["UCLouvain", "Université catholique de Louvain"] },
    { qs: "Université libre de Bruxelles", aliases: ["Université libre de Bruxelles", "Université Libre de Bruxelles", "ULB"] },
    { qs: "University of Antwerp", aliases: ["University of Antwerp", "Universiteit Antwerpen"] },
    { qs: "Vrije Universiteit Brussel", aliases: ["Vrije Universiteit Brussel", "VUB"] },
    { qs: "Université de Liège", aliases: ["University of Liège", "Université de Liège"] },
    { qs: "Hasselt University", aliases: ["Hasselt University", "Universiteit Hasselt"] },
  ],
};

function makeMatcherIndex(qsRows) {
  return Object.fromEntries(
    Object.entries(matchers).map(([country, entries]) => [
      country,
      entries
        .map((entry) => ({
          ...entry,
          qsRow: findQsRow(qsRows, country, entry.qs),
        }))
        .filter((entry) => entry.qsRow),
    ]),
  );
}

function resolveUniversity(value, country, matcherIndex) {
  const input = normalise(value);
  if (!input) return null;
  const entries = matcherIndex[country] || [];
  return (
    entries.find((entry) =>
      entry.aliases.some((alias) => {
        const candidate = normalise(alias);
        return input === candidate || input.includes(candidate);
      }),
    )?.qsRow || null
  );
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function makeRow({
  id,
  qsRow,
  program,
  country,
  city,
  degreeLevel = "Master’s",
  intake = "",
  language = "",
  category = "",
  deadline = "",
  website = "",
  source,
}) {
  return {
    _id: id,
    _source: source,
    "Catalog ID": remove2026(id),
    University: remove2026(qsRow.name),
    Program: remove2026(program),
    Category: category || inferProgramCategory({ program }),
    Country: country,
    City: remove2026(city),
    "Degree level": degreeLevel,
    Intake: normalizeIntake(intake),
    Language: remove2026(language),
    Deadline: remove2026(deadline),
    "Program website": normaliseWebsite(website),
    "QS Ranking": qsRow.rank,
  };
}

const qsRowsRaw = parseDelimited(await fs.readFile(qsCsvPath, "utf8"));
const qsRows = qsRowsRaw
  .map((row) => ({
    name: findValue(row, ["Name"]),
    country: findValue(row, ["Country/Territory"]),
    region: findValue(row, ["Region"]),
    city: findValue(row, ["City"]),
    rank: parseRank(findValue(row, ["Rank"])),
  }))
  .filter((row) => row.region === "Europe" && row.rank !== null);
const matcherIndex = makeMatcherIndex(qsRows);

const missingQsMappings = Object.entries(matchers)
  .flatMap(([country, entries]) =>
    entries
      .filter((entry) => !matcherIndex[country]?.some((item) => item.qs === entry.qs))
      .map((entry) => country + ": " + entry.qs),
  );
if (missingQsMappings.length) {
  throw new Error("QS mapping not found: " + missingQsMappings.join(", "));
}

const rows = [];
const sourceCounts = {};
const skippedBySource = {};

function addRow(row) {
  rows.push(row);
  sourceCounts[row._source] = (sourceCounts[row._source] || 0) + 1;
}

function skip(source, reason) {
  skippedBySource[source] = skippedBySource[source] || {};
  skippedBySource[source][reason] = (skippedBySource[source][reason] || 0) + 1;
}

function qsRankFor(row) {
  return String(row["QS Ranking"]);
}

async function addItaly() {
  const workbook = XLSX.readFile(italyWorkbookPath);
  const sheet = workbook.Sheets["Program database"];
  const records = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  for (const record of records) {
    const qsRow = resolveUniversity(record.University, "Italy", matcherIndex);
    if (!qsRow) {
      skip("Italy", "University outside QS<1000 Italy set");
      continue;
    }
    addRow(
      makeRow({
        id:
          clean(record["Catalog ID"]) ||
          "alma-" + stableHash(record.University + "|" + record.Program),
        qsRow,
        program: record.Program,
        country: "Italy",
        city: record.City,
        intake: record.Intake,
        language: record.Language,
        website: record["Program website"],
        source: "AlmaLaurea",
      }),
    );
  }
}

async function addGermany() {
  const data = await fetchJson(sources.Germany.api, {
    headers: {
      referer:
        "https://www2.daad.de/deutschland/studienangebote/international-programmes/en/result/",
    },
  });
  for (const course of data.courses || []) {
    const qsRow = resolveUniversity(course.academy, "Germany", matcherIndex);
    if (!qsRow) {
      skip("Germany", "Academy outside QS<1000 Germany set");
      continue;
    }
    const website = course.link
      ? "https://www2.daad.de" + course.link
      : "";
    addRow(
      makeRow({
        id: "daad-" + String(course.id),
        qsRow,
        program: course.courseName,
        country: "Germany",
        city: course.city,
        intake: course.beginning,
        language: (course.languages || []).join(" / "),
        deadline: isoDeadline(course.applicationDeadline),
        website,
        source: "DAAD",
      }),
    );
  }
}

async function addFrance() {
  const rowsRaw = parseDelimited(await fetchText(sources.France.csv), ";");
  const latest = new Map();
  for (const row of rowsRaw) {
    const institution = findValue(row, ["etab_nom_usage", "etab_nom"]);
    const qsRow = resolveUniversity(institution, "France", matcherIndex);
    if (!qsRow) {
      skip("France", "Institution outside QS<1000 France set");
      continue;
    }
    const programCode =
      findValue(row, ["parc_inmp", "for_inm"]) ||
      stableHash(institution + "|" + findValue(row, ["for_intitule"]));
    const key =
      findValue(row, ["etab_uai"]) +
      "|" +
      programCode +
      "|" +
      findValue(row, ["for_intitule"]) +
      "|" +
      findValue(row, ["parc_intitule"]);
    const year = isoYear(findValue(row, ["annee"]));
    const prior = latest.get(key);
    if (!prior || year >= prior.year) {
      latest.set(key, { row, qsRow, year, programCode });
    }
  }
  for (const item of latest.values()) {
    const row = item.row;
    const parent = findValue(row, ["for_intitule"]);
    const path = findValue(row, ["parc_intitule"]);
    const program = path && normalise(path) !== normalise(parent)
      ? parent + " — " + path
      : parent || path;
    const website = findValue(row, ["for_lien_fiche"]);
    const semester = findValue(row, ["parc_semestre", "for_semestre"]);
    addRow(
      makeRow({
        id: "tmm-" + item.year + "-" + slug(item.programCode) + "-" + stableHash(program),
        qsRow: item.qsRow,
        program,
        country: "France",
        city: findValue(row, ["etab_ville"]),
        intake: (item.year ? String(item.year) + " · " : "") + semester,
        website,
        source: "Trouver Mon Master",
      }),
    );
  }
}

function latestDuoRecords(records) {
  const latest = new Map();
  for (const row of records) {
    if (findValue(row, ["NIVEAU"]) !== "WO-MA") continue;
    const institution =
      findValue(row, ["ONDERWIJSBESTUUR_NAAM", "PENVOERDER", "ONDERWIJSAANBIEDER_NAAM"]);
    const qsRow = resolveUniversity(institution, "Netherlands", matcherIndex);
    if (!qsRow) {
      skip("Netherlands", "Institution outside QS<1000 Netherlands set");
      continue;
    }
    const program = findValue(row, [
      "INTERNATIONALE_NAAM",
      "EIGENNAAM_ENGELS",
      "NAAM_LANG",
    ]);
    const city = findValue(row, ["ONDERWIJSLOCATIEPLAATS"]);
    const language = languageList(findValue(row, ["VOERTAAL"]));
    const website = findValue(row, ["WEBSITE"]);
    const key =
      normalise(institution) +
      "|" +
      normalise(program) +
      "|" +
      normalise(city) +
      "|" +
      normalise(language) +
      "|" +
      normalise(website);
    const start =
      findValue(row, ["AANGEBODEN_OPLEIDING_BEGINDATUM"]) ||
      findValue(row, ["BEGINDATUM"]);
    const prior = latest.get(key);
    if (!prior || start > prior.start) {
      latest.set(key, { row, qsRow, institution, program, city, language, website, start });
    }
  }
  return latest;
}

function duoIntake(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month >= 7) return "Fall " + year;
  if (month <= 2) return "Spring " + year;
  return String(year);
}

async function addNetherlands() {
  const records = parseDelimited(await fetchText(sources.Netherlands.csv));
  for (const item of latestDuoRecords(records).values()) {
    const row = item.row;
    const code =
      findValue(row, ["AANGEBODEN_OPLEIDINGCODE", "OPLEIDINGSEENHEIDCODE"]) ||
      stableHash(item.institution + "|" + item.program + "|" + item.city);
    addRow(
      makeRow({
        id: "duo-" + slug(code) + "-" + stableHash(item.program + "|" + item.city + "|" + item.language),
        qsRow: item.qsRow,
        program: item.program,
        country: "Netherlands",
        city: item.city,
        intake: duoIntake(item.start),
        language: item.language,
        website: item.website,
        source: "DUO",
      }),
    );
  }
}

function extractFlLocation(block, label) {
  const pattern = new RegExp(
    "<span[^>]*programme__info-label[^>]*>\\s*" +
      label +
      "\\s*</span>\\s*<span[^>]*programme__info-value[^>]*>([\\s\\S]*?)</span>",
    "i",
  );
  return clean(block.match(pattern)?.[1] || "");
}

function parseFlandersPage(html) {
  const blocks = [
    ...String(html).matchAll(
      /<div class="programme">[\s\S]*?(?=<div class="programme">|<\/main>)/gi,
    ),
  ];
  return blocks
    .map((match) => {
      const titleMatch = match[0].match(
        /<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i,
      );
      if (!titleMatch) return null;
      return {
        title: clean(titleMatch[2]),
        website: clean(titleMatch[1]),
        type: extractFlLocation(match[0], "Type"),
        institution: extractFlLocation(match[0], "Institution"),
        language: extractFlLocation(match[0], "Language"),
      };
    })
    .filter(Boolean);
}

const flandersCities = {
  "KU Leuven": "Leuven",
  "Ghent University": "Ghent",
  "University of Antwerp": "Antwerp",
  "Vrije Universiteit Brussel": "Brussels",
  "Université libre de Bruxelles": "Brussels",
  UCLouvain: "Louvain-la-Neuve",
  "University of Liège": "Liège",
  "Hasselt University": "Hasselt",
};

async function addBelgium() {
  for (let page = 1; page <= 40; page += 1) {
    const url =
      "https://www.studyinflanders.be/programmes/p" +
      page +
      "?level%5B0%5D=9730";
    const pageRows = parseFlandersPage(await fetchText(url));
    if (!pageRows.length) break;
    for (const item of pageRows) {
      if (!["MA", "AdMA"].includes(item.type)) {
        skip("Belgium", "Non-master listing");
        continue;
      }
      const qsRow = resolveUniversity(item.institution, "Belgium", matcherIndex);
      if (!qsRow) {
        skip("Belgium", "Institution outside QS<1000 Belgium set");
        continue;
      }
      addRow(
        makeRow({
          id:
            "flanders-" +
            slug(item.institution) +
            "-" +
            slug(item.title) +
            "-" +
            stableHash(item.website),
          qsRow,
          program: item.title,
          country: "Belgium",
          city: flandersCities[qsRow.name] || flandersCities[item.institution] || "",
          language: item.language,
          website: item.website,
          source: "Study in Flanders",
        }),
      );
    }
  }
}

await addItaly();
await addGermany();
await addFrance();
await addNetherlands();
await addBelgium();

for (const program of POLIMI_CATALOG) {
  addRow(
    makeRow({
      id: program.catalogId,
      qsRow: { name: program.name, rank: Number(program.qsRanking) || 87 },
      program: program.program,
      country: program.country,
      city: program.city,
      category: program.category,
      intake: program.intake,
      language: program.language,
      website: program.url,
      source: "Politecnico di Milano",
    }),
  );
}

const seen = new Set();
const idCounts = new Map();
const deduped = [];
for (const row of rows) {
  const key = [
    normalise(row.University),
    normalise(row.Program),
    normalise(row.Country),
    normalise(row.City),
    normalise(row.Language),
    normalise(row["Program website"]),
  ].join("|");
  if (seen.has(key)) {
    skip(row._source, "Duplicate programme identity");
    continue;
  }
  seen.add(key);
  const baseId = row["Catalog ID"] || row._id;
  const count = idCounts.get(baseId) || 0;
  idCounts.set(baseId, count + 1);
  row["Catalog ID"] = count ? baseId + "-" + (count + 1) : baseId;
  deduped.push(row);
}

deduped.sort((left, right) => {
  const leftPolimi = left.University === "Politecnico di Milano";
  const rightPolimi = right.University === "Politecnico di Milano";
  if (leftPolimi !== rightPolimi) return leftPolimi ? -1 : 1;
  const deadlineCompare = (left.Deadline || "9999-12-31").localeCompare(right.Deadline || "9999-12-31");
  if (deadlineCompare) return deadlineCompare;
  const a =
    left.University +
    "|" +
    left.Program;
  const b =
    right.University +
    "|" +
    right.Program;
  return a.localeCompare(b, "en");
});

const dataRows = deduped.map((row) =>
  headers.map((header) => row[header] ?? ""),
);
const csv = [headers, ...dataRows]
  .map((row) => row.map(csvCell).join(","))
  .join("\r\n") + "\r\n";

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(csvPath, csv, "utf8");

const outputWorkbook = Workbook.create();
const outputSheet = outputWorkbook.worksheets.add("European master programs");
const endRow = dataRows.length + 1;
outputSheet.getRange("A1:L" + endRow).values = [headers, ...dataRows];
outputSheet.freezePanes.freezeRows(1);
outputSheet.showGridLines = true;
outputSheet.getRange("A1:L1").format = {
  fill: "#0F766E",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  wrapText: true,
  verticalAlignment: "center",
};
outputSheet.getRange("A2:L" + endRow).format = {
  font: { name: "Arial", size: 10, color: "#1F2937" },
  verticalAlignment: "center",
};
outputSheet.getRange("A1:L" + endRow).format.borders = {
  insideHorizontal: { style: "thin", color: "#E5E7EB" },
  bottom: { style: "thin", color: "#CBD5E1" },
};
outputSheet.getRange("L2:L" + endRow).format.numberFormat = "0";
const widths = {
  A: 25,
  B: 34,
  C: 54,
  D: 14,
  E: 20,
  F: 16,
  G: 28,
  H: 23,
  I: 20,
  J: 14,
  K: 68,
  L: 12,
};
for (const [column, width] of Object.entries(widths)) {
  outputSheet.getRange(column + "1:" + column + endRow).format.columnWidth =
    width;
}
outputSheet.getRange("A1:L1").format.rowHeight = 28;
const table = outputSheet.tables.add("A1:L" + endRow, true, "EuropeanMasterPrograms");
table.style = "TableStyleMedium2";
table.showFilterButton = true;

const exported = await SpreadsheetFile.exportXlsx(outputWorkbook);
await exported.save(xlsxPath);

const countsByCountry = Object.fromEntries(
  [...new Set(deduped.map((row) => row.Country))].map((country) => [
    country,
    deduped.filter((row) => row.Country === country).length,
  ]),
);
const universitiesByCountry = Object.fromEntries(
  [...new Set(deduped.map((row) => row.Country))].map((country) => [
    country,
    new Set(
      deduped
        .filter((row) => row.Country === country)
        .map((row) => row.University),
    ).size,
  ]),
);
const summary = {
  generatedAt: new Date().toISOString(),
  verifiedDate,
  qsSourceUrl,
  sourceUrls: Object.fromEntries(
    Object.entries(sources).map(([country, source]) => [
      country,
      source.url,
    ]),
  ),
  rowCount: deduped.length,
  universityCount: new Set(deduped.map((row) => row.University)).size,
  countryCount: new Set(deduped.map((row) => row.Country)).size,
  countsBySource: Object.fromEntries(
    Object.entries(sourceCounts).sort(([a], [b]) => a.localeCompare(b)),
  ),
  countsByCountry,
  universitiesByCountry,
  skippedBySource,
  qsRankingsContain2026: deduped.some((row) =>
    Object.values(row).some((value) => String(value).includes("(2026)")),
  ),
  outputCsv: csvPath,
  outputXlsx: xlsxPath,
};
await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

console.log(JSON.stringify(summary, null, 2));
