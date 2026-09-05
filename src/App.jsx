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
  Plus,
  Table,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import "@fontsource-variable/manrope";
import { addDaysIso, db, readAllData, seedDatabase, toIsoDate } from "./db.js";
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
const STATUS_OPTIONS = ["Researching", "Preparing", "Submitted", "Offer", "Decision"];
const NAV_ITEMS = [
  { id: "today", label: "Today", icon: CalendarCheck },
  { id: "programs", label: "Programs", icon: GraduationCap },
  { id: "applications", label: "Applications", icon: FolderSimple },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "calendar", label: "Calendar", icon: CalendarBlank },
  { id: "backup", label: "Backup", icon: Archive },
];

function currentRoute() {
  const value = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return ROUTES.includes(value) ? value : "today";
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
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parseDate(value));
}

function formatDeadlineDate(value) {
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
  const days = daysUntil(value);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function programFor(programs, task) {
  return programs.find((program) => program.id === task.programIds?.[0]);
}

function Modal({ title, children, onClose, size = "medium" }) {
  useEffect(() => {
    const handleKey = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal soft-panel modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button soft-button" type="button" onClick={onClose} aria-label="Close">
            <X size={20} weight="bold" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function TopNavigation({ route, navigate }) {
  return (
    <header className="topbar">
      <button className="brand" type="button" onClick={() => navigate("today")}>Apply 2027</button>
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

function PrimaryButton({ children, icon: Icon = Plus, className = "", ...props }) {
  return (
    <button className={`primary-button ${className}`} type="button" {...props}>
      <span>{children}</span><Icon size={23} weight="bold" />
    </button>
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
    () => [...data.programs].sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 4),
    [data.programs],
  );

  return (
    <div className="page today-page">
      <PageHeader
        title={formatLongDate()}
        description="Your next steps, in order"
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
          {deadlines.map((program) => (
            <button type="button" key={program.id} onClick={() => openModal({ type: "program", program })}>
              <strong>{formatDeadlineDate(program.deadline)}</strong><span>{program.name}</span>
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
  const filtered = data.programs.filter((program) => `${program.name} ${program.program} ${program.country}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page">
      <PageHeader eyebrow="Research workspace" title="Programs" description="Compare the details that matter before you apply." action={<PrimaryButton onClick={() => openModal({ type: "add-program" })}>Add program</PrimaryButton>} />
      <section className="workspace-panel soft-panel">
        <div className="toolbar">
          <label className="search-field soft-inset"><MagnifyingGlass size={22} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search programs..." aria-label="Search programs" /></label>
          <button type="button" className="secondary-button soft-button"><Funnel size={20} /> Filters</button>
        </div>
        {filtered.length ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>University & program</th><th>Country</th><th>Deadline</th><th>Tuition</th><th>Funding</th><th>Priority</th><th aria-label="Actions" /></tr></thead>
              <tbody>{filtered.map((program) => (
                <tr key={program.id}>
                  <td><strong>{program.name}</strong><span>{program.program}</span></td><td>{program.country}</td>
                  <td><strong className="date-text">{formatShortDate(program.deadline)}</strong><span>{relativeDue(program.deadline)}</span></td>
                  <td>{program.tuition}</td><td>{program.funding}</td>
                  <td><span className={`priority-label ${program.priority?.toLowerCase()}`}>{program.priority}</span></td>
                  <td><button className="icon-button" type="button" onClick={() => openModal({ type: "program", program })} aria-label={`View ${program.name}`}><CaretRight size={22} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No matching programs" description="Try a broader university, program, or country search." />}
      </section>
    </div>
  );
}

function ApplicationsPage({ data, refresh, notify, openModal }) {
  const [view, setView] = useState("table");
  const joined = data.applications.map((application) => ({ ...application, program: data.programs.find((program) => program.id === application.programId) }));
  async function updateStatus(applicationId, status) {
    await db.applications.update(applicationId, { status });
    await refresh();
    notify(`Application moved to ${status}.`);
  }
  return (
    <div className="page">
      <PageHeader eyebrow="Application pipeline" title="Applications" description="Move each application from research to decision." action={<PrimaryButton onClick={() => openModal({ type: "add-application" })}>Add application</PrimaryButton>} />
      <section className="workspace-panel soft-panel">
        <div className="toolbar applications-toolbar">
          <div className="segmented soft-inset" aria-label="Application view">
            <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}><Table size={20} /> Table</button>
            <button type="button" className={view === "board" ? "active" : ""} onClick={() => setView("board")}><Kanban size={20} /> Board</button>
          </div><span className="count-label">{joined.length} applications</span>
        </div>
        {view === "table" ? (
          <div className="data-table-wrap"><table className="data-table applications-table">
            <thead><tr><th>Program</th><th>Status</th><th>Deadline</th><th>Progress</th><th>Priority</th></tr></thead>
            <tbody>{joined.map((application) => (
              <tr key={application.id}>
                <td><strong>{application.program?.name}</strong><span>{application.program?.program}</span></td>
                <td><select value={application.status} onChange={(event) => updateStatus(application.id, event.target.value)} aria-label={`Status for ${application.program?.name}`}>{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></td>
                <td><strong className="date-text">{formatShortDate(application.deadline)}</strong><span>{relativeDue(application.deadline)}</span></td>
                <td><div className="progress-cell"><span>{application.progress}%</span><progress max="100" value={application.progress} /></div></td>
                <td><span className={`priority-label ${application.program?.priority?.toLowerCase()}`}>{application.program?.priority}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : (
          <div className="kanban-board">{STATUS_OPTIONS.slice(0, 4).map((status) => (
            <section className="kanban-column soft-inset" key={status}>
              <header><h3>{status}</h3><span>{joined.filter((item) => item.status === status).length}</span></header>
              {joined.filter((item) => item.status === status).map((application) => (
                <article className="kanban-card soft-panel" key={application.id}>
                  <strong>{application.program?.name}</strong><span>{application.program?.program}</span><small>{formatShortDate(application.deadline)}</small>
                  <select value={application.status} onChange={(event) => updateStatus(application.id, event.target.value)} aria-label={`Move ${application.program?.name}`}>{STATUS_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select>
                </article>
              ))}
            </section>
          ))}</div>
        )}
      </section>
    </div>
  );
}

function DocumentsPage({ data, refresh, notify }) {
  const inputRef = useRef(null);
  const [selectedId, setSelectedId] = useState(data.documents[0]?.id);
  const [query, setQuery] = useState("");
  const selected = data.documents.find((document) => document.id === selectedId) || data.documents[0];
  const filtered = data.documents.filter((document) => document.name.toLowerCase().includes(query.toLowerCase()));
  async function addDocuments(files) {
    for (const file of files) {
      const category = file.type.includes("image") ? "Identity" : file.name.toLowerCase().includes("statement") ? "Essays" : "Academic";
      await db.documents.add({ name: file.name, category, size: file.size, type: file.type || "application/octet-stream", updatedAt: toIsoDate(new Date()), version: "1.0", linkedProgramIds: [], blob: file, isExample: false });
    }
    await refresh();
    notify(`${files.length} document${files.length === 1 ? "" : "s"} stored on this device.`);
  }
  function downloadDocument(document) {
    if (!document.blob) return notify("This example record has no file attached. Add your own document to download it.");
    downloadBlob(document.blob, document.name);
  }
  async function removeDocument(document) {
    await db.documents.delete(document.id); setSelectedId(undefined); await refresh(); notify("Document removed from this device.");
  }
  return (
    <div className="page">
      <PageHeader eyebrow="Private document library" title="Documents" description="Store once, then reuse across applications." localMessage="Stored only on this device" action={<><input ref={inputRef} className="visually-hidden" tabIndex="-1" type="file" multiple onChange={(event) => addDocuments([...event.target.files])} /><PrimaryButton onClick={() => inputRef.current?.click()}>Add document</PrimaryButton></>} />
      <div className="document-workspace">
        <section className="document-list soft-panel">
          <label className="search-field soft-inset"><MagnifyingGlass size={22} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents..." aria-label="Search documents" /></label>
          <div className="document-rows">{filtered.map((document) => (
            <button type="button" className={`document-row ${selected?.id === document.id ? "selected" : ""}`} key={document.id} onClick={() => setSelectedId(document.id)}>
              <span className="file-icon soft-button"><FileText size={24} weight="duotone" /></span><span className="document-name"><strong>{document.name}</strong><small>{document.category}</small></span><span>{formatBytes(document.size)}</span><span>{formatShortDate(document.updatedAt)}</span><span>v{document.version}</span><CaretRight size={21} />
            </button>
          ))}</div>
        </section>
        <aside className="document-detail soft-panel">
          {selected ? <>
            <div className="detail-title"><span className="file-icon large soft-button"><FileText size={31} weight="duotone" /></span><div><span>Selected document</span><h2>{selected.name.replace(/\.[^.]+$/, "")}</h2></div></div>
            <dl><div><dt>File name</dt><dd>{selected.name}</dd></div><div><dt>Size</dt><dd>{formatBytes(selected.size)}</dd></div><div><dt>Updated</dt><dd>{formatShortDate(selected.updatedAt)}</dd></div><div><dt>Version</dt><dd>v{selected.version}</dd></div></dl>
            <div className="linked-section"><h3>Used by {selected.linkedProgramIds?.length || 0} applications</h3>{selected.linkedProgramIds?.map((id) => { const program = data.programs.find((item) => item.id === id); return program ? <div className="linked-row" key={id}><GraduationCap size={21} /><span><strong>{program.name}</strong><small>{program.program}</small></span><CheckCircle size={20} /></div> : null; })}</div>
            <div className="detail-actions"><button className="secondary-button soft-button" type="button" onClick={() => downloadDocument(selected)}><DownloadSimple size={20} /> Download</button><button className="danger-button soft-button" type="button" onClick={() => removeDocument(selected)}><Trash size={20} /> Remove</button></div>
          </> : <EmptyState title="No document selected" description="Choose a file to see its application links." />}
        </aside>
      </div>
    </div>
  );
}

function CalendarPage({ data, openModal }) {
  const events = [...data.tasks.map((task) => ({ id: `task-${task.id}`, date: task.dueDate, title: task.title, type: task.done ? "Complete" : "Task", task })), ...data.programs.map((program) => ({ id: `program-${program.id}`, date: program.deadline, title: `${program.name} deadline`, type: "Application", program }))].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="page">
      <PageHeader eyebrow="Deadline calendar" title="Calendar" description="Every task and application date in one place." />
      <section className="calendar-panel soft-panel">
        <div className="calendar-summary soft-inset"><CalendarBlank size={32} weight="duotone" /><div><span>Next deadline</span><strong>{events.find((event) => daysUntil(event.date) >= 0)?.title || "Nothing scheduled"}</strong></div></div>
        <div className="agenda-list">{events.map((event) => { const date = formatTaskDate(event.date); return (
          <button type="button" className="agenda-row" key={event.id} onClick={() => openModal(event.task ? { type: "task", task: event.task } : { type: "program", program: event.program })}>
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
      <PageHeader eyebrow="Data ownership" title="Backup & transfer" description="Your information stays portable and under your control." />
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
        </section>
        <section className="backup-card storage-card soft-panel">
          <span className="feature-icon soft-button"><HardDrive size={28} weight="duotone" /></span><div><span className="section-kicker">This browser</span><h2>Storage health</h2><p>{storage.persistent ? "Persistent storage is enabled." : "Storage is currently best-effort."}</p></div>
          <div className="storage-meter" aria-label={`${percent}% of browser storage used`}><span style={{ width: `${Math.max(percent, 2)}%` }} /></div><span className="storage-copy">{formatBytes(storage.used)} used of {formatBytes(storage.quota)}</span>
          <button className="secondary-button soft-button" type="button" onClick={requestPersistence} disabled={storage.persistent}><Database size={20} />{storage.persistent ? "Storage protected" : "Protect local storage"}</button>
        </section>
        <section className="backup-card install-card soft-panel">
          <span className="feature-icon soft-button"><DownloadSimple size={28} weight="duotone" /></span><div><span className="section-kicker">Offline app</span><h2>Install Apply 2027</h2><p>Open it like an app and keep working without an internet connection.</p></div>
          <button className="secondary-button soft-button" type="button" onClick={installApp} disabled={!installPrompt}><DownloadSimple size={20} />{installPrompt ? "Install app" : "Already installed or unavailable"}</button>
        </section>
      </div>
    </div>
  );
}

function TaskModal({ task, programs, refresh, notify, close }) {
  const program = programFor(programs, task);
  async function toggleDone() { await db.tasks.update(task.id, { done: !task.done }); await refresh(); notify(task.done ? "Task reopened." : "Task completed."); close(); }
  async function remove() { await db.tasks.delete(task.id); await refresh(); notify("Task removed."); close(); }
  return (
    <Modal title="Task details" onClose={close}>
      <div className="modal-task"><span className="section-kicker">{relativeDue(task.dueDate)}</span><h3>{task.title}</h3><p>{task.note}</p>
        <dl><div><dt>Application</dt><dd>{program?.name || "General"}</dd></div><div><dt>Due</dt><dd>{formatShortDate(task.dueDate)}</dd></div><div><dt>Priority</dt><dd>{task.priority}</dd></div></dl>
        <div className="modal-footer"><button className="danger-button soft-button" type="button" onClick={remove}><Trash size={20} />Remove</button><PrimaryButton icon={task.done ? Clock : Check} onClick={toggleDone}>{task.done ? "Reopen task" : "Mark complete"}</PrimaryButton></div>
      </div>
    </Modal>
  );
}

function AddTaskModal({ programs, refresh, notify, close }) {
  const [title, setTitle] = useState(""); const [programId, setProgramId] = useState(programs[0]?.id || ""); const [dueDate, setDueDate] = useState(addDaysIso(7)); const [priority, setPriority] = useState("Medium"); const [note, setNote] = useState("");
  async function submit(event) {
    event.preventDefault(); if (!title.trim()) return;
    const application = await db.applications.where("programId").equals(Number(programId)).first();
    await db.tasks.add({ title: title.trim(), applicationId: application?.id, programIds: programId ? [Number(programId)] : [], dueDate, done: false, priority, note: note.trim() });
    await refresh(); notify("Task added to your timeline."); close();
  }
  return (
    <Modal title="Add task" onClose={close}><form className="form-stack" onSubmit={submit}>
      <label>Task name<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Request recommendation letter" /></label>
      <div className="form-grid"><label>Application<select value={programId} onChange={(event) => setProgramId(event.target.value)}>{programs.map((program) => <option value={program.id} key={program.id}>{program.name}</option>)}</select></label><label>Due date<input required type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
      <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option>Low</option><option>Medium</option><option>High</option></select></label>
      <label>Notes<textarea rows="3" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context or next step" /></label>
      <div className="modal-footer"><button className="secondary-button soft-button" type="button" onClick={close}>Cancel</button><PrimaryButton type="submit">Add task</PrimaryButton></div>
    </form></Modal>
  );
}

function AddProgramModal({ refresh, notify, close, createApplication = false }) {
  const [form, setForm] = useState({ name: "", program: "", country: "", deadline: addDaysIso(90), priority: "Medium", status: "Researching" });
  function change(key, value) { setForm((current) => ({ ...current, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    const id = await db.programs.add({ ...form, tuition: "Not added", funding: "Not added", url: "", notes: "" });
    if (createApplication) await db.applications.add({ programId: id, status: form.status, deadline: form.deadline, progress: 0 });
    await refresh(); notify(createApplication ? "Application added." : "Program added."); close();
  }
  return (
    <Modal title={createApplication ? "Add application" : "Add program"} onClose={close}><form className="form-stack" onSubmit={submit}>
      <label>University<input autoFocus required value={form.name} onChange={(event) => change("name", event.target.value)} placeholder="University name" /></label><label>Program<input required value={form.program} onChange={(event) => change("program", event.target.value)} placeholder="Degree and subject" /></label>
      <div className="form-grid"><label>Country<input required value={form.country} onChange={(event) => change("country", event.target.value)} /></label><label>Deadline<input required type="date" value={form.deadline} onChange={(event) => change("deadline", event.target.value)} /></label></div>
      <div className="form-grid"><label>Priority<select value={form.priority} onChange={(event) => change("priority", event.target.value)}><option>Low</option><option>Medium</option><option>High</option></select></label>{createApplication ? <label>Status<select value={form.status} onChange={(event) => change("status", event.target.value)}>{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label> : null}</div>
      <div className="modal-footer"><button className="secondary-button soft-button" type="button" onClick={close}>Cancel</button><PrimaryButton type="submit">{createApplication ? "Add application" : "Add program"}</PrimaryButton></div>
    </form></Modal>
  );
}

function ProgramModal({ program, close }) {
  return (
    <Modal title={program.name} onClose={close}><div className="program-detail"><span className="section-kicker">{program.country}</span><h3>{program.program}</h3><p>{program.notes || "No notes yet."}</p>
      <dl><div><dt>Deadline</dt><dd>{formatShortDate(program.deadline)}</dd></div><div><dt>Tuition</dt><dd>{program.tuition}</dd></div><div><dt>Funding</dt><dd>{program.funding}</dd></div><div><dt>Priority</dt><dd>{program.priority}</dd></div></dl>
      <div className="modal-footer"><button className="secondary-button soft-button" type="button" onClick={close}>Close</button>{program.url ? <a className="primary-button" href={program.url} target="_blank" rel="noreferrer"><span>Open university site</span><ArrowRight size={21} /></a> : null}</div>
    </div></Modal>
  );
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [data, setData] = useState({ programs: [], applications: [], tasks: [], documents: [] });
  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  async function refresh() { setData(await readAllData()); }
  useEffect(() => {
    let active = true;
    seedDatabase().then(readAllData).then((value) => { if (active) { setData(value); setReady(true); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!window.location.hash) window.location.hash = "/today";
    const handleHash = () => setRoute(currentRoute());
    const handleInstall = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("hashchange", handleHash); window.addEventListener("beforeinstallprompt", handleInstall);
    return () => { window.removeEventListener("hashchange", handleHash); window.removeEventListener("beforeinstallprompt", handleInstall); };
  }, []);
  useEffect(() => { if (!toast) return undefined; const timeout = window.setTimeout(() => setToast(""), 3600); return () => window.clearTimeout(timeout); }, [toast]);
  function navigate(next) { window.location.hash = `/${next}`; setRoute(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function installApp() { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); }
  const common = { data, refresh, notify: setToast, openModal: setModal };
  const pages = { today: <TodayPage {...common} />, programs: <ProgramsPage {...common} />, applications: <ApplicationsPage {...common} />, documents: <DocumentsPage {...common} />, calendar: <CalendarPage {...common} />, backup: <BackupPage {...common} installPrompt={installPrompt} installApp={installApp} /> };
  if (!ready) return <main className="loading-screen"><img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" /><strong>Opening Apply 2027…</strong><span>Your local workspace is loading.</span></main>;
  return (
    <div className="app-shell">
      <TopNavigation route={route} navigate={navigate} /><main className="app-main">{pages[route]}</main>
      {modal?.type === "task" ? <TaskModal task={modal.task} programs={data.programs} refresh={refresh} notify={setToast} close={() => setModal(null)} /> : null}
      {modal?.type === "add-task" ? <AddTaskModal programs={data.programs} refresh={refresh} notify={setToast} close={() => setModal(null)} /> : null}
      {modal?.type === "add-program" ? <AddProgramModal refresh={refresh} notify={setToast} close={() => setModal(null)} /> : null}
      {modal?.type === "add-application" ? <AddProgramModal createApplication refresh={refresh} notify={setToast} close={() => setModal(null)} /> : null}
      {modal?.type === "program" ? <ProgramModal program={modal.program} close={() => setModal(null)} /> : null}
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite"><CheckCircle size={21} />{toast}</div>
    </div>
  );
}
