import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  CalendarBlank,
  CalendarCheck,
  CaretRight,
  Check,
  CheckCircle,
  Clock,
  Database,
  DownloadSimple,
  FileText,
  FileXls,
  FolderSimple,
  Funnel,
  GraduationCap,
  HardDrive,
  Kanban,
  MagnifyingGlass,
  Table,
  Trash,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import "@fontsource-variable/manrope";
import { db, readAllData, seedDatabase } from "./db.js";
import { PrimaryButton } from "./ui.jsx";
import kamiunityLogo from "./assets/kamiunity-logo.png";
import { ApplicationChecklistForm, ApplicationWorkspace } from "./ApplicationWorkspace.jsx";
import { ApplicationForm, DocumentForm, ExternalLink, ProgramForm, TaskForm } from "./WorkflowForms.jsx";
import { applicationDocuments, deadlineEvents, STATUS_OPTIONS } from "./workflow.js";
import {
  downloadBlob,
  exportEncryptedBackup,
  exportWorkbook,
  formatBytes,
  importWorkbook,
  readEncryptedBackup,
  restoreBackup,
} from "./backup.js";

const ROUTES = ["today", "programs", "applications", "documents", "calendar", "backup"];
const NAV_ITEMS = [
  { id: "applications", label: "My applications", icon: FolderSimple },
  { id: "programs", label: "Program shortlist", icon: GraduationCap },
  { id: "documents", label: "Document vault", icon: FileText },
  { id: "calendar", label: "Deadlines", icon: CalendarBlank },
];

function currentRoute() {
  const value = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return ROUTES.includes(value) ? value : "applications";
}

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function formatLongDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(value);
}

function formatShortDate(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parseDate(value));
}

function formatDeadlineDate(value) {
  if (!value) return "Not set";
  const date = parseDate(value);
  const includeYear = date.getFullYear() !== new Date().getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(date);
}

function formatTaskDate(value) {
  const date = parseDate(value);
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date),
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date),
  };
}

function daysUntil(value) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((parseDate(value) - today) / 86400000);
}

function relativeDue(value) {
  if (!value) return "No deadline yet";
  const days = daysUntil(value);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function programFor(programs, task) {
  return programs.find((program) => program.id === task.programIds?.[0]);
}

function TopNavigation({ route, navigate }) {
  return (
    <header className="topbar">
      <button className="brand" type="button" onClick={() => navigate("applications")} aria-label="Kamiunity — my applications"><img src={kamiunityLogo} alt="kamiunity" /></button>
      <nav className="topnav" aria-label="Primary navigation">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={`nav-item ${route === id ? "active" : ""}`}
            aria-current={route === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={24} weight={route === id ? "duotone" : "regular"} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="brand-utilities"><span><CheckCircle size={19} />Saved on this device</span><button className={`icon-button ${route === "backup" ? "active" : ""}`} type="button" onClick={() => navigate("backup")} aria-label="Backup and transfer" title="Backup & transfer"><Archive size={22} /></button></div>
    </header>
  );
}

function PageHeader({ eyebrow, title, description, localMessage = "Saved on this device", action }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="page-actions">
        <span className="local-status"><CheckCircle size={25} />{localMessage}</span>
        {action}
      </div>
    </div>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className="empty-state">
      <Database size={36} weight="duotone" />
      <h3>{title}</h3><p>{description}</p>
    </div>
  );
}

function TodayPage({ data, openModal }) {
  const tasks = useMemo(
    () => [...data.tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5),
    [data.tasks],
  );
  const nextTask = tasks.find((task) => !task.done);
  const deadlines = useMemo(
    () => deadlineEvents(data).slice(0, 4),
    [data],
  );

  return (
    <div className="page today-page">
      <PageHeader
        eyebrow={formatLongDate()}
        title="Today’s next steps"
        description="Move your applications forward, one task at a time."
        action={<PrimaryButton onClick={() => openModal({ type: "add-task" })}>Add task</PrimaryButton>}
      />

      <section className="timeline-panel soft-inset" aria-labelledby="timeline-title">
        <h2 id="timeline-title">Next 14 days</h2>
        {tasks.length ? (
          <div className="timeline-list">
            {tasks.map((task) => {
              const taskDate = formatTaskDate(task.dueDate);
              const isNext = task.id === nextTask?.id;
              const isUrgent = !task.done && task.priority === "High" && !isNext;
              const program = programFor(data.programs, task);
              return (
                <article className={`timeline-item ${isNext ? "is-next" : ""} ${task.done ? "is-done" : ""}`} key={task.id}>
                  <div className={`timeline-date ${isUrgent ? "urgent" : ""} ${task.done ? "done" : ""}`}>
                    <strong>{isNext && daysUntil(task.dueDate) === 0 ? "Today" : taskDate.weekday}</strong>
                    <span>{taskDate.date}</span>
                  </div>
                  <button
                    type="button"
                    className={`timeline-node ${isNext ? "next" : ""} ${isUrgent ? "urgent" : ""} ${task.done ? "done" : ""}`}
                    aria-label={`Open ${task.title}`}
                    onClick={() => openModal({ type: "task", task })}
                  >
                    {task.done ? <Check size={17} weight="bold" /> : null}
                  </button>
                  {isNext ? (
                    <div className="next-action-card soft-panel">
                      <div>
                        <span className="section-kicker">Next best action</span>
                        <h3>{task.title}</h3>
                        <p>
                          {task.programIds?.length > 1
                            ? `Unlocks ${task.programIds.length} applications: ${task.programIds.map((id) => data.programs.find((item) => item.id === id)?.name).filter(Boolean).join(", ")}`
                            : program?.name}
                        </p>
                      </div>
                      <PrimaryButton icon={ArrowRight} className="start-task-button" onClick={() => openModal({ type: "task", task })}>Start task</PrimaryButton>
                    </div>
                  ) : (
                    <button type="button" className="timeline-row" onClick={() => openModal({ type: "task", task })}>
                      <span className="task-copy"><strong>{task.title}</strong><span>{program?.name || "General"}</span></span>
                      <span className={`due-chip ${isUrgent ? "urgent" : ""} ${task.done ? "done" : ""}`}>
                        {task.done ? <CheckCircle size={22} /> : isUrgent ? <WarningCircle size={22} /> : <Clock size={22} />}
                        {task.done ? "Done" : relativeDue(task.dueDate)}
                      </span>
                      <CaretRight size={25} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : <EmptyState title="Your timeline is clear" description="Add a task to plan your next application step." />}
      </section>

      <section className="deadline-strip soft-panel" aria-labelledby="deadline-title">
        <div className="deadline-label" id="deadline-title"><CalendarBlank size={31} /><strong>Upcoming application deadlines</strong></div>
        <div className="deadline-items">
          {deadlines.map((event) => (
            <button type="button" key={event.id} onClick={() => openModal(event.application ? { type: "application", application: event.application } : { type: "program", program: event.program })}>
              <strong>{formatDeadlineDate(event.deadline)}</strong><span>{event.program.name}</span>
            </button>
          ))}
        </div>
        <CaretRight size={28} />
      </section>
    </div>
  );
}

function ProgramsPage({ data, openModal }) {
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("");
  const filtered = data.programs.filter((program) => `${program.name} ${program.program} ${program.country} ${(program.professors || []).map((professor) => `${professor.name} ${professor.email}`).join(" ")}`.toLowerCase().includes(query.toLowerCase()) && (!priority || program.priority === priority));
  return (
    <div className="page">
      <PageHeader eyebrow="Find your academic fit" title="Program shortlist" description="Keep program requirements, funding, and professor contacts in one place." action={<PrimaryButton onClick={() => openModal({ type: "add-program" })}>Add program</PrimaryButton>} />
      <section className="workspace-panel soft-panel">
        <div className="toolbar">
          <label className="search-field soft-inset"><MagnifyingGlass size={22} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search programs..." aria-label="Search programs" /></label>
          <label className="toolbar-filter"><Funnel size={20} /><select aria-label="Filter by priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">All priorities</option><option>High</option><option>Medium</option><option>Low</option></select></label>
        </div>
        {filtered.length ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>University & program</th><th>Country</th><th>Deadline</th><th>Tuition</th><th>Funding</th><th>Priority</th><th aria-label="Actions" /></tr></thead>
              <tbody>{filtered.map((program) => (
                <tr key={program.id}>
                  <td><button className="record-link" type="button" onClick={() => openModal({ type: "program", program })}><strong>{program.name}</strong><span>{program.program}</span></button><ExternalLink url={program.url}>Program website</ExternalLink><span>{data.documents.filter((document) => document.linkedProgramIds?.includes(program.id)).length} documents · {program.professors?.length || 0} professors</span></td><td>{program.country || "Not added"}</td>
                  <td><strong className="date-text">{formatShortDate(program.deadline)}</strong><span>{relativeDue(program.deadline)}</span></td>
                  <td>{program.tuition || "Not added"}</td><td>{program.funding || "Not added"}</td>
                  <td><span className={`priority-label ${program.priority?.toLowerCase()}`}>{program.priority}</span></td>
                  <td><div className="record-actions"><button className="secondary-button soft-button" type="button" onClick={() => openModal({ type: "add-application", programId: program.id })}>Start application</button><button className="icon-button" type="button" onClick={() => openModal({ type: "program", program })} aria-label={`Edit ${program.name}`}><CaretRight size={22} /></button></div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No matching programs" description="Try a broader university, program, or country search." />}
      </section>
    </div>
  );
}

function ApplicationsPage({ data, refresh, notify, openModal, navigate }) {
  const [view, setView] = useState("dossier");
  const [query, setQuery] = useState("");
  const joined = data.applications.map((application) => ({ ...application, program: data.programs.find((program) => program.id === application.programId) })).filter((application) => `${application.program?.name} ${application.program?.program} ${application.intake || ""} ${application.referenceNumber || ""} ${application.status}`.toLowerCase().includes(query.toLowerCase()));
  async function updateStatus(applicationId, status) {
    try {
    await db.applications.update(applicationId, { status });
    await refresh();
    notify(`Application moved to ${status}.`);
    } catch { notify("Could not save the status. Please try again."); }
  }
  if (view === "dossier") return <ApplicationWorkspace data={data} refresh={refresh} notify={notify} openModal={openModal} navigate={navigate} onOpenTable={() => setView("table")} />;
  return (
    <div className="page">
      <PageHeader eyebrow="From research to decision" title="My applications" description="Compare every application, then open its dedicated workspace." action={<PrimaryButton onClick={() => openModal({ type: "add-application" })}>Add application</PrimaryButton>} />
      <section className="workspace-panel soft-panel">
        <div className="toolbar applications-toolbar">
          <div className="segmented soft-inset" aria-label="Application view">
            <button type="button" onClick={() => setView("dossier")}><FolderSimple size={20} />Workspace</button>
            <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}><Table size={20} /> Table</button>
            <button type="button" className={view === "board" ? "active" : ""} onClick={() => setView("board")}><Kanban size={20} /> Board</button>
          </div><label className="search-field soft-inset"><MagnifyingGlass size={22} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search applications…" aria-label="Search applications" /></label><span className="count-label">{joined.length} applications</span>
        </div>
        {view === "table" ? (
          <div className="data-table-wrap"><table className="data-table applications-table">
            <thead><tr><th>Program</th><th>Status</th><th>Deadline</th><th>Progress</th><th>Documents</th><th>Priority</th><th aria-label="Actions" /></tr></thead>
            <tbody>{joined.map((application) => (
              <tr key={application.id}>
                <td><button className="record-link" type="button" onClick={() => openModal({ type: "application", application })}><strong>{application.program?.name || "Missing program"}</strong><span>{application.program?.program}</span></button><span>{application.intake || "Intake not set"} · #{application.id}{application.referenceNumber ? ` · ${application.referenceNumber}` : ""}</span></td>
                <td><select value={application.status} onChange={(event) => updateStatus(application.id, event.target.value)} aria-label={`Status for ${application.program?.name}`}>{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></td>
                <td><strong className="date-text">{formatShortDate(application.deadline)}</strong><span>{relativeDue(application.deadline)}</span></td>
                <td><div className="progress-cell"><span>{application.progress || 0}%</span><progress max="100" value={application.progress || 0} /></div></td>
                <td><button className="text-action" type="button" onClick={() => openModal({ type: "application", application })}>{applicationDocuments(data, application).length} linked</button></td>
                <td><span className={`priority-label ${(application.priority || application.program?.priority)?.toLowerCase()}`}>{application.priority || application.program?.priority}</span></td>
                <td><button className="icon-button" type="button" onClick={() => openModal({ type: "application", application })} aria-label={`Edit application for ${application.program?.name}`}><CaretRight size={22} /></button></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : (
          <div className="kanban-board">{STATUS_OPTIONS.map((status) => (
            <section className="kanban-column soft-inset" key={status}>
              <header><h3>{status}</h3><span>{joined.filter((item) => item.status === status).length}</span></header>
              {joined.filter((item) => item.status === status).map((application) => (
                <article className="kanban-card soft-panel" key={application.id}>
                  <button className="record-link" type="button" onClick={() => openModal({ type: "application", application })}><strong>{application.program?.name}</strong><span>{application.program?.program}</span></button><small>{application.intake || `Application #${application.id}`} · {formatShortDate(application.deadline)}</small><button className="text-action" type="button" onClick={() => openModal({ type: "application", application })}>{applicationDocuments(data, application).length} documents · Edit details</button>
                  <select value={application.status} onChange={(event) => updateStatus(application.id, event.target.value)} aria-label={`Move ${application.program?.name}`}>{STATUS_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select>
                </article>
              ))}
            </section>
          ))}</div>
        )}
        {!joined.length ? <EmptyState title="No matching applications" description="Start an application from a saved program or try another search." /> : null}
      </section>
    </div>
  );
}

function DocumentsPage({ data, refresh, notify, openModal }) {
  const [selectedId, setSelectedId] = useState(data.documents[0]?.id);
  const [query, setQuery] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const selected = data.documents.find((document) => document.id === selectedId) || data.documents[0];
  const filtered = data.documents.filter((document) => `${document.name} ${document.category} ${document.status || ""} ${document.notes || ""}`.toLowerCase().includes(query.toLowerCase()));
  function downloadDocument(document) {
    if (!document.blob) return notify("This example record has no file attached. Add your own document to download it.");
    downloadBlob(document.blob, document.name);
  }
  async function removeDocument(document) {
    setRemoving(true);
    try { await db.documents.delete(document.id); setSelectedId(undefined); setConfirmRemove(false); await refresh(); notify("Document and its assignments removed from this device."); }
    catch { notify("Could not remove the document. Please try again."); }
    finally { setRemoving(false); }
  }
  return (
    <div className="page">
      <PageHeader eyebrow="Your application evidence" title="Document vault" description="One academic CV. Every application that needs it. Keep versions and assignments together." localMessage="Stored only on this device" action={<PrimaryButton onClick={() => openModal({ type: "add-document", onSaved: setSelectedId })}>Add document</PrimaryButton>} />
      <div className="document-workspace">
        <section className="document-list soft-panel">
          <label className="search-field soft-inset"><MagnifyingGlass size={22} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents..." aria-label="Search documents" /></label>
          <div className="document-rows">{filtered.map((document) => (
            <button type="button" className={`document-row ${selected?.id === document.id ? "selected" : ""}`} aria-pressed={selected?.id === document.id} key={document.id} onClick={() => { setSelectedId(document.id); setConfirmRemove(false); }}>
              <span className="file-icon soft-button"><FileText size={24} weight="duotone" /></span><span className="document-name"><strong>{document.name}</strong><small>{document.category} · {document.blob ? document.status || "Draft" : "Example"}</small></span><span>{formatBytes(document.size)}</span><span>{formatShortDate(document.updatedAt)}</span><span>v{document.version}</span><CaretRight size={21} />
            </button>
          ))}{!filtered.length ? <EmptyState title="No matching documents" description="Add files or try a different search." /> : null}</div>
        </section>
        <aside className="document-detail soft-panel">
          {selected ? <>
            <div className="detail-title"><span className="file-icon large soft-button"><FileText size={31} weight="duotone" /></span><div><span>Selected document</span><h2>{selected.name.replace(/\.[^.]+$/, "")}</h2></div></div>
            <dl><div><dt>File name</dt><dd>{selected.name}</dd></div><div><dt>Size</dt><dd>{formatBytes(selected.size)}</dd></div><div><dt>Updated</dt><dd>{formatShortDate(selected.updatedAt)}</dd></div><div><dt>Version</dt><dd>v{selected.version}</dd></div><div><dt>Readiness</dt><dd>{selected.blob ? selected.status || "Draft" : "Example — attach a file"}</dd></div>{selected.expiresAt ? <div><dt>Expires</dt><dd className={daysUntil(selected.expiresAt) < 0 ? "expired-label" : ""}>{formatShortDate(selected.expiresAt)}{daysUntil(selected.expiresAt) < 0 ? " · Expired" : ""}</dd></div> : null}</dl>
            <button className="secondary-button soft-button manage-links-button" type="button" onClick={() => openModal({ type: "document", document: selected })}>Edit details & assignments</button>
            {selected.notes ? <p className="document-notes">{selected.notes}</p> : null}
            <div className="linked-section"><h3>{selected.linkedProgramIds?.length || 0} linked programs</h3>{selected.linkedProgramIds?.map((id) => { const program = data.programs.find((item) => item.id === id); return program ? <button className="linked-row" type="button" onClick={() => openModal({ type: "program", program })} key={id}><GraduationCap size={21} /><span><strong>{program.name}</strong><small>{program.program}</small></span><CaretRight size={20} /></button> : null; })}</div>
            <div className="linked-section"><h3>{selected.linkedApplicationIds?.length || 0} assigned applications</h3>{selected.linkedApplicationIds?.map((id) => { const application = data.applications.find((item) => item.id === id); const program = data.programs.find((item) => item.id === application?.programId); return application ? <button className="linked-row" type="button" onClick={() => openModal({ type: "application", application })} key={id}><FolderSimple size={21} /><span><strong>{program?.name}</strong><small>{program?.program} · {application.intake || `#${id}`} · {application.status}</small></span><CaretRight size={20} /></button> : null; })}</div>
            <div className="detail-actions"><button className="secondary-button soft-button" type="button" disabled={!selected.blob} onClick={() => downloadDocument(selected)}><DownloadSimple size={20} /> Download</button><button className="danger-button soft-button" type="button" onClick={() => setConfirmRemove(true)}><Trash size={20} /> Remove</button></div>
            {confirmRemove ? <div className="form-notice" role="alert"><p>Remove {selected.name} from the library and all its assignments?</p><div className="button-row"><button type="button" className="danger-button soft-button" disabled={removing} onClick={() => removeDocument(selected)}>{removing ? "Removing…" : "Remove document"}</button><button type="button" className="secondary-button" disabled={removing} onClick={() => setConfirmRemove(false)}>Keep document</button></div></div> : null}
          </> : <EmptyState title="No document selected" description="Choose a file to see its application links." />}
        </aside>
      </div>
    </div>
  );
}

function CalendarPage({ data, openModal }) {
  const events = [...data.tasks.map((task) => ({ id: `task-${task.id}`, date: task.dueDate, title: task.title, type: task.done ? "Complete" : "Task", task })), ...deadlineEvents(data).map((event) => ({ ...event, date: event.deadline, title: `${event.program.name} · ${event.program.program}${event.application?.intake ? ` · ${event.application.intake}` : ""}`, type: event.application ? "Application deadline" : "Program deadline" }))].filter((event) => event.date).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="page">
      <PageHeader eyebrow="Your admissions calendar" title="Deadlines" description="See what needs to happen before each application closes." />
      <section className="calendar-panel soft-panel">
        <div className="calendar-summary soft-inset"><CalendarBlank size={32} weight="duotone" /><div><span>Next deadline</span><strong>{events.find((event) => daysUntil(event.date) >= 0)?.title || "Nothing scheduled"}</strong></div></div>
        <div className="agenda-list">{events.map((event) => { const date = formatTaskDate(event.date); return (
          <button type="button" className="agenda-row" key={event.id} onClick={() => openModal(event.task ? { type: "task", task: event.task } : event.application ? { type: "application", application: event.application } : { type: "program", program: event.program })}>
            <span className="agenda-date"><strong>{date.weekday}</strong><span>{date.date}</span></span><span className="agenda-dot" /><span className="agenda-copy"><strong>{event.title}</strong><span>{event.type}</span></span><span className="due-chip"><Clock size={20} />{relativeDue(event.date)}</span><CaretRight size={22} />
          </button>
        ); })}</div>
      </section>
    </div>
  );
}

function BackupPage({ data, refresh, notify, installPrompt, installApp }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState({ used: 0, quota: 0, persistent: false });
  const backupInput = useRef(null);
  const excelInput = useRef(null);
  async function updateStorage() {
    if (!navigator.storage) return;
    const estimate = await navigator.storage.estimate();
    const persistent = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    setStorage({ used: estimate.usage || 0, quota: estimate.quota || 0, persistent });
  }
  useEffect(() => { updateStorage(); }, [data.documents.length]);
  async function requestPersistence() {
    if (!navigator.storage?.persist) return notify("Persistent storage is not supported by this browser.");
    const granted = await navigator.storage.persist(); await updateStorage(); notify(granted ? "Persistent storage is enabled." : "The browser did not grant persistent storage.");
  }
  async function createBackup() {
    if (password.length < 8) return notify("Use at least 8 characters for the backup passphrase.");
    setBusy(true);
    try { await exportEncryptedBackup(data, password); await db.settings.put({ key: "last-backup", value: new Date().toISOString() }); notify("Encrypted backup downloaded."); }
    catch (error) { notify(error.message || "Backup could not be created."); }
    finally { setBusy(false); }
  }
  async function importBackupFile(file) {
    if (!file) return;
    if (!password) return notify("Enter the backup passphrase first.");
    setBusy(true);
    try { const restored = await readEncryptedBackup(file, password); await restoreBackup(restored); await refresh(); notify("Backup restored on this device."); }
    catch (error) { notify(error.message || "Backup could not be restored."); }
    finally { setBusy(false); if (backupInput.current) backupInput.current.value = ""; }
  }
  async function importExcelFile(file) {
    if (!file) return;
    setBusy(true);
    try { const count = await importWorkbook(file); await refresh(); notify(`${count} program${count === 1 ? "" : "s"} imported from Excel.`); }
    catch (error) { notify(error.message || "The spreadsheet could not be imported."); }
    finally { setBusy(false); if (excelInput.current) excelInput.current.value = ""; }
  }
  const percent = storage.quota ? Math.min(100, Math.round((storage.used / storage.quota) * 100)) : 0;
  return (
    <div className="page">
      <PageHeader eyebrow="Your workspace, under your control" title="Backup & transfer" description="Keep your Kamiunity records and application files portable." />
      <div className="backup-grid">
        <section className="backup-card soft-panel">
          <span className="feature-icon soft-button"><Archive size={28} weight="duotone" /></span><div><span className="section-kicker">Recommended</span><h2>Encrypted local backup</h2><p>Includes programs, tasks, applications, and uploaded documents.</p></div>
          <label className="field-label">Backup passphrase<input className="soft-inset" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete="new-password" /></label>
          <div className="button-row"><PrimaryButton icon={DownloadSimple} onClick={createBackup} disabled={busy}>Export backup</PrimaryButton><input className="visually-hidden" ref={backupInput} tabIndex="-1" type="file" accept=".applyvault,application/json" onChange={(event) => importBackupFile(event.target.files[0])} /><button className="secondary-button soft-button" type="button" onClick={() => backupInput.current?.click()} disabled={busy}><UploadSimple size={20} /> Restore</button></div>
          <small>Keep the passphrase safe. It cannot be recovered by the app.</small>
        </section>
        <section className="backup-card soft-panel">
          <span className="feature-icon soft-button"><FileXls size={28} weight="duotone" /></span><div><span className="section-kicker">No lock-in</span><h2>Excel exchange</h2><p>Import an existing tracker or export a familiar workbook anytime.</p></div>
          <input className="visually-hidden" ref={excelInput} tabIndex="-1" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => importExcelFile(event.target.files[0])} />
          <div className="button-row"><PrimaryButton icon={DownloadSimple} onClick={async () => { try { await exportWorkbook(data); notify("Excel workbook downloaded."); } catch { notify("The Excel workbook could not be created."); } }}>Export Excel</PrimaryButton><button className="secondary-button soft-button" type="button" onClick={() => excelInput.current?.click()} disabled={busy}><UploadSimple size={20} /> Import Excel</button></div>
          <small>Imports program rows and starts an application for each, including links and professor contacts. Exports all workspace details in five sheets. Use encrypted backups to restore the full workspace and files.</small>
        </section>
        <section className="backup-card storage-card soft-panel">
          <span className="feature-icon soft-button"><HardDrive size={28} weight="duotone" /></span><div><span className="section-kicker">This browser</span><h2>Storage health</h2><p>{storage.persistent ? "Persistent storage is enabled." : "Storage is currently best-effort."}</p></div>
          <div className="storage-meter" aria-label={`${percent}% of browser storage used`}><span style={{ width: `${Math.max(percent, 2)}%` }} /></div><span className="storage-copy">{formatBytes(storage.used)} used of {formatBytes(storage.quota)}</span>
          <button className="secondary-button soft-button" type="button" onClick={requestPersistence} disabled={storage.persistent}><Database size={20} />{storage.persistent ? "Storage protected" : "Protect local storage"}</button>
        </section>
        <section className="backup-card install-card soft-panel">
          <span className="feature-icon soft-button"><DownloadSimple size={28} weight="duotone" /></span><div><span className="section-kicker">Offline app</span><h2>Install Kamiunity</h2><p>Keep your application workspace close, even without an internet connection.</p></div>
          <button className="secondary-button soft-button" type="button" onClick={installApp} disabled={!installPrompt}><DownloadSimple size={20} />{installPrompt ? "Install app" : "Already installed or unavailable"}</button>
        </section>
      </div>
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [data, setData] = useState({ programs: [], applications: [], tasks: [], documents: [] });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  async function refresh() { setData(await readAllData()); }
  useEffect(() => {
    let active = true;
    seedDatabase().then(readAllData).then((value) => { if (active) { setData(value); setReady(true); } }).catch(() => { if (active) setLoadError("Could not open local storage. Close other Kamiunity tabs and try again."); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!window.location.hash) window.location.hash = "/applications";
    const handleHash = () => setRoute(currentRoute());
    const handleInstall = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("hashchange", handleHash); window.addEventListener("beforeinstallprompt", handleInstall);
    return () => { window.removeEventListener("hashchange", handleHash); window.removeEventListener("beforeinstallprompt", handleInstall); };
  }, []);
  useEffect(() => { if (!toast) return undefined; const timeout = window.setTimeout(() => setToast(""), 3600); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => { document.title = `Kamiunity — ${NAV_ITEMS.find((item) => item.id === route)?.label || (route === "today" ? "Today’s next steps" : "Backup & transfer")}`; }, [route]);
  function navigate(next) { window.location.hash = `/${next}`; setRoute(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function installApp() { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); }
  const common = { data, refresh, notify: setToast, openModal: setModal, navigate };
  const pages = { today: <TodayPage {...common} />, programs: <ProgramsPage {...common} />, applications: <ApplicationsPage {...common} />, documents: <DocumentsPage {...common} />, calendar: <CalendarPage {...common} />, backup: <BackupPage {...common} installPrompt={installPrompt} installApp={installApp} /> };
  if (!ready) return <main className="loading-screen"><img className="loading-brand" src={kamiunityLogo} alt="kamiunity" /><strong>{loadError ? "Your workspace could not open" : "Opening your application workspace…"}</strong><span role={loadError ? "alert" : undefined}>{loadError || "Your records stay on this device."}</span>{loadError ? <button className="secondary-button soft-button" type="button" onClick={() => window.location.reload()}>Try again</button> : null}</main>;
  return (
    <div className="app-shell kamiunity">
      <TopNavigation route={route} navigate={navigate} /><main className="app-main">{pages[route]}</main>
      {["task", "add-task"].includes(modal?.type) ? <TaskForm key={`task-${modal.task?.id || "new"}`} {...common} task={modal.task} close={() => setModal(null)} /> : null}
      {["program", "add-program"].includes(modal?.type) ? <ProgramForm key={`program-${modal.program?.id || "new"}`} {...common} program={modal.program} close={() => setModal(null)} /> : null}
      {["application", "add-application"].includes(modal?.type) ? <ApplicationForm key={`application-${modal.application?.id || modal.programId || "new"}`} {...common} application={modal.application} programId={modal.programId} focusSection={modal.focusSection} close={() => setModal(null)} /> : null}
      {["document", "add-document"].includes(modal?.type) ? <DocumentForm key={`document-${modal.document?.id || "new"}`} {...common} document={modal.document} applicationId={modal.applicationId} onSaved={modal.onSaved} close={() => setModal(null)} /> : null}
      {modal?.type === "application-checklist" ? <ApplicationChecklistForm {...common} application={modal.application} close={() => setModal(null)} /> : null}
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite"><CheckCircle size={21} />{toast}</div>
    </div>
  );
}
