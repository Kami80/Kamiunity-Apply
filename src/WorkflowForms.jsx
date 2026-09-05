import { useEffect, useId, useRef, useState } from "react";
import { ArrowSquareOut, Check, DownloadSimple, Plus, Trash } from "@phosphor-icons/react";
import { addDaysIso, db } from "./db.js";
import { downloadBlob, formatBytes } from "./backup.js";
import { Modal, PrimaryButton } from "./ui.jsx";
import { applicationDocuments, applicationFromProgram, DOCUMENT_CATEGORIES, ids, PRIORITIES, programDocuments, safeUrl, saveApplication, saveDocument, saveProgram, saveTask, STATUS_OPTIONS } from "./workflow.js";

const newProgram = () => ({ name: "", program: "", country: "", deadline: "", priority: "Medium", professors: [] });
function revealInvalidField(event) {
  let parent = event.target.parentElement;
  while (parent) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
}
const programLabel = (program) => `${program.name} · ${program.program}`;
const applicationLabel = (application, data) => {
  const program = data.programs.find((item) => item.id === application.programId);
  return `${program ? programLabel(program) : "Missing program"}${application.intake ? ` · ${application.intake}` : ""} · #${application.id}`;
};

export function ExternalLink({ url, children = "Open link" }) {
  const href = safeUrl(url);
  return href ? <a className="inline-link" href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowSquareOut size={16} /></a> : null;
}

function Field({ label, value, onChange, type = "text", options, hint, className = "", ...props }) {
  const id = useId();
  const shared = { id, value: value ?? "", onChange: (event) => onChange(event.target.value), ...props };
  return <div className={`workflow-field ${className}`}><label htmlFor={id}>{label}{props.required ? <span aria-hidden="true"> *</span> : null}</label>
    {options ? <select {...shared}>{options.map((option) => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}</select> : type === "textarea" ? <textarea rows={3} {...shared} /> : <input type={type === "url" ? "text" : type} inputMode={type === "url" ? "url" : undefined} {...shared} />}
    {hint ? <small>{hint}</small> : null}{type === "url" ? <ExternalLink url={value} /> : null}
  </div>;
}

function Fields({ definitions, form, change }) {
  return <div className="form-grid">{definitions.map(([key, label, type = "text", extra = {}]) => <Field key={key} label={label} type={type} value={form[key]} onChange={(value) => change(key, value)} {...extra} />)}</div>;
}

function Section({ title, description, children, open = false, id }) {
  return <details id={id} className="form-section" open={open}><summary>{title}</summary>{description ? <p className="field-help">{description}</p> : null}<div className="section-fields">{children}</div></details>;
}

function LinkPicker({ title, items, selected, onChange, empty = "Nothing available yet.", description }) {
  const [query, setQuery] = useState("");
  const selectedIds = ids(selected);
  const visible = items.filter((item) => `${item.label} ${item.description || ""}`.toLowerCase().includes(query.toLowerCase()));
  function toggle(id) { onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]); }
  return <fieldset className="link-picker"><legend>{title}<span>{selectedIds.length} selected</span></legend>
    {description ? <p className="field-help">{description}</p> : null}
    {items.length ? <><input className="picker-search" type="search" aria-label={`Search ${title.toLowerCase()}`} placeholder={`Search ${title.toLowerCase()}…`} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="picker-options">{visible.map((item) => <div className={`picker-option ${selectedIds.includes(item.id) ? "is-selected" : ""}`} key={item.id}><label><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} /><span><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span></label>{item.download ? <button type="button" className="icon-button" onClick={item.download} aria-label={`Download ${item.label}`}><DownloadSimple size={20} /></button> : null}</div>)}{!visible.length ? <p className="field-help">No matches. Your selections are kept.</p> : null}</div></> : <p className="field-help">{empty}</p>}
  </fieldset>;
}

function DocumentPicker({ data, selected, onChange }) {
  return <LinkPicker title="Documents" items={data.documents.map((document) => ({ id: document.id, label: document.name, description: `${document.category} · v${document.version || "1.0"} · ${document.blob ? document.status || "Draft" : "Example — no file attached"}`, download: document.blob ? () => downloadBlob(document.blob, document.name) : undefined }))} selected={selected} onChange={onChange} empty="Add files in Documents, then link them here." description="Select any number of files. Unlinking keeps the original in your document library." />;
}

function ProfessorFields({ value = [], onChange }) {
  function change(index, key, next) { onChange(value.map((contact, i) => i === index ? { ...contact, [key]: next } : contact)); }
  return <div className="contacts-editor">{value.map((contact, index) => <div className="contact-card" key={index}>
    <div className="section-heading"><h4>Professor {index + 1}</h4><button className="icon-button" type="button" onClick={() => onChange(value.filter((_, i) => i !== index))} aria-label={`Remove professor ${index + 1}`}><Trash size={18} /></button></div>
    <Fields form={contact} change={(key, next) => change(index, key, next)} definitions={[["name", "Professor name"], ["email", "Professor email", "email"], ["lab", "Department / research lab"], ["url", "Profile or lab website", "url"], ["status", "Contact status", "text", { options: ["Not contacted", "Email drafted", "Contacted", "Replied", "Meeting scheduled"] }], ["lastContactDate", "Last contacted", "date"], ["followUpDate", "Follow-up date", "date"], ["notes", "Research fit & conversation notes", "textarea"]]} />
  </div>)}<button type="button" className="secondary-button soft-button" onClick={() => onChange([...value, { name: "", email: "", lab: "", url: "", notes: "", status: "Not contacted" }])}><Plus size={19} />Add professor</button></div>;
}

function ProgramFields({ form, change }) {
  return <>
    <Fields form={form} change={change} definitions={[["name", "University", "text", { required: true, placeholder: "University name" }], ["program", "Program", "text", { required: true, placeholder: "Degree and subject" }], ["country", "Country"], ["city", "City / campus"], ["url", "Program website", "url", { placeholder: "https://…" }], ["portalUrl", "Application portal", "url", { placeholder: "https://…" }], ["deadline", "Application deadline", "date", { hint: "Leave blank if it hasn’t been announced." }], ["priority", "Priority", "text", { options: PRIORITIES }]]} />
    <Section title="Study details" open={false}><Fields form={form} change={change} definitions={[["department", "Department"], ["degreeLevel", "Degree level", "text", { options: ["", "Bachelor’s", "Master’s", "PhD", "Certificate", "Other"] }], ["intake", "Intake", "text", { placeholder: "e.g. Fall 2027" }], ["duration", "Duration", "text", { placeholder: "e.g. 2 years" }], ["language", "Teaching language"], ["studyMode", "Study mode", "text", { options: ["", "On campus", "Online", "Hybrid"] }], ["deadlineNote", "Deadline time / time zone", "text", { placeholder: "e.g. 23:59 Europe/Berlin" }], ["admissionsEmail", "Admissions email", "email"]]} /></Section>
    <Section title="Costs & funding"><Fields form={form} change={change} definitions={[["tuition", "Tuition", "text", { placeholder: "Amount, currency and period" }], ["applicationFee", "Application fee", "text", { placeholder: "e.g. EUR 75" }], ["funding", "Funding / scholarship"], ["fundingUrl", "Funding website", "url"]]} /></Section>
    <Section title={`Professors & contacts · ${form.professors?.length || 0}`}><ProfessorFields value={form.professors} onChange={(value) => change("professors", value)} /></Section>
    <Section title="Requirements & notes"><Fields form={form} change={change} definitions={[["minimumGpa", "Minimum GPA / academic requirement"], ["languageRequirements", "Language test requirements"], ["requirements", "Required documents & prerequisites", "textarea"], ["notes", "Research notes", "textarea"]]} /></Section>
  </>;
}

function useFormSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  async function run(callback) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try { await callback(); } catch (failure) { setError(failure.message || "Could not save. Please try again."); }
    finally { saving.current = false; setBusy(false); }
  }
  return { busy, error, run };
}

function FormFooter({ busy, error, close, label = "Save changes", children }) {
  return <>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="modal-footer workflow-footer"><button className="secondary-button soft-button" type="button" onClick={close} disabled={busy}>Cancel</button><PrimaryButton type="submit" icon={Check} disabled={busy}>{busy ? "Saving…" : label}</PrimaryButton>{children ? <div className="footer-extra">{children}</div> : null}</div></>;
}

export function ProgramForm({ data, program, refresh, notify, close, openModal }) {
  const [form, setForm] = useState(() => ({ ...newProgram(), ...program }));
  const [documentIds, setDocumentIds] = useState(() => program ? programDocuments(data, program.id).map((document) => document.id) : []);
  const { busy, error, run } = useFormSave();
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function submit(event) {
    event.preventDefault(); const startApplication = event.nativeEvent.submitter?.value === "start-application";
    run(async () => { const programId = await saveProgram(form, documentIds); await refresh(); notify(program ? "Program and document links saved." : "Program added."); if (startApplication) openModal({ type: "add-application", programId }); else close(); });
  }
  return <Modal title={program ? "Program details" : "Add program"} onClose={close} busy={busy} size="large"><form className="form-stack workflow-form" onSubmit={submit} onInvalidCapture={revealInvalidField} aria-busy={busy}>
    <p className="field-help">Keep your research, contacts, and reusable documents together. Only fields marked * are required.</p>
    <ProgramFields form={form} change={change} /><DocumentPicker data={data} selected={documentIds} onChange={setDocumentIds} />
    <FormFooter busy={busy} error={error} close={close} label={program ? "Save program" : "Add program"}><button className="secondary-button soft-button" type="submit" value="start-application" disabled={busy}>Save & start application</button></FormFooter>
  </form></Modal>;
}

export function ApplicationForm({ data, application, programId, focusSection, refresh, notify, close }) {
  const source = data.programs.find((program) => program.id === (application?.programId || programId));
  const [sourceId, setSourceId] = useState(source?.id ? String(source.id) : data.programs.length ? "" : "new");
  const [draftProgram, setDraftProgram] = useState(newProgram);
  const [form, setForm] = useState(() => ({ ...applicationFromProgram(source || {}), ...application }));
  const [documentIds, setDocumentIds] = useState(() => application ? applicationDocuments(data, application).map((document) => document.id) : source ? programDocuments(data, source.id).map((document) => document.id) : []);
  const { busy, error, run } = useFormSave();
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const selectedProgram = data.programs.find((program) => program.id === Number(sourceId));
  useEffect(() => { if (focusSection === "contacts") document.getElementById("application-contacts")?.scrollIntoView({ block: "start" }); }, [focusSection]);
  function chooseProgram(value) {
    setSourceId(value);
    const program = data.programs.find((item) => item.id === Number(value));
    setForm(applicationFromProgram(program || {}));
    setDocumentIds(program ? programDocuments(data, program.id).map((document) => document.id) : []);
  }
  function submit(event) {
    event.preventDefault();
    run(async () => { await saveApplication({ ...form, programId: Number(sourceId) }, documentIds, sourceId === "new" ? draftProgram : undefined); await refresh(); notify(application ? "Application and document links saved." : "Application created with your selected documents."); close(); });
  }
  return <Modal title={application ? "Application details" : "Add application"} onClose={close} busy={busy} size="large"><form className="form-stack workflow-form" onSubmit={submit} onInvalidCapture={revealInvalidField} aria-busy={busy}>
    {application ? <div className="source-summary"><span className="section-kicker">Linked program</span><h3>{selectedProgram?.name || "Missing program"}</h3><p>{selectedProgram?.program}{form.intake ? ` · ${form.intake}` : ""}</p><ExternalLink url={selectedProgram?.url}>Program website</ExternalLink></div> : <>
      <Field label="Start from a program" value={sourceId} onChange={chooseProgram} required options={[{ value: "", label: "Choose a saved program…" }, ...data.programs.map((program) => ({ value: String(program.id), label: programLabel(program) })), { value: "new", label: "+ Create a new program" }]} />
      {selectedProgram ? <div className="source-summary"><p>Deadline, intake, portal, fees, requirements, contacts, and {programDocuments(data, selectedProgram.id).length} document(s) copied. You can tailor them for this application.</p><ExternalLink url={selectedProgram.url}>Program website</ExternalLink></div> : null}
      {sourceId === "new" ? <Section title="New program" open><ProgramFields form={draftProgram} change={(key, value) => { setDraftProgram((current) => ({ ...current, [key]: value })); if (["deadline", "deadlineNote", "intake", "priority", "portalUrl", "applicationFee", "funding", "requirements", "admissionsEmail", "professors"].includes(key)) change(key, value); }} /></Section> : null}
    </>}
    <Section title="Application tracking" open><Fields form={form} change={change} definitions={[["status", "Status", "text", { options: STATUS_OPTIONS }], ["priority", "Priority", "text", { options: PRIORITIES }], ["intake", "Intake", "text", { placeholder: "e.g. Fall 2027" }], ["deadline", "Application deadline", "date"], ["deadlineNote", "Deadline time / time zone"], ["progress", "Progress (%)", "number", { min: 0, max: 100, step: 1 }], ["portalUrl", "Application portal", "url"], ["referenceNumber", "Application / reference number"]]} /></Section>
    <DocumentPicker data={data} selected={documentIds} onChange={setDocumentIds} />
    <Section title="Submission, fees & decision"><Fields form={form} change={change} definitions={[["applicationFee", "Application fee"], ["feeStatus", "Fee status", "text", { options: ["Not paid", "Paid", "Waiver requested", "Waived", "Not required"] }], ["submittedAt", "Submission date", "date"], ["decisionDate", "Decision date", "date"], ["decision", "Decision outcome", "text", { options: ["", "Awaiting decision", "Accepted", "Conditional offer", "Waitlisted", "Rejected", "Withdrawn", "Enrolled"] }], ["funding", "Funding / scholarship"]]} /></Section>
    <Section id="application-contacts" title={`Professors & contacts · ${form.professors?.length || 0}`} open={focusSection === "contacts"}><Field label="Admissions email" type="email" value={form.admissionsEmail} onChange={(value) => change("admissionsEmail", value)} /><ProfessorFields value={form.professors} onChange={(value) => change("professors", value)} /></Section>
    <Section title="Requirements & notes"><Fields form={form} change={change} definitions={[["requirements", "Required documents & prerequisites", "textarea"], ["notes", "Application notes / next steps", "textarea"]]} /></Section>
    {application ? <p className="field-help">These application details are saved independently of the program. Manage related tasks from Today or Calendar.</p> : null}
    <FormFooter busy={busy} error={error} close={close} label={application ? "Save application" : "Create application"} />
  </form></Modal>;
}

export function DocumentForm({ data, document, applicationId, refresh, notify, close, onSaved }) {
  const [form, setForm] = useState(() => ({ name: "", category: "Academic", version: "1.0", status: "Draft", notes: "", expiresAt: "", linkedProgramIds: [], linkedApplicationIds: applicationId ? [applicationId] : [], ...document }));
  const [files, setFiles] = useState([]);
  const { busy, error, run } = useFormSave();
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function submit(event) {
    event.preventDefault();
    run(async () => { const id = await saveDocument(form, files); await refresh(); onSaved?.(id); notify(document ? "Document details and assignments saved." : `${files.length} document(s) added with your assignments.`); close(); });
  }
  return <Modal title={document ? "Document details & links" : "Add documents"} onClose={close} busy={busy} size="large"><form className="form-stack workflow-form" onSubmit={submit} aria-busy={busy}>
    {document?.isExample && !files.length ? <p className="form-notice">This is an example record. Attach your own file below to use it in your applications.</p> : null}
    <label className="upload-field">{document ? "Replace / attach file (optional)" : "Choose files *"}<input type="file" multiple={!document} required={!document} onChange={(event) => { const chosen = [...event.target.files]; setFiles(chosen); if (!document && chosen.length === 1) change("name", chosen[0].name); }} /></label>
    {files.length ? <ul className="selected-files">{files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name}<span>{formatBytes(file.size)}</span></li>)}</ul> : null}
    {document || files.length <= 1 ? <Field label="File name" value={form.name} onChange={(value) => change("name", value)} required={Boolean(document)} hint="Keep the file extension, such as .pdf or .docx." /> : <p className="field-help">Each file keeps its own name. The details and assignments below apply to all selected files.</p>}
    <Fields form={form} change={change} definitions={[["category", "Category", "text", { options: DOCUMENT_CATEGORIES }], ["version", "Version", "text", { placeholder: "e.g. 2.0" }], ["status", "Readiness", "text", { options: ["Draft", "In review", "Ready", "Needs update"] }], ["expiresAt", "Expiry date", "date"], ["notes", "Notes", "textarea", { className: "field-full" }]]} />
    <LinkPicker title="Programs" items={data.programs.map((program) => ({ id: program.id, label: programLabel(program), description: program.country }))} selected={form.linkedProgramIds} onChange={(value) => change("linkedProgramIds", value)} empty="Add a program to start linking documents." description="Program links make this file available when starting a future application." />
    <LinkPicker title="Applications" items={data.applications.map((application) => ({ id: application.id, label: applicationLabel(application, data), description: application.status }))} selected={form.linkedApplicationIds} onChange={(value) => change("linkedApplicationIds", value)} empty="Create an application to assign this file to it." description="Select existing applications that should use this file. These assignments are independent of program links." />
    <FormFooter busy={busy} error={error} close={close} label={document ? "Save document" : "Add documents"} />
  </form></Modal>;
}

export function TaskForm({ data, task, refresh, notify, close }) {
  const [form, setForm] = useState(() => {
    const applicationIds = task?.applicationIds ?? (task?.applicationId ? [task.applicationId] : []);
    const inheritedProgramIds = data.applications.filter((application) => applicationIds.includes(application.id)).map((application) => application.programId);
    return { title: "", dueDate: addDaysIso(7), priority: "Medium", note: "", url: "", done: false, ...task, applicationIds, programIds: task?.additionalProgramIds ?? (task?.programIds || []).filter((id) => !inheritedProgramIds.includes(id)) };
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useFormSave();
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function submit(event) { event.preventDefault(); run(async () => { await saveTask(form); await refresh(); notify(task ? "Task updated." : "Task added to your timeline."); close(); }); }
  return <Modal title={task ? "Task details" : "Add task"} onClose={close} busy={busy} size="large"><form className="form-stack workflow-form" onSubmit={submit} aria-busy={busy}>
    <Field label="Task name" value={form.title} onChange={(value) => change("title", value)} required placeholder="e.g. Request recommendation letters" />
    <Fields form={form} change={change} definitions={[["dueDate", "Due date", "date", { required: true }], ["priority", "Priority", "text", { options: PRIORITIES }], ["url", "Related link", "url", { className: "field-full" }], ["note", "Notes / next step", "textarea", { className: "field-full" }]]} />
    <label className="checkbox-field"><input type="checkbox" checked={form.done} onChange={(event) => change("done", event.target.checked)} />Task complete</label>
    <LinkPicker title="Applications" items={data.applications.map((application) => ({ id: application.id, label: applicationLabel(application, data), description: application.status }))} selected={form.applicationIds} onChange={(value) => change("applicationIds", value)} description="A task can support several applications, or stay general with no links." />
    <Section title="Additional programs"><LinkPicker title="Programs" items={data.programs.map((program) => ({ id: program.id, label: programLabel(program) }))} selected={form.programIds} onChange={(value) => change("programIds", value)} description="Link research tasks to programs, even before you start an application." /></Section>
    {confirmDelete ? <div className="form-notice"><p>Remove this task? Your applications and documents will stay saved.</p><button type="button" className="danger-button soft-button" disabled={busy} onClick={() => run(async () => { await db.tasks.delete(task.id); await refresh(); notify("Task removed."); close(); })}>Remove task</button><button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Keep task</button></div> : null}
    <FormFooter busy={busy} error={error} close={close} label={task ? "Save task" : "Add task"}>{task ? <button className="danger-button soft-button" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash size={18} />Remove</button> : null}</FormFooter>
  </form></Modal>;
}
