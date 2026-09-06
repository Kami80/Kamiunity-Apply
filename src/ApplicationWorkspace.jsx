import { useMemo, useState } from "react";
import { ArrowRight, ArrowSquareOut, CalendarBlank, CaretRight, Check, CheckCircle, Circle, Clock, EnvelopeSimple, FilePdf, FileText, ListChecks, MagnifyingGlass, NotePencil, Plus, Sparkle, Trash, WarningCircle } from "@phosphor-icons/react";
import { db, toIsoDate } from "./db.js";
import emptyApplication from "./assets/empty-application.png";
import { applicationChecklist, documentReadiness, removeApplication, saveApplicationChecklist } from "./workflow.js";
import { downloadBlob } from "./backup.js";
import { ExternalLink } from "./WorkflowForms.jsx";
import { Modal, PrimaryButton } from "./ui.jsx";

function fullDate(value) {
  return value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "Deadline not set";
}

function deadlineCopy(value) {
  if (!value) return "Add a deadline";
  const difference = Math.round((new Date(`${value}T12:00:00`) - new Date(`${toIsoDate(new Date())}T12:00:00`)) / 86400000);
  return difference < 0 ? `${Math.abs(difference)} days overdue` : difference === 0 ? "Due now" : `${difference} days left`;
}

export function ReadinessBadge({ status }) {
  const ready = status === "Ready";
  const missing = ["Needed", "No file", "Expired", "Needs update"].includes(status);
  const Icon = ready ? CheckCircle : missing ? WarningCircle : status === "Example" ? FileText : Clock;
  return <span className={`readiness-badge ${ready ? "ready" : missing ? "needed" : status === "Example" ? "example" : "draft"}`}><Icon size={17} />{status}</span>;
}

export function ApplicationWorkspace({ data, openModal, refresh, notify, navigate, onOpenTable }) {
  const [selectedId, setSelectedId] = useState(data.applications[0]?.id);
  const [query, setQuery] = useState("");
  const [savingStage, setSavingStage] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const applications = useMemo(() => data.applications.map((application) => ({ application, program: data.programs.find((program) => program.id === application.programId) })), [data]);
  const visible = applications.filter(({ application, program }) => `${program?.name} ${program?.program} ${application.intake || ""}`.toLowerCase().includes(query.toLowerCase()));
  const selected = visible.find(({ application }) => application.id === selectedId) || visible[0];
  const application = selected?.application;
  const program = selected?.program;
  const rows = application ? applicationChecklist(data, application) : [];
  const contacts = application?.professors ?? program?.professors ?? [];
  const stages = [{ label: "Research", status: "Researching" }, { label: "Prepare", status: "Preparing" }, { label: "Submit", status: "Submitted" }, { label: "Decision", status: application?.status === "Offer" ? "Offer" : "Decision" }];
  const stageIndex = Math.max(0, stages.findIndex((stage) => stage.status === application?.status));
  const tasks = data.tasks.filter((task) => (task.applicationIds ?? (task.applicationId ? [task.applicationId] : [])).includes(application?.id) && !task.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  async function setStage(status) {
    if (savingStage) return;
    setSavingStage(true);
    try { await db.applications.update(application.id, { status }); await refresh(); notify(`Application moved to ${status}.`); }
    catch { notify("Could not update the stage. Please try again."); }
    finally { setSavingStage(false); }
  }
  async function deleteApplication() {
    if (!application || removing) return;
    setRemoving(true);
    try {
      await removeApplication(application.id);
      setSelectedId(undefined);
      setConfirmRemove(false);
      await refresh();
      notify("Application removed. Its saved program, tasks, and documents are still here.");
    } catch { notify("Could not remove the application. Please try again."); }
    finally { setRemoving(false); }
  }
  function edit(section) { openModal({ type: "application", application, focusSection: section }); }
  return <div className={`application-workspace ${!data.applications.length ? "application-workspace-empty" : ""}`}>
    <aside className="application-index" aria-label="Your applications">
      <div className="index-heading"><div><h1>My applications</h1><p>{application?.intake || "Your admissions cycle"}</p></div><button className="icon-button soft-button" type="button" onClick={() => openModal({ type: "add-application" })} aria-label="Add application"><Plus size={22} /></button></div>
      <label className="index-search"><MagnifyingGlass size={17} /><input type="search" placeholder="Find an application" aria-label="Find an application" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="application-index-list">{visible.map(({ application: item, program: school }) => <button className={`application-index-item ${application?.id === item.id ? "selected" : ""}`} type="button" key={item.id} aria-pressed={application?.id === item.id} onClick={() => setSelectedId(item.id)}>
        <strong>{school?.name || "Program unavailable"}</strong><span>{school?.program || "Edit this application to add program details"}</span><small>{item.intake || `Application #${item.id}`}</small><span className="index-deadline"><CalendarBlank size={17} />{fullDate(item.deadline)}</span><span className={`application-stage-pill ${item.status === "Preparing" ? "preparing" : ""}`}><Circle size={14} />{item.status}</span>
      </button>)}{!visible.length ? <p className="index-empty">{query ? "No matching applications." : "Start with a program from your shortlist."}</p> : null}</div>
      <div className="index-footer"><button type="button" onClick={() => navigate("deadlines")}><ListChecks size={21} />Deadline plan<ArrowRight size={18} /></button><button type="button" onClick={onOpenTable}>Open table & board<ArrowSquareOut size={17} /></button><button type="button" onClick={() => navigate("backup")}>Backup & transfer<ArrowRight size={17} /></button></div>
    </aside>
    {application ? <article className="application-dossier">
      <div className="dossier-breadcrumb"><span>Applications<span aria-hidden="true">/</span>{program?.name || "Application"}</span><div className="dossier-header-actions"><button className="text-action" type="button" onClick={() => edit("tracking")}><NotePencil size={17} />Edit details</button><button className="text-action danger-text-action" type="button" onClick={() => setConfirmRemove(true)}><Trash size={17} />Remove application</button></div></div>
      {confirmRemove ? <div className="form-notice application-remove-notice" role="alert"><p>Remove this application from your workspace? Its saved program, tasks, and documents will stay available.</p><div className="button-row application-remove-actions"><button type="button" className="danger-button soft-button" disabled={removing} onClick={deleteApplication}>{removing ? "Removing…" : "Remove application"}</button><button type="button" className="secondary-button" disabled={removing} onClick={() => setConfirmRemove(false)}>Keep application</button></div></div> : null}
      <header className="dossier-header"><div><h2>{program?.name || "Your application"}</h2><p>{program?.program}{application.intake ? ` · ${application.intake}` : ""}</p><div className="dossier-links"><ExternalLink url={program?.url}>Program website</ExternalLink><ExternalLink url={application.portalUrl || program?.portalUrl}>Application portal</ExternalLink>{!program?.url && !application.portalUrl && !program?.portalUrl ? <button className="text-action" type="button" onClick={() => edit("tracking")}>Add application details</button> : null}</div></div>
        <button className="dossier-deadline" type="button" onClick={() => edit("tracking")}><CalendarBlank size={29} /><span><strong>{fullDate(application.deadline)}</strong><small>{deadlineCopy(application.deadline)}</small></span></button>
      </header>
      <ol className="application-stepper" aria-label="Application stage">{stages.map((stage, index) => <li key={stage.label} className={index < stageIndex ? "completed" : index === stageIndex ? "current" : ""}><button type="button" disabled={savingStage} onClick={() => setStage(stage.status)} aria-current={index === stageIndex ? "step" : undefined} aria-label={`Set stage to ${stage.label}`}><span>{stage.label}</span><span className="stage-node">{index < stageIndex ? <Check size={12} weight="bold" /> : null}</span></button></li>)}</ol>
      <section className="dossier-documents" aria-labelledby="file-heading"><div className="dossier-section-heading"><h3 id="file-heading">Build your application file</h3><PrimaryButton icon={FileText} onClick={() => openModal({ type: "application-checklist", application })}>Assign documents</PrimaryButton></div>
        {rows.length ? <div className="application-file-list">{rows.map((row) => {
          const status = documentReadiness(row.document); const Icon = row.document?.type === "application/pdf" ? FilePdf : FileText;
          return <div className="application-file-row" key={row.id}><Icon size={26} weight="regular" /><strong>{row.label}</strong><span className="assigned-file-name">{row.document ? row.document.name : "No file assigned"}</span><ReadinessBadge status={status} /><button className="text-action" type="button" onClick={() => row.document?.blob ? downloadBlob(row.document.blob, row.document.name) : row.document ? openModal({ type: "document", document: row.document }) : openModal({ type: "application-checklist", application })}>{row.document?.blob ? "Download" : row.document ? "Attach file" : "Choose file"}{row.document?.blob ? <ArrowSquareOut size={16} /> : <CaretRight size={18} />}</button></div>;
        })}</div> : <div className="dossier-empty"><FileText size={29} /><div><strong>Give every requirement a place.</strong><p>Add the documents this program asks for, then assign files from your vault.</p></div><button className="text-action" type="button" onClick={() => openModal({ type: "application-checklist", application })}>Build checklist<ArrowRight size={18} /></button></div>}
        <div className="file-list-caption"><span>{rows.filter((row) => documentReadiness(row.document) === "Ready").length} of {rows.length} ready{rows.some((row) => row.document?.isExample) ? " · Example files need your own attachment" : ""}</span><button className="text-action" type="button" onClick={() => openModal({ type: "add-document", applicationId: application.id })}><Plus size={16} />Upload a file</button></div>
      </section>
      <section className="dossier-contacts" aria-labelledby="contacts-heading"><div className="dossier-section-heading"><h3 id="contacts-heading">Professor contact{contacts.length > 1 ? "s" : ""}</h3>{contacts.length ? <button className="text-action" type="button" onClick={() => edit("contacts")}>Manage contacts<ArrowRight size={17} /></button> : null}</div>
        {contacts.length ? contacts.map((contact, index) => <div className="dossier-contact" key={`${contact.email}-${index}`}><span className="contact-avatar" aria-hidden="true">{(contact.name || contact.email || "?").replace(/^Dr\.?\s*/i, "").split(/\s+/).map((name) => name[0]).slice(0, 2).join("").toUpperCase()}</span><div className="contact-identity"><strong>{contact.name || "Professor contact"}</strong><span>{contact.lab || contact.status || "Add research interests"}</span></div><span className="contact-email"><EnvelopeSimple size={19} />{contact.email || "Email not added"}</span><span className="contact-followup"><CalendarBlank size={19} /><span>{contact.followUpDate ? <>Follow-up due<small>{fullDate(contact.followUpDate)}</small></> : contact.status || "Not contacted"}</span></span><button className="text-action" type="button" onClick={() => edit("contacts")}>View contact<CaretRight size={19} /></button></div>) : <div className="dossier-empty contact-empty"><EnvelopeSimple size={27} /><div><strong>Keep your outreach connected.</strong><p>Add a professor’s email, research fit, and follow-up date to this application.</p></div><button className="text-action" type="button" onClick={() => edit("contacts")}>Add professor<Plus size={18} /></button></div>}
      </section>
      <div className="dossier-research-note"><Sparkle size={22} /><p><strong>Research fit:</strong> {contacts.find((contact) => contact.notes)?.notes || program?.notes || "Add a note about why this program fits your interests."}</p></div>
      <section className="dossier-next-step" aria-labelledby="application-tasks-heading">
        <div><h3 className="section-kicker" id="application-tasks-heading">Tasks for this application</h3><strong>{tasks[0]?.title || "No upcoming tasks"}</strong><small>{tasks.length ? fullDate(tasks[0].dueDate) : "Add a task to plan your next application step."}</small></div>
        <div className="dossier-task-actions">
          {tasks.length ? <button className="text-action" type="button" onClick={() => openModal({ type: "task", task: tasks[0] })}>Open task<ArrowRight size={19} /></button> : null}
          <PrimaryButton onClick={() => openModal({ type: "add-task", applicationId: application.id })}>Add task</PrimaryButton>
        </div>
      </section>
    </article> : <div className={`dossier-no-selection ${!data.applications.length ? "dossier-first-use" : ""}`}>
      {!data.applications.length ? <img className="first-use-art" src={emptyApplication} alt="" /> : <FileText size={42} />}
      {!data.applications.length ? <span className="eyebrow">Start your application workspace</span> : null}
      <h2>{query ? "No matching application" : !data.applications.length ? "Start with a program from your shortlist." : "Your next chapter starts with a program."}</h2>
      <p>{query ? "Try another university, degree, or intake." : !data.applications.length ? "Choose a saved program and bring its deadlines, contacts, and documents into one application." : "Choose a saved program and bring its deadlines, contacts, and documents into one application."}</p>
      <div className="first-use-actions"><PrimaryButton onClick={() => openModal({ type: "add-application" })}>Add application</PrimaryButton>{!data.applications.length ? <button className="secondary-button soft-button" type="button" onClick={() => navigate("programs")}>Browse programs</button> : null}</div>
    </div>}
  </div>;
}

export function ApplicationChecklistForm({ data, application, refresh, notify, close }) {
  const [rows, setRows] = useState(() => applicationChecklist(data, application).map(({ document, ...row }) => row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function change(index, key, value) { setRows((current) => current.map((row, position) => index === position ? { ...row, [key]: value } : row)); }
  async function submit(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await saveApplicationChecklist(application.id, rows); await refresh(); notify("Application checklist and document assignments saved."); close(); }
    catch (failure) { setError(failure.message || "Could not save the checklist."); }
    finally { setBusy(false); }
  }
  return <Modal title="Application document checklist" size="large" onClose={close} busy={busy}><form className="form-stack workflow-form" onSubmit={submit}><p className="field-help">List this program’s requirements and choose the file for each. Removing a row unlinks its file from this application; the original stays in your vault.</p>
    {rows.map((row, index) => <div className="checklist-editor-row" key={row.id}><label>Requirement<input required value={row.label} onChange={(event) => change(index, "label", event.target.value)} placeholder="e.g. Official transcript" /></label><label>Assigned document<select value={row.documentId || ""} onChange={(event) => change(index, "documentId", Number(event.target.value) || null)}><option value="">No file assigned</option>{data.documents.map((document) => <option key={document.id} value={document.id}>{document.name} · {documentReadiness(document)}</option>)}</select></label><button className="icon-button" type="button" aria-label={`Remove requirement ${index + 1}`} onClick={() => setRows((current) => current.filter((_, position) => position !== index))}><Trash size={20} /></button></div>)}
    <button className="secondary-button soft-button" type="button" onClick={() => setRows((current) => [...current, { id: crypto.randomUUID(), label: "", documentId: null }])}><Plus size={20} />Add requirement</button>
    {!data.documents.length ? <p className="field-help">Your vault is empty. You can save requirements now and upload files from the application workspace.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}<div className="modal-footer"><button className="secondary-button soft-button" type="button" disabled={busy} onClick={close}>Cancel</button><PrimaryButton type="submit" icon={Check} disabled={busy}>{busy ? "Saving…" : "Save checklist"}</PrimaryButton></div>
  </form></Modal>;
}
