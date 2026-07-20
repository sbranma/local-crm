import { invoke } from "@tauri-apps/api/core";
import type {
  InventoryItem,
  InventoryItemInput,
  InventoryMovement,
  InventoryMovementInput,
  InventoryMovementResult,
} from "./inventory.types";

export function createInventoryItem(input: InventoryItemInput): Promise<InventoryItem> {
  return invoke<InventoryItem>("create_inventory_item", { input });
}

export function listInventoryItems(): Promise<InventoryItem[]> {
  return invoke<InventoryItem[]>("list_inventory_items");
}

export function updateInventoryItem(
  id: number,
  input: InventoryItemInput,
): Promise<InventoryItem> {
  return invoke<InventoryItem>("update_inventory_item", { id, input });
}

export function setInventoryItemArchived(
  id: number,
  isArchived: boolean,
): Promise<InventoryItem> {
  return invoke<InventoryItem>("set_inventory_item_archived", { id, isArchived });
}

export function deleteInventoryItem(id: number): Promise<void> {
  return invoke<void>("delete_inventory_item", { id });
}

export function createInventoryMovement(
  input: InventoryMovementInput,
): Promise<InventoryMovementResult> {
  return invoke<InventoryMovementResult>("create_inventory_movement", { input });
}

export function listInventoryMovements(itemId?: number): Promise<InventoryMovement[]> {
  return invoke<InventoryMovement[]>("list_inventory_movements", {
    itemId: itemId ?? null,
  });
}
