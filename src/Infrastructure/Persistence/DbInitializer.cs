using Application.Common.Interfaces;
using Domain.Entities;
using Domain.Enums;
using Domain.ValueObjects;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Persistence;

public static class DbInitializer
{
    /// <summary>Applies pending migrations. Intended for development and container start-up.</summary>
    public static async Task MigrateAsync(IServiceProvider services, CancellationToken ct = default)
    {
        await using var scope = services.CreateAsyncScope();

        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(DbInitializer));

        logger.LogInformation("Applying database migrations…");
        await db.Database.MigrateAsync(ct);
        logger.LogInformation("Database is up to date.");
    }

    /// <summary>
    /// Seeds a demo restaurant with a full day's trading behind it, so every screen has
    /// something to show and every branch has a row that reaches it. The data itself is in
    /// <see cref="DemoSeedData"/>.
    ///
    /// Idempotent: it does nothing once the demo tenant exists. To rebuild it, drop the volume
    /// (<c>docker compose down -v</c>) and start again.
    /// </summary>
    public static async Task SeedDemoTenantAsync(IServiceProvider services, CancellationToken ct = default)
    {
        await using var scope = services.CreateAsyncScope();

        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var currentTenant = scope.ServiceProvider.GetRequiredService<ICurrentTenant>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(DbInitializer));

        var slug = Slug.From("demo-resto");

        if (await db.Tenants.AnyAsync(t => t.Slug == slug, ct))
        {
            logger.LogInformation("Demo tenant already present; skipping seed.");
            return;
        }

        var tenant = new Tenant("Café Sidi Bou", slug, "TND");
        tenant.SetFloorPlan(DemoSeedData.FloorPlanJson);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync(ct);

        // Everything below is tenant-scoped, so the scope needs a tenant context before it is saved.
        currentTenant.Set(tenant.Id, tenant.Slug.Value);

        var categories = SeedCategories(db);
        var ingredients = SeedIngredients(db);
        await db.SaveChangesAsync(ct);

        var products = SeedProducts(db, categories, ingredients);
        await db.SaveChangesAsync(ct);

        await SeedOrdersAsync(db, products, ingredients, ct);
        SeedClosingCount(db, ingredients);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Seeded demo tenant {Slug} ({TenantId}): {Products} products, {Orders} orders.",
            tenant.Slug.Value, tenant.Id, products.Count, DemoSeedData.Orders.Length);
    }

    private static Dictionary<string, Category> SeedCategories(ApplicationDbContext db)
    {
        var categories = DemoSeedData.Categories
            .ToDictionary(c => c.Name, c => new Category(c.Name, c.SortOrder));

        db.Categories.AddRange(categories.Values);

        return categories;
    }

    private static Dictionary<string, Ingredient> SeedIngredients(ApplicationDbContext db)
    {
        var ingredients = new Dictionary<string, Ingredient>();

        foreach (var seed in DemoSeedData.Ingredients)
        {
            var ingredient = new Ingredient(seed.Name, seed.Unit, seed.OpeningStock, seed.MinimumAlert);
            ingredients[seed.Key] = ingredient;
            db.Ingredients.Add(ingredient);

            // Opening balances belong in the ledger too, so history reconciles with current stock.
            db.StockLogs.Add(StockLog.Record(
                ingredient.Id, seed.OpeningStock, 0m, seed.OpeningStock,
                StockChangeReason.InventoryCount, "Stock d'ouverture."));
        }

        return ingredients;
    }

    private static Dictionary<string, Product> SeedProducts(
        ApplicationDbContext db,
        IReadOnlyDictionary<string, Category> categories,
        IReadOnlyDictionary<string, Ingredient> ingredients)
    {
        var products = new Dictionary<string, Product>();

        foreach (var seed in DemoSeedData.Products)
        {
            var product = new Product(
                categories[seed.Category].Id,
                seed.Name,
                seed.Price,
                seed.Description,
                seed.IsActive,
                seed.ImageUrl);

            products[seed.Key] = product;
            db.Products.Add(product);

            foreach (var (ingredientKey, quantity) in seed.Recipe)
                db.RecipeItems.Add(new RecipeItem(product.Id, ingredients[ingredientKey].Id, quantity));
        }

        return products;
    }

    private static async Task SeedOrdersAsync(
        ApplicationDbContext db,
        IReadOnlyDictionary<string, Product> products,
        IReadOnlyDictionary<string, Ingredient> ingredients,
        CancellationToken ct)
    {
        // Recipes are needed to expand a line into ingredient movements, and to price a
        // customisation — both are keyed off the product the line names.
        var recipeByProduct = DemoSeedData.Products.ToDictionary(
            p => p.Key,
            p => p.Recipe.ToDictionary(r => r.Ingredient, r => r.Quantity));

        var ordersByKey = new Dictionary<string, Order>();

        foreach (var seed in DemoSeedData.Orders)
        {
            var placedAt = DateTimeOffset.UtcNow.AddMinutes(-seed.MinutesAgo);
            var order = new Order(seed.Type, seed.Payment);

            order.SetFulfilment(seed.Type, seed.Table, seed.CustomerName, seed.Phone, seed.Address);
            order.SetAllergyNotes(seed.Allergies);
            order.SetCovers(seed.Covers);

            foreach (var lineSeed in seed.Lines)
            {
                var product = products[lineSeed.Product];
                var recipe = recipeByProduct[lineSeed.Product];

                var item = order.AddItem(product.Id, lineSeed.Quantity, product.Price, lineSeed.Notes);

                foreach (var (ingredientKey, kind) in lineSeed.Customizations ?? [])
                {
                    var ingredient = ingredients[ingredientKey];

                    item.Customize(ingredient.Id, ingredient.Name, kind, recipe[ingredientKey]);
                }
            }

            if (seed.PaymentState == PaymentStatus.Paid) order.MarkPaid();
            if (seed.PaymentState == PaymentStatus.Failed) order.MarkPaymentFailed();

            if (seed.DeductedStock)
            {
                order.MarkStockDeducted();
                Consume(db, order, seed, ingredients, recipeByProduct, placedAt);
            }

            // Cancel before Complete: the domain only allows either from Pending.
            if (seed.Status == OrderStatus.Cancelled) order.Cancel(seed.CancellationReason);
            if (seed.Status == OrderStatus.Completed) order.Complete();

            db.Orders.Add(order);
            ordersByKey[seed.Key] = order;

            // CreatedAt is stamped by the constructor and has no public setter — reasonably so,
            // since nothing but a seeder should ever choose it. The change tracker can.
            db.Entry(order).Property(o => o.CreatedAt).CurrentValue = placedAt;
        }

        await db.SaveChangesAsync(ct);

        SeedServiceRequests(db, ordersByKey);
        SeedReviews(db, ordersByKey);
    }

    /// <summary>
    /// Moves a seeded order's ingredients out of stock and writes the ledger lines, mirroring
    /// what <c>StockService</c> does for a real order: one expansion per line, with removals
    /// skipped and extras doubled.
    /// </summary>
    private static void Consume(
        ApplicationDbContext db,
        Order order,
        DemoSeedData.OrderSeed seed,
        IReadOnlyDictionary<string, Ingredient> ingredients,
        IReadOnlyDictionary<string, Dictionary<string, decimal>> recipeByProduct,
        DateTimeOffset placedAt)
    {
        var required = new Dictionary<string, decimal>();

        foreach (var line in seed.Lines)
        {
            foreach (var (ingredientKey, perUnit) in recipeByProduct[line.Product])
            {
                var kind = line.Customizations
                    ?.Where(c => c.Ingredient == ingredientKey)
                    .Select(c => (CustomizationKind?)c.Kind)
                    .FirstOrDefault();

                var multiplier = kind switch
                {
                    CustomizationKind.Removed => 0m,
                    CustomizationKind.Added => 2m,
                    _ => 1m,
                };

                if (multiplier == 0m) continue;

                required[ingredientKey] = required.GetValueOrDefault(ingredientKey)
                                          + perUnit * multiplier * line.Quantity;
            }
        }

        foreach (var (ingredientKey, quantity) in required)
        {
            var ingredient = ingredients[ingredientKey];
            var previous = ingredient.CurrentStock;

            ingredient.Consume(quantity);

            var log = StockLog.Record(
                ingredient.Id, -quantity, previous, ingredient.CurrentStock,
                StockChangeReason.OrderConsumption, null, order.Id);

            db.StockLogs.Add(log);
            db.Entry(log).Property(l => l.CreatedAt).CurrentValue = placedAt;
        }
    }

    private static void SeedServiceRequests(
        ApplicationDbContext db,
        IReadOnlyDictionary<string, Order> orders)
    {
        foreach (var seed in DemoSeedData.ServiceRequests)
        {
            var orderId = seed.OrderKey is null ? (Guid?)null : orders[seed.OrderKey].Id;
            var request = new ServiceRequest(seed.Table, seed.Kind, seed.Note, orderId);

            // Resolve goes through Acknowledge, so the timestamps stay ordered.
            if (seed.Status is ServiceRequestStatus.Acknowledged or ServiceRequestStatus.Resolved)
                request.Acknowledge();

            if (seed.Status == ServiceRequestStatus.Resolved)
                request.Resolve();

            db.ServiceRequests.Add(request);
            db.Entry(request).Property(r => r.CreatedAt).CurrentValue =
                DateTimeOffset.UtcNow.AddMinutes(-seed.MinutesAgo);
        }
    }

    private static void SeedReviews(ApplicationDbContext db, IReadOnlyDictionary<string, Order> orders)
    {
        foreach (var seed in DemoSeedData.Reviews)
        {
            var review = new OrderReview(orders[seed.OrderKey].Id, seed.Rating, seed.Comment);

            db.OrderReviews.Add(review);
            db.Entry(review).Property(r => r.CreatedAt).CurrentValue =
                DateTimeOffset.UtcNow.AddMinutes(-seed.MinutesAgo);
        }
    }

    /// <summary>
    /// The closing stock take, which is what actually puts a couple of ingredients under their
    /// alert threshold and one at zero. Doing it as a counted adjustment rather than by picking
    /// convenient opening balances keeps the ledger adding up.
    /// </summary>
    private static void SeedClosingCount(
        ApplicationDbContext db,
        IReadOnlyDictionary<string, Ingredient> ingredients)
    {
        foreach (var (ingredientKey, counted, note) in DemoSeedData.ClosingCount)
        {
            var ingredient = ingredients[ingredientKey];
            var previous = ingredient.CurrentStock;

            if (previous == counted) continue;

            ingredient.SetStock(counted);

            db.StockLogs.Add(StockLog.Record(
                ingredient.Id, counted - previous, previous, counted,
                StockChangeReason.InventoryCount, note));
        }
    }
}
