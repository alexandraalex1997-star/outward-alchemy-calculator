import { describe, expect, it } from "vitest";

import calculatorData from "../../public/data/calculator-data.json";
import type { MetadataResponse } from "../types";
import { buildRuntimeData, calculateDirect, counterFromItems } from "./runtime-calculator";
import { canonicalizeImportedInventoryItems, extractUrlInventoryPayload, parseUrlInventoryPayloadValue } from "./runtime-service";

function base64UrlEncode(value: string) {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("runtime mod sync payloads", () => {
  it("reads sync payloads from the hash when query params are absent", () => {
    const payload = extractUrlInventoryPayload("", "#sync=b64:abc123");

    expect(payload).toBe("b64:abc123");
  });

  it("parses base64url mod payloads into a usable browser inventory source", () => {
    const payload = {
      source: "Outward mod",
      exportedAtUtc: "2026-03-16T12:00:00Z",
      inventoryType: "bag",
      items: [
        { name: "Star Mushroom", quantity: 1 },
        { canonicalName: "Turmmip", quantity: 1 },
        { canonicalName: "Clean Water", qty: 1 },
      ],
    };

    const encoded = `b64:${base64UrlEncode(JSON.stringify(payload))}`;
    const result = parseUrlInventoryPayloadValue(encoded);

    expect(result.status).toBe("applied");
    if (result.status === "applied") {
      expect(result.source.kind).toBe("url_sync");
      expect(result.source.label).toBe("Mod URL sync");
      expect(result.source.detail).toContain("3 inventory lines");
    }
  });

  it("returns a friendly invalid message for bad mod payloads", () => {
    const result = parseUrlInventoryPayloadValue("b64:not-valid-json");

    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.message).toContain("could not be parsed");
    }
  });

  it("canonicalizes mod-style item names into the same calculator inventory used by direct crafting", () => {
    const metadata = calculatorData as MetadataResponse;
    const runtimeData = buildRuntimeData(metadata);
    const items = canonicalizeImportedInventoryItems(metadata, [
      { item: "star_mushroom", qty: 1 },
      { item: "turmmip", qty: 1 },
      { item: "clean_water", qty: 1 },
    ]);

    const direct = calculateDirect(runtimeData, counterFromItems(items), "Smart score", ["Alchemy Kit"], 2);

    expect(items).toEqual([
      { item: "Clean Water", qty: 1 },
      { item: "Star Mushroom", qty: 1 },
      { item: "Turmmip", qty: 1 },
    ]);
    expect(direct.items.some((row) => row.result === "Astral Potion")).toBe(true);
  });
});
