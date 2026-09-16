import {
  CategoryDto,
  OrderDto,
  OrderReviewDto,
  ProductDto,
  ServiceRequestDto,
  TenantDto,
} from '../core/api.models';
import { FloorPlan } from '../core/floor-plan.models';
import { IngredientDto } from '../admin/data/admin.models';

/**
 * The demo restaurant. Seeded to make every feature visible on the first screen rather than
 * only after someone has typed data in:
 *
 * - "Menthe fraîche" and "Lait" are both below their alert thresholds, so the low-stock
 *   dashboard has red badges waiting.
 * - "Lait" is down to 1.2 L against 0.2 L per cup, so ordering seven Cafés Crème hits the
 *   shortage path and shows the all-or-nothing rejection.
 * - Four orders span dine-in, takeaway and delivery, so the board shows every type.
 */

export const DEMO_TENANT: TenantDto = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Café Sidi Bou',
  slug: 'demo-resto',
  currency: 'TND',
};

export interface DemoRecipeLine {
  readonly id: string;
  readonly productId: string;
  readonly ingredientId: string;
  readonly quantityRequired: number;
}

export interface DemoState {
  /** Bumped when the seed changes, so an old localStorage snapshot is discarded. */
  readonly version: number;
  tenant: TenantDto;
  categories: CategoryDto[];
  products: ProductDto[];
  ingredients: IngredientDto[];
  recipes: DemoRecipeLine[];
  orders: OrderDto[];
  serviceRequests: ServiceRequestDto[];
  reviews: OrderReviewDto[];
  /** Drawn in the floor planner; null until somebody imports one. */
  floorPlan: FloorPlan | null;
}

export const DEMO_STATE_VERSION = 6;

/**
 * A plan for the demo room, exactly as the floor planner would export it. The table labels
 * match the seeded orders — that join is what the waiter view is for.
 */
export const DEMO_FLOOR_PLAN: FloorPlan = {
  schema: 'restaurant-floor-plan',
  version: 1,
  name: 'Café Sidi Bou — ground floor',
  units: 'cm',
  grid: 25,
  walls: [
    { id: 'w1', x1: 0, y1: 0, x2: 900, y2: 0, thickness: 12 },
    { id: 'w2', x1: 900, y1: 0, x2: 900, y2: 640, thickness: 12 },
    { id: 'w3', x1: 900, y1: 640, x2: 0, y2: 640, thickness: 12 },
    { id: 'w4', x1: 0, y1: 640, x2: 0, y2: 0, thickness: 12 },
    { id: 'w5', x1: 560, y1: 300, x2: 560, y2: 640, thickness: 12 },
  ],
  doors: [{ id: 'd1', x1: 150, y1: 640, x2: 330, y2: 640, thickness: 10 }],
  tables: [
    { id: 't1', label: '1', x: 125, y: 125, width: 80, height: 80, seats: 4, section: 'Salle' },
    { id: 't2', label: '2', x: 375, y: 125, width: 80, height: 80, seats: 2, section: 'Salle' },
    { id: 't3', label: '3', x: 650, y: 125, width: 100, height: 100, seats: 6, section: 'Salle' },
    { id: 't4', label: '4', x: 125, y: 400, width: 80, height: 80, seats: 4, section: 'Salle' },
    { id: 't5', label: '7', x: 350, y: 400, width: 80, height: 80, seats: 4, section: 'Salle' },
    { id: 't6', label: '12', x: 650, y: 380, width: 80, height: 80, seats: 4, section: 'Terrasse' },
    { id: 't7', label: 'Terrasse 2', x: 650, y: 520, width: 100, height: 80, seats: 5, section: 'Terrasse' },
  ],
  labels: [
    { id: 'l1', x: 620, y: 340, text: 'Terrasse' },
    { id: 'l2', x: 60, y: 90, text: 'Salle' },
  ],
};

const CATEGORY = {
  hot: '22222222-0000-4000-8000-000000000001',
  cold: '22222222-0000-4000-8000-000000000002',
  pastry: '22222222-0000-4000-8000-000000000003',
} as const;

const PRODUCT = {
  espresso: '33333333-0000-4000-8000-000000000001',
  creme: '33333333-0000-4000-8000-000000000002',
  theMenthe: '33333333-0000-4000-8000-000000000003',
  citronnade: '33333333-0000-4000-8000-000000000004',
  eau: '33333333-0000-4000-8000-000000000005',
  bambalouni: '33333333-0000-4000-8000-000000000006',
  makroudh: '33333333-0000-4000-8000-000000000007',
} as const;

const INGREDIENT = {
  cafe: '44444444-0000-4000-8000-000000000001',
  lait: '44444444-0000-4000-8000-000000000002',
  sucre: '44444444-0000-4000-8000-000000000003',
  gobelets: '44444444-0000-4000-8000-000000000004',
  menthe: '44444444-0000-4000-8000-000000000005',
  the: '44444444-0000-4000-8000-000000000006',
  citrons: '44444444-0000-4000-8000-000000000007',
  farine: '44444444-0000-4000-8000-000000000008',
  dattes: '44444444-0000-4000-8000-000000000009',
} as const;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export function seedDemoState(): DemoState {
  const categories: CategoryDto[] = [
    { id: CATEGORY.hot, name: 'Boissons chaudes', sortOrder: 1, productCount: 3 },
    { id: CATEGORY.cold, name: 'Boissons fraîches', sortOrder: 2, productCount: 2 },
    { id: CATEGORY.pastry, name: 'Pâtisseries', sortOrder: 3, productCount: 2 },
  ];

  const products: ProductDto[] = [
    {
      id: PRODUCT.espresso,
      categoryId: CATEGORY.hot,
      categoryName: 'Boissons chaudes',
      name: 'Express',
      description: 'Café serré, torréfaction locale.',
      imageUrl: '/demo/express.svg',
      price: 2.2,
      isActive: true,
      recipeItemCount: 3,
    },
    {
      id: PRODUCT.creme,
      categoryId: CATEGORY.hot,
      categoryName: 'Boissons chaudes',
      name: 'Café Crème',
      description: 'Express allongé au lait vapeur.',
      imageUrl: '/demo/creme.svg',
      price: 3.5,
      isActive: true,
      recipeItemCount: 4,
    },
    {
      id: PRODUCT.theMenthe,
      categoryId: CATEGORY.hot,
      categoryName: 'Boissons chaudes',
      name: 'Thé à la menthe',
      description: 'Thé vert, menthe fraîche, pignons.',
      imageUrl: '/demo/the-menthe.svg',
      price: 2.8,
      isActive: true,
      recipeItemCount: 4,
    },
    {
      id: PRODUCT.citronnade,
      categoryId: CATEGORY.cold,
      categoryName: 'Boissons fraîches',
      name: 'Citronnade',
      description: 'Citrons pressés, menthe, servie glacée.',
      imageUrl: '/demo/citronnade.svg',
      price: 4.5,
      isActive: true,
      recipeItemCount: 3,
    },
    {
      id: PRODUCT.eau,
      categoryId: CATEGORY.cold,
      categoryName: 'Boissons fraîches',
      name: 'Eau minérale 50cl',
      description: null,
      imageUrl: '/demo/eau.svg',
      price: 1.5,
      isActive: true,
      // Sold from the fridge: no recipe, so it never touches stock.
      recipeItemCount: 0,
    },
    {
      id: PRODUCT.bambalouni,
      categoryId: CATEGORY.pastry,
      categoryName: 'Pâtisseries',
      name: 'Bambalouni',
      description: 'Beignet sucré, préparé à la commande.',
      imageUrl: '/demo/bambalouni.svg',
      price: 2.0,
      isActive: true,
      recipeItemCount: 2,
    },
    {
      id: PRODUCT.makroudh,
      categoryId: CATEGORY.pastry,
      categoryName: 'Pâtisseries',
      name: 'Makroudh aux dattes',
      description: 'Semoule et dattes, miel de romarin.',
      imageUrl: '/demo/makroudh.svg',
      price: 2.5,
      isActive: false,
      recipeItemCount: 2,
    },
  ];

  const ingredients: IngredientDto[] = [
    ing(INGREDIENT.cafe, 'Café en grains', 'kg', 8.4, 2),
    ing(INGREDIENT.lait, 'Lait', 'L', 1.2, 4),
    ing(INGREDIENT.sucre, 'Sucre', 'kg', 12, 3),
    ing(INGREDIENT.gobelets, 'Gobelets', 'unit', 640, 100),
    ing(INGREDIENT.menthe, 'Menthe fraîche', 'botte', 3, 6),
    ing(INGREDIENT.the, 'Thé vert', 'kg', 1.8, 0.5),
    ing(INGREDIENT.citrons, 'Citrons', 'kg', 6.5, 2),
    ing(INGREDIENT.farine, 'Farine', 'kg', 14, 5),
    ing(INGREDIENT.dattes, 'Dattes Deglet Nour', 'kg', 4.2, 1),
  ];

  const recipes: DemoRecipeLine[] = [
    line(PRODUCT.espresso, INGREDIENT.cafe, 0.018),
    line(PRODUCT.espresso, INGREDIENT.sucre, 0.008),
    line(PRODUCT.espresso, INGREDIENT.gobelets, 1),

    line(PRODUCT.creme, INGREDIENT.cafe, 0.018),
    line(PRODUCT.creme, INGREDIENT.lait, 0.2),
    line(PRODUCT.creme, INGREDIENT.sucre, 0.008),
    line(PRODUCT.creme, INGREDIENT.gobelets, 1),

    line(PRODUCT.theMenthe, INGREDIENT.the, 0.006),
    line(PRODUCT.theMenthe, INGREDIENT.menthe, 0.15),
    line(PRODUCT.theMenthe, INGREDIENT.sucre, 0.012),
    line(PRODUCT.theMenthe, INGREDIENT.gobelets, 1),

    line(PRODUCT.citronnade, INGREDIENT.citrons, 0.25),
    line(PRODUCT.citronnade, INGREDIENT.sucre, 0.03),
    line(PRODUCT.citronnade, INGREDIENT.gobelets, 1),

    line(PRODUCT.bambalouni, INGREDIENT.farine, 0.09),
    line(PRODUCT.bambalouni, INGREDIENT.sucre, 0.02),

    line(PRODUCT.makroudh, INGREDIENT.farine, 0.07),
    line(PRODUCT.makroudh, INGREDIENT.dattes, 0.05),
  ];

  const orders: OrderDto[] = [
    order({
      id: '55555555-0000-4000-8000-000000000003',
      orderType: 'Takeaway',
      customerName: 'Sami',
      customerPhone: '+216 20 111 222',
      paymentMethod: 'Konnect',
      paymentStatus: 'Paid',
      createdAt: minutesAgo(3),
      items: [
        orderLine('66666666-0000-4000-8000-000000000004', PRODUCT.espresso, 'Express', 2, 2.2),
      ],
    }),
    order({
      id: '55555555-0000-4000-8000-000000000001',
      orderType: 'DineIn',
      tableNumber: '4',
      covers: 3,
      allergyNotes: 'Allergie aux fruits à coque.',
      createdAt: minutesAgo(6),
      items: [
        orderLine('66666666-0000-4000-8000-000000000001', PRODUCT.creme, 'Café Crème', 2, 3.5, {
          notes: 'Bien chaud',
          customizations: [
            { ingredientId: INGREDIENT.sucre, ingredientName: 'Sucre', kind: 'Removed' },
          ],
        }),
        orderLine('66666666-0000-4000-8000-000000000002', PRODUCT.eau, 'Eau minérale 50cl', 1, 1.5),
      ],
    }),
    order({
      id: '55555555-0000-4000-8000-000000000004',
      orderType: 'Delivery',
      customerName: 'Ines',
      customerPhone: '+216 22 333 444',
      deliveryAddress: 'Rue de Marseille 14, Tunis',
      paymentMethod: 'Flouci',
      paymentStatus: 'Paid',
      createdAt: minutesAgo(12),
      items: [
        orderLine('66666666-0000-4000-8000-000000000005', PRODUCT.citronnade, 'Citronnade', 2, 4.5),
      ],
    }),
    order({
      id: '55555555-0000-4000-8000-000000000002',
      orderType: 'DineIn',
      tableNumber: 'Terrasse 2',
      covers: 5,
      status: 'Completed',
      paymentStatus: 'Paid',
      createdAt: minutesAgo(41),
      items: [
        orderLine('66666666-0000-4000-8000-000000000003', PRODUCT.theMenthe, 'Thé à la menthe', 2, 2.8),
      ],
    }),
  ];

  return {
    version: DEMO_STATE_VERSION,
    tenant: { ...DEMO_TENANT },
    categories,
    products,
    ingredients,
    recipes,
    orders,
    serviceRequests: [
      {
        id: '88888888-0000-4000-8000-000000000001',
        tableNumber: '7',
        kind: 'CallWaiter',
        note: null,
        orderId: null,
        status: 'Open',
        createdAt: minutesAgo(2),
        resolvedAt: null,
      },
    ],
    reviews: [
      {
        id: '99999999-0000-4000-8000-000000000001',
        orderId: '55555555-0000-4000-8000-000000000002',
        rating: 5,
        comment: 'Le thé à la menthe était parfait, merci !',
        createdAt: minutesAgo(30),
        updatedAt: null,
      },
    ],
    floorPlan: DEMO_FLOOR_PLAN,
  };
}

function ing(
  id: string,
  name: string,
  unit: string,
  currentStock: number,
  minimumStockAlert: number,
): IngredientDto {
  return {
    id,
    name,
    unit,
    currentStock,
    minimumStockAlert,
    isBelowMinimum: currentStock <= minimumStockAlert,
  };
}

let lineSeq = 0;

function line(productId: string, ingredientId: string, quantityRequired: number): DemoRecipeLine {
  lineSeq += 1;

  return {
    id: `77777777-0000-4000-8000-${String(lineSeq).padStart(12, '0')}`,
    productId,
    ingredientId,
    quantityRequired,
  };
}

function orderLine(
  id: string,
  productId: string,
  productName: string,
  quantity: number,
  unitPrice: number,
  extras: { notes?: string; customizations?: OrderDto['items'][number]['customizations'] } = {},
) {
  return {
    id,
    productId,
    productName,
    quantity,
    unitPrice,
    lineTotal: Math.round(unitPrice * quantity * 100) / 100,
    notes: extras.notes ?? null,
    customizations: extras.customizations ?? [],
  };
}

/** Fills in everything a seeded order shares, so each entry only states what is distinctive. */
function order(
  seed: Partial<OrderDto> & { id: string; items: OrderDto['items']; createdAt: string },
): OrderDto {
  const total = seed.items.reduce((sum, line) => sum + line.lineTotal, 0);
  const orderType = seed.orderType ?? 'DineIn';

  return {
    tenantId: DEMO_TENANT.id,
    orderType,
    tableNumber: seed.tableNumber ?? null,
    customerName: seed.customerName ?? null,
    customerPhone: seed.customerPhone ?? null,
    deliveryAddress: seed.deliveryAddress ?? null,
    allergyNotes: seed.allergyNotes ?? null,
    covers: seed.covers ?? null,
    fulfilmentLabel:
      orderType === 'DineIn'
        ? (seed.tableNumber ?? 'Table')
        : orderType === 'Takeaway'
          ? (seed.customerName ?? 'Takeaway')
          : (seed.deliveryAddress ?? 'Delivery'),
    status: seed.status ?? 'Pending',
    paymentStatus: seed.paymentStatus ?? 'Unpaid',
    paymentMethod: seed.paymentMethod ?? 'Cash',
    totalAmountMillimes: Math.round(total * 1000),
    totalAmount: Math.round(total * 100) / 100,
    cancellationReason: null,
    ...seed,
  };
}
