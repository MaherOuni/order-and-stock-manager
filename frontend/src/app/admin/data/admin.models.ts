/** Request shapes the admin views send. Responses reuse ../../core/api.models. */

export interface ProductPayload {
  readonly categoryId: string;
  readonly name: string;
  readonly price: number;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly imageUrl: string | null;
}

export interface IngredientDto {
  readonly id: string;
  readonly name: string;
  /** kg, g, L, ml or unit. */
  readonly unit: string;
  readonly currentStock: number;
  readonly minimumStockAlert: number;
  /** currentStock <= minimumStockAlert, decided by the API. */
  readonly isBelowMinimum: boolean;
}

export interface CreateIngredientPayload {
  readonly name: string;
  readonly unit: string;
  readonly currentStock: number;
  readonly minimumStockAlert: number;
}

/** Stock is absent by design: it only moves through adjust/recount, which write the ledger. */
export interface UpdateIngredientPayload {
  readonly name: string;
  readonly unit: string;
  readonly minimumStockAlert: number;
}

export type StockChangeReason =
  | 'Delivery'
  | 'Waste'
  | 'Spoilage'
  | 'InventoryCount'
  | 'OrderConsumption'
  | 'OrderCancellation'
  | 'Manual';

export interface StockAdjustmentPayload {
  /** Signed: +12 is a delivery, -0.75 is waste. */
  readonly changeAmount: number;
  readonly reason: StockChangeReason;
  readonly note: string | null;
}

export interface StockMovementResult {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly unit: string;
  readonly currentStock: number;
  readonly minimumStockAlert: number;
  readonly isBelowMinimum: boolean;
}

export interface RecipeItemDto {
  readonly id: string;
  readonly productId: string;
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly unit: string;
  readonly quantityRequired: number;
  readonly ingredientCurrentStock: number;
}

export interface ProductRecipeDto {
  readonly productId: string;
  readonly productName: string;
  readonly items: readonly RecipeItemDto[];
  /** How many units current stock supports, capped by the scarcest ingredient. */
  readonly maxProducibleUnits: number;
}

/** A full replacement: lines left out are removed, an empty list clears the recipe. */
export interface SetRecipePayload {
  readonly items: readonly { readonly ingredientId: string; readonly quantityRequired: number }[];
}

export const UNITS: readonly string[] = ['kg', 'g', 'L', 'ml', 'unit'];

export const RESTOCK_REASONS: readonly StockChangeReason[] = [
  'Delivery',
  'InventoryCount',
  'Manual',
];

export const WRITE_OFF_REASONS: readonly StockChangeReason[] = ['Waste', 'Spoilage', 'Manual'];
