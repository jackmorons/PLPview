// Programs, revisions and persistence (spec §7.6, §7.7), against an in-memory store.
import { describe, it, expect } from "vitest";
import { createLibrary } from "../src/library.js";
import { MAX_REVISIONS } from "../src/programs.js";
import { fixture, editedPL28Bytes, dropLastRow, memoryStore } from "./helpers.js";

const PL28 = { name: "PL28.xlsx", bytes: new Uint8Array(fixture("PL28.xlsx")) };
// "An edited copy of PL28: one prescription changed, one week removed."
const PL28_EDITED = {
  name: "PL28.xlsx",
  bytes: editedPL28Bytes((wb) => {
    wb.Sheets.overall.C3.f = '"4x5 + ist. "&MROUND(Massimali!$B$3*0.6,2.5)&"kg"';
    dropLastRow(wb.Sheets.overall);
  }),
};
const OTHER = { name: "Altro.xlsx", bytes: editedPL28Bytes((wb) => { wb.Sheets.Massimali.B3.v = 150; }) };

const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

let n = 0;
const deps = { uuid: () => `id-${++n}`, now: () => `2026-10-25T10:00:${String(n).padStart(2, "0")}Z` };

async function withPL28() {
  const store = memoryStore();
  const lib = createLibrary(store, deps);
  await lib.load();
  const p = await lib.create(await lib.analyze(PL28));
  await lib.setActive(p.id);
  return { store, lib, p };
}

describe("persistence (§7.6)", () => {
  it("restores maxes, position and the active program after a relaunch", async () => {
    const { store, lib, p } = await withPL28();
    await lib.setMax(p.id, "squat", 200);
    await lib.setPosition(p.id, { week: 7, day: "C" });

    const relaunched = createLibrary(store, deps);
    await relaunched.load();
    expect(relaunched.active().id).toBe(p.id);
    expect(relaunched.editedMaxes(p.id)).toEqual({ squat: 200 });
    expect(relaunched.position(p.id)).toEqual({ week: 7, day: "C" });
    expect(relaunched.model(p.id).weeks).toHaveLength(20);
  });

  it("keeps the original file bytes of each revision", async () => {
    const { lib, p } = await withPL28();
    expect(same(await lib.originalFile(p.revisions[0].revisionId), PL28.bytes)).toBe(true);
  });
});

describe("programs and revisions (§7.7)", () => {
  it("keeps maxes and position separate for each program", async () => {
    const { lib, p } = await withPL28();
    const q = await lib.create(await lib.analyze(OTHER));
    await lib.setMax(p.id, "squat", 200);
    await lib.setPosition(p.id, { week: 3, day: "B" });
    await lib.setPosition(q.id, { week: 12, day: "D" });
    await lib.setActive(q.id);
    expect(lib.editedMaxes(q.id)).toEqual({});
    expect(lib.position(q.id)).toEqual({ week: 12, day: "D" });
    expect(lib.position(p.id)).toEqual({ week: 3, day: "B" });
    expect(lib.model(q.id).lifts[0].defaultMax).toBe(150);
  });

  it("updates from an edited file: exact summary, maxes kept, position clamped, same id", async () => {
    const { lib, p } = await withPL28();
    await lib.setMax(p.id, "panca", 135);
    await lib.setPosition(p.id, { week: 20, day: "D" });

    const a = await lib.analyze(PL28_EDITED);
    expect(a.duplicate).toBeNull();
    expect(a.parsed.ok).toBe(true);
    expect(a.sameName.id).toBe(p.id);
    expect(lib.preview(p.id, a)).toEqual({
      weeks: [20, 19], blocks: [4, 4], days: ["ABCDE", "ABCDE"],
      mainAdded: [], mainRemoved: [], accAdded: [], accRemoved: [], itemsChanged: 1, itemsAdded: 0, itemsRemoved: 0,
    });

    await lib.update(p.id, a);
    expect(lib.get(p.id).id).toBe(p.id);
    expect(lib.get(p.id).revisions).toHaveLength(2);
    expect(lib.editedMaxes(p.id)).toEqual({ panca: 135 });
    expect(lib.position(p.id)).toEqual({ week: 19, day: "D" });
  });

  it("says 'già importato' for an identical file, wherever it is stored", async () => {
    const { lib, p } = await withPL28();
    const a = await lib.analyze({ name: "copia di PL28.xlsx", bytes: PL28.bytes });
    expect(a.duplicate.program.id).toBe(p.id);
  });

  it("restoring an old revision makes it current and grows the history by one", async () => {
    const { lib, p } = await withPL28();
    await lib.update(p.id, await lib.analyze(PL28_EDITED));
    const first = lib.get(p.id).revisions[0];
    await lib.restore(p.id, first.revisionId);
    const revs = lib.get(p.id).revisions;
    expect(revs).toHaveLength(3);
    expect(revs[2].sha256).toBe(first.sha256);
    expect(lib.model(p.id).weeks).toHaveLength(20);
    expect(same(await lib.originalFile(revs[2].revisionId), PL28.bytes)).toBe(true);
  });

  it("a failed update leaves the current revision untouched", async () => {
    const { lib, p } = await withPL28();
    const broken = { name: "PL28.xlsx", bytes: editedPL28Bytes((wb) => { wb.Sheets.overall.D7.f = "B3*2"; }) };
    const a = await lib.analyze(broken);
    expect(a.parsed.ok).toBe(false);
    // The UI stops here and shows a.parsed.errors; nothing was written.
    expect(lib.get(p.id).revisions).toHaveLength(1);
  });

  it("keeps only the last revisions and deletes their files", async () => {
    const { store, lib, p } = await withPL28();
    const firstFile = `files/${p.revisions[0].revisionId}.xlsx`;
    for (let i = 0; i < MAX_REVISIONS; i++) {
      const f = { name: "PL28.xlsx", bytes: editedPL28Bytes((wb) => { wb.Sheets.overall.L3.v = `30RT +${i}kg`; }) };
      await lib.update(p.id, await lib.analyze(f));
    }
    expect(lib.get(p.id).revisions).toHaveLength(MAX_REVISIONS);
    expect(store.data.has(firstFile)).toBe(false);
  });

  it("renames, duplicates and deletes", async () => {
    const { store, lib, p } = await withPL28();
    await lib.rename(p.id, "PL28 bis");
    expect(lib.get(p.id).name).toBe("PL28 bis");
    const c = await lib.duplicate(p.id);
    expect(c.name).toBe("PL28 bis (copia)");
    expect(c.id).not.toBe(p.id);
    await lib.remove(p.id);
    expect(lib.programs().map((x) => x.id)).toEqual([c.id]);
    expect(lib.active().id).toBe(c.id);
    expect([...store.data.keys()].some((k) => k.includes(p.id))).toBe(false);
    expect(store.data.has(`files/${p.revisions[0].revisionId}.xlsx`)).toBe(false);
  });

  it("upgrades a program saved by milestone 3 (schema 1) when loading", async () => {
    const { store, lib, p } = await withPL28();
    const saved = JSON.parse(store.data.get(`programs/${p.id}.json`));
    const v1 = { schemaVersion: 1, lifts: [{ id: "squat", name: "Squat", max: 100 }], blocks: [{ name: "B1", variants: ["no var."] }],
      weeks: [{ number: 1, phase: "TEST", block: 0 }], days: ["A"], slots: [{ name: "Squat", day: "A" }],
      prescriptions: [[{ parts: ["3x3 ", { lift: "squat", pct: 0.8, step: 2.5 }, "kg"] }]],
      accessories: [{ day: "A", name: "Plank", instructions: "", group: "Core", reps: "max", intensity: "RIR 1", sets: [3], volumeOnly: false }],
      notes: [] };
    saved.revisions[0].model = v1;
    store.data.set(`programs/${p.id}.json`, JSON.stringify(saved));
    const relaunched = createLibrary(store, deps);
    await relaunched.load();
    const m = relaunched.model(p.id);
    expect(m.schemaVersion).toBe(2);
    expect(m.weeks[0].type).toBe("test");
    expect(m.weeks[0].days[0].items.map((i) => [i.name, i.prescription.parts[0], i.load?.parts[0] ?? null]))
      .toEqual([["Squat", "3x3 ", null], ["Plank", "2xmax", "RIR 2"]]);
    expect(JSON.parse(store.data.get(`programs/${p.id}.json`)).revisions[0].model.schemaVersion).toBe(2); // saved upgraded
  });

  it("imports a coach-format file next to a PL28-format one", async () => {
    const { lib } = await withPL28();
    const c = await lib.create(await lib.analyze({ name: "PL28_coach.xlsx", bytes: new Uint8Array(fixture("PL28_coach.xlsx")) }));
    expect(lib.model(c.id).format).toBe("coach");
    expect(lib.position(c.id)).toEqual({ week: 1, day: "A" });
  });

  it("drops edited maxes of lifts that no longer exist", async () => {
    const { lib, p } = await withPL28();
    await lib.setMax(p.id, "stacco", 230);
    await lib.setMax(p.id, "squat", 200);
    const renamed = { name: "PL28.xlsx", bytes: editedPL28Bytes((wb) => { wb.Sheets.Massimali.A5.v = "Stacco sumo"; }) };
    await lib.update(p.id, await lib.analyze(renamed));
    expect(lib.editedMaxes(p.id)).toEqual({ squat: 200 });
  });
});
