using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Recipes;

public interface IRecipeService
{
    Task<ProductRecipeDto> GetForProductAsync(Guid productId, CancellationToken ct = default);

    /// <summary>
    /// The ingredient names a customer may change, and nothing else. Separate from
    /// <see cref="GetForProductAsync"/> because that one is staff-only.
    /// </summary>
    Task<ProductCustomizationsDto> GetCustomizationsAsync(Guid productId, CancellationToken ct = default);

    /// <summary>Maps a whole set of ingredients to a product, replacing any previous recipe.</summary>
    Task<ProductRecipeDto> ReplaceRecipeAsync(Guid productId, SetRecipeRequest request, CancellationToken ct = default);

    Task<RecipeItemDto> AddItemAsync(Guid productId, AddRecipeItemRequest request, CancellationToken ct = default);
    Task<RecipeItemDto> UpdateItemAsync(Guid productId, Guid recipeItemId, UpdateRecipeItemRequest request, CancellationToken ct = default);
    Task RemoveItemAsync(Guid productId, Guid recipeItemId, CancellationToken ct = default);
}

/// <summary>
/// Maintains the bill of materials that inventory deduction reads at order time.
/// Both the product and the ingredient are re-read through the tenant filter, so a recipe
/// can never span two tenants.
/// </summary>
public sealed class RecipeService : IRecipeService
{
    private readonly IApplicationDbContext _db;

    public RecipeService(IApplicationDbContext db) => _db = db;

    public async Task<ProductRecipeDto> GetForProductAsync(Guid productId, CancellationToken ct = default)
    {
        var product = await _db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == productId, ct)
                      ?? throw new NotFoundException(nameof(Product), productId);

        var rows = await _db.RecipeItems
            .AsNoTracking()
            .Where(r => r.ProductId == productId)
            .Include(r => r.Ingredient)
            .ToListAsync(ct);

        var items = rows
            .OrderBy(r => r.Ingredient!.Name)
            .Select(Map)
            .ToList();

        return new ProductRecipeDto(product.Id, product.Name, items, MaxProducible(rows));
    }

    public async Task<ProductCustomizationsDto> GetCustomizationsAsync(
        Guid productId, CancellationToken ct = default)
    {
        var product = await _db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == productId, ct)
                      ?? throw new NotFoundException(nameof(Product), productId);

        // Projected in the query rather than mapped from the full row, so quantities and stock
        // are never even loaded on a request that must not reveal them.
        var items = await _db.RecipeItems
            .AsNoTracking()
            .Where(r => r.ProductId == productId)
            .OrderBy(r => r.Ingredient!.Name)
            .Select(r => new CustomizationOptionDto(r.IngredientId, r.Ingredient!.Name))
            .ToListAsync(ct);

        return new ProductCustomizationsDto(product.Id, product.Name, items);
    }

    public async Task<ProductRecipeDto> ReplaceRecipeAsync(
        Guid productId, SetRecipeRequest request, CancellationToken ct = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == productId, ct)
                      ?? throw new NotFoundException(nameof(Product), productId);

        var lines = request.Items ?? Array.Empty<RecipeLineRequest>();

        var duplicates = lines
            .GroupBy(l => l.IngredientId)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();

        if (duplicates.Count > 0)
            throw new ValidationException(
                nameof(SetRecipeRequest.Items),
                $"An ingredient can only appear once in a recipe; duplicated: {string.Join(", ", duplicates)}.");

        var requestedIds = lines.Select(l => l.IngredientId).ToList();

        // Tenant-filtered, so an ingredient belonging to another tenant is simply not found.
        var ingredients = await _db.Ingredients
            .Where(i => requestedIds.Contains(i.Id))
            .ToDictionaryAsync(i => i.Id, ct);

        var missing = requestedIds.Except(ingredients.Keys).ToList();
        if (missing.Count > 0)
            throw new NotFoundException(nameof(Ingredient), string.Join(", ", missing));

        var existing = await _db.RecipeItems
            .Where(r => r.ProductId == productId)
            .ToListAsync(ct);

        var requestedById = lines.ToDictionary(l => l.IngredientId);

        // Drop lines the caller left out.
        foreach (var obsolete in existing.Where(e => !requestedById.ContainsKey(e.IngredientId)))
            _db.RecipeItems.Remove(obsolete);

        // Update the quantity of lines that stay, so their ids (and any history) survive.
        foreach (var kept in existing.Where(e => requestedById.ContainsKey(e.IngredientId)))
            kept.ChangeQuantity(requestedById[kept.IngredientId].QuantityRequired);

        var existingIngredientIds = existing.Select(e => e.IngredientId).ToHashSet();

        foreach (var line in lines.Where(l => !existingIngredientIds.Contains(l.IngredientId)))
            _db.RecipeItems.Add(new RecipeItem(product.Id, line.IngredientId, line.QuantityRequired));

        await _db.SaveChangesAsync(ct);

        return await GetForProductAsync(productId, ct);
    }

    public async Task<RecipeItemDto> AddItemAsync(
        Guid productId, AddRecipeItemRequest request, CancellationToken ct = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == productId, ct)
                      ?? throw new NotFoundException(nameof(Product), productId);

        var ingredient = await _db.Ingredients.FirstOrDefaultAsync(i => i.Id == request.IngredientId, ct)
                         ?? throw new NotFoundException(nameof(Ingredient), request.IngredientId);

        if (await _db.RecipeItems.AnyAsync(r => r.ProductId == productId && r.IngredientId == ingredient.Id, ct))
            throw new ConflictException(
                $"'{ingredient.Name}' is already part of this recipe; update the existing line instead.");

        var item = new RecipeItem(product.Id, ingredient.Id, request.QuantityRequired);

        _db.RecipeItems.Add(item);
        await _db.SaveChangesAsync(ct);

        return new RecipeItemDto(item.Id, product.Id, ingredient.Id, ingredient.Name,
            ingredient.Unit.Code, item.QuantityRequired, ingredient.CurrentStock);
    }

    public async Task<RecipeItemDto> UpdateItemAsync(
        Guid productId, Guid recipeItemId, UpdateRecipeItemRequest request, CancellationToken ct = default)
    {
        var item = await _db.RecipeItems
                       .Include(r => r.Ingredient)
                       .FirstOrDefaultAsync(r => r.Id == recipeItemId && r.ProductId == productId, ct)
                   ?? throw new NotFoundException(nameof(RecipeItem), recipeItemId);

        item.ChangeQuantity(request.QuantityRequired);
        await _db.SaveChangesAsync(ct);

        return Map(item);
    }

    public async Task RemoveItemAsync(Guid productId, Guid recipeItemId, CancellationToken ct = default)
    {
        var item = await _db.RecipeItems
                       .FirstOrDefaultAsync(r => r.Id == recipeItemId && r.ProductId == productId, ct)
                   ?? throw new NotFoundException(nameof(RecipeItem), recipeItemId);

        _db.RecipeItems.Remove(item);
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>Units sellable right now, capped by the scarcest ingredient. No recipe means unbounded.</summary>
    private static int MaxProducible(IReadOnlyCollection<RecipeItem> items)
    {
        if (items.Count == 0) return int.MaxValue;

        return items.Min(r => (int)Math.Floor(r.Ingredient!.CurrentStock / r.QuantityRequired));
    }

    private static RecipeItemDto Map(RecipeItem r) => new(
        r.Id,
        r.ProductId,
        r.IngredientId,
        r.Ingredient!.Name,
        r.Ingredient.Unit.Code,
        r.QuantityRequired,
        r.Ingredient.CurrentStock);
}
