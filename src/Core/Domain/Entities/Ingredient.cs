using Domain.Common;
using Domain.Exceptions;
using Domain.ValueObjects;

namespace Domain.Entities;

/// <summary>A raw stock item (flour, milk, cups). Quantities are decimal(18,4).</summary>
public class Ingredient : TenantEntity
{
    public const int NameMaxLength = 200;

    private readonly List<RecipeItem> _recipeItems = new();

    private Ingredient()
    {
        Name = null!;
        Unit = null!;
    }

    public Ingredient(string name, UnitOfMeasure unit, decimal currentStock = 0m, decimal minimumStockAlert = 0m)
    {
        Rename(name);
        Unit = unit ?? throw new DomainException("Unit is required.");
        SetStock(currentStock);
        SetMinimumStockAlert(minimumStockAlert);
    }

    public string Name { get; private set; }

    public UnitOfMeasure Unit { get; private set; }

    public decimal CurrentStock { get; private set; }

    /// <summary>Low-stock threshold; <see cref="IsBelowMinimum"/> drives the restock alert.</summary>
    public decimal MinimumStockAlert { get; private set; }

    public IReadOnlyCollection<RecipeItem> RecipeItems => _recipeItems.AsReadOnly();

    public bool IsBelowMinimum => CurrentStock <= MinimumStockAlert;

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("Ingredient name is required.");
        if (name.Length > NameMaxLength)
            throw new DomainException($"Ingredient name cannot exceed {NameMaxLength} characters.");

        Name = name.Trim();
    }

    public void ChangeUnit(UnitOfMeasure unit)
        => Unit = unit ?? throw new DomainException("Unit is required.");

    /// <summary>Absolute stock correction (inventory count).</summary>
    public void SetStock(decimal quantity)
    {
        if (quantity < 0)
            throw new DomainException("Stock cannot be negative.");

        CurrentStock = Normalize(quantity);
    }

    /// <summary>Goods-in.</summary>
    public void Replenish(decimal quantity)
    {
        if (quantity <= 0)
            throw new DomainException("Replenishment quantity must be greater than zero.");

        CurrentStock = Normalize(CurrentStock + quantity);
    }

    /// <summary>
    /// Goods-out, called while an order is created inside an explicit transaction.
    /// Throws rather than allowing stock to go negative.
    /// </summary>
    public void Consume(decimal quantity)
    {
        if (quantity <= 0)
            throw new DomainException("Consumed quantity must be greater than zero.");
        if (quantity > CurrentStock)
            throw new DomainException($"Insufficient stock for '{Name}': required {quantity} {Unit}, available {CurrentStock} {Unit}.");

        CurrentStock = Normalize(CurrentStock - quantity);
    }

    public void SetMinimumStockAlert(decimal threshold)
    {
        if (threshold < 0)
            throw new DomainException("Minimum stock alert cannot be negative.");

        MinimumStockAlert = Normalize(threshold);
    }

    private static decimal Normalize(decimal value) => decimal.Round(value, 4, MidpointRounding.AwayFromZero);
}
