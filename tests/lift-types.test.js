// The `tipo alzata` row of overall (decided 2026-10-26): a free-text type per lift column (stressante, rigenerante…),
// stored as items' liftType (schema 3) and shown next to the lift's name; and lift columns grouped by lift in exports.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseXlsx } from "../src/parser.js";
import { migrate } from "../src/model.js";
import { exportProgram, exportFormats, sameProgram } from "../src/export.js";
import { writeWorkbook } from "../src/xlsx-write.js";
import { exampleModel } from "../src/templates.js";
import { session, maxesFor } from "../src/resolve.js";
import { pl28, model, fixture } from "./helpers.js";

const base = pl28();
const sheet = (d, name) => d.sheets.find((s) => s.name === name);
const mains = (m, n, letter) => m.weeks.find((w) => w.n === n).days.find((d) => d.letter === letter).items.filter((i) => i.kind === "main");
const headers = (d) => sheet(d, "overall").rows[0].slice(3).map((c) => c.v);

/** PL28 exported, with the type row filled from {header: type}, then imported again. */
async function withTypes(types, format = "pl28") {
  const d = exportProgram(base, "pl28");
  const ov = sheet(d, "overall").rows;
  ov[0].forEach((h, i) => { if (types[h?.v]) ov[1][i] = types[h.v]; });
  const r = parseXlsx(await writeWorkbook(d));
  expect(r.errors).toEqual([]);
  return format === "pl28" ? r.model : parseXlsx(await writeWorkbook(exportProgram(r.model, "coach"))).model;
}

describe("the tipo alzata row", () => {
  it("files without it read as before: no lift types", () => {
    expect(base.weeks.flatMap((w) => w.days.flatMap((d) => d.items)).every((i) => i.liftType === null)).toBe(true);
  });

  it("PL28: every week of that column gets the type, and the session shows it", async () => {
    const m = await withTypes({ "Squat stress (A)": "stressante", "Panca var. (A)": "rigenerante" });
    for (const n of [1, 7, 20]) expect(mains(m, n, "A").map((i) => [i.name, i.liftType])).toEqual([["Squat stress", "stressante"], ["Panca var.", "rigenerante"], ["Trazioni", null]]);
    expect(session(m, 1, "A", maxesFor(m)).mains[0].liftType).toBe("stressante");
  });

  it("coach: a log row pointing at an overall column takes that column's type", async () => {
    const m = await withTypes({ "Squat stress (A)": "stressante" });
    const coach = exportProgram(m, "coach");
    const r = parseXlsx(await writeWorkbook(coach));
    expect(r.errors).toEqual([]);
    expect(sameProgram(r.model, m)).toBe(true);
    expect(mains(r.model, 1, "A")[0].liftType).toBe("stressante");
  });

  it("coach: a log row with its own text instead of a reference has no type", async () => {
    const m = await withTypes({ "Squat stress (A)": "stressante" });
    const d = exportProgram(m, "coach");
    const log = sheet(d, "training log").rows;
    const row = log.findIndex((r) => r[0] === 1 && r[1] === "A" && r[2] === "Squat stress");
    log[row][4] = "4x5 a sensazione";
    const r = parseXlsx(await writeWorkbook(d));
    expect(mains(r.model, 1, "A")[0]).toMatchObject({ liftType: null, prescription: { parts: ["4x5 a sensazione"] } });
    expect(mains(r.model, 2, "A")[0].liftType).toBe("stressante");
  });

  it("is recognised with any capitals, and is optional per column", async () => {
    const d = exportProgram(base, "pl28");
    sheet(d, "overall").rows[1][0] = { v: "TIPO ALZATA" };
    sheet(d, "overall").rows[1][4] = "tecnica"; // Squat tecnica (C)
    const r = parseXlsx(await writeWorkbook(d));
    expect(r.errors).toEqual([]);
    expect(mains(r.model, 1, "C")[0].liftType).toBe("tecnica");
    expect(mains(r.model, 1, "A")[0].liftType).toBeNull();
  });

  it("programs saved before (schema 2) are upgraded with no lift types", () => {
    const old = structuredClone(base);
    old.schemaVersion = 2;
    for (const w of old.weeks) for (const d of w.days) for (const i of d.items) delete i.liftType;
    expect(migrate(old)).toEqual(base);
  });
});

describe("exports group the lift columns by lift", () => {
  it("PL28.xlsx: Squat A, C, D, then Panca, Stacco, Trazioni (the order of the original file)", () => {
    const original = XLSX.read(fixture("PL28.xlsx"), { type: "buffer" }).Sheets.overall;
    const want = "CDEFGHIJKL".split("").map((c) => original[`${c}1`].v);
    expect(headers(exportProgram(base, "pl28"))).toEqual(want);
    expect(headers(exportProgram(base, "coach")).map((h) => h.replace(/ \(.\)$/, ""))).toEqual(want.map((h) => h.replace(/ \(.\)$/, "")));
  });

  it("example.xlsx: coach groups by lift; PL28 keeps day order, because day B lists Stacco before Panca volume", () => {
    const m = parseXlsx(fixture("../examples/example.xlsx")).model;
    expect(headers(exportProgram(m, "coach"))).toEqual(["Squat (A)", "Squat volume (C)", "Panca (A)", "Panca volume (B)", "Panca var. (C)", "Stacco (B)", "Stacco var. (C)"]);
    expect(headers(exportProgram(m, "pl28"))).toEqual(["Squat (A)", "Panca (A)", "Stacco (B)", "Panca volume (B)", "Squat volume (C)", "Panca var. (C)", "Stacco var. (C)"]);
  });

  it("PL28 keeps day order when grouping by lift would change the order of a day's lifts", async () => {
    const m = structuredClone(exampleModel());
    const a = m.weeks[0].days[0];
    a.items = [a.items[1], a.items[0], ...a.items.slice(2)]; // day A: Panca before Squat
    expect(exportFormats(m)[0].ok).toBe(true);
    const back = parseXlsx(await writeWorkbook(exportProgram(m, "pl28"))).model;
    expect(sameProgram(back, m)).toBe(true);
  });

  it("the coach format always groups by lift (the log keeps each day's order)", () => {
    const m = model("PL28_coach.xlsx");
    const h = headers(exportProgram(m, "coach"));
    expect(h.slice(0, 3).every((x) => x.toLowerCase().startsWith("squat"))).toBe(true);
  });
});
