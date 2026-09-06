import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  CaretLeft,
  CalendarBlank,
  CalendarCheck,
  CaretRight,
  CheckCircle,
  Clock,
  Database,
  DownloadSimple,
  FilePlus,
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
import { db, readAllData, seedDatabase } from "./db.js";
import { PrimaryButton } from "./ui.jsx";
import kamiunityLogo from "./assets/kamiunity-logo.png";
import emptyApplication from "./assets/empty-application.png";
import emptyDocuments from "./assets/empty-documents.png";
import { ApplicationChecklistForm, ApplicationWorkspace } from "./ApplicationWorkspace.jsx";
import { ApplicationForm, DocumentForm, ExternalLink, ProgramForm, TaskForm } from "./WorkflowForms.jsx";
import { catalogToProgram, importCatalogCsv, programKey, replaceCatalog, syncCatalogFromUrl } from "./catalog.js";
import { CATALOG_AUTO_SYNC_SETTING_KEY, DEFAULT_CATALOG_SOURCE, SHARED_CATALOG_SOURCE, STARTER_CATALOG } from "./catalog-data.js";
import { POLIMI_CATALOG } from "./polimi-data.js";
import { applicationDocuments, deadlineEvents, saveProgram, STATUS_OPTIONS } from "./workflow.js";
import { isPolitecnicoDiMilano } from "./program-taxonomy.js";
import {
  downloadBlob,
  exportEncryptedBackup,
  exportWorkbook,
  formatBytes,
  importWorkbook,
  readEncryptedBackup,
  restoreBackup,
} from "./backup.js";

const ROUTES = ["deadlines", "programs", "applications", "documents", "backup"];
const NAV_ITEMS = [
  { id: "deadlines", label: "Deadlines", icon: CalendarCheck },
  { id: "applications", label: "My applications", icon: FolderSimple },
  { id: "programs", label: "Program shortlist", icon: GraduationCap },
  { id: "documents", label: "Document vault", icon: FileText },
];

function currentRoute() {
  const value = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  if (value === "today" || value === "calendar") return "deadlines";
  return ROUTES.includes(value) ? value : "applications";
}

const SHARED_CATALOG_SHEET_ID = "1vu_kdUPWucy6F7lUvieuTA5MHct18aj-eha8FYTDK_s";
const isSharedCatalogUrl = (input) => String(input || "").includes(`/spreadsheets/d/${SHARED_CATALOG_SHEET_ID}/`);

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
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
  if (days === 0) return "Due now";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function deadlineDays(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const days = daysUntil(value);
  return Number.isFinite(days) ? days : null;
}

function qsRank(program) {
  const directValue = String(program?.qsRanking ?? program?.qsRank ?? program?.ranking ?? "");
  const directNumbers = directValue.match(/\d+/g);
  if (directNumbers?.length) return Number(directNumbers[directNumbers.length - 1]);
  const note = String(program?.notes || "");
  const match = note.match(/(?:QS(?:\s+WUR)?[^#\n]*)#\s*(?:=|≤)?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function programSearchText(program) {
  return [
    program?.name,
    program?.program,
    program?.country,
    program?.city,
    program?.department,
    program?.category,
    program?.degreeLevel,
    program?.intake,
    program?.language,
    program?.studyMode,
    program?.funding,
    program?.requirements,
    program?.languageRequirements,
    program?.notes,
    program?.qsRanking,
    qsRank(program),
    ...(program?.professors || []).flatMap((professor) => [professor.name, professor.email, professor.lab]),
  ].filter(Boolean).join(" ").toLowerCase();
}

function comparePrograms(first, second, sort) {
  const textCompare = (left, right) => String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base" });
  if (sort === "default") {
    const polimiFirst = Number(isPolitecnicoDiMilano(second)) - Number(isPolitecnicoDiMilano(first));
    return polimiFirst || (deadlineDays(first.deadline) ?? Number.POSITIVE_INFINITY) - (deadlineDays(second.deadline) ?? Number.POSITIVE_INFINITY) || textCompare(first.name, second.name) || textCompare(first.program, second.program);
  }
  if (sort === "university") return textCompare(first.name, second.name) || textCompare(first.program, second.program);
  if (sort === "program") return textCompare(first.program, second.program) || textCompare(first.name, second.name);
  if (sort === "deadline") return (deadlineDays(first.deadline) ?? Number.POSITIVE_INFINITY) - (deadlineDays(second.deadline) ?? Number.POSITIVE_INFINITY) || textCompare(first.name, second.name);
  if (sort === "ranking") return (qsRank(first) ?? Number.POSITIVE_INFINITY) - (qsRank(second) ?? Number.POSITIVE_INFINITY) || textCompare(first.name, second.name);
  return 0;
}

function TopNavigation({ route, navigate, openModal }) {
  const navigateFromMobile = (nextRoute) => navigate(nextRoute);
  return (
    <>
      <header className="topbar desktop-navigation">
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
              <span className="nav-item-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="brand-utilities"><span><CheckCircle size={19} />Saved on this device</span><button className={`backup-nav-button ${route === "backup" ? "active" : ""}`} type="button" onClick={() => navigate("backup")} aria-label="Backup and transfer" title="Backup & transfer"><Archive size={21} /><span>Backup</span></button></div>
      </header>
      <nav className="mobile-navigation" aria-label="Mobile navigation">
        <button className={`mobile-backup-button ${route === "backup" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("backup")} aria-label="Backup and transfer" title="Backup & transfer"><Archive size={21} weight={route === "backup" ? "duotone" : "regular"} /><span className="visually-hidden">Backup and transfer</span></button>
        <div className="mobile-nav-bar">
          <button className={`mobile-nav-item ${route === "applications" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("applications")} aria-current={route === "applications" ? "page" : undefined} aria-label="Applications" title="Applications"><span className="mobile-nav-icon"><FolderSimple size={23} weight={route === "applications" ? "duotone" : "regular"} /></span><span className="visually-hidden">Applications</span></button>
          <button className={`mobile-nav-item ${route === "programs" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("programs")} aria-current={route === "programs" ? "page" : undefined} aria-label="Programs" title="Programs"><span className="mobile-nav-icon"><GraduationCap size={23} weight={route === "programs" ? "duotone" : "regular"} /></span><span className="visually-hidden">Programs</span></button>
          <button className="mobile-nav-item mobile-nav-add" type="button" onClick={() => openModal({ type: "add-document" })} aria-label="Add document" title="Add document"><span className="mobile-nav-icon"><FilePlus size={27} weight="bold" /></span><span className="visually-hidden">Add document</span></button>
          <button className={`mobile-nav-item ${route === "deadlines" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("deadlines")} aria-current={route === "deadlines" ? "page" : undefined} aria-label="Deadlines" title="Deadlines"><span className="mobile-nav-icon"><CalendarCheck size={23} weight={route === "deadlines" ? "duotone" : "regular"} /></span><span className="visually-hidden">Deadlines</span></button>
          <button className={`mobile-nav-item ${route === "documents" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("documents")} aria-current={route === "documents" ? "page" : undefined} aria-label="Document vault" title="Document vault"><span className="mobile-nav-icon"><FileText size={23} weight={route === "documents" ? "duotone" : "regular"} /></span><span className="visually-hidden">Document vault</span></button>
        </div>
      </nav>
    </>
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

function FirstUseState({ image, imageAlt = "", eyebrow, title, description, primaryLabel, onPrimary, secondaryLabel, onSecondary, className = "" }) {
  return (
    <section className={`first-use-state soft-panel ${className}`}>
      <div className="first-use-art-wrap"><img className="first-use-art" src={image} alt={imageAlt} /></div>
      <div className="first-use-copy">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="first-use-actions">
          <PrimaryButton onClick={onPrimary}>{primaryLabel}</PrimaryButton>
          {secondaryLabel ? <button className="secondary-button soft-button" type="button" onClick={onSecondary}>{secondaryLabel}</button> : null}
        </div>
      </div>
    </section>
  );
}

function Pagination({ page, pageCount, pageSize, total, onPageChange, onPageSizeChange, label = "programs" }) {
  if (!total) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageNumbers = [...new Set([1, page - 1, page, page + 1, pageCount].filter((number) => number >= 1 && number <= pageCount))].sort((a, b) => a - b);
  return (
    <nav className="pagination" aria-label={`${label} pagination`}>
      <span className="pagination-summary">Showing {start}–{end} of {total} {label}</span>
      <div className="pagination-controls">
        <button className="pagination-arrow" type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page"><CaretLeft size={18} /></button>
        <div className="pagination-pages">
          {pageNumbers.map((number, index) => <Fragment key={number}>{index > 0 && number - pageNumbers[index - 1] > 1 ? <span className="pagination-ellipsis" aria-hidden="true">…</span> : null}<button className={number === page ? "active" : ""} type="button" aria-current={number === page ? "page" : undefined} onClick={() => onPageChange(number)}>{number}</button></Fragment>)}
        </div>
        <button className="pagination-arrow" type="button" disabled={page === pageCount} onClick={() => onPageChange(page + 1)} aria-label="Next page"><CaretRight size={18} /></button>
      </div>
      <label className="pagination-size">Rows <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option value="10">10</option><option value="25">25</option><option value="50">50</option></select></label>
    </nav>
  );
}

function deadlineTitle(event) {
  const programName = event.program?.name || "Untitled program";
  const program = event.program?.program ? ` · ${event.program.program}` : "";
  return `${programName}${program}`;
}

function deadlineAction(event, openModal) {
  if (event.application) return openModal({ type: "application", application: event.application });
  return openModal({ type: "program", program: event.program });
}

function DeadlineAgenda({ events, openModal }) {
  return <div className="deadline-agenda">{events.map((event) => {
    const date = formatTaskDate(event.deadline);
    const days = daysUntil(event.deadline);
    const urgency = days < 0 ? "overdue" : days <= 14 ? "urgent" : days <= 30 ? "soon" : "steady";
    return (
      <button type="button" className={`deadline-agenda-row ${urgency}`} key={event.id} onClick={() => deadlineAction(event, openModal)}>
        <span className="deadline-agenda-date"><strong>{date.date}</strong><span>{date.weekday}</span></span>
        <span className="deadline-agenda-marker" aria-hidden="true" />
        <span className="deadline-agenda-copy"><strong>{deadlineTitle(event)}</strong><span>{event.application ? "Application deadline" : "Program deadline"}{event.application?.intake ? ` · ${event.application.intake}` : ""}</span></span>
        <span className="deadline-status-chip"><Clock size={19} />{relativeDue(event.deadline)}</span>
        <CaretRight size={22} />
      </button>
    );
  })}</div>;
}

function DeadlinesPage({ data, openModal }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const events = useMemo(() => deadlineEvents(data), [data]);
  const nextEvent = events.find((event) => daysUntil(event.deadline) >= 0) || events[0];
  const dueSoonCount = events.filter((event) => { const days = daysUntil(event.deadline); return days >= 0 && days <= 30; }).length;
  const overdueCount = events.filter((event) => daysUntil(event.deadline) < 0).length;
  const unscheduledCount = data.programs.filter((program) => !program.deadline).length;
  const filteredEvents = useMemo(() => {
    const search = query.trim().toLowerCase();
    return events.filter((event) => {
      const days = daysUntil(event.deadline);
      if (filter === "next-30" && (days < 0 || days > 30)) return false;
      if (filter === "overdue" && days >= 0) return false;
      if (filter === "programs" && event.application) return false;
      if (filter === "applications" && !event.application) return false;
      if (search && !`${deadlineTitle(event)} ${event.program?.country || ""} ${event.program?.city || ""} ${event.application?.intake || ""}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [events, filter, query]);

  return (
    <div className="page deadlines-page">
      <PageHeader
        eyebrow="Your application datebook"
        title="Deadlines"
        description="Every important program and application date, sorted so the next one is easy to spot."
        action={<div className="deadline-page-actions"><button className="secondary-button soft-button" type="button" onClick={() => openModal({ type: "add-task" })}>Add task</button><PrimaryButton onClick={() => openModal({ type: "add-application" })}>Add application</PrimaryButton></div>}
      />

      <section className="deadline-hero soft-panel" aria-labelledby="deadline-hero-title">
        <div className="deadline-hero-copy">
          <span className="section-kicker">Deadline desk</span>
          <h2 id="deadline-hero-title">See the dates before they become emergencies.</h2>
          <p>Use this page as your visual runway: check what is close, clear overdue dates, and open any deadline to update the source record.</p>
        </div>
        <div className="deadline-hero-note">
          <span>Next on the radar</span>
          {nextEvent ? <><strong>{formatDeadlineDate(nextEvent.deadline)}</strong><p>{deadlineTitle(nextEvent)}</p><small>{relativeDue(nextEvent.deadline)} · {nextEvent.application ? "Application" : "Program"}</small></> : <><strong>No dates yet</strong><p>Add a program or application deadline to start your runway.</p></>}
        </div>
      </section>

      <section className="deadline-metrics" aria-label="Deadline summary">
        <article className="deadline-metric deadline-metric-next soft-inset"><span className="deadline-metric-icon"><CalendarBlank size={24} weight="duotone" /></span><div><span>Next date</span><strong>{nextEvent ? formatDeadlineDate(nextEvent.deadline) : "—"}</strong><small>{nextEvent ? relativeDue(nextEvent.deadline) : "Nothing scheduled"}</small></div></article>
        <article className="deadline-metric deadline-metric-soon soft-inset"><span className="deadline-metric-icon"><Clock size={24} weight="duotone" /></span><div><span>Due within 30 days</span><strong>{dueSoonCount}</strong><small>{dueSoonCount === 1 ? "date needs attention" : "dates need attention"}</small></div></article>
        <article className="deadline-metric deadline-metric-overdue soft-inset"><span className="deadline-metric-icon"><WarningCircle size={24} weight="duotone" /></span><div><span>Overdue</span><strong>{overdueCount}</strong><small>{overdueCount ? "Open and update these dates" : "You are all caught up"}</small></div></article>
        <article className="deadline-metric deadline-metric-unscheduled soft-inset"><span className="deadline-metric-icon"><GraduationCap size={24} weight="duotone" /></span><div><span>Programs without dates</span><strong>{unscheduledCount}</strong><small>{unscheduledCount ? "Add dates from your shortlist" : "Every program has a date"}</small></div></article>
      </section>

      <section className="deadline-board soft-panel" aria-labelledby="deadline-board-title">
        <div className="deadline-board-heading"><div><span className="section-kicker">Your datebook</span><h2 id="deadline-board-title">All tracked deadlines</h2><p>Open a row to edit the program or application it belongs to.</p></div><span className="deadline-count">{filteredEvents.length} of {events.length} dates</span></div>
        <div className="deadline-board-controls">
          <label className="search-field soft-inset"><MagnifyingGlass size={21} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search deadlines…" aria-label="Search deadlines" />{query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label="Clear deadline search"><X size={17} /></button> : null}</label>
          <div className="segmented soft-inset" aria-label="Deadline filters"><button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>All</button><button className={filter === "next-30" ? "active" : ""} type="button" onClick={() => setFilter("next-30")}>Next 30 days</button><button className={filter === "overdue" ? "active" : ""} type="button" onClick={() => setFilter("overdue")}>Overdue</button><button className={filter === "programs" ? "active" : ""} type="button" onClick={() => setFilter("programs")}>Programs</button><button className={filter === "applications" ? "active" : ""} type="button" onClick={() => setFilter("applications")}>Applications</button></div>
        </div>
        {filteredEvents.length ? <DeadlineAgenda events={filteredEvents} openModal={openModal} /> : <div className="deadline-empty"><EmptyState title={events.length ? "No deadlines match" : "Your datebook is waiting"} description={events.length ? "Try a different search or filter." : "Add a program deadline or start an application to give your datebook something to track."} /></div>}
      </section>
    </div>
  );
}

function formatCatalogTimestamp(value) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not synced yet";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function CatalogConnection({ source, catalogCount, syncCatalog, importCatalog, resetCatalog, notify }) {
  const [open, setOpen] = useState(false);
  const [inputUrl, setInputUrl] = useState(source?.inputUrl || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
  const isConnected = source?.mode === "google-sheet";
  useEffect(() => { setInputUrl(source?.inputUrl || ""); }, [source?.inputUrl]);

  async function connect(event) {
    event.preventDefault();
    if (!inputUrl.trim()) { setError("Paste a Google Sheet or public CSV URL."); return; }
    setBusy(true); setError("");
    try {
      const result = await syncCatalog(inputUrl);
      notify(`${result.records.length} program${result.records.length === 1 ? "" : "s"} synced${result.skipped.length ? ` · ${result.skipped.length} row${result.skipped.length === 1 ? "" : "s"} skipped` : ""}.`);
      setOpen(false);
    } catch (failure) { setError(failure.message || "The catalog could not be synced."); }
    finally { setBusy(false); }
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setError("");
    try {
      const result = await importCatalog(await file.text(), file.name);
      notify(`${result.records.length} program${result.records.length === 1 ? "" : "s"} imported${result.skipped.length ? ` · ${result.skipped.length} row${result.skipped.length === 1 ? "" : "s"} skipped` : ""}.`);
      setOpen(false);
    } catch (failure) { setError(failure.message || "The CSV could not be imported."); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function useStarterCatalog() {
    setBusy(true); setError("");
    try { await resetCatalog(); notify("The starter catalog is ready. Verify every detail before applying."); setOpen(false); }
    catch (failure) { setError(failure.message || "The starter catalog could not be restored."); }
    finally { setBusy(false); }
  }

  const label = isConnected ? "Shared Google Sheet" : source?.mode === "file" ? "Imported CSV" : "Starter catalog";
  return <section className="catalog-connection soft-inset" aria-labelledby="catalog-source-heading">
    <div className="catalog-connection-copy"><span className="section-kicker">Program database</span><h2 id="catalog-source-heading">{label}</h2><p>{isConnected ? "Search the shared read-only catalog, then save programs to your private shortlist." : "Start with example records, or connect a published Google Sheet that your students can browse."}</p><small>{catalogCount} programs · {source?.lastSyncedAt ? `Last synced ${formatCatalogTimestamp(source.lastSyncedAt)}` : "Starter records are ready to replace"}{source?.skippedRows ? ` · ${source.skippedRows} rows skipped` : ""}</small></div>
    <div className="catalog-connection-actions"><span className="catalog-source-chip"><Database size={18} />{isConnected ? "Read-only source" : "Local snapshot"}</span><button className="secondary-button soft-button" type="button" onClick={() => { setError(""); setOpen((value) => !value); }}>{open ? "Close source settings" : isConnected ? "Change source" : "Connect a sheet"}</button></div>
    {open ? <form className="catalog-connect-form" onSubmit={connect}>
      <label className="field-label">Published Google Sheet or CSV URL<input className="soft-inset" type="url" value={inputUrl} onChange={(event) => setInputUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." autoComplete="off" /></label>
      <p className="field-help">In Google Sheets, use <strong>File → Share → Publish to web</strong> and choose CSV. The sheet must be readable without signing in. Kamiunity only reads rows; student edits stay on this device.</p>
      <div className="button-row"><PrimaryButton type="submit" disabled={busy}>{busy ? "Syncing…" : "Sync Google Sheet"}</PrimaryButton><input className="visually-hidden" ref={fileInput} type="file" accept=".csv,text/csv" onChange={importFile} /><button className="secondary-button soft-button" type="button" disabled={busy} onClick={() => fileInput.current?.click()}><UploadSimple size={20} /> Import CSV</button><button className="secondary-button" type="button" disabled={busy} onClick={useStarterCatalog}>Use starter catalog</button><a className="text-action catalog-template-link" href={`${import.meta.env.BASE_URL}kamiunity-program-database-template.csv`} download>Download sheet template</a></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form> : null}
  </section>;
}

function ProgramsPage({ data, openModal, notify, addCatalogProgram, syncCatalog, importCatalog, resetCatalog }) {
  const [view, setView] = useState("catalog");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priority, setPriority] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [degree, setDegree] = useState("");
  const [language, setLanguage] = useState("");
  const [intake, setIntake] = useState("");
  const [studyMode, setStudyMode] = useState("");
  const [deadlineFilter, setDeadlineFilter] = useState("all");
  const [rankFilter, setRankFilter] = useState("");
  const [sort, setSort] = useState("default");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pendingCatalogId, setPendingCatalogId] = useState("");
  const catalogPrograms = data.catalogPrograms || [];
  const sourcePrograms = view === "catalog" ? catalogPrograms : data.programs;
  const search = query.trim().toLowerCase();
  const filterOptions = useMemo(() => {
    const values = (key) => [...new Set(sourcePrograms.map((program) => program[key]).filter(Boolean))].sort((first, second) => String(first).localeCompare(String(second)));
    return { countries: values("country"), categories: values("category"), degrees: values("degreeLevel"), languages: values("language"), intakes: values("intake"), studyModes: values("studyMode"), priorities: values("priority") };
  }, [sourcePrograms]);
  const activeFilterCount = [country, category, degree, language, intake, studyMode, priority, rankFilter, deadlineFilter !== "all" ? deadlineFilter : ""].filter(Boolean).length;
  const filteredPrograms = useMemo(() => {
    const matches = sourcePrograms.filter((program) => {
      if (search && !programSearchText(program).includes(search)) return false;
      if (country && program.country !== country) return false;
      if (category && program.category !== category) return false;
      if (degree && program.degreeLevel !== degree) return false;
      if (language && program.language !== language) return false;
      if (intake && program.intake !== intake) return false;
      if (studyMode && program.studyMode !== studyMode) return false;
      if (priority && program.priority !== priority) return false;
      const rank = qsRank(program);
      if (rankFilter === "top-100" && (!rank || rank > 100)) return false;
      if (rankFilter === "101-300" && (!rank || rank < 101 || rank > 300)) return false;
      if (rankFilter === "301-500" && (!rank || rank < 301 || rank > 500)) return false;
      if (rankFilter === "501-1000" && (!rank || rank < 501 || rank > 1000)) return false;
      if (rankFilter === "1000-plus" && (!rank || rank < 1000)) return false;
      if (rankFilter === "unranked" && rank) return false;
      const days = deadlineDays(program.deadline);
      if (deadlineFilter === "set" && days === null) return false;
      if (deadlineFilter === "missing" && days !== null) return false;
      if (deadlineFilter === "next-30" && (days === null || days < 0 || days > 30)) return false;
      if (deadlineFilter === "next-90" && (days === null || days < 0 || days > 90)) return false;
      if (deadlineFilter === "overdue" && (days === null || days >= 0)) return false;
      return true;
    });
    return sort === "relevance" ? matches : [...matches].sort((first, second) => comparePrograms(first, second, sort));
  }, [sourcePrograms, search, country, category, degree, language, intake, studyMode, priority, rankFilter, deadlineFilter, sort]);
  const pageCount = Math.max(1, Math.ceil(filteredPrograms.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visiblePrograms = filteredPrograms.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasActiveSearch = Boolean(query.trim());
  useEffect(() => { setPage(1); }, [view, query, country, category, degree, language, intake, studyMode, priority, rankFilter, deadlineFilter, sort, pageSize]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  function clearFilters() {
    setQuery(""); setPriority(""); setCountry(""); setCategory(""); setDegree(""); setLanguage(""); setIntake(""); setStudyMode(""); setDeadlineFilter("all"); setRankFilter(""); setSort("default"); setPage(1);
  }
  function changeView(nextView) {
    setView(nextView); setQuery(""); setPriority(""); setCountry(""); setCategory(""); setDegree(""); setLanguage(""); setIntake(""); setStudyMode(""); setDeadlineFilter("all"); setRankFilter(""); setSort("default"); setPage(1);
  }
  function savedProgramFor(catalogProgram) { return data.programs.find((program) => (catalogProgram.catalogId && program.catalogId === catalogProgram.catalogId) || programKey(program) === programKey(catalogProgram)); }
  async function chooseCatalogProgram(catalogProgram, mode) {
    const saved = savedProgramFor(catalogProgram);
    const application = saved && data.applications.find((item) => item.programId === saved.id);
    if (mode === "application" && application) { openModal({ type: "application", application }); return; }
    setPendingCatalogId(catalogProgram.catalogId);
    try { await addCatalogProgram(catalogProgram, mode); }
    catch (failure) { notify(failure.message || "The program could not be added."); }
    finally { setPendingCatalogId(""); }
  }
  const countLabel = view === "catalog" ? `${filteredPrograms.length} matches` : `${filteredPrograms.length} saved`;
  const paginationLabel = view === "catalog" ? "programs" : "saved programs";
  return (
    <div className="page">
      <PageHeader eyebrow="Find your academic fit" title="Program shortlist" description="Search a shared program database, then bring the programs you want into your private application workspace." action={<PrimaryButton onClick={() => openModal({ type: "add-program" })}>Add program</PrimaryButton>} />
      <CatalogConnection source={data.catalogSource} catalogCount={catalogPrograms.length} syncCatalog={syncCatalog} importCatalog={importCatalog} resetCatalog={resetCatalog} notify={notify} />
      <section className="workspace-panel soft-panel">
        <div className="toolbar program-toolbar">
          <div className="segmented soft-inset" aria-label="Program view"><button className={view === "catalog" ? "active" : ""} type="button" aria-pressed={view === "catalog"} onClick={() => changeView("catalog")}>Browse database <span>{catalogPrograms.length}</span></button><button className={view === "shortlist" ? "active" : ""} type="button" aria-pressed={view === "shortlist"} onClick={() => changeView("shortlist")}>My shortlist <span>{data.programs.length}</span></button></div>
          <div className="program-search-group"><div className="search-field soft-inset"><MagnifyingGlass size={22} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === "catalog" ? "Search university, program, city, language…" : "Search your saved programs…"} aria-label={view === "catalog" ? "Search the program database" : "Search saved programs"} />{query ? <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label="Clear program search"><X size={17} /></button> : null}</div><button className={`filter-toggle secondary-button soft-button ${filtersOpen || activeFilterCount ? "is-active" : ""}`} type="button" aria-expanded={filtersOpen} aria-controls="program-filters" onClick={() => setFiltersOpen((open) => !open)}><Funnel size={19} />Filters{activeFilterCount ? <span>{activeFilterCount}</span> : null}</button></div>
          <span className="count-label">{countLabel}</span>
        </div>
        {filtersOpen ? <div className="program-filters-panel soft-inset" id="program-filters">
          <div className="program-filter-grid">
            <label className="advanced-filter"><span>Country</span><select aria-label="Filter by country" value={country} onChange={(event) => setCountry(event.target.value)}><option value="">All countries</option>{filterOptions.countries.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="advanced-filter"><span>Category</span><select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{filterOptions.categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="advanced-filter"><span>Degree level</span><select aria-label="Filter by degree level" value={degree} onChange={(event) => setDegree(event.target.value)}><option value="">All degree levels</option>{filterOptions.degrees.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="advanced-filter"><span>Language</span><select aria-label="Filter by language" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">All languages</option>{filterOptions.languages.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="advanced-filter"><span>Intake</span><select aria-label="Filter by intake" value={intake} onChange={(event) => setIntake(event.target.value)}><option value="">All intakes</option>{filterOptions.intakes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="advanced-filter"><span>Study mode</span><select aria-label="Filter by study mode" value={studyMode} onChange={(event) => setStudyMode(event.target.value)}><option value="">All study modes</option>{filterOptions.studyModes.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="advanced-filter"><span>QS ranking</span><select aria-label="Filter by QS ranking" value={rankFilter} onChange={(event) => setRankFilter(event.target.value)}><option value="">Any ranking</option><option value="top-100">Top 100</option><option value="101-300">101–300</option><option value="301-500">301–500</option><option value="501-1000">501–1000</option><option value="1000-plus">1000+</option><option value="unranked">Unranked / not added</option></select></label>
            <label className="advanced-filter"><span>Deadline</span><select aria-label="Filter by deadline" value={deadlineFilter} onChange={(event) => setDeadlineFilter(event.target.value)}><option value="all">Any deadline</option><option value="set">Deadline added</option><option value="missing">No deadline yet</option><option value="next-30">Due in 30 days</option><option value="next-90">Due in 90 days</option><option value="overdue">Overdue</option></select></label>
            <label className="advanced-filter"><span>Priority</span><select aria-label="Filter by priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">All priorities</option>{(filterOptions.priorities.length ? filterOptions.priorities : ["High", "Medium", "Low"]).map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <div className="program-filters-footer"><label className="program-sort"><span>Sort results</span><select aria-label="Sort programs" value={sort} onChange={(event) => setSort(event.target.value)}><option value="default">Politecnico di Milano first · deadline</option><option value="relevance">Relevance / source order</option><option value="university">University A–Z</option><option value="program">Program A–Z</option><option value="deadline">Deadline soonest</option><option value="ranking">QS ranking</option></select></label><span className="filter-result-copy">{countLabel}</span>{activeFilterCount || hasActiveSearch ? <button className="text-action clear-filters" type="button" onClick={clearFilters}>Clear all</button> : null}</div>
        </div> : null}
        {activeFilterCount || hasActiveSearch ? <div className="active-filter-summary"><span>{hasActiveSearch ? `Search: “${query.trim()}”` : "Filters active"}</span>{activeFilterCount ? <strong>{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}</strong> : null}<button className="text-action" type="button" onClick={clearFilters}>Clear all</button></div> : null}
        {view === "catalog" ? filteredPrograms.length ? <div className="catalog-result-list">{visiblePrograms.map((catalogProgram) => {
          const saved = savedProgramFor(catalogProgram);
          const application = saved && data.applications.find((item) => item.programId === saved.id);
          const pending = pendingCatalogId === catalogProgram.catalogId;
          const rank = qsRank(catalogProgram);
          return <article className="catalog-result" key={catalogProgram.id || catalogProgram.catalogId}>
            <div className="catalog-result-main"><span className="catalog-result-source">{catalogProgram.catalogSource || data.catalogSource?.label || "Program database"}</span><h3>{catalogProgram.name}</h3><p>{catalogProgram.program}</p><div className="catalog-result-meta"><span>{[catalogProgram.city, catalogProgram.country].filter(Boolean).join(", ") || "Location not added"}</span><span>{[catalogProgram.degreeLevel, catalogProgram.intake].filter(Boolean).join(" · ") || "Graduate program"}</span>{catalogProgram.category ? <span className="program-category-badge">{catalogProgram.category}</span> : null}{rank ? <span>QS #{rank}</span> : null}</div><ExternalLink url={catalogProgram.url}>Program website</ExternalLink></div>
            <div className="catalog-result-details"><div><small>Deadline</small><strong className={catalogProgram.deadline ? "date-text" : "muted-value"}>{catalogProgram.deadline ? formatShortDate(catalogProgram.deadline) : "Verify date"}</strong><span>{catalogProgram.deadline ? relativeDue(catalogProgram.deadline) : "Not added"}</span></div><div><small>Funding</small><strong>{catalogProgram.funding || "Not added"}</strong><span>{catalogProgram.tuition || "Tuition not added"}</span></div></div>
            <div className="catalog-result-actions">{saved ? <span className="catalog-saved"><CheckCircle size={19} />Saved to shortlist</span> : <button className="secondary-button soft-button" type="button" disabled={pending} onClick={() => chooseCatalogProgram(catalogProgram, "shortlist")}>{pending ? "Adding…" : "Add to shortlist"}</button>}{application ? <button className="text-action" type="button" onClick={() => openModal({ type: "application", application })}>Open application<CaretRight size={18} /></button> : <PrimaryButton disabled={pending} onClick={() => chooseCatalogProgram(catalogProgram, "application")}>{pending ? "Adding…" : "Start application"}</PrimaryButton>}</div>
            {catalogProgram.catalogLastVerified ? <small className="catalog-verification">{catalogProgram.catalogLastVerified}</small> : null}
          </article>;
        })}</div> : <EmptyState title="No matching catalog programs" description="Try a broader search, clear a filter, or connect a different Google Sheet." /> : filteredPrograms.length ? <>
          <div className="program-shortlist-desktop data-table-wrap"><table className="data-table program-shortlist-table"><thead><tr><th>University & program</th><th>Category</th><th>Country</th><th>Deadline</th><th>Tuition</th><th>Funding</th><th>Priority</th><th aria-label="Actions" /></tr></thead><tbody>{visiblePrograms.map((program) => <tr key={program.id}><td><button className="record-link" type="button" onClick={() => openModal({ type: "program", program })}><strong>{program.name}</strong><span>{program.program}</span></button><ExternalLink url={program.url}>Program website</ExternalLink><span>{data.documents.filter((document) => document.linkedProgramIds?.includes(program.id)).length} documents · {program.professors?.length || 0} professors</span></td><td><span className="program-category-badge">{program.category || "Other"}</span></td><td>{program.country || "Not added"}</td><td><strong className="date-text">{formatShortDate(program.deadline)}</strong><span>{relativeDue(program.deadline)}</span></td><td>{program.tuition || "Not added"}</td><td>{program.funding || "Not added"}</td><td><span className={`priority-label ${program.priority?.toLowerCase()}`}>{program.priority}</span></td><td><div className="record-actions"><button className="secondary-button soft-button" type="button" onClick={() => openModal({ type: "add-application", programId: program.id })}>Start application</button><button className="icon-button" type="button" onClick={() => openModal({ type: "program", program })} aria-label={`Edit ${program.name}`}><CaretRight size={22} /></button></div></td></tr>)}</tbody></table></div>
          <div className="program-shortlist-mobile" aria-label="Saved program cards">{visiblePrograms.map((program) => <article className="shortlist-card" key={program.id}>
            <div className="shortlist-card-heading"><div className="shortlist-card-identity"><span className="shortlist-card-kicker">{[program.city, program.country].filter(Boolean).join(", ") || "Location not added"}</span><button className="record-link" type="button" onClick={() => openModal({ type: "program", program })}><strong>{program.name}</strong><span>{program.program}</span></button></div><span className={`priority-label ${program.priority?.toLowerCase()}`}>{program.priority}</span></div>
            <div className="shortlist-card-meta"><div><small>Category</small><strong>{program.category || "Other"}</strong></div><div><small>Deadline</small><strong className="date-text">{formatShortDate(program.deadline)}</strong><span>{relativeDue(program.deadline)}</span></div><div><small>QS ranking</small><strong>{qsRank(program) ? `#${qsRank(program)}` : "Not added"}</strong></div></div>
            <div className="shortlist-card-footer"><span>{data.documents.filter((document) => document.linkedProgramIds?.includes(program.id)).length} documents · {program.professors?.length || 0} professors</span><ExternalLink url={program.url}>Program website</ExternalLink></div>
            <div className="shortlist-card-actions"><button className="secondary-button soft-button" type="button" onClick={() => openModal({ type: "add-application", programId: program.id })}>Start application</button><button className="icon-button" type="button" onClick={() => openModal({ type: "program", program })} aria-label={`Edit ${program.name}`}><CaretRight size={22} /></button></div>
          </article>)}</div>
        </> : <EmptyState title="No matching saved programs" description="Browse the database or add a program manually to start your shortlist." />}
        {filteredPrograms.length ? <Pagination page={currentPage} pageCount={pageCount} pageSize={pageSize} total={filteredPrograms.length} onPageChange={setPage} onPageSizeChange={setPageSize} label={paginationLabel} /> : null}
      </section>
    </div>
  );
}

function HomePage({ data, openModal, navigate }) {
  const catalogCount = data.catalogPrograms?.length || 0;
  const savedCount = data.programs?.length || 0;
  const documentCount = data.documents?.length || 0;
  const formatCount = (value) => new Intl.NumberFormat("en-US").format(value);
  const steps = [
    { number: "01", icon: GraduationCap, eyebrow: "Discover", title: "Find programs that fit", description: "Search the shared catalog by country, language, degree, deadline, or QS ranking.", action: "Browse programs", onClick: () => navigate("programs") },
    { number: "02", icon: FolderSimple, eyebrow: "Shortlist", title: "Save the ones worth pursuing", description: "Keep promising programs together, then start an application when the fit feels right.", action: "Build a shortlist", onClick: () => navigate("programs") },
    { number: "03", icon: FileText, eyebrow: "Prepare", title: "Build a connected dossier", description: "Link documents, requirements, and professor contacts to each application.", action: "Open document vault", onClick: () => navigate("documents") },
    { number: "04", icon: CalendarCheck, eyebrow: "Move forward", title: "Make the next date visible", description: "Track stages, tasks, and deadlines so nothing important stays in your head.", action: "See deadlines", onClick: () => navigate("deadlines") },
  ];

  return (
    <div className="page home-page">
      <section className="home-hero soft-panel" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <span className="eyebrow">A calmer application season</span>
          <h1 id="home-title">From first search to final submission.</h1>
          <p>Keep programs, deadlines, documents, and professor outreach connected in one private workspace built for graduate applications.</p>
          <div className="home-hero-actions">
            <PrimaryButton icon={ArrowRight} onClick={() => navigate("programs")}>Explore programs</PrimaryButton>
            <button className="secondary-button soft-button" type="button" onClick={() => openModal({ type: "add-application" })}>Add an application</button>
          </div>
          <div className="home-assurance"><span><CheckCircle size={18} />Saved on this device</span><span><CheckCircle size={18} />No account required</span></div>
        </div>
        <div className="home-hero-visual" aria-label="A preview of the connected application workflow">
          <div className="home-hero-badge"><span>START HERE</span><strong>One place for every next step.</strong></div>
          <div className="home-hero-image-frame"><img src={emptyApplication} alt="Illustration of an organized graduate application workspace" /></div>
          <div className="home-hero-float"><CalendarCheck size={23} /><span><small>Keep deadlines visible</small><strong>Your next date</strong></span></div>
        </div>
      </section>

      <section className="home-guide" aria-labelledby="home-guide-title">
        <div className="home-section-heading"><div><span className="section-kicker">How Kamiunity works</span><h2 id="home-guide-title">A simple path through a complicated process.</h2></div><p>Start small. Each piece you add becomes part of the same application story.</p></div>
        <div className="home-steps">
          {steps.map(({ number, icon: Icon, eyebrow, title, description, action, onClick }) => <article className="home-step soft-inset" key={number}><div className="home-step-top"><span className="home-step-number">{number}</span><Icon size={27} weight="duotone" /></div><span className="section-kicker">{eyebrow}</span><h3>{title}</h3><p>{description}</p><button className="text-action home-step-action" type="button" onClick={onClick}>{action}<ArrowRight size={17} /></button></article>)}
        </div>
      </section>

      <section className="home-overview-grid" aria-label="Kamiunity workspace overview">
        <article className="home-overview-card home-trust-card soft-inset"><div className="home-card-heading"><span className="home-card-icon"><HardDrive size={25} weight="duotone" /></span><div><span className="section-kicker">Private by default</span><h2>Your work stays yours.</h2></div></div><p>Kamiunity stores your records on this device. When you need a safety copy, create an encrypted backup from Backup & transfer.</p><div className="home-overview-points"><span><CheckCircle size={17} />Local-first workspace</span><span><CheckCircle size={17} />Portable Excel exports</span></div><button className="text-action" type="button" onClick={() => navigate("backup")}>Open Backup & transfer<ArrowRight size={17} /></button></article>
        <article className="home-overview-card home-start-card soft-panel"><span className="section-kicker">Your starting point</span><h2>Build momentum one record at a time.</h2><p>There is no perfect first step. Explore a program, save a possibility, or add the document you already have.</p><div className="home-stats"><div><strong>{formatCount(catalogCount)}</strong><span>programs to explore</span></div><div><strong>{formatCount(savedCount)}</strong><span>saved programs</span></div><div><strong>{formatCount(documentCount)}</strong><span>documents added</span></div></div></article>
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
  if (view === "dossier" && !data.applications.length) return <HomePage data={data} openModal={openModal} navigate={navigate} />;
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
        {!joined.length ? data.applications.length ? <EmptyState title="No matching applications" description="Try another university, degree, or intake." /> : <FirstUseState className="compact-first-use" image={emptyApplication} eyebrow="Start your application workspace" title="Your application list is ready for its first program." description="Save a program to your shortlist, then turn it into an application when you are ready to track the next step." primaryLabel="Add application" onPrimary={() => openModal({ type: "add-application" })} secondaryLabel="Browse programs" onSecondary={() => navigate("programs")} /> : null}
      </section>
    </div>
  );
}

function DocumentsPage({ data, refresh, notify, openModal, navigate }) {
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
  if (!data.documents.length) return (
    <div className="page first-use-page">
      <PageHeader eyebrow="Your application evidence" title="Document vault" description="One academic CV. Every application that needs it. Keep versions and assignments together." localMessage="Stored only on this device" action={<PrimaryButton onClick={() => openModal({ type: "add-document", onSaved: setSelectedId })}>Add document</PrimaryButton>} />
      <FirstUseState
        image={emptyDocuments}
        eyebrow="Build your evidence kit"
        title="Your document vault is ready."
        description="Upload your CV, transcript, and other files once. Then link them to the programs and applications that need them."
        primaryLabel="Upload your first document"
        onPrimary={() => openModal({ type: "add-document", onSaved: setSelectedId })}
        secondaryLabel="Browse programs"
        onSecondary={() => navigate("programs")}
      />
    </div>
  );
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
  async function ensurePolimiCatalog(source) {
    const current = await db.catalogPrograms.toArray();
    const keys = new Set(current.map((program) => programKey(program)));
    const additions = POLIMI_CATALOG.filter((program) => !keys.has(programKey(program))).map((program) => ({ ...program }));
    if (!additions.length) return source;
    const nextSource = { ...source, label: `${source?.label || "Google Sheet"} + Politecnico di Milano`, rowCount: current.length + additions.length };
    await replaceCatalog([...current, ...additions], nextSource);
    return nextSource;
  }
  async function openWorkspace() {
    await seedDatabase();
    const initial = await readAllData();
    const autoSync = await db.settings.get(CATALOG_AUTO_SYNC_SETTING_KEY);
    const source = initial.catalogSource;
    if (source?.mode === "google-sheet" && source.inputUrl) {
      try {
        const result = await syncCatalogFromUrl(source.inputUrl);
        if (isSharedCatalogUrl(source.inputUrl)) await ensurePolimiCatalog(result.source);
      } catch {
        // Keep the last local snapshot when offline, but preserve the built-in
        // Polimi records for users who already have an older shared snapshot.
        if (isSharedCatalogUrl(source.inputUrl)) await ensurePolimiCatalog(source);
      }
    } else if (!autoSync?.value) {
      try {
        const result = await syncCatalogFromUrl(SHARED_CATALOG_SOURCE.inputUrl);
        await ensurePolimiCatalog(result.source);
        await db.settings.put({ key: CATALOG_AUTO_SYNC_SETTING_KEY, value: true });
      } catch { /* Keep the starter snapshot and allow a later retry. */ }
    }
    return readAllData();
  }
  useEffect(() => {
    let active = true;
    openWorkspace().then((value) => { if (active) { setData(value); setReady(true); } }).catch(() => { if (active) setLoadError("Could not open local storage. Close other Kamiunity tabs and try again."); });
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
  useEffect(() => { document.title = `Kamiunity — ${NAV_ITEMS.find((item) => item.id === route)?.label || (route === "backup" ? "Backup & transfer" : "Deadlines")}`; }, [route]);
  function navigate(next) { const target = ["today", "calendar"].includes(next) ? "deadlines" : next; window.location.hash = `/${target}`; setRoute(target); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function installApp() { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); }
  async function syncProgramCatalog(inputUrl) {
    const result = await syncCatalogFromUrl(inputUrl);
    if (isSharedCatalogUrl(inputUrl)) await ensurePolimiCatalog(result.source);
    await refresh();
    return result;
  }
  async function importProgramCatalog(text, label) {
    const result = await importCatalogCsv(text, label);
    await refresh();
    return result;
  }
  async function resetProgramCatalog() {
    await replaceCatalog(STARTER_CATALOG.map((program) => ({ ...program })), { ...DEFAULT_CATALOG_SOURCE, lastSyncedAt: null });
    await db.settings.put({ key: CATALOG_AUTO_SYNC_SETTING_KEY, value: true });
    await refresh();
  }
  async function addCatalogProgram(catalogProgram, mode = "shortlist") {
    const existing = data.programs.find((program) => (catalogProgram.catalogId && program.catalogId === catalogProgram.catalogId) || programKey(program) === programKey(catalogProgram));
    const programId = existing?.id || await saveProgram(catalogToProgram(catalogProgram), []);
    const nextData = await readAllData();
    setData(nextData);
    if (mode === "application") {
      const application = nextData.applications.find((item) => item.programId === programId);
      if (application) setModal({ type: "application", application });
      else setModal({ type: "add-application", programId });
    } else {
      setToast(existing ? "That program is already in your shortlist." : "Program added to your shortlist.");
    }
    return programId;
  }
  const common = { data, refresh, notify: setToast, openModal: setModal, navigate, addCatalogProgram, syncCatalog: syncProgramCatalog, importCatalog: importProgramCatalog, resetCatalog: resetProgramCatalog };
  const pages = { deadlines: <DeadlinesPage {...common} />, programs: <ProgramsPage {...common} />, applications: <ApplicationsPage {...common} />, documents: <DocumentsPage {...common} />, backup: <BackupPage {...common} installPrompt={installPrompt} installApp={installApp} /> };
  if (!ready) return <main className="loading-screen"><img className="loading-brand" src={kamiunityLogo} alt="kamiunity" /><strong>{loadError ? "Your workspace could not open" : "Opening your application workspace…"}</strong><span role={loadError ? "alert" : undefined}>{loadError || "Your records stay on this device."}</span>{loadError ? <button className="secondary-button soft-button" type="button" onClick={() => window.location.reload()}>Try again</button> : null}</main>;
  return (
    <div className="app-shell kamiunity">
      <TopNavigation route={route} navigate={navigate} openModal={setModal} /><main className="app-main">{pages[route]}</main>
      {["task", "add-task"].includes(modal?.type) ? <TaskForm key={`task-${modal.task?.id || "new"}`} {...common} task={modal.task} applicationId={modal.applicationId} close={() => setModal(null)} /> : null}
      {["program", "add-program"].includes(modal?.type) ? <ProgramForm key={`program-${modal.program?.id || "new"}`} {...common} program={modal.program} close={() => setModal(null)} /> : null}
      {["application", "add-application"].includes(modal?.type) ? <ApplicationForm key={`application-${modal.application?.id || modal.programId || "new"}`} {...common} application={modal.application} programId={modal.programId} focusSection={modal.focusSection} close={() => setModal(null)} /> : null}
      {["document", "add-document"].includes(modal?.type) ? <DocumentForm key={`document-${modal.document?.id || "new"}`} {...common} document={modal.document} applicationId={modal.applicationId} onSaved={modal.onSaved} close={() => setModal(null)} /> : null}
      {modal?.type === "application-checklist" ? <ApplicationChecklistForm {...common} application={modal.application} close={() => setModal(null)} /> : null}
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite"><CheckCircle size={21} />{toast}</div>
    </div>
  );
}
