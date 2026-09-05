import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db.js";
import { googleSheetCsvUrl, importCatalogCsv, parseCatalogCsv, programKey } from "../src/catalog.js";

beforeEach(async () => { await db.delete(); await db.open(); });
after(async () => { await db.delete(); });

test("Google Sheet edit links become read-only CSV export links", () => {
  assert.equal(
    googleSheetCsvUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=42"),
    "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42",
  );
  assert.equal(
    googleSheetCsvUrl("https://docs.google.com/spreadsheets/d/e/public-id/pubhtml"),
    "https://docs.google.com/spreadsheets/d/e/public-id/pubhtml?output=csv",
  );
});

test("catalog CSV parsing keeps rich program fields and skips unusable rows", () => {
  const csv = [
    "Catalog ID,University,Program,Country,Deadline,Program website,Admissions email,Professor name,Professor email,Notes",
    "cs-01,Example University, MSc Design ,Canada,2027-01-15,example.edu/design,admissions@example.edu,Dr Contact,contact@example.edu,Research fit",
    ",Missing University,,Germany,2027-01-15,,,,,",
    "bad-date,Second University,PhD AI,Germany,2027-02-31,https://second.example.edu,,,,",
  ].join("\n");
  const parsed = parseCatalogCsv(csv, { sourceLabel: "Test sheet", sourceUrl: "https://sheet.example/catalog.csv" });
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.skipped.length, 2);
  assert.equal(parsed.records[0].catalogId, "cs-01");
  assert.equal(parsed.records[0].url, "https://example.edu/design");
  assert.equal(parsed.records[0].professors[0].email, "contact@example.edu");
  assert.equal(parsed.records[0].catalogSourceUrl, "https://sheet.example/catalog.csv");
  assert.equal(programKey(parsed.records[0]), "example university::msc design");
});

test("importing catalog CSV replaces the shared snapshot without creating applications", async () => {
  const csv = "University,Program,Country\nExample University,MSc Design,Canada\nSecond University,PhD AI,Germany";
  const result = await importCatalogCsv(csv, "program-list.csv");
  assert.equal(result.records.length, 2);
  assert.equal(await db.catalogPrograms.count(), 2);
  assert.equal(await db.programs.count(), 0);
  const source = await db.settings.get("program-catalog-source");
  assert.equal(source.value.label, "program-list.csv");
  assert.equal(source.value.mode, "file");
});
