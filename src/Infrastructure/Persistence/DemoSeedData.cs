using Domain.Entities;
using Domain.Enums;
using Domain.ValueObjects;

namespace Infrastructure.Persistence;

/// <summary>
/// The catalogue and the day's trading for the demo restaurant, kept apart from the wiring in
/// <see cref="DbInitializer"/> so the data reads as data.
///
/// It deliberately covers the awkward cases rather than a tidy happy path: an inactive product,
/// a product with no recipe, an ingredient at zero that blocks its product, two ingredients
/// under their alert threshold, every order type, every status, every payment state, both kinds
/// of customisation, an order old enough to look neglected on the floor plan, and a cancelled
/// order whose ingredients went back. Debugging needs the edges, not the middle.
/// </summary>
internal static class DemoSeedData
{
    /// <summary>Menu groupings, in the order the customer app shows them.</summary>
    internal static readonly (string Name, int SortOrder)[] Categories =
    [
        ("Boissons chaudes", 1),
        ("Boissons fraîches", 2),
        ("Pâtisseries", 3),
        ("Salés", 4),
    ];

    /// <param name="Key">Stable handle used by the recipe and order tables below.</param>
    /// <param name="OpeningStock">
    /// What the ledger opens with. Seeded orders then consume from it, so the closing figure
    /// the dashboard shows is arrived at rather than asserted.
    /// </param>
    internal sealed record IngredientSeed(
        string Key,
        string Name,
        UnitOfMeasure Unit,
        decimal OpeningStock,
        decimal MinimumAlert);

    internal static readonly IngredientSeed[] Ingredients =
    [
        new("cafe", "Café en grains", UnitOfMeasure.Kilogram, 9.0m, 2m),
        new("lait", "Lait", UnitOfMeasure.Litre, 6.0m, 4m),
        new("sucre", "Sucre", UnitOfMeasure.Kilogram, 12m, 3m),
        new("gobelets", "Gobelets", UnitOfMeasure.Unit, 700m, 100m),
        // 'botte' would read better, but the domain only accepts kg/g/L/ml/unit — the demo
        // frontend shows 'botte' here, which the real API would reject. Bunches, counted.
        new("menthe", "Menthe fraîche", UnitOfMeasure.Unit, 14m, 6m),
        new("the", "Thé vert", UnitOfMeasure.Kilogram, 1.8m, 0.5m),
        new("citrons", "Citrons", UnitOfMeasure.Kilogram, 6.5m, 2m),
        new("farine", "Farine", UnitOfMeasure.Kilogram, 14m, 5m),
        new("dattes", "Dattes Deglet Nour", UnitOfMeasure.Kilogram, 4.2m, 1m),
        new("chocolat", "Chocolat noir", UnitOfMeasure.Kilogram, 2.4m, 1m),
        new("oranges", "Oranges", UnitOfMeasure.Kilogram, 4m, 3m),
        new("thon", "Thon", UnitOfMeasure.Kilogram, 1.6m, 0.5m),
        new("oeufs", "Œufs", UnitOfMeasure.Unit, 60m, 24m),
        new("harissa", "Harissa", UnitOfMeasure.Kilogram, 0.9m, 0.3m),
        new("semoule", "Semoule", UnitOfMeasure.Kilogram, 8m, 2m),
        new("amandes", "Amandes", UnitOfMeasure.Kilogram, 1.2m, 0.5m),
        new("huile", "Huile d'olive", UnitOfMeasure.Litre, 5m, 2m),
    ];

    /// <param name="ImageUrl">
    /// Root-relative, resolved against whatever origin serves the frontend. The domain rejects
    /// a bare relative path, so the leading slash is required rather than cosmetic. Left null on
    /// several products on purpose: the product card falls back to a coloured initial, and that
    /// path needs exercising too.
    /// </param>
    internal sealed record ProductSeed(
        string Key,
        string Category,
        string Name,
        decimal Price,
        string? Description,
        string? ImageUrl,
        bool IsActive,
        (string Ingredient, decimal Quantity)[] Recipe);

    internal static readonly ProductSeed[] Products =
    [
        new("express", "Boissons chaudes", "Express", 2.20m,
            "Café serré, torréfaction locale.", "/demo/express.svg", true,
            [("cafe", 0.018m), ("sucre", 0.008m), ("gobelets", 1m)]),

        new("creme", "Boissons chaudes", "Café Crème", 3.50m,
            "Express allongé au lait vapeur.", "/demo/creme.svg", true,
            [("cafe", 0.018m), ("lait", 0.2m), ("sucre", 0.008m), ("gobelets", 1m)]),

        new("the-menthe", "Boissons chaudes", "Thé à la menthe", 2.80m,
            "Thé vert, menthe fraîche, pignons.", "/demo/the-menthe.svg", true,
            [("the", 0.006m), ("menthe", 0.15m), ("sucre", 0.012m), ("gobelets", 1m)]),

        new("cappuccino", "Boissons chaudes", "Cappuccino", 3.80m,
            "Mousse de lait, cacao.", null, true,
            [("cafe", 0.018m), ("lait", 0.15m), ("chocolat", 0.005m), ("gobelets", 1m)]),

        new("chocolat-chaud", "Boissons chaudes", "Chocolat chaud", 4.00m,
            "Chocolat noir fondu, lait entier.", null, true,
            [("chocolat", 0.03m), ("lait", 0.25m), ("sucre", 0.01m), ("gobelets", 1m)]),

        new("citronnade", "Boissons fraîches", "Citronnade", 4.50m,
            "Citrons pressés, menthe, servie glacée.", "/demo/citronnade.svg", true,
            [("citrons", 0.25m), ("sucre", 0.03m), ("gobelets", 1m)]),

        // No recipe at all: sold from the fridge, so it never touches stock and can never be
        // blocked by a shortage. The one product that proves the deduction path is conditional.
        new("eau", "Boissons fraîches", "Eau minérale 50cl", 1.50m,
            null, "/demo/eau.svg", true, []),

        // Its only ingredient is seeded at zero, so this is the "temporarily unavailable"
        // case the menu has to handle without going wrong.
        new("jus-orange", "Boissons fraîches", "Jus d'orange pressé", 5.00m,
            "Pressé à la commande.", null, true,
            [("oranges", 0.35m), ("gobelets", 1m)]),

        new("bambalouni", "Pâtisseries", "Bambalouni", 2.00m,
            "Beignet sucré, préparé à la commande.", "/demo/bambalouni.svg", true,
            [("farine", 0.09m), ("sucre", 0.02m)]),

        // Off the menu, but still referenced by an older order — the admin list has to render
        // a product it can no longer sell.
        new("makroudh", "Pâtisseries", "Makroudh aux dattes", 2.50m,
            "Semoule et dattes, miel de romarin.", "/demo/makroudh.svg", false,
            [("semoule", 0.07m), ("dattes", 0.05m)]),

        new("corne-gazelle", "Pâtisseries", "Corne de gazelle", 2.80m,
            "Pâte d'amande, fleur d'oranger.", null, true,
            [("farine", 0.05m), ("amandes", 0.03m), ("sucre", 0.015m)]),

        new("chapati-thon", "Salés", "Chapati thon", 6.50m,
            "Thon, œuf, harissa, olives.", null, true,
            [("farine", 0.12m), ("thon", 0.08m), ("oeufs", 1m), ("harissa", 0.01m), ("huile", 0.02m)]),

        new("fricasse", "Salés", "Fricassé", 3.20m,
            "Petit pain frit, thon et harissa.", null, true,
            [("farine", 0.07m), ("thon", 0.05m), ("oeufs", 1m), ("huile", 0.03m)]),
    ];

    internal sealed record LineSeed(
        string Product,
        int Quantity,
        string? Notes = null,
        (string Ingredient, CustomizationKind Kind)[]? Customizations = null);

    /// <param name="MinutesAgo">
    /// How long ago it was placed. The floor plan turns a table amber past 25 minutes, so the
    /// ages here are what make that state reachable without waiting for it.
    /// </param>
    /// <param name="DeductedStock">
    /// Whether its ingredients actually left the store. False for a failed payment (nothing was
    /// ever committed) and for a cancellation that put them back.
    /// </param>
    internal sealed record OrderSeed(
        string Key,
        OrderType Type,
        int MinutesAgo,
        LineSeed[] Lines,
        string? Table = null,
        int? Covers = null,
        string? CustomerName = null,
        string? Phone = null,
        string? Address = null,
        string? Allergies = null,
        PaymentMethod Payment = PaymentMethod.Cash,
        PaymentStatus PaymentState = PaymentStatus.Unpaid,
        OrderStatus Status = OrderStatus.Pending,
        string? CancellationReason = null,
        bool DeductedStock = true);

    internal static readonly OrderSeed[] Orders =
    [
        // Dine-in, unpaid, with an allergy warning, a kitchen note and a removed ingredient.
        new("t4-open", OrderType.DineIn, 6,
            [
                new("creme", 2, "Bien chaud", [("sucre", CustomizationKind.Removed)]),
                new("eau", 1),
            ],
            Table: "4", Covers: 3, Allergies: "Allergie aux fruits à coque."),

        // Paid up front by gateway while still being served — the other half of the dine-in flow.
        new("t1-paid", OrderType.DineIn, 4,
            [new("express", 2, Customizations: [("sucre", CustomizationKind.Added)])],
            Table: "1", Covers: 2,
            Payment: PaymentMethod.Flouci, PaymentState: PaymentStatus.Paid),

        // Old enough that the floor plan flags it: 38 minutes, still pending, still unpaid.
        new("t3-neglected", OrderType.DineIn, 38,
            [new("the-menthe", 3), new("bambalouni", 2)],
            Table: "3", Covers: 6),

        // Closed and paid, and the one that carries the five-star review.
        new("terrasse2-done", OrderType.DineIn, 41,
            [new("the-menthe", 2)],
            Table: "Terrasse 2", Covers: 5,
            PaymentState: PaymentStatus.Paid, Status: OrderStatus.Completed),

        // Closed but poorly reviewed — a completed order is not automatically a happy one.
        new("t2-done", OrderType.DineIn, 92,
            [new("express", 2), new("bambalouni", 1)],
            Table: "2", Covers: 2,
            PaymentState: PaymentStatus.Paid, Status: OrderStatus.Completed),

        new("t12-open", OrderType.DineIn, 9,
            [new("citronnade", 1), new("bambalouni", 2)],
            Table: "12", Covers: 4,
            Payment: PaymentMethod.Konnect, PaymentState: PaymentStatus.Paid),

        new("takeaway-sami", OrderType.Takeaway, 3,
            [new("express", 2)],
            CustomerName: "Sami", Phone: "+216 20 111 222",
            Payment: PaymentMethod.Konnect, PaymentState: PaymentStatus.Paid),

        new("takeaway-leila", OrderType.Takeaway, 55,
            [new("creme", 1), new("corne-gazelle", 1)],
            CustomerName: "Leila", Phone: "+216 21 444 555",
            PaymentState: PaymentStatus.Paid, Status: OrderStatus.Completed),

        new("delivery-ines", OrderType.Delivery, 12,
            [new("citronnade", 2)],
            CustomerName: "Ines", Phone: "+216 22 333 444",
            Address: "Rue de Marseille 14, Tunis",
            Payment: PaymentMethod.Flouci, PaymentState: PaymentStatus.Paid),

        // Cancelled after the stock had gone, so the ingredients were returned.
        new("delivery-cancelled", OrderType.Delivery, 70,
            [new("chapati-thon", 1)],
            CustomerName: "Karim", Phone: "+216 23 777 888",
            Address: "Avenue Habib Bourguiba 3, La Marsa",
            Status: OrderStatus.Cancelled,
            CancellationReason: "Adresse introuvable, client injoignable.",
            DeductedStock: false),

        new("t7-cancelled", OrderType.DineIn, 26,
            [new("fricasse", 2)],
            Table: "7", Covers: 2,
            Status: OrderStatus.Cancelled,
            CancellationReason: "Client parti avant le service.",
            DeductedStock: false),

        // Gateway declined: nothing was deducted, because for a digital order stock only moves
        // when the webhook confirms the money.
        new("takeaway-failed", OrderType.Takeaway, 8,
            [new("chocolat-chaud", 1)],
            CustomerName: "Nizar", Phone: "+216 24 999 000",
            Payment: PaymentMethod.Flouci, PaymentState: PaymentStatus.Failed,
            DeductedStock: false),
    ];

    internal sealed record ServiceRequestSeed(
        string Table,
        ServiceRequestKind Kind,
        int MinutesAgo,
        ServiceRequestStatus Status,
        string? Note = null,
        string? OrderKey = null);

    /// <summary>One of each kind, spread across the three states the service desk filters on.</summary>
    internal static readonly ServiceRequestSeed[] ServiceRequests =
    [
        new("7", ServiceRequestKind.CallWaiter, 2, ServiceRequestStatus.Open),
        new("3", ServiceRequestKind.RequestBill, 5, ServiceRequestStatus.Open, OrderKey: "t3-neglected"),
        new("1", ServiceRequestKind.Supplies, 11, ServiceRequestStatus.Acknowledged,
            "Encore un peu de sucre s'il vous plaît."),
        new("12", ServiceRequestKind.Problem, 24, ServiceRequestStatus.Resolved,
            "Citronnade renversée, table à nettoyer."),
    ];

    internal sealed record ReviewSeed(string OrderKey, int Rating, string? Comment, int MinutesAgo);

    internal static readonly ReviewSeed[] Reviews =
    [
        new("terrasse2-done", 5, "Le thé à la menthe était parfait, merci !", 30),
        new("takeaway-leila", 4, "Rapide et bon. La corne de gazelle était un peu sèche.", 48),
        new("t2-done", 2, "Trop d'attente pour deux express.", 80),
    ];

    /// <summary>
    /// Closing stock take. Applied after the day's orders so a few ingredients land on values
    /// the dashboard has to react to: two under their alert threshold, one at zero that takes
    /// its product off the menu.
    /// </summary>
    internal static readonly (string Ingredient, decimal Counted, string Note)[] ClosingCount =
    [
        ("lait", 1.2m, "Inventaire de fin de service : brique entamée jetée."),
        ("menthe", 3m, "Inventaire de fin de service : bottes fanées retirées."),
        ("oranges", 0m, "Inventaire de fin de service : rupture, livraison attendue demain."),
    ];

    /// <summary>
    /// The room as the floor planner exports it. Table labels match the orders above — that
    /// join on the number is the whole point of the waiter view.
    /// </summary>
    internal const string FloorPlanJson = """
    {
      "schema": "restaurant-floor-plan",
      "version": 1,
      "name": "Café Sidi Bou — ground floor",
      "units": "cm",
      "grid": 25,
      "walls": [
        { "id": "w1", "x1": 0, "y1": 0, "x2": 900, "y2": 0, "thickness": 12 },
        { "id": "w2", "x1": 900, "y1": 0, "x2": 900, "y2": 640, "thickness": 12 },
        { "id": "w3", "x1": 900, "y1": 640, "x2": 0, "y2": 640, "thickness": 12 },
        { "id": "w4", "x1": 0, "y1": 640, "x2": 0, "y2": 0, "thickness": 12 },
        { "id": "w5", "x1": 560, "y1": 300, "x2": 560, "y2": 640, "thickness": 12 }
      ],
      "doors": [
        { "id": "d1", "x1": 150, "y1": 640, "x2": 330, "y2": 640, "thickness": 10 }
      ],
      "tables": [
        { "id": "t1", "label": "1", "x": 125, "y": 125, "width": 80, "height": 80, "seats": 4, "section": "Salle" },
        { "id": "t2", "label": "2", "x": 375, "y": 125, "width": 80, "height": 80, "seats": 2, "section": "Salle" },
        { "id": "t3", "label": "3", "x": 650, "y": 125, "width": 100, "height": 100, "seats": 6, "section": "Salle" },
        { "id": "t4", "label": "4", "x": 125, "y": 400, "width": 80, "height": 80, "seats": 4, "section": "Salle" },
        { "id": "t5", "label": "7", "x": 350, "y": 400, "width": 80, "height": 80, "seats": 4, "section": "Salle" },
        { "id": "t6", "label": "12", "x": 650, "y": 380, "width": 80, "height": 80, "seats": 4, "section": "Terrasse" },
        { "id": "t7", "label": "Terrasse 2", "x": 650, "y": 520, "width": 100, "height": 80, "seats": 5, "section": "Terrasse" }
      ],
      "labels": [
        { "id": "l1", "x": 620, "y": 340, "text": "Terrasse" },
        { "id": "l2", "x": 60, "y": 90, "text": "Salle" }
      ]
    }
    """;
}
