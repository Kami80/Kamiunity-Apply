import Dexie from "dexie";

export const db = new Dexie("apply-2027");

db.version(1).stores({
  programs: "++id,name,country,deadline",
  applications: "++id,programId,status,deadline",
  tasks: "++id,dueDate,done,applicationId,priority",
  documents: "++id,name,category,updatedAt",
  settings: "key",
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
  if (seeded) return;

  await db.transaction(
    "rw",
    db.programs,
    db.applications,
    db.tasks,
    db.documents,
    db.settings,
    async () => {
      await db.programs.bulkAdd([
        {
          id: 1,
          name: "University of Toronto",
          program: "MSc Computer Science",
          country: "Canada",
          deadline: addDaysIso(41),
          tuition: "CAD 31,870",
          funding: "Scholarship review",
          priority: "High",
          url: "https://www.utoronto.ca/",
          notes: "Strong research fit. Confirm transcript delivery rules.",
        },
        {
          id: 2,
          name: "TU Munich",
          program: "MSc Informatics",
          country: "Germany",
          deadline: addDaysIso(58),
          tuition: "EUR 6,000",
          funding: "DAAD eligible",
          priority: "High",
          url: "https://www.tum.de/",
          notes: "Check VPD processing time before submission.",
        },
        {
          id: 3,
          name: "KU Leuven",
          program: "MSc Data Science",
          country: "Belgium",
          deadline: addDaysIso(88),
          tuition: "EUR 7,518",
          funding: "Master Mind",
          priority: "Medium",
          url: "https://www.kuleuven.be/",
          notes: "Motivation letter needs a program-specific paragraph.",
        },
        {
          id: 4,
          name: "University of Amsterdam",
          program: "MSc Artificial Intelligence",
          country: "Netherlands",
          deadline: addDaysIso(133),
          tuition: "EUR 18,810",
          funding: "Amsterdam Merit",
          priority: "Medium",
          url: "https://www.uva.nl/",
          notes: "Portfolio of relevant coursework may be requested.",
        },
      ]);

      await db.applications.bulkAdd([
        { id: 1, programId: 1, status: "Preparing", deadline: addDaysIso(41), progress: 62 },
        { id: 2, programId: 2, status: "Preparing", deadline: addDaysIso(58), progress: 75 },
        { id: 3, programId: 3, status: "Researching", deadline: addDaysIso(88), progress: 28 },
        { id: 4, programId: 4, status: "Researching", deadline: addDaysIso(133), progress: 20 },
      ]);

      await db.tasks.bulkAdd([
        {
          id: 1,
          title: "Request official transcript",
          applicationId: 1,
          programIds: [1, 2],
          dueDate: addDaysIso(0),
          done: false,
          priority: "High",
          note: "Request one sealed digital copy that can be reused for Toronto and TU Munich.",
        },
        {
          id: 2,
          title: "Submit English language test scores",
          applicationId: 1,
          programIds: [1],
          dueDate: addDaysIso(4),
          done: false,
          priority: "Medium",
          note: "Confirm the institution code before ordering the score report.",
        },
        {
          id: 3,
          title: "Upload CV / Résumé",
          applicationId: 2,
          programIds: [2],
          dueDate: addDaysIso(7),
          done: false,
          priority: "Medium",
          note: "Use the two-page academic version saved in Documents.",
        },
        {
          id: 4,
          title: "Pay application fee",
          applicationId: 3,
          programIds: [3],
          dueDate: addDaysIso(11),
          done: false,
          priority: "High",
          note: "Verify the fee waiver rules before paying.",
        },
        {
          id: 5,
          title: "Confirm recommendations",
          applicationId: 4,
          programIds: [4],
          dueDate: addDaysIso(14),
          done: true,
          priority: "Medium",
          note: "Both referees confirmed receipt of the request.",
        },
      ]);

      await db.documents.bulkAdd([
        {
          id: 1,
          name: "Official transcript.pdf",
          category: "Academic",
          size: 626688,
          type: "application/pdf",
          updatedAt: addDaysIso(-3),
          version: "1.2",
          linkedProgramIds: [1, 2, 3],
          blob: null,
          isExample: true,
        },
        {
          id: 2,
          name: "CV — September 2026.pdf",
          category: "Academic",
          size: 284672,
          type: "application/pdf",
          updatedAt: addDaysIso(-7),
          version: "1.1",
          linkedProgramIds: [1, 2],
          blob: null,
          isExample: true,
        },
        {
          id: 3,
          name: "Passport.pdf",
          category: "Identity",
          size: 991232,
          type: "application/pdf",
          updatedAt: addDaysIso(-51),
          version: "1.0",
          linkedProgramIds: [1, 2, 3, 4],
          blob: null,
          isExample: true,
        },
        {
          id: 4,
          name: "Statement of purpose — Toronto.docx",
          category: "Essays",
          size: 94208,
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          updatedAt: addDaysIso(-5),
          version: "1.3",
          linkedProgramIds: [1],
          blob: null,
          isExample: true,
        },
      ]);

      await db.settings.put({ key: "seeded-v1", value: true });
    },
  );
}

export async function readAllData() {
  const [programs, applications, tasks, documents] = await Promise.all([
    db.programs.toArray(),
    db.applications.toArray(),
    db.tasks.toArray(),
    db.documents.toArray(),
  ]);

  return { programs, applications, tasks, documents };
}
