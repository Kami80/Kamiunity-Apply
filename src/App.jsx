import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  ArrowSquareOut,
  CaretLeft,
  CalendarBlank,
  CalendarCheck,
  CaretRight,
  ChatCircleText,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Database,
  DownloadSimple,
  EnvelopeSimple,
  FileText,
  FileXls,
  FolderSimple,
  Funnel,
  GraduationCap,
  HardDrive,
  Kanban,
  MagnifyingGlass,
  MoonStars,
  Plus,
  Sparkle,
  Sun,
  Table,
  Trash,
  UploadSimple,
  UsersThree,
  VideoCamera,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import "@fontsource-variable/manrope";
import { db, PROFILE_LOOKUP_EMAIL_SETTING_KEY, PROFILE_SETTING_KEY, readAllData, seedDatabase } from "./db.js";
import { PrimaryButton } from "./ui.jsx";
import kamiunityLogo from "./assets/kamiunity-logo.png";
import emptyApplication from "./assets/empty-application.png";
import emptyApplicationDark from "./assets/empty-application-dark.png";
import emptyDocuments from "./assets/empty-documents.png";
import emptyDocumentsDark from "./assets/empty-documents-dark.png";
import emptyCalendar from "./assets/empty-calendar.png";
import emptyCalendarDark from "./assets/empty-calendar-dark.png";
import { ApplicationChecklistForm, ApplicationWorkspace } from "./ApplicationWorkspace.jsx";
import { ApplicationForm, DocumentForm, ExternalLink, ProgramForm, TaskForm } from "./WorkflowForms.jsx";
import { catalogToProgram, importCatalogCsv, programKey, replaceCatalog, syncCatalogFromUrl } from "./catalog.js";
import { CATALOG_AUTO_SYNC_SETTING_KEY, DEFAULT_CATALOG_SOURCE, SHARED_CATALOG_SOURCE, STARTER_CATALOG } from "./catalog-data.js";
import { POLIMI_CATALOG } from "./polimi-data.js";
import { fetchProfileSheet, findProfileByEmail, normalizeProfileEmail, PROFILE_FORM_URL } from "./profile.js";
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

const ROUTES = ["deadlines", "programs", "applications", "services", "profile", "documents", "backup"];
const NAV_ITEMS = [
  { id: "deadlines", label: "Deadlines", icon: CalendarCheck },
  { id: "applications", label: "My applications", icon: FolderSimple },
  { id: "programs", label: "Program shortlist", icon: GraduationCap },
  { id: "services", label: "Services & contact", icon: ChatCircleText },
  { id: "documents", label: "Document vault", icon: FileText },
];

function currentRoute() {
  const value = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  if (value === "today" || value === "calendar") return "deadlines";
  return ROUTES.includes(value) ? value : "applications";
}

function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
}

const THEME_STORAGE_KEY = "kamiunity-theme";

function readThemePreference() {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : "light";
  } catch {
    return "light";
  }
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

function TopNavigation({ route, navigate, profile, installed = false, installPrompt, installApp, theme, toggleTheme }) {
  const navigateFromMobile = (nextRoute) => navigate(nextRoute);
  const workspaceLocked = !hasCompletedProfile(profile);
  const profileName = profile?.fullName?.trim() || "Your profile";
  const profileInitials = profile?.fullName?.trim()
    ? profile.fullName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  return (
    <>
      <header className="topbar desktop-navigation">
        <div className="topbar-identity">
          <button className="brand" type="button" onClick={() => navigate("applications")} aria-label="Kamiunity — my applications"><img src={kamiunityLogo} alt="kamiunity" /></button>
          <button className={`profile-nav-button ${route === "profile" ? "active" : ""}`} type="button" onClick={() => navigate("profile")} aria-current={route === "profile" ? "page" : undefined} aria-label={`Open profile for ${profileName}`} title="Profile">
            <span className="profile-avatar" aria-hidden="true">{profileInitials}</span>
            <span className="profile-nav-copy"><small>Profile</small><strong>{profileName}</strong></span>
          </button>
        </div>
        <nav className="topnav" aria-label="Primary navigation">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={`nav-item ${route === id ? "active" : ""}`}
              aria-current={route === id ? "page" : undefined}
              aria-disabled={workspaceLocked ? "true" : undefined}
              disabled={workspaceLocked}
              onClick={() => navigate(id)}
            >
              <Icon size={24} weight={route === id ? "duotone" : "regular"} />
              <span className="nav-item-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="brand-utilities"><span><CheckCircle size={19} />Saved on this device</span><button className={`theme-toggle-button ${theme === "dark" ? "active" : ""}`} type="button" onClick={toggleTheme} aria-pressed={theme === "dark"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{theme === "dark" ? <Sun size={21} weight="duotone" /> : <MoonStars size={21} weight="duotone" />}<span>{theme === "dark" ? "Light" : "Dark"}</span></button>{!installed ? <button className="install-nav-button" type="button" onClick={installApp} aria-label="Install Kamiunity" title={installPrompt ? "Install Kamiunity" : "Use the browser menu to install Kamiunity"}><DownloadSimple size={21} /><span>Install</span></button> : null}<button className={`backup-nav-button ${route === "backup" ? "active" : ""}`} type="button" onClick={() => navigate("backup")} aria-label="Backup and transfer" title={workspaceLocked ? "Complete your profile first" : "Backup & transfer"} disabled={workspaceLocked}><Archive size={21} /><span>Backup</span></button></div>
      </header>
      <nav className="mobile-navigation" aria-label="Mobile navigation">
        <button className={`mobile-profile-button ${route === "profile" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("profile")} aria-current={route === "profile" ? "page" : undefined} aria-label={`Open profile for ${profileName}`} title="Profile"><span className="profile-avatar" aria-hidden="true">{profileInitials}</span><span className="mobile-profile-name">{profileName}</span></button>
        {!installed ? <button className="mobile-install-button" type="button" onClick={installApp} aria-label="Install Kamiunity" title={installPrompt ? "Install Kamiunity" : "Use the browser menu to install Kamiunity"}><DownloadSimple size={21} /><span className="visually-hidden">Install Kamiunity</span></button> : null}
        <button className={`mobile-theme-button ${theme === "dark" ? "active" : ""} ${!installed ? "has-install" : ""}`} type="button" onClick={toggleTheme} aria-pressed={theme === "dark"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{theme === "dark" ? <Sun size={21} weight="duotone" /> : <MoonStars size={21} weight="duotone" />}<span className="visually-hidden">{theme === "dark" ? "Light mode" : "Dark mode"}</span></button>
        <button className={`mobile-backup-button ${route === "backup" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("backup")} aria-label="Backup and transfer" title={workspaceLocked ? "Complete your profile first" : "Backup & transfer"} disabled={workspaceLocked}><Archive size={21} weight={route === "backup" ? "duotone" : "regular"} /><span className="visually-hidden">Backup and transfer</span></button>
        <div className="mobile-nav-bar">
          <button className={`mobile-nav-item ${route === "applications" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("applications")} aria-current={route === "applications" ? "page" : undefined} aria-label="Applications" title={workspaceLocked ? "Complete your profile first" : "Applications"} disabled={workspaceLocked}><span className="mobile-nav-icon"><FolderSimple size={23} weight={route === "applications" ? "duotone" : "regular"} /></span><span className="visually-hidden">Applications</span></button>
          <button className={`mobile-nav-item ${route === "programs" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("programs")} aria-current={route === "programs" ? "page" : undefined} aria-label="Programs" title={workspaceLocked ? "Complete your profile first" : "Programs"} disabled={workspaceLocked}><span className="mobile-nav-icon"><GraduationCap size={23} weight={route === "programs" ? "duotone" : "regular"} /></span><span className="visually-hidden">Programs</span></button>
          <button className={`mobile-nav-item mobile-nav-services ${route === "services" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("services")} aria-current={route === "services" ? "page" : undefined} aria-label="Services and contact" title={workspaceLocked ? "Complete your profile first" : "Services & contact"} disabled={workspaceLocked}><span className="mobile-nav-icon"><ChatCircleText size={27} weight={route === "services" ? "duotone" : "bold"} /></span><span className="visually-hidden">Services and contact</span></button>
          <button className={`mobile-nav-item ${route === "deadlines" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("deadlines")} aria-current={route === "deadlines" ? "page" : undefined} aria-label="Deadlines" title={workspaceLocked ? "Complete your profile first" : "Deadlines"} disabled={workspaceLocked}><span className="mobile-nav-icon"><CalendarCheck size={23} weight={route === "deadlines" ? "duotone" : "regular"} /></span><span className="visually-hidden">Deadlines</span></button>
          <button className={`mobile-nav-item ${route === "documents" ? "active" : ""}`} type="button" onClick={() => navigateFromMobile("documents")} aria-current={route === "documents" ? "page" : undefined} aria-label="Document vault" title={workspaceLocked ? "Complete your profile first" : "Document vault"} disabled={workspaceLocked}><span className="mobile-nav-icon"><FileText size={23} weight={route === "documents" ? "duotone" : "regular"} /></span><span className="visually-hidden">Document vault</span></button>
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

function FirstUseState({ image, darkImage, theme = "light", imageAlt = "", eyebrow, title, description, primaryLabel, onPrimary, secondaryLabel, onSecondary, className = "" }) {
  return (
    <section className={`first-use-state soft-panel ${className}`}>
      <div className="first-use-art-wrap"><img className="first-use-art" src={theme === "dark" && darkImage ? darkImage : image} alt={imageAlt} /></div>
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

function DeadlinesPage({ data, openModal, theme }) {
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
        {filteredEvents.length ? <DeadlineAgenda events={filteredEvents} openModal={openModal} /> : events.length ? <div className="deadline-empty"><EmptyState title="No deadlines match" description="Try a different search or filter." /></div> : <FirstUseState className="deadline-first-use" image={emptyCalendar} darkImage={emptyCalendarDark} theme={theme} eyebrow="Make the next date visible" title="Your datebook is waiting." description="Add your first application or task deadline and turn the application season into a clear, manageable runway." primaryLabel="Add application" onPrimary={() => openModal({ type: "add-application" })} secondaryLabel="Add task" onSecondary={() => openModal({ type: "add-task" })} />}
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

function HomePage({ data, openModal, navigate, theme }) {
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
          <div className="home-hero-image-frame"><img className="theme-art" src={theme === "dark" ? emptyApplicationDark : emptyApplication} alt="Illustration of an organized graduate application workspace" /></div>
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

function ApplicationsPage({ data, refresh, notify, openModal, navigate, theme }) {
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
  if (view === "dossier" && !data.applications.length) return <HomePage data={data} openModal={openModal} navigate={navigate} theme={theme} />;
  if (view === "dossier") return <ApplicationWorkspace data={data} refresh={refresh} notify={notify} openModal={openModal} navigate={navigate} theme={theme} onOpenTable={() => setView("table")} />;
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
        {!joined.length ? data.applications.length ? <EmptyState title="No matching applications" description="Try another university, degree, or intake." /> : <FirstUseState className="compact-first-use" image={emptyApplication} darkImage={emptyApplicationDark} theme={theme} eyebrow="Start your application workspace" title="Your application list is ready for its first program." description="Save a program to your shortlist, then turn it into an application when you are ready to track the next step." primaryLabel="Add application" onPrimary={() => openModal({ type: "add-application" })} secondaryLabel="Browse programs" onSecondary={() => navigate("programs")} /> : null}
      </section>
    </div>
  );
}

function DocumentsPage({ data, refresh, notify, openModal, navigate, theme }) {
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
        darkImage={emptyDocumentsDark}
        theme={theme}
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

const CONTACT_EMAIL = "kamyabsafaie80@gmail.com";
const TELEGRAM_HANDLE = "SafaeiKamyab";
const COMMUNITY_LINKS = [
  { label: "Kamiunity Open Source", handle: "t.me/kamiunity_opensource", href: "https://t.me/kamiunity_opensource", description: "Build the tools together." },
  { label: "Apply Europe Iran", handle: "t.me/ApplyEuropeIran", href: "https://t.me/ApplyEuropeIran", description: "Application ideas and updates." },
];

const SERVICE_OPTIONS = [
  {
    id: "meeting",
    label: "Have a meeting",
    eyebrow: "1:1 application guidance",
    title: "Application planning meeting",
    description: "Talk through your goals, shortlist, timeline, or next move with a clear agenda.",
    icon: VideoCamera,
    accent: "peach",
  },
  {
    id: "resume",
    label: "Build a resume",
    eyebrow: "CV and profile storytelling",
    title: "Resume / CV building",
    description: "Turn your experience, projects, and goals into a focused academic or professional CV.",
    icon: FileText,
    accent: "blue",
  },
  {
    id: "sop",
    label: "Write a motivation letter / SOP",
    eyebrow: "Personal statement support",
    title: "Motivation letter / SOP",
    description: "Shape your story, evidence, and goals into a convincing statement for the right audience.",
    icon: Sparkle,
    accent: "amber",
  },
  {
    id: "review",
    label: "Review my application",
    eyebrow: "Application package check",
    title: "Application package review",
    description: "Get a second look at your documents, fit, timeline, and next actions before you submit.",
    icon: UsersThree,
    accent: "sage",
  },
];

function profileContactValue(profile, key, fallback) {
  const value = String(profile?.[key] || "").trim();
  return value || fallback;
}

function profileContactLines(profile) {
  return [
    ["Name", profile?.fullName],
    ["Email", profile?.email],
    ["Previous degree", profile?.lastDegree],
    ["University", profile?.university],
    ["Program", profile?.programName],
  ]
    .map(([label, value]) => [label, String(value || "").trim()])
    .filter(([, value]) => value);
}

function buildServiceDraft(serviceId, profile) {
  const name = profileContactValue(profile, "fullName", "A student");
  const profileLines = profileContactLines(profile);
  const profileSummary = profileLines.length
    ? profileLines.map(([label, value]) => `${label}: ${value}`).join("\n")
    : "I can share my profile details in our conversation.";
  const profileSummaryShort = profileLines
    .filter(([label]) => label !== "Email")
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
  const contactLine = profile?.email ? `You can also reach me at ${profile.email}.` : "I can share my contact details in the conversation.";

  const drafts = {
    meeting: {
      subject: `Meeting request — ${name}`,
      emailBody: `Hi Kamyab,\n\nMy name is ${name}, and I’d like to book a meeting about my graduate application.\n\nMy saved profile details:\n${profileSummary}\n\nI’d like help with my application plan, shortlist, timeline, or next steps. Please let me know your available times.\n\n${contactLine}\n\nThank you,\n${name}`,
      telegramBody: `Hi Kamyab! I’d like to book a meeting about my graduate application.\n\n${profileSummaryShort || `Name: ${name}`}\n\nI’d like help with my application plan, shortlist, timeline, or next steps. Please let me know your available times.`,
    },
    resume: {
      subject: `Resume / CV building request — ${name}`,
      emailBody: `Hi Kamyab,\n\nI’d like help building or improving my resume/CV.\n\nMy saved profile details:\n${profileSummary}\n\nI’d like to shape my experience for my graduate application. I can share my current CV and supporting links. Please let me know what I should send first.\n\nBest,\n${name}`,
      telegramBody: `Hi Kamyab! I’d like help building or improving my resume/CV.\n\n${profileSummaryShort || `Name: ${name}`}\n\nI can send my current CV and supporting links. What should I share first?`,
    },
    sop: {
      subject: `Motivation letter / SOP support — ${name}`,
      emailBody: `Hi Kamyab,\n\nI’d like help with a motivation letter or SOP for my graduate application.\n\nMy saved profile details:\n${profileSummary}\n\nI can share the program prompt, word limit, notes, or current draft. I’d appreciate help with the structure, clarity, and positioning of my story.\n\nBest,\n${name}`,
      telegramBody: `Hi Kamyab! I’d like help with a motivation letter or SOP for my graduate application.\n\n${profileSummaryShort || `Name: ${name}`}\n\nI can send the program prompt, my notes, or a current draft. What should I share first?`,
    },
    review: {
      subject: `Application package review — ${name}`,
      emailBody: `Hi Kamyab,\n\nI’d like a review of my graduate application package.\n\nMy saved profile details:\n${profileSummary}\n\nI can share the program link and my documents. I’d appreciate a second look at fit, missing pieces, clarity, timeline, and submission requirements. Please let me know how we can start.\n\nBest,\n${name}`,
      telegramBody: `Hi Kamyab! I’d like a review of my graduate application package.\n\n${profileSummaryShort || `Name: ${name}`}\n\nI can send the program link and my documents. I’d appreciate help with fit, missing pieces, clarity, or timeline.`,
    },
  };

  return drafts[serviceId] || drafts.meeting;
}

function ServicesPage({ data, notify }) {
  const [serviceId, setServiceId] = useState(SERVICE_OPTIONS[0].id);
  const selectedService = SERVICE_OPTIONS.find((service) => service.id === serviceId) || SERVICE_OPTIONS[0];
  const profile = data?.profile || {};
  const draft = useMemo(() => buildServiceDraft(selectedService.id, profile), [selectedService.id, profile]);
  const emailHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.emailBody)}`;
  const telegramHref = `https://t.me/${TELEGRAM_HANDLE}?text=${encodeURIComponent(draft.telegramBody)}`;
  const profileFields = profileContactLines(profile).filter(([label]) => label !== "Email");
  const SelectedServiceIcon = selectedService.icon;

  function announceOpen(channel) {
    notify(`Opening ${channel} with your ${selectedService.label.toLowerCase()} details.`);
  }

  function chooseService(id) {
    setServiceId(id);
    window.requestAnimationFrame(() => document.getElementById("service-launch")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="page services-page">
      <PageHeader
        eyebrow="People behind the paperwork"
        title="Services & contact"
        description="Bring the question, draft, or half-finished idea. We can turn it into a clear next step."
        localMessage="Direct contact · no form required"
        action={<div className="services-page-actions"><a className="primary-button" href={emailHref} onClick={() => announceOpen("email")}><EnvelopeSimple size={19} />Email this request</a><a className="secondary-button soft-button" href={telegramHref} target="_blank" rel="noreferrer" onClick={() => announceOpen("Telegram")}><ChatCircleText size={19} />Telegram this request</a></div>}
      />

      <section className="services-hero soft-panel" aria-labelledby="services-hero-title">
        <div className="services-hero-copy">
          <span className="section-kicker">A little help, right when it matters</span>
          <h2 id="services-hero-title">Make your application feel more like a plan.</h2>
          <p>Whether you need a focused meeting, a stronger resume, or a thoughtful motivation letter, start with a short message and we’ll figure out the right next step together.</p>
          <div className="services-hero-points"><span><CheckCircle size={18} />Practical, student-focused support</span><span><CheckCircle size={18} />Clear drafts and next actions</span></div>
        </div>
        <aside className="services-contact-card">
          <span className="services-contact-stamp"><Sparkle size={26} weight="duotone" /></span>
          <span className="section-kicker">Reach out directly</span>
          <h3>Let’s work on the next piece together.</h3>
          <div className="services-contact-links">
            <a className="services-contact-link" href={emailHref} onClick={() => announceOpen("email")}><span className="services-contact-link-icon"><EnvelopeSimple size={19} /></span><span><small>Email · {selectedService.label}</small><strong>{CONTACT_EMAIL}</strong></span><ArrowSquareOut size={17} /></a>
            <a className="services-contact-link" href={telegramHref} target="_blank" rel="noreferrer" onClick={() => announceOpen("Telegram")}><span className="services-contact-link-icon"><ChatCircleText size={19} /></span><span><small>Telegram · {selectedService.label}</small><strong>@{TELEGRAM_HANDLE}</strong></span><ArrowSquareOut size={17} /></a>
          </div>
          <small className="services-contact-note">Your saved profile details are added to the draft automatically.</small>
        </aside>
      </section>

      <section className="services-offerings" aria-labelledby="services-offerings-title">
        <div className="services-section-heading"><div><span className="section-kicker">Ways I can help</span><h2 id="services-offerings-title">Choose the kind of support you need.</h2></div><p>Pick a service, then open a pre-filled email or Telegram draft using your saved profile.</p></div>
        <div className="service-offer-grid">
          {SERVICE_OPTIONS.map(({ id, eyebrow, title, description, icon: Icon, accent }) => (
            <article className={`service-offer service-offer-${accent} soft-panel`} key={id}>
              <span className="service-offer-icon"><Icon size={25} weight="duotone" /></span>
              <span className="service-offer-eyebrow">{eyebrow}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <button className="text-action service-offer-action" type="button" onClick={() => chooseService(id)}>Prepare outreach <ArrowRight size={16} /></button>
            </article>
          ))}
        </div>
      </section>

      <section className="service-launch soft-panel" id="service-launch" aria-labelledby="service-launch-title">
        <div className="service-launch-heading"><div><span className="section-kicker">Private profile, ready to use</span><h2 id="service-launch-title">Open a prepared request.</h2><p>Choose a channel and your saved profile details will be placed into a new draft. You review it before sending.</p></div><span className="service-launch-ready"><CheckCircle size={18} />Draft stays private</span></div>
        <div className="service-launch-grid">
          <div className="service-launch-selection">
            <span className="service-launch-label">Selected support</span>
            <div className={`service-launch-service service-launch-service-${selectedService.accent}`}>
              <span className="service-launch-icon"><SelectedServiceIcon size={24} weight="duotone" /></span>
              <span><strong>{selectedService.title}</strong><small>{selectedService.description}</small></span>
            </div>
            <div className="service-profile-summary"><span className="service-profile-summary-label"><UsersThree size={17} />Using your saved profile</span><div className="service-profile-pills">{profileFields.map(([label, value]) => <span key={label}><strong>{label}</strong>{value}</span>)}</div></div>
          </div>
          <div className="service-launch-actions">
            <span className="service-launch-label">Choose where to continue</span>
            <a className="primary-button service-launch-button" href={emailHref} onClick={() => announceOpen("email")}><EnvelopeSimple size={20} /><span><strong>Open email draft</strong><small>{CONTACT_EMAIL}</small></span><ArrowSquareOut size={17} /></a>
            <a className="secondary-button soft-button service-launch-button" href={telegramHref} target="_blank" rel="noreferrer" onClick={() => announceOpen("Telegram")}><ChatCircleText size={20} /><span><strong>Open Telegram draft</strong><small>@{TELEGRAM_HANDLE}</small></span><ArrowSquareOut size={17} /></a>
            <small className="service-launch-note">Nothing is sent automatically. Check the draft and press Send when it looks right.</small>
          </div>
        </div>
      </section>

      <section className="services-community soft-inset" aria-labelledby="services-community-title">
        <div><span className="section-kicker">Stay connected</span><h2 id="services-community-title">More Kamiunity, beyond your application list.</h2><p>Join the communities for open-source updates, application conversations, and new resources.</p></div>
        <div className="community-link-grid">{COMMUNITY_LINKS.map(({ label, handle, href, description }) => <a className="community-link" href={href} target="_blank" rel="noreferrer" key={href}><span className="community-link-icon"><ChatCircleText size={20} /></span><span><strong>{label}</strong><small>{handle} · {description}</small></span><ArrowSquareOut size={18} /></a>)}</div>
      </section>
    </div>
  );
}

function profileInitials(profile) {
  if (!profile?.fullName?.trim()) return "?";
  return profile.fullName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function hasCompletedProfile(profile) {
  return Boolean(profile?.email && profile?.fullName?.trim());
}

function ProfilePage({ data, refresh, notify, locked = false, installPrompt, installApp, installed = false }) {
  const savedEmail = data.profile?.email || data.profileLookupEmail || "";
  const [email, setEmail] = useState(savedEmail);
  const [showEmailEditor, setShowEmailEditor] = useState(!savedEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const autoSyncEmail = useRef("");
  const profile = data.profile;
  const profileReady = hasCompletedProfile(profile);

  useEffect(() => {
    const nextEmail = data.profile?.email || data.profileLookupEmail || "";
    setEmail(nextEmail);
    if (data.profile?.email) setShowEmailEditor(false);
  }, [data.profile?.email, data.profileLookupEmail]);

  async function syncProfileByEmail(inputEmail, { silent = false } = {}) {
    const targetEmail = normalizeProfileEmail(inputEmail);
    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      if (!silent) {
        setError("Enter the same email address used when submitting the Google Form.");
        setStatus("");
      }
      return false;
    }
    autoSyncEmail.current = targetEmail;
    setBusy(true);
    if (!silent) {
      setError("");
      setStatus("");
    }
    try {
      // Remember the email before the network request so a return visit can
      // reuse it even if the sheet is temporarily unavailable.
      await db.settings.put({ key: PROFILE_LOOKUP_EMAIL_SETTING_KEY, value: targetEmail });
      const result = await fetchProfileSheet();
      const match = findProfileByEmail(result.records, targetEmail);
      if (!match) {
        if (!silent) {
          await db.settings.delete(PROFILE_SETTING_KEY);
          await refresh();
          setShowEmailEditor(true);
          setStatus(`No profile response matched ${targetEmail}. Submit the form first, then sync again.`);
        }
        return false;
      }
      await db.settings.put({ key: PROFILE_SETTING_KEY, value: { ...match, email: targetEmail, source: "Google Form response sheet", syncedAt: new Date().toISOString() } });
      await refresh();
      setEmail(targetEmail);
      setShowEmailEditor(false);
      if (!silent) {
        setStatus(`Profile synced from response row ${match.rowNumber}.`);
        notify("Your profile was updated on this device.");
      }
      return true;
    } catch (failure) {
      if (!silent) setError(failure.message || "The profile sheet could not be synced.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const rememberedEmail = normalizeProfileEmail(data.profile?.email || data.profileLookupEmail);
    if (!rememberedEmail || autoSyncEmail.current === rememberedEmail) return undefined;
    autoSyncEmail.current = rememberedEmail;
    void syncProfileByEmail(rememberedEmail, { silent: true });
    return undefined;
  }, [data.profile?.email, data.profileLookupEmail]);

  useEffect(() => {
    const rememberedEmail = normalizeProfileEmail(data.profile?.email || data.profileLookupEmail);
    if (!rememberedEmail || profileReady) return undefined;
    const handleReturnToApp = () => { void syncProfileByEmail(rememberedEmail, { silent: true }); };
    window.addEventListener("focus", handleReturnToApp);
    return () => window.removeEventListener("focus", handleReturnToApp);
  }, [data.profile?.email, data.profileLookupEmail, profileReady]);

  async function syncProfile(event) {
    event.preventDefault();
    await syncProfileByEmail(email || data.profile?.email || data.profileLookupEmail);
  }

  async function openProfileForm() {
    const targetEmail = normalizeProfileEmail(email || data.profile?.email || data.profileLookupEmail);
    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      setError("Enter your email once before opening the Google Form.");
      setStatus("");
      return;
    }
    // Open in the click handler before awaiting IndexedDB so popup blockers do
    // not mistake the form tab for an unsolicited window.
    window.open(PROFILE_FORM_URL, "_blank", "noopener,noreferrer");
    await db.settings.put({ key: PROFILE_LOOKUP_EMAIL_SETTING_KEY, value: targetEmail });
    setEmail(targetEmail);
    await refresh();
  }

  async function clearProfile() {
    await db.settings.delete(PROFILE_SETTING_KEY);
    await db.settings.delete(PROFILE_LOOKUP_EMAIL_SETTING_KEY);
    await refresh();
    autoSyncEmail.current = "";
    setEmail("");
    setShowEmailEditor(true);
    setStatus("The local profile has been cleared. Your Google Form response was not changed.");
    setError("");
  }

  const name = profile?.fullName || "Your profile is ready for its first update";
  return (
    <div className="page profile-page">
      <PageHeader
        eyebrow="Your personal application identity"
        title={profileReady ? profile.fullName : "Unlock your workspace"}
        description={locked ? "Create your profile through the Google Form, then sync it once to unlock programs, applications, deadlines, documents, and services." : profileReady ? "Your connected profile is restored from this browser and can be refreshed whenever your details change." : "Keep your academic background in one place and refresh it from your Google Form whenever something changes."}
        localMessage={profileReady && profile.syncedAt ? `Synced ${formatCatalogTimestamp(profile.syncedAt)}` : "Stored only on this device"}
        action={<div className="profile-header-actions"><button className="primary-button" type="button" onClick={openProfileForm}><ArrowSquareOut size={19} />Open Google Form</button>{installed ? <span className="pwa-status-badge"><CheckCircle size={18} />Installed</span> : installPrompt ? <button className="secondary-button soft-button" type="button" onClick={installApp}><DownloadSimple size={19} />Install app</button> : null}</div>}
      />

      {locked ? <div className="profile-access-gate soft-inset" role="status"><span className="profile-access-gate-icon"><WarningCircle size={22} weight="duotone" /></span><div><strong>Complete your profile to unlock Kamiunity.</strong><p>Submit the form, return here, and sync the response. Your matched profile will unlock the rest of the app on this browser.</p></div></div> : null}

      <section className="profile-hero soft-panel" aria-labelledby="profile-hero-title">
        <div className="profile-hero-identity"><span className="profile-large-avatar" aria-hidden="true">{profileInitials(profile)}</span><div><span className="section-kicker">Your profile card</span><h2 id="profile-hero-title">{name}</h2><p>{profileReady ? "This is the profile currently matched to your form response on this browser." : savedEmail ? "Your email is remembered on this browser. Submit the form, then refresh the saved connection." : "Submit the short form, then enter your form email below to bring your details into Kamiunity."}</p></div></div>
        <div className={`profile-sync-badge ${profileReady ? "is-synced" : ""}`}><CheckCircle size={20} />{profileReady ? "Workspace unlocked" : "Profile setup required"}</div>
      </section>

      <div className="profile-grid">
        <section className="profile-sync-card soft-panel" aria-labelledby="profile-sync-title">
          <div className="profile-card-heading"><span className="profile-card-icon profile-card-icon-peach"><Sparkle size={23} weight="duotone" /></span><div><span className="section-kicker">Google Form sync</span><h2 id="profile-sync-title">Update your profile</h2></div></div>
          <p>{savedEmail ? "Your email is saved on this browser, so you do not need to enter it again. Open the form when you need to change your details, then refresh the connection." : locked ? "Open the form, submit your details, then sync the response. Once a matched profile is found, the rest of Kamiunity unlocks immediately." : "Open the form, submit your details, then sync the response using the same email. Kamiunity remembers the connection locally on this browser."}</p>
          {!showEmailEditor && savedEmail ? <div className="profile-connected-state">
            <div className="profile-connected-summary"><span className="profile-connected-icon"><CheckCircle size={22} weight="duotone" /></span><div><span className="section-kicker">{profileReady ? "Connected on this browser" : "Email saved on this browser"}</span><strong>{savedEmail}</strong><small>{profileReady ? "Your profile is restored automatically when you return." : "Refresh after submitting the form to find your profile."}</small></div></div>
            <div className="profile-form-actions"><button className="primary-button" type="button" onClick={() => syncProfileByEmail(savedEmail)} disabled={busy}>{busy ? "Refreshing…" : "Refresh profile"}<ArrowRight size={18} /></button><button className="secondary-button soft-button" type="button" onClick={() => { setShowEmailEditor(true); setError(""); setStatus(""); }}>Change email</button></div>
          </div> : <form className="profile-sync-form" onSubmit={syncProfile}>
            <label className="profile-email-field"><span>Email used in the Google Form</span><input className="soft-inset" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
            <small className="profile-form-hint">Enable “Collect email addresses” in Google Forms so each response can be matched safely.</small>
            <div className="profile-form-actions"><button className="secondary-button soft-button" type="button" onClick={openProfileForm}><ArrowSquareOut size={18} />Open form first</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "Syncing…" : "Save and sync profile"}<ArrowRight size={18} /></button></div>
          </form>}
          {error ? <div className="profile-notice profile-notice-error" role="alert"><WarningCircle size={19} />{error}</div> : null}
          {status ? <div className="profile-notice profile-notice-status" role="status"><CheckCircle size={19} />{status}</div> : null}
          {profile ? <button className="text-action profile-clear-action" type="button" onClick={clearProfile}>Clear local profile</button> : null}
        </section>

        <aside className="profile-details-card soft-panel" aria-labelledby="profile-details-title">
          <div className="profile-card-heading"><span className="profile-card-icon profile-card-icon-blue"><UsersThree size={23} weight="duotone" /></span><div><span className="section-kicker">Matched details</span><h2 id="profile-details-title">What the app knows</h2></div></div>
          {profile ? <dl className="profile-details-list"><div><dt>Full name</dt><dd>{profile.fullName || "Not provided"}</dd></div><div><dt>Last degree</dt><dd>{profile.lastDegree || "Not provided"}</dd></div><div><dt>University</dt><dd>{profile.university || "Not provided"}</dd></div><div><dt>Program</dt><dd>{profile.programName || "Not provided"}</dd></div><div><dt>Matched email</dt><dd>{profile.email}</dd></div><div><dt>Form response</dt><dd>{profile.submittedAt || `Row ${profile.rowNumber}`}</dd></div></dl> : <div className="profile-details-empty"><Database size={30} weight="duotone" /><strong>No matched profile yet.</strong><p>Once a response is matched, your name, degree, university, and program will appear here.</p></div>}
        </aside>
      </div>

    </div>
  );
}

function BackupPage({ data, refresh, notify, installPrompt, installApp, installed = false }) {
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
          <span className="feature-icon soft-button"><DownloadSimple size={28} weight="duotone" /></span><div><span className="section-kicker">Offline app</span><h2>{installed ? "Kamiunity is installed" : "Install Kamiunity"}</h2><p>{installed ? "Open your application workspace from your device like a normal app." : "Keep your application workspace close, even without an internet connection."}</p></div>
          <button className="secondary-button soft-button" type="button" onClick={installApp} disabled={installed || !installPrompt}><DownloadSimple size={20} />{installed ? "Installed on this device" : installPrompt ? "Install app" : "Use the browser install menu"}</button>
          {!installed && !installPrompt ? <small className="install-help">If the button is unavailable, open your browser menu and choose Install app or Add to Home Screen.</small> : null}
        </section>
      </div>
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [data, setData] = useState({ programs: [], applications: [], tasks: [], documents: [], profile: null, profileLookupEmail: "" });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [appInstalled, setAppInstalled] = useState(isStandalonePwa);
  const [theme, setTheme] = useState(readThemePreference);
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
    const handleInstalled = () => { setInstallPrompt(null); setAppInstalled(true); };
    window.addEventListener("hashchange", handleHash); window.addEventListener("beforeinstallprompt", handleInstall); window.addEventListener("appinstalled", handleInstalled);
    return () => { window.removeEventListener("hashchange", handleHash); window.removeEventListener("beforeinstallprompt", handleInstall); window.removeEventListener("appinstalled", handleInstalled); };
  }, []);
  const profileUnlocked = hasCompletedProfile(data.profile);
  useEffect(() => {
    if (!ready || profileUnlocked || route === "profile") return;
    window.location.hash = "/profile";
    setRoute("profile");
    setToast("Complete your profile to unlock the workspace.");
    setModal(null);
  }, [ready, profileUnlocked, route]);
  useEffect(() => { if (!toast) return undefined; const timeout = window.setTimeout(() => setToast(""), 3600); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#110f1b" : "#55C8BD");
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Theme preference is optional on restricted browsers. */ }
  }, [theme]);
  useEffect(() => { document.title = `Kamiunity — ${NAV_ITEMS.find((item) => item.id === route)?.label || ({ backup: "Backup & transfer", profile: "Profile" }[route] || "Deadlines")}`; }, [route]);
  function navigate(next) {
    const target = ["today", "calendar"].includes(next) ? "deadlines" : next;
    if (!profileUnlocked && target !== "profile") {
      window.location.hash = "/profile";
      setRoute("profile");
      setToast("Complete your profile to unlock the workspace.");
      return;
    }
    window.location.hash = `/${target}`;
    setRoute(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function toggleTheme() {
    setTheme((value) => value === "dark" ? "light" : "dark");
  }
  async function installApp() {
    if (appInstalled) return;
    if (!installPrompt) { setToast("Use your browser menu to install Kamiunity."); return; }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }
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
  const common = { data, refresh, notify: setToast, openModal: setModal, navigate, theme, addCatalogProgram, syncCatalog: syncProgramCatalog, importCatalog: importProgramCatalog, resetCatalog: resetProgramCatalog };
  const pages = { deadlines: <DeadlinesPage {...common} />, programs: <ProgramsPage {...common} />, applications: <ApplicationsPage {...common} />, services: <ServicesPage {...common} />, profile: <ProfilePage {...common} locked={!profileUnlocked} installPrompt={installPrompt} installApp={installApp} installed={appInstalled} />, documents: <DocumentsPage {...common} />, backup: <BackupPage {...common} installPrompt={installPrompt} installApp={installApp} installed={appInstalled} /> };
  const visibleRoute = profileUnlocked ? route : "profile";
  if (!ready) return <main className="loading-screen"><img className="loading-brand" src={kamiunityLogo} alt="kamiunity" /><strong>{loadError ? "Your workspace could not open" : "Opening your application workspace…"}</strong><span role={loadError ? "alert" : undefined}>{loadError || "Your records stay on this device."}</span>{loadError ? <button className="secondary-button soft-button" type="button" onClick={() => window.location.reload()}>Try again</button> : null}</main>;
  return (
    <div className="app-shell kamiunity">
      <TopNavigation route={visibleRoute} navigate={navigate} profile={data.profile} installed={appInstalled} installPrompt={installPrompt} installApp={installApp} theme={theme} toggleTheme={toggleTheme} /><main className="app-main">{pages[visibleRoute]}</main>
      {["task", "add-task"].includes(modal?.type) ? <TaskForm key={`task-${modal.task?.id || "new"}`} {...common} task={modal.task} applicationId={modal.applicationId} close={() => setModal(null)} /> : null}
      {["program", "add-program"].includes(modal?.type) ? <ProgramForm key={`program-${modal.program?.id || "new"}`} {...common} program={modal.program} close={() => setModal(null)} /> : null}
      {["application", "add-application"].includes(modal?.type) ? <ApplicationForm key={`application-${modal.application?.id || modal.programId || "new"}`} {...common} application={modal.application} programId={modal.programId} focusSection={modal.focusSection} close={() => setModal(null)} /> : null}
      {["document", "add-document"].includes(modal?.type) ? <DocumentForm key={`document-${modal.document?.id || "new"}`} {...common} document={modal.document} applicationId={modal.applicationId} onSaved={modal.onSaved} close={() => setModal(null)} /> : null}
      {modal?.type === "application-checklist" ? <ApplicationChecklistForm {...common} application={modal.application} close={() => setModal(null)} /> : null}
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite"><CheckCircle size={21} />{toast}</div>
    </div>
  );
}
