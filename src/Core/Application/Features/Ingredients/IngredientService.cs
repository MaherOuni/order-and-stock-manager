using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Domain.Entities;
using Domain.Enums;
using Domain.ValueObjects;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Ingredients;

public interface IIngredientService
{
    Task<IReadOnlyList<IngredientDto>> GetAllAsync(bool lowStockOnly, CancellationToken ct = default);
    Task<IngredientDto> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IngredientDto> CreateAsync(CreateIngredientRequest request, CancellationToken ct = default);
    Task<IngredientDto> UpdateAsync(Guid id, UpdateIngredientRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}

public sealed class IngredientService : IIngredientService
{
    private readonly IApplicationDbContext _db;

    public IngredientService(IApplicationDbContext db) => _db = db;

    public async Task<IReadOnlyList<IngredientDto>> GetAllAsync(bool lowStockOnly, CancellationToken ct = default)
    {
        var query = _db.Ingredients.AsNoTracking();

        // Evaluated server-side; IsBelowMinimum itself is a CLR-only convenience.
        if (lowStockOnly)
            query = query.Where(i => i.CurrentStock <= i.MinimumStockAlert);

        // Materialised before mapping: Unit is a value object behind a converter, so
        // i.Unit.Code cannot be translated inside the SQL projection.
        var ingredients = await query.OrderBy(i => i.Name).ToListAsync(ct);

        return ingredients.Select(Map).ToList();
    }

    public async Task<IngredientDto> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var ingredient = await _db.Ingredients.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, ct)
                         ?? throw new NotFoundException(nameof(Ingredient), id);

        return Map(ingredient);
    }

    public async Task<IngredientDto> CreateAsync(CreateIngredientRequest request, CancellationToken ct = default)
    {
        if (await _db.Ingredients.AnyAsync(i => i.Name == request.Name, ct))
            throw new ConflictException($"An ingredient named '{request.Name}' already exists.");

        var ingredient = new Ingredient(
            request.Name,
            UnitOfMeasure.From(request.Unit),
            request.CurrentStock,
            request.MinimumStockAlert);

        _db.Ingredients.Add(ingredient);

        // Opening stock is a stock movement like any other, so the ledger starts complete.
        if (ingredient.CurrentStock > 0)
            _db.StockLogs.Add(StockLog.Record(
                ingredient.Id,
                ingredient.CurrentStock,
                previousStock: 0m,
                newStock: ingredient.CurrentStock,
                StockChangeReason.InventoryCount,
                "Opening stock."));

        await _db.SaveChangesAsync(ct);

        return Map(ingredient);
    }

    public async Task<IngredientDto> UpdateAsync(Guid id, UpdateIngredientRequest request, CancellationToken ct = default)
    {
        var ingredient = await _db.Ingredients.FirstOrDefaultAsync(i => i.Id == id, ct)
                         ?? throw new NotFoundException(nameof(Ingredient), id);

        if (await _db.Ingredients.AnyAsync(i => i.Name == request.Name && i.Id != id, ct))
            throw new ConflictException($"An ingredient named '{request.Name}' already exists.");

        var unit = UnitOfMeasure.From(request.Unit);

        // Changing the unit would silently reinterpret every recipe quantity that points here.
        if (!unit.Equals(ingredient.Unit) && await _db.RecipeItems.AnyAsync(r => r.IngredientId == id, ct))
            throw new ConflictException(
                $"Cannot change the unit of '{ingredient.Name}' while recipes still reference it.");

        ingredient.Rename(request.Name);
        ingredient.ChangeUnit(unit);
        ingredient.SetMinimumStockAlert(request.MinimumStockAlert);

        await _db.SaveChangesAsync(ct);

        return Map(ingredient);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var ingredient = await _db.Ingredients.FirstOrDefaultAsync(i => i.Id == id, ct)
                         ?? throw new NotFoundException(nameof(Ingredient), id);

        if (await _db.RecipeItems.AnyAsync(r => r.IngredientId == id, ct))
            throw new ConflictException("Cannot delete an ingredient that is still used by a recipe.");

        _db.Ingredients.Remove(ingredient);
        await _db.SaveChangesAsync(ct);
    }

    private static IngredientDto Map(Ingredient i) => new(
        i.Id, i.Name, i.Unit.Code, i.CurrentStock, i.MinimumStockAlert, i.IsBelowMinimum);
}
