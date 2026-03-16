import { describe, expect, it, beforeAll } from "vitest";

import calculatorData from "../../public/data/calculator-data.json";
import type { MetadataResponse } from "../types";
import {
  buildRuntimeData,
  calculateDirect,
  calculateNear,
  calculatePlanner,
  calculateRecipeDebug,
  counterFromItems,
  type RuntimeData,
} from "./runtime-calculator";

let runtimeData: RuntimeData;

beforeAll(() => {
  runtimeData = buildRuntimeData(calculatorData as MetadataResponse);
});

describe("frontend runtime calculator", () => {
  it("keeps Astral Potion consistent across craftable, planner, and debug surfaces", () => {
    const inventory = counterFromItems([
      { item: "Star Mushroom", qty: 1 },
      { item: "Turmmip", qty: 1 },
      { item: "Clean Water", qty: 1 },
    ]);

    const direct = calculateDirect(runtimeData, inventory, "Smart score", ["Alchemy Kit"], 2);
    const planner = calculatePlanner(runtimeData, inventory, "Astral Potion", 5, ["Alchemy Kit"]);
    const debug = calculateRecipeDebug(runtimeData, inventory, "Astral Potion", ["Alchemy Kit"], 2, 5);

    expect(direct.items.some((row) => row.result === "Astral Potion")).toBe(true);
    expect(planner.found).toBe(true);
    expect(planner.mode).toBe("direct_craft_route");
    expect(debug.craftable_now).toBe(true);
    expect(debug.craftable_panel).toBe(true);
    expect(debug.planner_found).toBe(true);
  });

  it("plans one more copy when the target is already owned and ingredients remain", () => {
    const inventory = counterFromItems([
      { item: "Astral Potion", qty: 1 },
      { item: "Star Mushroom", qty: 1 },
      { item: "Turmmip", qty: 1 },
      { item: "Clean Water", qty: 1 },
    ]);

    const planner = calculatePlanner(runtimeData, inventory, "Astral Potion", 5, ["Alchemy Kit"]);

    expect(planner.already_owned).toBe(true);
    expect(planner.planning_goal).toBe("craft_one_more");
    expect(planner.found).toBe(true);
    expect(planner.mode).toBe("direct_craft_route");
    expect(planner.one_more_found).toBe(true);
    expect(planner.lines.some((line) => line.includes("Craft Astral Potion"))).toBe(true);
  });

  it("expands near-craft results when the missing-slot threshold increases", () => {
    const inventory = counterFromItems([{ item: "Gravel Beetle", qty: 1 }]);

    const nearOne = calculateNear(runtimeData, inventory, ["Alchemy Kit"], 1);
    const nearTwo = calculateNear(runtimeData, inventory, ["Alchemy Kit"], 2);

    expect(nearTwo.count).toBeGreaterThan(nearOne.count);
    expect(nearOne.items.some((row) => row.result === "Cool Potion")).toBe(true);
    expect(nearOne.items.some((row) => row.result === "Life Potion")).toBe(false);
    expect(nearTwo.items.some((row) => row.result === "Life Potion")).toBe(true);
  });
});
