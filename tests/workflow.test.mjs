import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import Dexie from "dexie";
import * as XLSX from "xlsx";
import { db, readAllData, seedDatabase } from "../src/db.js";
import { applicationChecklist, applicationDocuments, applicationFromProgram, cleanProgram, deadlineEvents, documentReadiness, programDocuments, safeUrl, saveApplication, saveApplicationChecklist, saveDocument, saveProgram, saveTask } from "../src/workflow.js";
import { buildWorkbook, createEncryptedBackup, importWorkbook, readEncryptedBackup, restoreBackup } from "../src/backup.js";

beforeEach(async () => { await db.delete(); await db.open(); });
after(async () => { await db.delete(); });

async function fixture() {
  await db.programs.bulkAdd([
    { id: 10, name: "Example University", program: "MSc Computer Science", country: "Canada", deadline: "2027-01-15", priority: "High", url: "https://example.edu/program", portalUrl: "https://example.edu/apply", intake: "Fall 2027", applicationFee: "CAD 100", funding: "Research award", requirements: "Transcript and CV", professors: [{ name: "Dr Research", email: "research@example.edu", lab: "Systems", url: "https://example.edu/lab", notes: "Research fit", status: "Contacted" }] },
    { id: 20, name: "Second University", program: "PhD AI", country: "Germany", deadline: "2027-02-20", priority: "Medium" },
  ]);
  const program = await db.programs.get(10);
  await db.applications.bulkAdd([{ ...applicationFromProgram(program), id: 99 }, { ...applicationFromProgram(await db.programs.get(20)), id: 100 }]);
  await db.documents.bulkAdd([
    { id: 7, name: "Transcript.pdf", category: "Academic", version: "1.0", linkedProgramIds: [10, 20], linkedApplicationIds: [99, 100], blob: new Blob(["transcript bytes"], { type: "application/pdf" }), type: "application/pdf", size: 16, status: "Ready" },
    { id: 8, name: "CV.pdf", category: "Academic", version: "2.0", linkedProgramIds: [10], linkedApplicationIds: [99], blob: null, isExample: true },
    { id: 9, name: "Portfolio.pdf", category: "Other", version: "1.0", linkedProgramIds: [], linkedApplicationIds: [], blob: null },
  ]);
  return readAllData();
}

test("version 1 migration maps program links to application IDs and keeps intentionally empty assignments", async () => {
  await db.delete();
  const legacy = new Dexie("apply-2027");
  legacy.version(1).stores({ programs: "++id,name,country,deadline", applications: "++id,programId,status,deadline", tasks: "++id,dueDate,done,applicationId,priority", documents: "++id,name,category,updatedAt", settings: "key" });
  await legacy.open();
  await legacy.applications.bulkAdd([{ id: 99, programId: 10 }, { id: 100, programId: 20 }]);
  await legacy.documents.bulkAdd([{ id: 1, linkedProgramIds: [10] }, { id: 2, linkedProgramIds: [10], linkedApplicationIds: [] }]);
  await legacy.tasks.add({ id: 1, applicationId: 99, programIds: [10, 20] });
  legacy.close();
  await db.open();
  assert.deepEqual((await db.documents.get(1)).linkedApplicationIds, [99]);
  assert.deepEqual((await db.documents.get(2)).linkedApplicationIds, []);
  assert.deepEqual((await db.tasks.get(1)).applicationIds, [99]);
});

test("concurrent initialization creates one starter workspace and preserves existing records", async () => {
  await Promise.all([seedDatabase(), seedDatabase()]);
  assert.equal(await db.programs.count(), 4);
  assert.equal(await db.applications.count(), 4);
  assert.deepEqual((await db.documents.get(1)).linkedApplicationIds, [1, 2, 3]);
  await db.programs.update(1, { notes: "My edits" });
  await seedDatabase();
  assert.equal((await db.programs.get(1)).notes, "My edits");
});

test("starting from a saved program copies details and multiple documents without duplicating the program", async () => {
  const data = await fixture();
  const program = data.programs[0];
  const id = await saveApplication({ ...applicationFromProgram(program), referenceNumber: "APP-27", intake: "Spring 2028" }, programDocuments(data, program.id).map((document) => document.id));
  assert.equal(await db.programs.count(), 2);
  const application = await db.applications.get(id);
  assert.equal(application.programId, 10);
  assert.equal(application.portalUrl, program.portalUrl);
  assert.equal(application.referenceNumber, "APP-27");
  assert.equal(application.applicationFee, "CAD 100");
  assert.equal(application.professors[0].email, "research@example.edu");
  assert.deepEqual(applicationDocuments(await readAllData(), application).map((document) => document.id), [7, 8]);
  await saveProgram({ ...program, deadline: "2028-04-05", professors: [] }, [7]);
  assert.equal((await db.applications.get(id)).deadline, "2027-01-15");
  assert.equal((await db.applications.get(id)).professors.length, 1);
  assert.deepEqual((await db.documents.get(8)).linkedApplicationIds, [99, id]);
});

test("editing application documents keeps other applications and program selections intact", async () => {
  await fixture();
  await saveApplication({ ...await db.applications.get(99), status: "Submitted", submittedAt: "2026-12-15", progress: 100 }, [9]);
  assert.deepEqual((await db.documents.get(7)).linkedApplicationIds, [100]);
  assert.deepEqual((await db.documents.get(7)).linkedProgramIds, [10, 20]);
  assert.deepEqual((await db.documents.get(8)).linkedApplicationIds, []);
  assert.deepEqual((await db.documents.get(9)).linkedApplicationIds, [99]);
  assert.equal((await db.applications.get(99)).status, "Submitted");
});

test("editing a document changes assignments from the document side and retains its file", async () => {
  await fixture();
  await saveDocument({ ...await db.documents.get(7), linkedProgramIds: [20], linkedApplicationIds: [99], notes: "Certified copy", expiresAt: "2028-05-01" });
  const document = await db.documents.get(7);
  assert.deepEqual(document.linkedProgramIds, [20]);
  assert.deepEqual(document.linkedApplicationIds, [99]);
  assert.equal(await document.blob.text(), "transcript bytes");
  const data = await readAllData();
  assert.equal(programDocuments(data, 10).some((item) => item.id === 7), false);
  assert.equal(applicationDocuments(data, data.applications.find((item) => item.id === 100)).length, 0);
});

test("failed links roll back both program and application creation", async () => {
  await fixture();
  await assert.rejects(saveApplication({ ...applicationFromProgram({}), status: "Preparing" }, [999], { name: "Third University", program: "MSc Design", deadline: "" }), /selected document was removed/);
  assert.equal(await db.programs.count(), 2);
  assert.equal(await db.applications.count(), 2);
  await assert.rejects(saveProgram({ ...await db.programs.get(10), name: "Must roll back" }, [999]), /selected document was removed/);
  assert.equal((await db.programs.get(10)).name, "Example University");
  assert.deepEqual((await db.documents.get(7)).linkedProgramIds, [10, 20]);
});

test("bulk uploads share selected assignments and reject stale targets without partial files", async () => {
  await fixture();
  const files = [new File(["one"], "one.pdf", { type: "application/pdf" }), new File(["two"], "two.pdf", { type: "application/pdf" })];
  const values = { category: "Academic", version: "1.0", status: "Ready", linkedProgramIds: [10, 20], linkedApplicationIds: [99, 100] };
  await saveDocument(values, files);
  const added = (await db.documents.toArray()).filter((document) => document.id > 9);
  assert.equal(added.length, 2);
  assert.deepEqual(added.map((document) => document.name), ["one.pdf", "two.pdf"]);
  for (const document of added) assert.deepEqual(document.linkedApplicationIds, [99, 100]);
  await assert.rejects(saveDocument({ ...values, linkedApplicationIds: [404] }, files), /selected application was removed/);
  assert.equal(await db.documents.count(), 5);
});

test("replacing an example file preserves assignments and stores new bytes", async () => {
  await fixture();
  await saveDocument({ ...await db.documents.get(8), version: "3.0", status: "Ready" }, [new File(["new CV content"], "CV.pdf", { type: "application/pdf" })]);
  const document = await db.documents.get(8);
  assert.equal(document.isExample, false);
  assert.equal(document.version, "3.0");
  assert.equal(await document.blob.text(), "new CV content");
  assert.deepEqual(document.linkedApplicationIds, [99]);
  assert.deepEqual(document.linkedProgramIds, [10]);
});

test("tasks can support multiple applications and become general when unlinked", async () => {
  await fixture();
  const id = await saveTask({ title: "Request recommendation", applicationIds: [99, 100], programIds: [], dueDate: "2026-11-01", priority: "High", url: "example.edu/request" });
  let task = await db.tasks.get(id);
  assert.deepEqual(task.applicationIds, [99, 100]);
  assert.deepEqual(task.programIds, [10, 20]);
  assert.equal(task.url, "https://example.edu/request");
  await saveTask({ ...task, title: "Prepare a general recommendation", done: true, applicationIds: [], programIds: [] });
  task = await db.tasks.get(id);
  assert.equal(task.done, true);
  assert.deepEqual(task.programIds, []);
  assert.deepEqual(task.applicationIds, []);
  assert.equal(task.applicationId, null);
});

test("encrypted backups retain contacts, application details, assignments, and file contents", async () => {
  await fixture();
  await saveApplicationChecklist(99, [{ id: "transcript", label: "Transcript", documentId: 7 }, { id: "letter", label: "Recommendation letter", documentId: null }]);
  const original = await readAllData();
  const blob = await createEncryptedBackup(original, "test-passphrase-2027");
  assert.equal((await blob.text()).includes("research@example.edu"), false);
  await assert.rejects(readEncryptedBackup(blob, "wrong-passphrase"), /incorrect or the backup is damaged/);
  const restored = await readEncryptedBackup(blob, "test-passphrase-2027");
  await restoreBackup(restored);
  const actual = await readAllData();
  assert.deepEqual(actual.programs, original.programs);
  assert.deepEqual(actual.applications, original.applications);
  assert.deepEqual(actual.documents[0].linkedApplicationIds, [99, 100]);
  assert.equal(await actual.documents[0].blob.text(), "transcript bytes");
});

test("restoring legacy backups repairs missing assignments but respects explicit empty lists", async () => {
  await restoreBackup({ programs: [{ id: 10, name: "Legacy", program: "MSc" }], applications: [{ id: 99, programId: 10 }], tasks: [{ id: 4, applicationId: 99 }], documents: [{ id: 7, linkedProgramIds: [10] }, { id: 8, linkedProgramIds: [10], linkedApplicationIds: [] }] });
  assert.deepEqual((await db.documents.get(7)).linkedApplicationIds, [99]);
  assert.deepEqual((await db.documents.get(8)).linkedApplicationIds, []);
  assert.deepEqual((await db.tasks.get(4)).applicationIds, [99]);
});

test("Excel exports detailed programs, applications, contacts, and precise document assignments", async () => {
  await fixture();
  await saveApplicationChecklist(99, [{ id: "transcript", label: "Transcript", documentId: 7 }]);
  const data = await readAllData();
  const workbook = await buildWorkbook(data);
  assert.deepEqual(workbook.SheetNames, ["Programs", "Applications", "Contacts", "Tasks", "Documents"]);
  const programs = XLSX.utils.sheet_to_json(workbook.Sheets.Programs);
  const applications = XLSX.utils.sheet_to_json(workbook.Sheets.Applications);
  const documents = XLSX.utils.sheet_to_json(workbook.Sheets.Documents);
  assert.equal(programs[0]["Professor email"], "research@example.edu");
  assert.equal(applications[0]["Application portal"], "https://example.edu/apply");
  assert.deepEqual(JSON.parse(applications[0]["Document checklist (JSON)"]), data.applications[0].documentChecklist);
  assert.equal(documents[0]["Program IDs"], "10, 20");
  assert.equal(documents[0]["Application IDs"], "99, 100");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  assert.equal(await importWorkbook(new Blob([bytes])), 2);
  const copied = (await db.programs.toArray()).find((program) => program.id > 20 && program.name === "Example University");
  assert.deepEqual(copied.professors, data.programs[0].professors);
  assert.equal(copied.portalUrl, data.programs[0].portalUrl);
});

test("CSV import reads professor details and does not invent unknown deadlines", async () => {
  const file = new Blob(['University,Program,Program website,Professor name,Professor email,Application portal,Intake\nExample,MSc Design,example.edu/design,Dr Contact,contact@example.edu,example.edu/apply,Fall 2027']);
  assert.equal(await importWorkbook(file), 1);
  const data = await readAllData();
  assert.equal(data.programs[0].deadline, "");
  assert.equal(data.programs[0].url, "https://example.edu/design");
  assert.equal(data.applications[0].professors[0].email, "contact@example.edu");
  assert.equal(data.applications[0].intake, "Fall 2027");
});

test("deadline summaries use application-specific dates and omit unscheduled records", async () => {
  await fixture();
  await db.applications.update(99, { deadline: "2027-04-01" });
  await db.programs.add({ id: 30, name: "Unscheduled", program: "MSc", deadline: "" });
  const events = deadlineEvents(await readAllData());
  assert.deepEqual(events.map((event) => event.deadline), ["2027-02-20", "2027-04-01"]);
  assert.equal(events[1].application.id, 99);
});

test("validation rejects unsafe links, invalid contacts, dates, progress, and missing program selection", async () => {
  await fixture();
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///private"]) assert.equal(safeUrl(url), "");
  assert.throws(() => cleanProgram({ name: "Example", program: "MSc", professors: [{ email: "invalid" }] }), /valid email/);
  assert.throws(() => cleanProgram({ name: "Example", program: "MSc", deadline: "2027-02-31" }), /valid deadline/);
  await assert.rejects(saveApplication({ ...applicationFromProgram({ id: 10 }), progress: 101 }, []), /between 0 and 100/);
  await assert.rejects(saveApplication({ ...applicationFromProgram({}), programId: -1 }, []), /Choose a saved program/);
  assert.equal(await db.applications.count(), 2);
});

test("application checklists assign shared files without changing other applications or program links", async () => {
  await fixture();
  await saveApplicationChecklist(99, [
    { id: "cv", label: "  Academic CV  ", documentId: 8 },
    { id: "letter", label: "Recommendation letter", documentId: null },
  ]);
  const transcript = await db.documents.get(7);
  assert.deepEqual(transcript.linkedApplicationIds, [100]);
  assert.deepEqual(transcript.linkedProgramIds, [10, 20]);
  assert.equal(await transcript.blob.text(), "transcript bytes");
  const data = await readAllData();
  const rows = applicationChecklist(data, data.applications[0]);
  assert.deepEqual(rows.map((row) => [row.label, row.documentId, documentReadiness(row.document)]), [
    ["Academic CV", 8, "Example"], ["Recommendation letter", null, "Needed"],
  ]);
});

test("stale checklist files roll back, while external unlinking retains the requirement", async () => {
  await fixture();
  await saveApplicationChecklist(99, [{ id: "transcript", label: "Transcript", documentId: 7 }]);
  await assert.rejects(saveApplicationChecklist(99, [{ id: "stale", label: "Transcript", documentId: 999 }]), /selected document was removed/);
  assert.deepEqual((await db.documents.get(7)).linkedApplicationIds, [99, 100]);
  assert.equal((await db.applications.get(99)).documentChecklist[0].documentId, 7);
  await saveDocument({ ...await db.documents.get(7), linkedApplicationIds: [100] });
  const data = await readAllData();
  const rows = applicationChecklist(data, data.applications[0]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Transcript");
  assert.equal(rows[0].documentId, null);
  await assert.rejects(saveApplicationChecklist(99, [{ id: "bad", label: "Invalid", documentId: -1 }]), /Choose a document/);
  await assert.rejects(saveApplicationChecklist(99, [{ id: "blank", label: " ", documentId: null }]), /Give each/);
});

test("readiness requires a real current file and respects draft and expiry states", () => {
  const blob = new Blob(["test"]);
  assert.equal(documentReadiness(undefined), "Needed");
  assert.equal(documentReadiness({ isExample: true, status: "Ready" }), "Example");
  assert.equal(documentReadiness({ status: "Ready" }), "No file");
  assert.equal(documentReadiness({ blob, status: "Ready", expiresAt: "2026-09-04" }, "2026-09-05"), "Expired");
  assert.equal(documentReadiness({ blob, status: "Ready", expiresAt: "2026-09-05" }, "2026-09-05"), "Ready");
  assert.equal(documentReadiness({ blob, status: "Draft" }), "Draft");
});

test("professor outreach dates copy to applications and reject impossible dates", async () => {
  const data = await fixture();
  const program = data.programs[0];
  program.professors[0].lastContactDate = "2026-09-05";
  program.professors[0].followUpDate = "2026-09-12";
  await saveProgram(program, [7, 8]);
  const copied = applicationFromProgram(await db.programs.get(10));
  assert.equal(copied.professors[0].lastContactDate, "2026-09-05");
  assert.equal(copied.professors[0].followUpDate, "2026-09-12");
  assert.throws(() => cleanProgram({ ...program, professors: [{ name: "Professor", followUpDate: "2026-02-30" }] }), /valid follow-up date/);
});
