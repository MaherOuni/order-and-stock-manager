namespace Application.Features.Recipes;

public sealed record RecipeItemDto(
    Guid Id,
    Guid ProductId,
    Guid IngredientId,
    string IngredientName,
    string Unit,
    decimal QuantityRequired,
    decimal IngredientCurrentStock);

/// <summary>A product's full bill of materials plus how many units the current stock supports.</summary>
public sealed record ProductRecipeDto(
    Guid ProductId,
    string ProductName,
    IReadOnlyList<RecipeItemDto> Items,
    int MaxProducibleUnits);

public sealed record AddRecipeItemRequest(Guid IngredientId, decimal QuantityRequired);

public sealed record UpdateRecipeItemRequest(decimal QuantityRequired);

/// <summary>One ingredient of a product's bill of materials, in that ingredient's own unit.</summary>
public sealed record RecipeLineRequest(Guid IngredientId, decimal QuantityRequired);

/// <summary>
/// Maps several ingredients to a product in one call. This is a full replacement: lines absent
/// from <see cref="Items"/> are removed, so the request always describes the complete recipe.
/// An empty list clears the recipe.
/// </summary>
public sealed record SetRecipeRequest(IReadOnlyList<RecipeLineRequest> Items);
