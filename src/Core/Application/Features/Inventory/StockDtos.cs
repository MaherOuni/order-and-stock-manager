using Domain.Enums;

namespace Application.Features.Inventory;

/// <summary>
/// A manual stock movement. <paramref name="ChangeAmount"/> is signed: +5 is a delivery,
/// -0.75 is waste.
/// </summary>
public sealed record StockAdjustmentRequest(
    decimal ChangeAmount,
    StockChangeReason Reason,
    string? Note);

/// <summary>Absolute correction after a physical count; the delta is derived and logged.</summary>
public sealed record StockRecountRequest(decimal CountedStock, string? Note);

public sealed record StockLogDto(
    Guid Id,
    Guid IngredientId,
    string IngredientName,
    string Unit,
    decimal ChangeAmount,
    decimal PreviousStock,
    decimal NewStock,
    StockChangeReason Reason,
    string? Note,
    // The order that caused the movement, or null for a manual adjustment.
    Guid? OrderId,
    DateTimeOffset CreatedAt);

/// <summary>Result of a stock movement: the ledger line plus the ingredient's new state.</summary>
public sealed record StockMovementResult(
    Guid IngredientId,
    string IngredientName,
    string Unit,
    decimal CurrentStock,
    decimal MinimumStockAlert,
    bool IsBelowMinimum,
    StockLogDto Log);

/// <summary>One line of an incoming order: how many units of a product were requested.</summary>
public sealed record OrderItemDto(Guid ProductId, int Quantity);

/// <summary>
/// A basket line as stock sees it: a product, a quantity, and any changes the customer made to
/// its recipe. Removing an ingredient takes it out of the deduction; adding one doubles it,
/// since an "extra shot" is a second helping of what the recipe already specifies.
/// </summary>
public sealed record OrderLineRequirement(
    Guid ProductId,
    int Quantity,
    IReadOnlyCollection<Guid> RemovedIngredientIds,
    IReadOnlyCollection<Guid> AddedIngredientIds)
{
    public static OrderLineRequirement From(OrderItemDto item)
        => new(item.ProductId, item.Quantity, Array.Empty<Guid>(), Array.Empty<Guid>());
}

/// <summary>An ingredient the order cannot be fulfilled with, and by how much it falls short.</summary>
public sealed record StockShortageDto(
    Guid IngredientId,
    string IngredientName,
    string Unit,
    decimal RequiredQuantity,
    decimal AvailableQuantity,
    decimal MissingQuantity,
    IReadOnlyList<Guid> BlockedProductIds);

/// <summary>
/// Outcome of a stock check. <see cref="IsAvailable"/> is true only when every ingredient of
/// every requested product is present in sufficient quantity.
/// </summary>
public sealed record StockAvailabilityResult(
    bool IsAvailable,
    IReadOnlyList<StockShortageDto> Shortages)
{
    public static StockAvailabilityResult Available { get; } =
        new(true, Array.Empty<StockShortageDto>());

    public static StockAvailabilityResult Unavailable(IReadOnlyList<StockShortageDto> shortages)
        => new(false, shortages);
}

/// <summary>What a set of order lines consumes from stock, aggregated per ingredient.</summary>
public sealed record IngredientRequirementDto(
    Guid IngredientId,
    string IngredientName,
    string Unit,
    decimal RequiredQuantity,
    decimal AvailableQuantity);

/// <summary>Result of committing a deduction: every ledger line written.</summary>
public sealed record StockDeductionResult(
    IReadOnlyList<StockLogDto> Movements);
