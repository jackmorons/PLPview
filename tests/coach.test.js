// Coach format (FORMAT-COACH-SPEC §7 and §9): PL28_coach.xlsx, PL27.xlsx and broken copies.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseXlsx, formatIssue } from "../src/parser.js";
import { render, maxesFor, session } from "../src/resolve.js";
import { fixture, model, parseEdited } from "./helpers.js";

const coach = model("PL28_coach.xlsx");
const pl28 = model("PL28.xlsx");
const maxes = maxesFor(coach);
const day = (m, n, letter) => m.weeks.find((w) => w.n === n).days.find((d) => d.letter === letter);
const LOG = "training log";

/** Finds the log row (1-based) of week n, day letter, exercise name. */
function logRow(ws, n, letter, name) {
  const last = XLSX.utils.decode_range(ws["!ref"]).e.r + 1;
  for (let r = 2; r <= last; r++) {
    if (ws[`A${r}`]?.v === n && ws[`B${r}`]?.v === letter && ws[`C${r}`]?.v === name) return r;
  }
  throw new Error(`row not found: ${n} ${letter} ${name}`);
}

describe("golden: PL28_coach.xlsx (§7.1)", () => {
  it("imports with no errors: 20 weeks, days A–E, 4 blocks from overall", () => {
    const r = parseXlsx(fixture("PL28_coach.xlsx"));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(coach.format).toBe("coach");
    expect(coach.weeks).toHaveLength(20);
    expect(coach.days).toEqual(["A", "B", "C", "D", "E"]);
    expect(coach.blocks.map((b) => [b.firstWeek, b.lastWeek])).toEqual([[1, 5], [6, 10], [11, 15], [16, 20]]);
  });

  it("spot checks", () => {
    const w1a = session(coach, 1, "A", maxes);
    expect([w1a.mains[0].name, w1a.mains[0].instructions, w1a.mains[0].text]).toEqual(["squat", "discesa 4''", "4x5 + ist. 110kg"]);
    const affondi = session(coach, 5, "A", maxes).accessories.find((a) => a.name === "Affondi");
    expect([affondi.text, affondi.load]).toEqual(["2x8-10", "RIR 3"]);
    const w13b = session(coach, 13, "B", maxes).mains[1];
    expect([w13b.name, w13b.text]).toEqual(["stacco", "1-ist.-1-ist. 195kg"]);
    const w1e = session(coach, 1, "E", maxes);
    expect([w1e.mains.length, w1e.accessories.length, w1e.banner]).toEqual([0, 11, "Solo se domani non c'è B o D"]);
  });

  it("the banner note isn't repeated under its item; other notes stay with their item", () => {
    const s = session(coach, 5, "A", maxes);
    expect(s.banner).toBe("Transizione: accessori -1 serie, RIR +1");
    expect(s.mains[0].note).toBeNull();
  });
});

describe("same sessions from both formats (§7.2)", () => {
  it("every week and day matches item by item, apart from main-lift names and notes", () => {
    // Main-lift names differ by design (PL28 slot "Squat stress" vs log "squat"); an empty intensity is "—" in
    // PL28's accessori and an empty cell in the log. Decisions in VERSIONS.md, 2026-10-25.
    const view = (m, n, letter) => session(m, n, letter, maxesFor(m)).mains.concat(session(m, n, letter, maxesFor(m)).accessories)
      .map((i) => ({ kind: i.kind, name: i.kind === "main" ? "" : i.name, instructions: i.instructions, text: i.text,
        load: i.load === "—" ? null : i.load, group: i.group }));
    let sessions = 0;
    for (const w of pl28.weeks) {
      expect(day(coach, w.n, "A") && coach.weeks.find((x) => x.n === w.n).days.map((d) => d.letter)).toEqual(w.days.map((d) => d.letter));
      for (const d of w.days) {
        expect(view(coach, w.n, d.letter), `settimana ${w.n} giorno ${d.letter}`).toEqual(view(pl28, w.n, d.letter));
        sessions++;
      }
    }
    expect(sessions).toBe(100);
  });

  it("both give the same week types (§9)", () => {
    expect(coach.weeks.map((w) => w.type)).toEqual(pl28.weeks.map((w) => w.type));
  });
});

describe("maxes and week-specific accessories (§7.3, §7.4)", () => {
  it("squat at 200 recalculates through log → overall → Massimali", () => {
    expect(session(coach, 1, "A", maxesFor(coach, { squat: 200 })).mains[0].text).toBe("4x5 + ist. 115kg");
  });

  it("changing week 7 C changes only week 7 C", () => {
    const r = parseEdited("PL28_coach.xlsx", (wb) => {
      const ws = wb.Sheets[LOG];
      const row = logRow(ws, 7, "C", "Hip thrust");
      ws[`C${row}`] = { t: "s", v: "Glute bridge" };
      ws[`E${row}`] = { t: "s", v: "4x12" };
    });
    expect(r.ok).toBe(true);
    for (const n of [6, 8]) expect(day(r.model, n, "C")).toEqual(day(coach, n, "C"));
    const changed = day(r.model, 7, "C").items.find((i) => i.name === "Glute bridge");
    expect(render(changed.prescription, maxes)).toBe("4x12");
    expect(day(r.model, 7, "C").items.some((i) => i.name === "Hip thrust")).toBe(false);
  });
});

describe("PL27 (§7.5, §7.6)", () => {
  it("is rejected for week 16 days A–D written twice, and nothing else", () => {
    const r = parseXlsx(fixture("PL27.xlsx"));
    expect(r.ok).toBe(false);
    // The full list, so the behaviour is documented. Nothing about the athlete columns (G, H).
    expect(r.errors.map(formatIssue)).toEqual([
      "training log 2!A439: settimana 16 giorno A ripetuta alle righe 408 e 439",
      "training log 2!A446: settimana 16 giorno B ripetuta alle righe 415 e 446",
      "training log 2!A453: settimana 16 giorno C ripetuta alle righe 422 e 453",
      "training log 2!A462: settimana 16 giorno D ripetuta alle righe 431 e 462",
    ]);
  });

  it("imports once the second week-16 run is deleted", () => {
    const r = parseEdited("PL27.xlsx", (wb) => {
      const ws = wb.Sheets["training log 2"];
      for (let row = 438; row <= 468; row++) for (const c of "ABCDEFGHIJ") delete ws[`${c}${row}`];
    });
    expect(r.errors).toEqual([]);
    const m = r.model;
    expect(m.weeks).toHaveLength(20);
    expect(m.lifts).toEqual([]); // no Massimali: loads are fixed text, the max editor is hidden
    expect(m.blocks.map((b) => b.firstWeek)).toEqual([1, 7, 10, 15, 17]); // from overall's variant rows
    const w1a = day(m, 1, "A").items;
    expect(w1a.filter((i) => i.kind === "main").map((i) => i.name.toLowerCase().split(" ")[0]).every((n) => ["squat", "panca", "stacco", "trazioni"].includes(n))).toBe(true);
    expect(w1a.every((i) => i.group === null)).toBe(true);
    expect(m.weeks[14].dates).toBe("3-9/11");
  });
});

describe("errors (§7.7)", () => {
  const issues = (edit) => parseEdited("PL28_coach.xlsx", edit).errors.map(formatIssue);

  it("a non-integer Settimana", () => {
    expect(issues((wb) => { wb.Sheets[LOG].A3 = { t: "n", v: 1.5 }; })).toEqual(['training log!A3: settimana "1.5" non valida: serve un intero ≥ 1']);
  });
  it("an unknown formula in E", () => {
    expect(issues((wb) => { wb.Sheets[LOG].E5 = { t: "n", v: 0, f: "B3*2" }; })[0]).toMatch(/^training log!E5: formula non riconosciuta/);
  });
  it("=overall!Z99 pointing at an empty cell is an empty value, not an error", () => {
    const r = parseEdited("PL28_coach.xlsx", (wb) => { wb.Sheets[LOG].F5 = { t: "s", v: "", f: "overall!$Z$99" }; });
    expect(r.errors).toEqual([]);
    expect(day(r.model, 1, "A").items[3].load).toBeNull();
  });
  it("two sheets starting with training log", () => {
    const r = parseEdited("PL28_coach.xlsx", (wb) => {
      wb.SheetNames.push("training log 2");
      wb.Sheets["training log 2"] = wb.Sheets[LOG];
    });
    expect(r.errors.map((e) => e.ref)).toEqual(["training log", "training log 2"]);
  });
  it("a missing Alzata", () => {
    expect(issues((wb) => { delete wb.Sheets[LOG].C6; })).toEqual(["training log!C6: alzata mancante"]);
  });
  it("ignores the athlete columns completely", () => {
    const r = parseEdited("PL28_coach.xlsx", (wb) => {
      wb.Sheets[LOG].G2 = { t: "s", v: "MANCA 💀" };
      wb.Sheets[LOG].H2 = { t: "s", v: "=)" };
      wb.Sheets[LOG].G3 = { t: "n", v: 0, f: "B3*2" };
    });
    expect(r.errors).toEqual([]);
  });
  it("weeks going back, and a repeated week+day, name their rows", () => {
    // Week 1 day B (rows 10–16) moved to week 2: week 1 day C then follows week 2, and week 2 day B appears twice.
    expect(issues((wb) => { for (let r = 10; r <= 16; r++) wb.Sheets[LOG][`A${r}`] = { t: "n", v: 2 }; })).toEqual([
      "training log!A18: settimana 1 dopo la settimana 2: le settimane non possono tornare indietro",
      "training log!A58: settimana 2 giorno B ripetuta alle righe 10 e 58",
    ]);
  });
});

describe("week types in the coach format (§9)", () => {
  it("rejects an unknown type, naming the cell", () => {
    expect(issues2((wb) => { wb.Sheets.overall.C4 = { t: "s", v: "leggera" }; })).toEqual([
      'overall!C4: tipo di settimana "leggera" non valido: usa normale, scarico, transizione, ramping, intensificazione, picco, taper, entrata, test, gara',
    ]);
  });
  it("empty is normale, and the type never changes sets", () => {
    const r = parseEdited("PL28_coach.xlsx", (wb) => { delete wb.Sheets.overall.C7; wb.Sheets.overall.C10 = { t: "s", v: "scarico" }; });
    expect(r.model.weeks[4].type).toBe("normale");
    expect(r.model.weeks[6].type).toBe("scarico");
    expect(r.model.weeks[6].days).toEqual(coach.weeks[6].days);
  });
});

function issues2(edit) {
  return parseEdited("PL28_coach.xlsx", edit).errors.map(formatIssue);
}
