import type { InventoryItem } from "../types";

export type ShoppingTarget = {
  item: string;
  qty: number;
};

export function parseShoppingTargets(raw: string): ShoppingTarget[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [item, qty] = line.includes(",") ? line.split(",") : [line, "1"];
      return { item: item.trim(), qty: Math.max(1, Number.parseInt(qty.trim(), 10) || 1) };
    });
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => JSON.stringify(row[header] ?? ""))
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function toggleSelection(current: string[], value: string) {
  return current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
}

export function inventoryRows(items: InventoryItem[] | undefined): Array<Record<string, unknown>> {
  return (items ?? []).map((item) => ({ item: item.item, qty: item.qty }));
}
