namespace Application.Features.Ingredients;

public sealed record IngredientDto(
    Guid Id,
    string Name,
    string Unit,
    decimal CurrentStock,
    decimal MinimumStockAlert,
    bool IsBelowMinimum);

/// <summary>Opening stock is optional; it is recorded as the ingredient's first ledger line.</summary>
public sealed record CreateIngredientRequest(
    string Name,
    string Unit,
    decimal CurrentStock,
    decimal MinimumStockAlert);

/// <summary>
/// Stock is deliberately absent: it only ever moves through
/// <c>/api/v1/ingredients/{id}/adjust</c> and <c>/recount</c>, so every change leaves a ledger line.
/// </summary>
public sealed record UpdateIngredientRequest(
    string Name,
    string Unit,
    decimal MinimumStockAlert);
