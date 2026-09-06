import { db, toIsoDate } from "./db.js";
import { inferProgramCategory, normalizeIntake } from "./program-taxonomy.js";

export const STATUS_OPTIONS = ["Researching", "Preparing", "Submitted", "Offer", "Decision"];
export const PRIORITIES = ["Low", "Medium", "High"];
export const DOCUMENT_CATEGORIES = ["Academic", "Essays", "Identity", "Recommendations", "Test scores", "Financial", "Other"];
export const PROGRAM_TEXT_FIELDS = ["name", "program", "country", "city", "department", "category", "degreeLevel", "intake", "duration", "language", "studyMode", "qsRanking", "deadline", "deadlineNote", "priority", "url", "portalUrl", "admissionsEmail", "tuition", "applicationFee", "funding", "fundingUrl", "requirements", "languageRequirements", "minimumGpa", "notes", "catalogId", "catalogSource", "catalogSourceUrl", "catalogLastVerified"];
export const APPLICATION_TEXT_FIELDS = ["deadline", "deadlineNote", "intake", "priority", "portalUrl", "applicationFee", "funding", "requirements", "admissionsEmail", "status", "referenceNumber", "feeStatus", "submittedAt", "decisionDate", "decision", "notes"];

export function ids(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
}

export function safeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    return ["http:", "https:"].includes(url.protocol) && url.hostname ? url.href : "";
  } catch { return ""; }
}

function validateUrl(value, label) {
  if (!value) return "";
  const result = safeUrl(value);
  if (!result) throw new Error(`${label} must be a valid http or https link.`);
  return result;
}

function validateEmail(value) {
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Enter a valid email address.");
  return value;
}

function validateDate(value, label, required = false) {
  if (!value && !required) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Enter a valid ${label.toLowerCase()}.`);
  return value;
}

function textFields(record, fields) {
  return Object.fromEntries(fields.map((key) => [key, String(record[key] ?? "").trim()]));
}

export function cleanProfessors(professors = []) {
  return (Array.isArray(professors) ? professors : []).map((professor) => {
    const contact = textFields(professor, ["name", "email", "lab", "url", "notes", "status"]);
    for (const key of ["followUpDate", "lastContactDate"]) {
      if (professor[key] !== undefined) contact[key] = validateDate(String(professor[key] || ""), key === "followUpDate" ? "Follow-up date" : "Last contacted date");
    }
    contact.email = validateEmail(contact.email);
    contact.url = validateUrl(contact.url, "Professor website");
    return contact;
  }).filter((contact) => contact.name || contact.email || contact.lab || contact.url || contact.notes);
}

export function cleanProgram(record) {
  const result = textFields(record, PROGRAM_TEXT_FIELDS);
  if (!result.name || !result.program) throw new Error("Add both a university and a program name.");
  result.intake = normalizeIntake(result.intake);
  result.category = result.category || inferProgramCategory(result);
  for (const key of ["url", "portalUrl", "fundingUrl"]) result[key] = validateUrl(result[key], "Website");
  result.admissionsEmail = validateEmail(result.admissionsEmail);
  result.deadline = validateDate(result.deadline, "Deadline");
  result.priority = PRIORITIES.includes(result.priority) ? result.priority : "Medium";
  result.professors = cleanProfessors(record.professors);
  return result;
}

export function programDocuments(data, programId) {
  return data.documents.filter((document) => document.linkedProgramIds?.includes(programId));
}

export function applicationDocuments(data, application) {
  return data.documents.filter((document) => (document.linkedApplicationIds ?? data.applications
    .filter((item) => document.linkedProgramIds?.includes(item.programId)).map((item) => item.id)).includes(application.id));
}

export function applicationFromProgram(program) {
  return {
    ...textFields(program, ["deadline", "deadlineNote", "intake", "priority", "portalUrl", "applicationFee", "funding", "requirements", "admissionsEmail"]),
    programId: program.id,
    priority: program.priority || "Medium",
    status: "Researching", progress: 0, referenceNumber: "", feeStatus: "Not paid",
    submittedAt: "", decisionDate: "", decision: "", notes: "",
    professors: (program.professors || []).map((professor) => ({ ...professor })),
  };
}

async function requireRecords(table, selectedIds, label) {
  const keys = ids(selectedIds);
  const records = await table.bulkGet(keys);
  if (records.some((record) => !record)) throw new Error(`A selected ${label} was removed. Reopen this form and try again.`);
  return keys;
}

async function updateDocumentLinks(field, recordId, selectedIds) {
  const selected = new Set(await requireRecords(db.documents, selectedIds, "document"));
  await db.documents.toCollection().modify((document) => {
    const links = new Set(ids(document[field]));
    if (selected.has(document.id)) links.add(recordId);
    else links.delete(recordId);
    document[field] = [...links];
  });
}

export async function saveProgram(record, documentIds) {
  const values = cleanProgram(record);
  return db.transaction("rw", db.programs, db.documents, async () => {
    if (record.id) await requireRecords(db.programs, [record.id], "program");
    const id = record.id || await db.programs.add(values);
    if (record.id) await db.programs.update(id, values);
    await updateDocumentLinks("linkedProgramIds", id, documentIds);
    return id;
  });
}

export async function saveApplication(record, documentIds, newProgram) {
  const values = textFields(record, APPLICATION_TEXT_FIELDS);
  values.intake = normalizeIntake(values.intake);
  values.portalUrl = validateUrl(values.portalUrl, "Application portal");
  values.admissionsEmail = validateEmail(values.admissionsEmail);
  values.professors = cleanProfessors(record.professors);
  values.priority = PRIORITIES.includes(values.priority) ? values.priority : "Medium";
  for (const key of ["deadline", "submittedAt", "decisionDate"]) values[key] = validateDate(values[key], "Date");
  values.progress = Number(record.progress || 0);
  if (!Number.isFinite(values.progress) || values.progress < 0 || values.progress > 100) throw new Error("Progress must be between 0 and 100.");
  if (!STATUS_OPTIONS.includes(values.status)) throw new Error("Choose an application status.");
  const programValues = newProgram ? cleanProgram(newProgram) : null;
  return db.transaction("rw", db.programs, db.applications, db.documents, async () => {
    if (record.id) await requireRecords(db.applications, [record.id], "application");
    const programId = programValues ? await db.programs.add(programValues) : Number(record.programId);
    if (!Number.isSafeInteger(programId) || programId < 1) throw new Error("Choose a saved program or create a new one.");
    await requireRecords(db.programs, [programId], "program");
    const id = record.id || await db.applications.add({ ...values, programId });
    if (record.id) await db.applications.update(id, { ...values, programId });
    await updateDocumentLinks("linkedApplicationIds", id, documentIds);
    if (programValues) await updateDocumentLinks("linkedProgramIds", programId, documentIds);
    return id;
  });
}

export async function removeApplication(applicationId) {
  const id = Number(applicationId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Choose an application to remove.");
  return db.transaction("rw", db.applications, db.tasks, db.documents, async () => {
    const application = await db.applications.get(id);
    if (!application) throw new Error("The application could not be found.");
    const applications = await db.applications.toArray();
    const programByApplication = new Map(applications.map((item) => [item.id, item.programId]));

    await db.tasks.toCollection().modify((task) => {
      const linkedApplicationIds = ids(task.applicationIds ?? (task.applicationId ? [task.applicationId] : []));
      if (!linkedApplicationIds.includes(id)) return;
      const remainingApplicationIds = linkedApplicationIds.filter((value) => value !== id);
      const additionalProgramIds = Array.isArray(task.additionalProgramIds)
        ? task.additionalProgramIds
        : (task.programIds || []).filter((value) => Number(value) !== Number(application.programId));
      task.applicationIds = remainingApplicationIds;
      task.applicationId = remainingApplicationIds[0] ?? null;
      task.additionalProgramIds = ids(additionalProgramIds);
      task.programIds = ids([
        ...additionalProgramIds,
        ...remainingApplicationIds.map((applicationKey) => programByApplication.get(applicationKey)),
      ]);
    });

    await db.documents.toCollection().modify((document) => {
      const linkedApplicationIds = document.linkedApplicationIds ?? applications
        .filter((item) => document.linkedProgramIds?.includes(item.programId))
        .map((item) => item.id);
      document.linkedApplicationIds = ids(linkedApplicationIds).filter((value) => value !== id);
    });

    await db.applications.delete(id);
    return id;
  });
}

export async function saveDocument(record, files = []) {
  if (!record.id && !files.length) throw new Error("Choose at least one file to add.");
  if (record.id && !String(record.name || "").trim()) throw new Error("Give the document a name.");
  return db.transaction("rw", db.documents, db.programs, db.applications, async () => {
    const linkedProgramIds = await requireRecords(db.programs, record.linkedProgramIds, "program");
    const linkedApplicationIds = await requireRecords(db.applications, record.linkedApplicationIds, "application");
    const values = {
      ...textFields(record, ["category", "version", "status", "expiresAt", "notes"]),
      linkedProgramIds, linkedApplicationIds, updatedAt: toIsoDate(new Date()),
    };
    values.expiresAt = validateDate(values.expiresAt, "Expiry date");
    const attachment = (file) => ({ blob: file, size: file.size, type: file.type || "application/octet-stream", isExample: false });
    if (record.id) {
      await requireRecords(db.documents, [record.id], "document");
      await db.documents.update(record.id, { ...values, name: record.name.trim(), ...(files[0] ? attachment(files[0]) : {}) });
      return record.id;
    }
    const added = [];
    for (const file of files) added.push(await db.documents.add({ ...values, name: files.length === 1 && record.name?.trim() ? record.name.trim() : file.name, ...attachment(file) }));
    return added[0];
  });
}

export async function saveTask(record) {
  const title = String(record.title || "").trim();
  if (!title) throw new Error("Give the task a name.");
  return db.transaction("rw", db.tasks, db.programs, db.applications, async () => {
    const applicationIds = await requireRecords(db.applications, record.applicationIds, "application");
    const programIds = await requireRecords(db.programs, record.programIds, "program");
    const applications = await db.applications.bulkGet(applicationIds);
    const values = { title, dueDate: validateDate(record.dueDate, "Due date", true), priority: record.priority, done: Boolean(record.done), note: String(record.note || "").trim(), url: validateUrl(record.url, "Task link"), applicationIds, applicationId: applicationIds[0] ?? null, additionalProgramIds: programIds, programIds: ids([...programIds, ...applications.map((application) => application.programId)]) };
    if (record.id) { await requireRecords(db.tasks, [record.id], "task"); await db.tasks.update(record.id, values); return record.id; }
    return db.tasks.add(values);
  });
}

export function deadlineEvents(data) {
  const programs = data.programs.filter((program) => !data.applications.some((application) => application.programId === program.id));
  return [
    ...data.applications.map((application) => ({ id: `application-${application.id}`, deadline: application.deadline, program: data.programs.find((program) => program.id === application.programId), application })),
    ...programs.map((program) => ({ id: `program-${program.id}`, deadline: program.deadline, program })),
  ].filter((event) => event.deadline && event.program).sort((a, b) => a.deadline.localeCompare(b.deadline));
}

export function documentLabel(document) {
  const name = document.name.toLowerCase();
  if (/\bcv\b|résumé|resume/.test(name)) return "Academic CV";
  if (/transcript/.test(name)) return "Official transcript";
  if (/statement|purpose|motivation/.test(name)) return "Statement of purpose";
  if (/passport/.test(name)) return "Passport";
  if (/recommendation|reference letter/.test(name)) return "Recommendation letter";
  if (/ielts|toefl|test score/.test(name)) return "Language test scores";
  return document.name.replace(/\.[^.]+$/, "");
}

export function documentReadiness(document, today = toIsoDate(new Date())) {
  if (!document) return "Needed";
  if (!document.blob) return document.isExample ? "Example" : "No file";
  if (document.expiresAt && document.expiresAt < today) return "Expired";
  return document.status || "Draft";
}

export function applicationChecklist(data, application) {
  const linked = applicationDocuments(data, application);
  const rows = (application.documentChecklist || []).map((row) => {
    const document = linked.find((item) => item.id === row.documentId);
    return { ...row, documentId: document?.id ?? null, document };
  });
  for (const document of linked) {
    if (!rows.some((row) => row.documentId === document.id)) rows.push({ id: `document-${document.id}`, label: documentLabel(document), documentId: document.id, document });
  }
  return rows;
}

export async function saveApplicationChecklist(applicationId, rows) {
  const checklist = rows.map((row) => ({ id: String(row.id), label: String(row.label || "").trim(), documentId: Number(row.documentId) || null }));
  if (checklist.some((row) => !row.label)) throw new Error("Give each document requirement a name.");
  if (checklist.some((row) => row.documentId !== null && (!Number.isSafeInteger(row.documentId) || row.documentId < 1))) throw new Error("Choose a document from your vault.");
  return db.transaction("rw", db.applications, db.documents, async () => {
    await requireRecords(db.applications, [applicationId], "application");
    await updateDocumentLinks("linkedApplicationIds", applicationId, ids(checklist.map((row) => row.documentId)));
    await db.applications.update(applicationId, { documentChecklist: checklist });
  });
}
