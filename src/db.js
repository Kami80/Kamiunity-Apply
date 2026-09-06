import Dexie from "dexie";
import { CATALOG_SOURCE_SETTING_KEY, DEFAULT_CATALOG_SOURCE, STARTER_CATALOG } from "./catalog-data.js";
import { inferProgramCategory, normalizeIntake } from "./program-taxonomy.js";

export const db = new Dexie("apply-2027");
export const PROFILE_SETTING_KEY = "profile";
export const PROFILE_LOOKUP_EMAIL_SETTING_KEY = "profile-lookup-email";

db.version(1).stores({
  programs: "++id,name,country,deadline",
  applications: "++id,programId,status,deadline",
  tasks: "++id,dueDate,done,applicationId,priority",
  documents: "++id,name,category,updatedAt",
  settings: "key",
});

db.version(2).stores({
  documents: "++id,name,category,updatedAt,*linkedProgramIds,*linkedApplicationIds",
}).upgrade(async (transaction) => {
  const applications = await transaction.table("applications").toArray();
  await transaction.table("documents").toCollection().modify((document) => {
    document.linkedApplicationIds ??= applications
      .filter((application) => document.linkedProgramIds?.includes(application.programId))
      .map((application) => application.id);
  });
  await transaction.table("tasks").toCollection().modify((task) => {
    task.applicationIds ??= task.applicationId ? [task.applicationId] : [];
  });
});

db.version(3).stores({
  catalogPrograms: "++id,catalogId,name,program,country,degreeLevel,intake,deadline",
});

db.version(4).stores({
  catalogPrograms: "++id,catalogId,name,program,country,degreeLevel,intake,deadline",
}).upgrade(async (transaction) => {
  await transaction.table("programs").toCollection().modify((program) => {
    program.intake = normalizeIntake(program.intake);
    program.category ||= inferProgramCategory(program);
  });
  await transaction.table("applications").toCollection().modify((application) => {
    application.intake = normalizeIntake(application.intake);
  });
  await transaction.table("catalogPrograms").toCollection().modify((program) => {
    program.intake = normalizeIntake(program.intake);
    program.category ||= inferProgramCategory(program);
  });
});

export function toIsoDate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

export function addDaysIso(days, origin = new Date()) {
  const date = new Date(origin);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export async function seedDatabase() {
  const seeded = await db.settings.get("seeded-v1");
  const catalogCount = await db.catalogPrograms.count();
  if (seeded && catalogCount) return;

  await db.transaction(
    "rw",
    db.programs,
    db.applications,
    db.tasks,
    db.documents,
    db.catalogPrograms,
    db.settings,
    async () => {
      // Initialization can run twice in React Strict Mode or in two tabs.
      const alreadySeeded = await db.settings.get("seeded-v1");
      if (!(await db.catalogPrograms.count())) {
        await db.catalogPrograms.bulkAdd(STARTER_CATALOG.map((program) => ({ ...program })));
        await db.settings.put({ key: CATALOG_SOURCE_SETTING_KEY, value: { ...DEFAULT_CATALOG_SOURCE } });
      }

      if (!alreadySeeded) await db.settings.put({ key: "seeded-v1", value: true });
    },
  );
}

export async function readAllData() {
  const [programs, applications, tasks, documents, catalogPrograms, catalogSource, profile, profileLookupEmail] = await Promise.all([
    db.programs.toArray(),
    db.applications.toArray(),
    db.tasks.toArray(),
    db.documents.toArray(),
    db.catalogPrograms.toArray(),
    db.settings.get(CATALOG_SOURCE_SETTING_KEY),
    db.settings.get(PROFILE_SETTING_KEY),
    db.settings.get(PROFILE_LOOKUP_EMAIL_SETTING_KEY),
  ]);

  return { programs, applications, tasks, documents, catalogPrograms, catalogSource: catalogSource?.value || { ...DEFAULT_CATALOG_SOURCE }, profile: profile?.value || null, profileLookupEmail: profileLookupEmail?.value || "" };
}
