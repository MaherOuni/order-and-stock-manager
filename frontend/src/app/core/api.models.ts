/**
 * Wire shapes of the Order & Stock API. Names match the C# DTOs after the API's camelCase
 * JSON policy; only the fields this app actually reads are declared.
 */

export interface TenantDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** ISO 4217 code, e.g. "TND". Drives every price shown. */
  readonly currency: string;
}

export interface CategoryDto {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly productCount: number;
}

export interface ProductDto {
  readonly id: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly price: number;
  readonly isActive: boolean;
  /** How many ingredients its recipe maps; 0 means it consumes no stock. */
  readonly recipeItemCount: number;
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
  readonly maxProducibleUnits: number;
}

export type OrderStatus = 'Pending' | 'Completed' | 'Cancelled';

/**
 * How the order leaves the counter. Not everyone sits down: a takeaway has no table, and a
 * delivery has neither a table nor a customer in the room.
 */
export type OrderType = 'DineIn' | 'Takeaway' | 'Delivery';

export const ORDER_TYPES: readonly OrderType[] = ['DineIn', 'Takeaway', 'Delivery'];

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  DineIn: 'Dine-in',
  Takeaway: 'Takeaway',
  Delivery: 'Delivery',
};

export const ORDER_TYPE_ICONS: Record<OrderType, string> = {
  DineIn: 'dineIn',
  Takeaway: 'takeaway',
  Delivery: 'delivery',
};

export type PaymentStatus = 'Unpaid' | 'Paid' | 'Failed';

export type PaymentMethod = 'Cash' | 'Flouci' | 'Konnect';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['Cash', 'Flouci', 'Konnect'];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  Cash: 'Cash at the counter',
  Flouci: 'Flouci wallet',
  Konnect: 'Card / E-Dinar',
};

/** Whether an ingredient was taken out of a line or doubled on it. */
export type CustomizationKind = 'Removed' | 'Added';

export interface OrderCustomizationDto {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly kind: CustomizationKind;
}

export interface OrderLineDto {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly lineTotal: number;
  readonly notes: string | null;
  readonly customizations: readonly OrderCustomizationDto[];
}

export interface OrderDto {
  readonly id: string;
  readonly tenantId: string;
  readonly orderType: OrderType;
  /** Only a dine-in order has one. */
  readonly tableNumber: string | null;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly deliveryAddress: string | null;
  readonly allergyNotes: string | null;
  /** How many people are actually eating. Asked for dine-in; null elsewhere. */
  readonly covers: number | null;
  /** What to show where a table number would go, whatever the order type. */
  readonly fulfilmentLabel: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  readonly paymentMethod: PaymentMethod;
  readonly totalAmountMillimes: number;
  readonly totalAmount: number;
  readonly cancellationReason: string | null;
  readonly createdAt: string;
  readonly items: readonly OrderLineDto[];
}

export interface CustomizationRequest {
  readonly ingredientId: string;
  readonly kind: CustomizationKind;
}

export interface OrderLineRequest {
  readonly productId: string;
  readonly quantity: number;
  readonly notes?: string | null;
  readonly customizations?: readonly CustomizationRequest[];
}

export interface PlaceOrderRequest {
  readonly tenantSlug: string;
  readonly items: readonly OrderLineRequest[];
  readonly orderType: OrderType;
  readonly tableNumber?: string | null;
  readonly customerName?: string | null;
  readonly customerPhone?: string | null;
  readonly deliveryAddress?: string | null;
  readonly allergyNotes?: string | null;
  readonly covers?: number | null;
  readonly paymentMethod: PaymentMethod;
}

export interface CancelOrderRequest {
  readonly reason?: string | null;
}

export type ServiceRequestKind = 'CallWaiter' | 'RequestBill' | 'Supplies' | 'Problem';

export const SERVICE_REQUEST_KINDS: readonly ServiceRequestKind[] = [
  'CallWaiter',
  'RequestBill',
  'Supplies',
  'Problem',
];

export const SERVICE_REQUEST_LABELS: Record<ServiceRequestKind, string> = {
  CallWaiter: 'Call a waiter',
  RequestBill: 'Ask for the bill',
  Supplies: 'Water, napkins, cutlery',
  Problem: 'Something is wrong',
};

export type ServiceRequestStatus = 'Open' | 'Acknowledged' | 'Resolved';

export interface ServiceRequestDto {
  readonly id: string;
  readonly tableNumber: string;
  readonly kind: ServiceRequestKind;
  readonly note: string | null;
  readonly orderId: string | null;
  readonly status: ServiceRequestStatus;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface CreateServiceRequestCommand {
  readonly tenantSlug: string;
  readonly tableNumber: string;
  readonly kind: ServiceRequestKind;
  readonly note?: string | null;
  readonly orderId?: string | null;
}

export interface OrderReviewDto {
  readonly id: string;
  readonly orderId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export interface SubmitReviewCommand {
  readonly tenantSlug: string;
  readonly rating: number;
  readonly comment?: string | null;
}

/** One ingredient the kitchen is short of, as returned on a 400 from POST /api/v1/orders. */
export interface StockShortageDto {
  readonly ingredientId: string;
  readonly ingredientName: string;
  readonly unit: string;
  readonly requiredQuantity: number;
  readonly availableQuantity: number;
  readonly missingQuantity: number;
  /** The products that cannot be served because of this shortage. */
  readonly blockedProductIds: readonly string[];
}

/** RFC 7807 body the API returns for every non-2xx, plus its own extensions. */
export interface ApiProblem {
  readonly title?: string;
  readonly status?: number;
  readonly detail?: string;
  readonly errors?: Record<string, string[]>;
  readonly shortages?: readonly StockShortageDto[];
}
