export const INTAKE_OPTIONS = ["Fall", "Spring", "Summer", "Winter"];

export const PROGRAM_CATEGORIES = [
  "Engineering",
  "Computer Science & Data",
  "Architecture & Urbanism",
  "Design & Creative Arts",
  "Business & Management",
  "Science & Mathematics",
  "Sustainability & Environment",
  "Health & Biomedical",
  "Social Sciences & Policy",
  "Humanities & Languages",
  "Other",
];

const SEASON_PATTERNS = [
  ["Fall", /\bfall\b|\bautumn\b|\bautomne\b|\bherbst\b|\bsemester\s*1\b|\b1(?:st|er)?\s*semester\b|\b1er\b|\bseptember\b|\boctober\b|\bnovember\b/],
  ["Spring", /\bspring\b|\bprintemps\b|\bfruehling\b|\bfrühling\b|\bsemester\s*2\b|\b2(?:nd|e)?\s*semester\b|\b2e\b|\bjanuary\b|\bfebruary\b|\bmarch\b/],
  ["Summer", /\bsummer\b|\bete\b|\bsommer\b|\bsemester\s*4\b|\b4(?:th|e)?\s*semester\b|\bjune\b|\bjuly\b|\baugust\b/],
  ["Winter", /\bwinter\b|\bhiver\b|\bsemester\s*0\b|\bdecember\b/],
];

function normaliseText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-");
}

/**
 * Convert legacy academic-year, semester, month, and season values into the
 * small set of seasons used by the programme search UI. Unknown values are
 * intentionally blank instead of being presented as a misleading season.
 */
export function normalizeIntake(value) {
  const text = normaliseText(value);
  if (!text) return "";
  const seasons = new Set();
  for (const [season, pattern] of SEASON_PATTERNS) {
    if (pattern.test(text)) seasons.add(season);
  }

  // French master portals often expose entry into semester 3 for the second
  // year of a programme. It still begins in the autumn academic intake.
  if (/\bsemester\s*3\b|\b3(?:rd|eme|e)\s*semester\b|\b3eme\b/.test(text)) seasons.add("Fall");

  // An academic year such as 2025/2026 usually represents the autumn cycle.
  // Keep the season, remove every year token, and never return the year.
  if (!seasons.size && /\b20\d{2}\s*[/-]\s*20\d{2}\b|\b20\d{2}\b/.test(text)) seasons.add("Fall");

  return INTAKE_OPTIONS.filter((season) => seasons.has(season)).join(", ");
}

function contains(text, pattern) {
  return pattern.test(text);
}

/**
 * Give every catalogue row a predictable filterable category. Explicit sheet
 * values are preserved; blank values are inferred from the programme and
 * department text.
 */
export function inferProgramCategory(record = {}) {
  const text = normaliseText(`${record.program || ""} ${record.department || ""} ${record.name || ""}`);
  if (contains(text, /\b(architecture|architectural|urban|landscape|built environment|spatial planning|city planning)\b/)) return "Architecture & Urbanism";
  if (contains(text, /\b(design|fashion|creative|interior|product service|communication design|interaction design)\b/)) return "Design & Creative Arts";
  if (contains(text, /\b(biomedical|medicine|medical|health|public health|clinical|pharmacy|nutrition|bioengineering)\b/)) return "Health & Biomedical";
  if (contains(text, /\b(sustainab|environment|environmental|climate|ecology|renewable|green|energy transition)\b/)) return "Sustainability & Environment";
  if (contains(text, /\b(computer|computational|informatics|information technology|artificial intelligence|machine learning|data science|data analytics|cyber|software|telecommunication|bioinformatics|high performance computing|digital)\b/)) return "Computer Science & Data";
  if (contains(text, /\b(engineer\w*|aeronaut\w*|automation|chemical|civil|electrical|electronic|mechanical|mobility|nuclear|materials|geoinformatics|food technology|industrial safety|telecommunication)\b/)) return "Engineering";
  if (contains(text, /\b(management|business|economics|finance|accounting|marketing|entrepreneur|mba|organisation|organization)\b/)) return "Business & Management";
  if (contains(text, /\b(mathemat|physics|astronomy|astrophysics|chemistry|statistics|quantitative|natural science)\b/)) return "Science & Mathematics";
  if (contains(text, /\b(policy|political|social science|sociology|education|pedagogy|law|international relations|psychology|communication)\b/)) return "Social Sciences & Policy";
  if (contains(text, /\b(history|language|linguistic|literature|philosophy|culture|humanities|arts)\b/)) return "Humanities & Languages";
  return "Other";
}

export function normalizeProgramCategory(value, record = {}) {
  const explicit = String(value ?? "").trim();
  return explicit || inferProgramCategory(record);
}

export function isPolitecnicoDiMilano(program = {}) {
  return /politecnico\s+di\s+milano|politecnico\s+milano/i.test(String(program.name || ""));
}
