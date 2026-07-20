export type InventoryItemType = "product" | "service";

export type InventoryMovementType = "entry" | "exit" | "adjustment";

export type InventoryItem = {
  id: number;
  itemType: InventoryItemType;
  name: string;
  sku: string | null;
  category: string | null;
  description: string | null;
  unit: string;
  costPriceMinor: number;
  salePriceMinor: number;
  currentStockMillis: number;
  minimumStockMillis: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InventoryItemInput = {
  itemType: InventoryItemType;
  name: string;
  sku: string | null;
  category: string | null;
  description: string | null;
  unit: string;
  costPriceMinor: number;
  salePriceMinor: number;
  minimumStockMillis: number;
  initialStockMillis: number;
};

export type InventoryMovement = {
  id: number;
  itemId: number;
  itemName: string;
  itemSku: string | null;
  movementType: InventoryMovementType;
  quantityDeltaMillis: number;
  previousStockMillis: number;
  newStockMillis: number;
  reason: string;
  createdAt: string;
};

export type InventoryMovementInput = {
  itemId: number;
  movementType: InventoryMovementType;
  quantityMillis: number;
  reason: string;
};

export type InventoryMovementResult = {
  item: InventoryItem;
  movement: InventoryMovement;
};
