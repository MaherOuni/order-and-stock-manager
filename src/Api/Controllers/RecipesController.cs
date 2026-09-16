using Application.Features.Recipes;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>
/// The bill of materials a product consumes from stock when it is sold. Deducting an order
/// walks these lines, so a product with no recipe consumes nothing.
/// </summary>
[ApiController]
[Route("api/v1/products/{productId:guid}/recipe")]
[Produces("application/json")]
public sealed class RecipesController : ControllerBase
{
    private readonly IRecipeService _recipes;

    public RecipesController(IRecipeService recipes) => _recipes = recipes;

    /// <summary>
    /// The product's recipe, plus <c>maxProducibleUnits</c> — how many units current stock
    /// supports, capped by the scarcest ingredient.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(ProductRecipeDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductRecipeDto>> Get(Guid productId, CancellationToken ct)
        => Ok(await _recipes.GetForProductAsync(productId, ct));

    /// <summary>
    /// Maps a set of ingredients and their required quantities to the product.
    /// </summary>
    /// <remarks>
    /// This is a full replacement: lines missing from the request are removed, so the body
    /// always describes the complete recipe. Quantities are in each ingredient's own unit.
    ///
    /// Sample request:
    ///
    ///     POST /api/v1/products/{productId}/recipe
    ///     X-Tenant-Id: demo-resto
    ///     {
    ///       "items": [
    ///         { "ingredientId": "3b1e…", "quantityRequired": 0.018 },
    ///         { "ingredientId": "9c22…", "quantityRequired": 0.2 }
    ///       ]
    ///     }
    /// </remarks>
    /// <response code="400">An ingredient appears more than once.</response>
    /// <response code="404">The product, or one of the ingredients, does not exist in this tenant.</response>
    [HttpPost]
    [ProducesResponseType(typeof(ProductRecipeDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductRecipeDto>> SetRecipe(
        Guid productId, SetRecipeRequest request, CancellationToken ct)
        => Ok(await _recipes.ReplaceRecipeAsync(productId, request, ct));

    /// <summary>Adds a single ingredient to the recipe.</summary>
    [HttpPost("items")]
    [ProducesResponseType(typeof(RecipeItemDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<RecipeItemDto>> AddItem(
        Guid productId, AddRecipeItemRequest request, CancellationToken ct)
    {
        var item = await _recipes.AddItemAsync(productId, request, ct);

        return CreatedAtAction(nameof(Get), new { productId }, item);
    }

    /// <summary>Changes how much of one ingredient the product consumes.</summary>
    [HttpPut("items/{recipeItemId:guid}")]
    [ProducesResponseType(typeof(RecipeItemDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RecipeItemDto>> UpdateItem(
        Guid productId, Guid recipeItemId, UpdateRecipeItemRequest request, CancellationToken ct)
        => Ok(await _recipes.UpdateItemAsync(productId, recipeItemId, request, ct));

    /// <summary>Removes one ingredient from the recipe.</summary>
    [HttpDelete("items/{recipeItemId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RemoveItem(Guid productId, Guid recipeItemId, CancellationToken ct)
    {
        await _recipes.RemoveItemAsync(productId, recipeItemId, ct);

        return NoContent();
    }
}
