// resolve.js helpers and model rules.
import { describe, it, expect } from "vitest";
import { platesPerSide, topKg, sessionOrder, daySubtitle, mround, daysOf } from "../src/resolve.js";
import { validateProgram, migrate, rirPlusOne, weekType } from "../src/model.js";
import { pl28 } from "./helpers.js";

describe("plates", () => {
  it("loads each side greedily, heaviest first", () => {
    expect(platesPerSide(185)).toEqual({ plates: [25, 25, 25, 5, 2.5], rest: 0 });
    expect(platesPerSide(20)).toEqual({ plates: [], rest: 0 });
    expect(platesPerSide(15)).toBeNull();
  });
  it("respects collars and the available plates", () => {
    expect(platesPerSide(100, { bar: 20, collar: 2.5, plates: [20, 10, 5] })).toEqual({ plates: [20, 10, 5], rest: 2.5 });
  });
  it("finds the heaviest load in a string", () => {
    expect(topKg("5@6/7 130-145kg")).toBe(145);
    expect(topKg("1x1 112,5kg + 5x3 110kg")).toBe(112.5);
    expect(topKg("4@7 + 90% 3x4")).toBe(0);
    expect(topKg(null)).toBe(0);
  });
  it("rounds like Excel's MROUND", () => {
    expect(mround(114, 2.5)).toBe(115);
    expect(mround(113.75, 2.5)).toBe(115);
  });
});

describe("program model", () => {
  const m = pl28();
  it("steps through every week and day in order", () => {
    const o = sessionOrder(m);
    expect(o).toHaveLength(100);
    expect(o[0]).toEqual({ week: 1, day: "A" });
    expect(o[5]).toEqual({ week: 2, day: "A" });
    expect(daysOf(m, 3)).toEqual(["A", "B", "C", "D", "E"]);
  });
  it("builds day subtitles from that week's main lifts", () => {
    expect(daySubtitle(m, 1, "B")).toBe("Panca stress · Stacco stress");
    expect(daySubtitle(m, 1, "E")).toBe("Ipertrofia / accessori");
  });
  it("PL28 passes validateProgram, a broken model doesn't", () => {
    expect(validateProgram(m)).toEqual([]);
    const bad = structuredClone(m);
    bad.weeks[3].n = 7;
    bad.weeks[0].days[0].items[0].prescription.parts[1].lift = "front squat";
    bad.weeks[1].type = "leggera";
    expect(validateProgram(bad).map((e) => e.path)).toEqual(["weeks.0.days.0.items.0.prescription", "weeks.1.type", "weeks.3.n"]);
  });
  it("migrate refuses a newer schema", () => {
    expect(migrate(m)).toBe(m);
    expect(() => migrate({ ...m, schemaVersion: 4 })).toThrow(/versione più recente/);
  });
  it("RIR +1 and week types", () => {
    expect(["RIR 0-1", "RIR 2", "@7/8", "—"].map(rirPlusOne)).toEqual(["RIR 1-2", "RIR 3", "@7/8", "—"]);
    expect(["", "TEST", " Picco ", "leggera"].map(weekType)).toEqual(["normale", "test", "picco", null]);
  });
});
