import { addDaysIso, db } from "./db.js";

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

export async function exportEncryptedBackup(data, password) {
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
  downloadBlob(
    new Blob([JSON.stringify(envelope)], { type: "application/json" }),
    `apply-2027-backup-${new Date().toISOString().slice(0, 10)}.applyvault`,
  );
}

export async function readEncryptedBackup(file, password) {
  const envelope = JSON.parse(await file.text());
  if (envelope.format !== "apply-2027-encrypted-backup") {
    throw new Error("This is not an Apply 2027 encrypted backup.");
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
    db.settings,
    async () => {
      await Promise.all([
        db.programs.clear(),
        db.applications.clear(),
        db.tasks.clear(),
        db.documents.clear(),
      ]);
      if (data.programs?.length) await db.programs.bulkAdd(data.programs);
      if (data.applications?.length) await db.applications.bulkAdd(data.applications);
      if (data.tasks?.length) await db.tasks.bulkAdd(data.tasks);
      if (data.documents?.length) await db.documents.bulkAdd(data.documents);
      await db.settings.put({ key: "seeded-v1", value: true });
      await db.settings.put({ key: "last-restore", value: new Date().toISOString() });
    },
  );
}

export async function exportWorkbook(data) {
  const XLSX = await import("xlsx");
  const programsById = new Map(data.programs.map((program) => [program.id, program]));
  const applicationsByProgram = new Map(
    data.applications.map((application) => [application.programId, application]),
  );
  const programRows = data.programs.map((program) => {
    const application = applicationsByProgram.get(program.id);
    return {
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
      Notes: program.notes,
    };
  });
  const taskRows = data.tasks.map((task) => ({
    Task: task.title,
    University: programsById.get(task.programIds?.[0])?.name || "",
    Due: task.dueDate,
    Priority: task.priority,
    Done: task.done ? "Yes" : "No",
    Notes: task.note || "",
  }));
  const documentRows = data.documents.map((document) => ({
    Document: document.name,
    Category: document.category,
    Updated: document.updatedAt,
    Version: document.version,
    Size: document.size,
    "Linked applications": document.linkedProgramIds?.length || 0,
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(programRows), "Programs");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(taskRows), "Tasks");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(documentRows), "Documents");
  XLSX.writeFile(workbook, `apply-2027-${new Date().toISOString().slice(0, 10)}.xlsx`);
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
  return Number.isNaN(parsed.valueOf()) ? addDaysIso(90) : parsed.toISOString().slice(0, 10);
}

export async function importWorkbook(file) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
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
      url: String(getValue(row, ["url", "link", "website"])).trim(),
      notes: String(getValue(row, ["notes", "note"])).trim(),
    }))
    .filter((row) => row.name && row.program);

  if (!mapped.length) {
    throw new Error("No rows with both a university and program were found.");
  }

  await db.transaction("rw", db.programs, db.applications, async () => {
    for (const row of mapped) {
      const programId = await db.programs.add({
        name: row.name,
        program: row.program,
        country: row.country || "Not specified",
        deadline: row.deadline,
        tuition: row.tuition || "Not added",
        funding: row.funding || "Not added",
        priority: ["High", "Medium", "Low"].includes(row.priority) ? row.priority : "Medium",
        url: row.url,
        notes: row.notes,
      });
      const supportedStatus = ["Researching", "Preparing", "Submitted", "Offer", "Decision"];
      await db.applications.add({
        programId,
        status: supportedStatus.includes(row.status) ? row.status : "Researching",
        deadline: row.deadline,
        progress: 0,
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
