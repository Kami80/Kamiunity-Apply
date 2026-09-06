import { db } from "./db.js";
import { CATALOG_SOURCE_SETTING_KEY, DEFAULT_CATALOG_SOURCE, STARTER_CATALOG } from "./catalog-data.js";
import { applicationFromProgram, cleanProgram, ids, STATUS_OPTIONS } from "./workflow.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function blobToRecord(document) {
  if (!document.blob) return { ...document, blob: null };
  const bytes = new Uint8Array(await document.blob.arrayBuffer());
  return {
    ...document,
    blob: {
      type: document.blob.type || document.type || "application/octet-stream",
      data: bytesToBase64(bytes),
    },
  };
}

function recordToBlob(document) {
  if (!document.blob?.data) return { ...document, blob: null };
  return {
    ...document,
    blob: new Blob([base64ToBytes(document.blob.data)], {
      type: document.blob.type || document.type || "application/octet-stream",
    }),
  };
}

async function deriveKey(password, salt, usages) {
  const source = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function createEncryptedBackup(data, password) {
  const documents = await Promise.all(data.documents.map(blobToRecord));
  const payload = JSON.stringify({
    format: "apply-2027-data",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { ...data, documents },
  });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(payload)),
  );
  const envelope = {
    format: "apply-2027-encrypted-backup",
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: 210000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
  return new Blob([JSON.stringify(envelope)], { type: "application/json" });
}

export async function exportEncryptedBackup(data, password) {
  downloadBlob(
    await createEncryptedBackup(data, password),
    `kamiunity-backup-${new Date().toISOString().slice(0, 10)}.applyvault`,
  );
}

export async function readEncryptedBackup(file, password) {
  const envelope = JSON.parse(await file.text());
  if (envelope.format !== "apply-2027-encrypted-backup") {
    throw new Error("This is not a supported Kamiunity encrypted backup.");
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const key = await deriveKey(password, salt, ["decrypt"]);
  let cleartext;
  try {
    cleartext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    throw new Error("The passphrase is incorrect or the backup is damaged.");
  }
  const payload = JSON.parse(decoder.decode(cleartext));
  if (payload.format !== "apply-2027-data" || !payload.data) {
    throw new Error("The backup content is not supported.");
  }
  return {
    ...payload.data,
    documents: (payload.data.documents || []).map(recordToBlob),
  };
}

export async function restoreBackup(data) {
  await db.transaction(
    "rw",
    db.programs,
    db.applications,
    db.tasks,
    db.documents,
    db.catalogPrograms,
    db.settings,
    async () => {
      await Promise.all([
        db.programs.clear(),
        db.applications.clear(),
        db.tasks.clear(),
        db.documents.clear(),
        db.catalogPrograms.clear(),
      ]);
      if (data.programs?.length) await db.programs.bulkAdd(data.programs);
      if (data.applications?.length) await db.applications.bulkAdd(data.applications);
      if (data.tasks?.length) await db.tasks.bulkAdd(data.tasks.map((task) => ({ ...task, applicationIds: task.applicationIds ?? (task.applicationId ? [task.applicationId] : []) })));
      if (data.documents?.length) await db.documents.bulkAdd(data.documents.map((document) => ({ ...document, linkedApplicationIds: document.linkedApplicationIds ?? (data.applications || []).filter((application) => document.linkedProgramIds?.includes(application.programId)).map((application) => application.id) })));
      if (Array.isArray(data.catalogPrograms)) {
        if (data.catalogPrograms.length) await db.catalogPrograms.bulkAdd(data.catalogPrograms);
      } else {
        await db.catalogPrograms.bulkAdd(STARTER_CATALOG.map((program) => ({ ...program })));
      }
      await db.settings.put({ key: "seeded-v1", value: true });
      await db.settings.put({ key: CATALOG_SOURCE_SETTING_KEY, value: data.catalogSource || { ...DEFAULT_CATALOG_SOURCE } });
      await db.settings.put({ key: "last-restore", value: new Date().toISOString() });
    },
  );
}

export async function buildWorkbook(data) {
  const XLSX = await import("xlsx");
  const programsById = new Map(data.programs.map((program) => [program.id, program]));
  const applicationsByProgram = new Map(
    data.applications.map((application) => [application.programId, application]),
  );
  const programRows = data.programs.map((program) => {
    const application = applicationsByProgram.get(program.id);
    return {
      "Program ID": program.id,
      University: program.name,
      Program: program.program,
      Country: program.country,
      Deadline: program.deadline,
      Status: application?.status || "Researching",
      Progress: application?.progress ?? 0,
      Priority: program.priority,
      Tuition: program.tuition,
      Funding: program.funding,
      URL: program.url,
      City: program.city || "",
      Department: program.department || "",
      "Degree level": program.degreeLevel || "",
      Category: program.category || "",
      Intake: program.intake || "",
      Duration: program.duration || "",
      Language: program.language || "",
      "Study mode": program.studyMode || "",
      "Deadline note": program.deadlineNote || "",
      "Application portal": program.portalUrl || "",
      "Admissions email": program.admissionsEmail || "",
      "Application fee": program.applicationFee || "",
      "Funding URL": program.fundingUrl || "",
      Requirements: program.requirements || "",
      "Language requirements": program.languageRequirements || "",
      "Minimum GPA": program.minimumGpa || "",
      "Professor name": program.professors?.[0]?.name || "",
      "Professor email": program.professors?.[0]?.email || "",
      "Professors (JSON)": JSON.stringify(program.professors || []),
      Notes: program.notes,
    };
  });
  const taskRows = data.tasks.map((task) => ({
    "Task ID": task.id,
    Task: task.title,
    "Program IDs": ids(task.programIds).join(", "),
    "Application IDs": ids(task.applicationIds ?? (task.applicationId ? [task.applicationId] : [])).join(", "),
    University: programsById.get(task.programIds?.[0])?.name || "",
    Due: task.dueDate,
    Priority: task.priority,
    Done: task.done ? "Yes" : "No",
    Notes: task.note || "",
    URL: task.url || "",
  }));
  const documentRows = data.documents.map((document) => ({
    "Document ID": document.id,
    Document: document.name,
    Category: document.category,
    Updated: document.updatedAt,
    Version: document.version,
    Size: document.size,
    Readiness: document.status || "Draft",
    Expires: document.expiresAt || "",
    Notes: document.notes || "",
    "File attached": document.blob ? "Yes — use encrypted backup for file contents" : "No",
    "Program IDs": ids(document.linkedProgramIds).join(", "),
    "Application IDs": ids(document.linkedApplicationIds).join(", "),
    "Linked programs": (document.linkedProgramIds || []).map((id) => programsById.get(id)?.name || id).join("; "),
    "Linked applications": ids(document.linkedApplicationIds).map((id) => { const application = data.applications.find((item) => item.id === id); return `${programsById.get(application?.programId)?.name || "Application"} #${id}`; }).join("; "),
  }));

  const applicationRows = data.applications.map((application) => ({
    "Application ID": application.id, "Program ID": application.programId,
    University: programsById.get(application.programId)?.name || "",
    Program: programsById.get(application.programId)?.program || "",
    Status: application.status, Progress: application.progress || 0,
    Priority: application.priority || programsById.get(application.programId)?.priority || "",
    Intake: application.intake || "", Deadline: application.deadline || "",
    "Deadline note": application.deadlineNote || "", "Application portal": application.portalUrl || "",
    "Reference number": application.referenceNumber || "", "Application fee": application.applicationFee || "",
    "Fee status": application.feeStatus || "", Funding: application.funding || "",
    "Submission date": application.submittedAt || "", "Decision date": application.decisionDate || "", Decision: application.decision || "",
    "Admissions email": application.admissionsEmail || "", Requirements: application.requirements || "",
    "Professors (JSON)": JSON.stringify(application.professors || []), Notes: application.notes || "",
    "Document IDs": data.documents.filter((document) => document.linkedApplicationIds?.includes(application.id)).map((document) => document.id).join(", "),
    "Document checklist (JSON)": JSON.stringify(application.documentChecklist || []),
  }));
  const catalogRows = (data.catalogPrograms || []).map((program) => ({
    "Catalog ID": program.catalogId || program.id,
    University: program.name,
    Program: program.program,
    Country: program.country || "",
    City: program.city || "",
    Department: program.department || "",
    "Degree level": program.degreeLevel || "",
    Category: program.category || "",
    Intake: program.intake || "",
    Duration: program.duration || "",
    Language: program.language || "",
    "QS Ranking": program.qsRanking || "",
    "Study mode": program.studyMode || "",
    Deadline: program.deadline || "",
    "Deadline note": program.deadlineNote || "",
    "Program website": program.url || "",
    "Application portal": program.portalUrl || "",
    "Admissions email": program.admissionsEmail || "",
    Tuition: program.tuition || "",
    "Application fee": program.applicationFee || "",
    Funding: program.funding || "",
    "Funding website": program.fundingUrl || "",
    Requirements: program.requirements || "",
    "Language requirements": program.languageRequirements || "",
    "Minimum GPA": program.minimumGpa || "",
    "Professor name": program.professors?.[0]?.name || "",
    "Professor email": program.professors?.[0]?.email || "",
    "Professors (JSON)": JSON.stringify(program.professors || []),
    Notes: program.notes || "",
    Source: program.catalogSource || data.catalogSource?.label || "",
    "Source URL": program.catalogSourceUrl || data.catalogSource?.url || "",
    "Last verified": program.catalogLastVerified || "",
  }));
  const contactRows = [
    ...data.programs.flatMap((program) => (program.professors || []).map((professor) => ({ Scope: "Program", "Record ID": program.id, University: program.name, Program: program.program, ...professor }))),
    ...data.applications.flatMap((application) => (application.professors || []).map((professor) => ({ Scope: "Application", "Record ID": application.id, University: programsById.get(application.programId)?.name || "", Program: programsById.get(application.programId)?.program || "", ...professor }))),
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(programRows), "Programs");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(applicationRows), "Applications");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(contactRows), "Contacts");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(taskRows), "Tasks");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(documentRows), "Documents");
  if (catalogRows.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(catalogRows), "Program database");
  return workbook;
}

export async function exportWorkbook(data) {
  const XLSX = await import("xlsx");
  const workbook = await buildWorkbook(data);
  XLSX.writeFile(workbook, `kamiunity-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function normalizedRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]),
  );
}

function getValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function normalizeDate(value, XLSX) {
  if (value === "" || value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts) {
      return `${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString().slice(0, 10);
}

function importProfessors(row) {
  const json = getValue(row, ["professors (json)"]);
  if (json) {
    try { const contacts = JSON.parse(json); if (Array.isArray(contacts)) return contacts; } catch { /* Fall back to the spreadsheet's contact columns. */ }
  }
  const name = String(getValue(row, ["professor name", "professor", "supervisor"])).trim();
  const email = String(getValue(row, ["professor email", "supervisor email"])).trim();
  return name || email ? [{ name, email, url: String(getValue(row, ["professor website"])), lab: String(getValue(row, ["lab"])), notes: "", status: "Not contacted" }] : [];
}

export async function importWorkbook(file) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = workbook.Sheets.Programs || workbook.Sheets["Program database"] || workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  const mapped = rows
    .map(normalizedRow)
    .map((row) => ({
      name: String(getValue(row, ["university", "institution", "school", "name"])).trim(),
      program: String(getValue(row, ["program", "course", "degree", "major"])).trim(),
      country: String(getValue(row, ["country", "location"])).trim(),
      deadline: normalizeDate(getValue(row, ["deadline", "due date", "due"]), XLSX),
      status: String(getValue(row, ["status", "stage"]) || "Researching").trim(),
      priority: String(getValue(row, ["priority"]) || "Medium").trim(),
      tuition: String(getValue(row, ["tuition", "fee", "cost"])).trim(),
      funding: String(getValue(row, ["funding", "scholarship"])).trim(),
      url: String(getValue(row, ["program url", "program website", "url", "link", "website"])).trim(),
      city: String(getValue(row, ["city", "campus"])),
      department: String(getValue(row, ["department"])),
      category: String(getValue(row, ["category", "study area", "field", "discipline"])),
      degreeLevel: String(getValue(row, ["degree level"])),
      intake: String(getValue(row, ["intake", "term"])),
      duration: String(getValue(row, ["duration"])),
      language: String(getValue(row, ["language", "teaching language"])),
      studyMode: String(getValue(row, ["study mode"])),
      deadlineNote: String(getValue(row, ["deadline note", "time zone"])),
      portalUrl: String(getValue(row, ["application portal", "portal url"])),
      admissionsEmail: String(getValue(row, ["admissions email"])),
      applicationFee: String(getValue(row, ["application fee"])),
      fundingUrl: String(getValue(row, ["funding url", "funding website"])),
      requirements: String(getValue(row, ["requirements"])),
      languageRequirements: String(getValue(row, ["language requirements"])),
      minimumGpa: String(getValue(row, ["minimum gpa"])),
      professors: importProfessors(row),
      notes: String(getValue(row, ["notes", "note"])).trim(),
      catalogId: String(getValue(row, ["catalog id"])).trim(),
      catalogSource: String(getValue(row, ["source", "source label"])).trim(),
      catalogSourceUrl: String(getValue(row, ["source url", "source website"])).trim(),
      catalogLastVerified: String(getValue(row, ["last verified", "verified date"])).trim(),
    }))
    .filter((row) => row.name && row.program);

  if (!mapped.length) {
    throw new Error("No rows with both a university and program were found.");
  }

  await db.transaction("rw", db.programs, db.applications, async () => {
    for (const row of mapped) {
      const program = cleanProgram(row);
      const programId = await db.programs.add(program);
      await db.applications.add({
        ...applicationFromProgram({ ...program, id: programId }),
        status: STATUS_OPTIONS.includes(row.status) ? row.status : "Researching",
      });
    }
  });

  return mapped.length;
}

export function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
