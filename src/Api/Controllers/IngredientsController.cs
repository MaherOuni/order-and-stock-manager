using Application.Features.Ingredients;
using Application.Features.Inventory;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>
/// Stock items and their movements. Stock only ever changes through <c>adjust</c> or
/// <c>recount</c>, so every change leaves a line in the stock ledger.
/// </summary>
[ApiController]
[Route("api/v1/ingredients")]
[Produces("application/json")]
public sealed class IngredientsController : ControllerBase
{
    private readonly IIngredientService _ingredients;
    private readonly IStockService _stock;

    public IngredientsController(IIngredientService ingredients, IStockService stock)
    {
        _ingredients = ingredients;
        _stock = stock;
    }

    /// <summary>Lists the tenant's ingredients.</summary>
    /// <param name="lowStockOnly">Only ingredients at or below their minimum stock alert.</param>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<IngredientDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<IngredientDto>>> GetAll(
        [FromQuery] bool lowStockOnly,
        CancellationToken ct)
        => Ok(await _ingredients.GetAllAsync(lowStockOnly, ct));

    /// <summary>Gets a single ingredient.</summary>
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(IngredientDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IngredientDto>> GetById(Guid id, CancellationToken ct)
        => Ok(await _ingredients.GetByIdAsync(id, ct));

    /// <summary>Creates an ingredient. Any opening stock is recorded as its first ledger line.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(IngredientDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<IngredientDto>> Create(CreateIngredientRequest request, CancellationToken ct)
    {
        var ingredient = await _ingredients.CreateAsync(request, ct);

        return CreatedAtAction(nameof(GetById), new { id = ingredient.Id }, ingredient);
    }

    /// <summary>
    /// Renames an ingredient or changes its alert threshold. Stock is not editable here —
    /// use <c>adjust</c> or <c>recount</c>.
    /// </summary>
    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(IngredientDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<IngredientDto>> Update(Guid id, UpdateIngredientRequest request, CancellationToken ct)
        => Ok(await _ingredients.UpdateAsync(id, request, ct));

    /// <summary>
    /// Adds or subtracts stock with a reason. <c>changeAmount</c> is signed: <c>+12</c> for a
    /// delivery, <c>-0.75</c> for waste. Writes one ledger line and never lets stock go negative.
    /// </summary>
    /// <response code="409">The subtraction would take stock below zero.</response>
    [HttpPost("{id:guid}/adjust")]
    [ProducesResponseType(typeof(StockMovementResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<StockMovementResult>> Adjust(
        Guid id, StockAdjustmentRequest request, CancellationToken ct)
        => Ok(await _stock.AdjustAsync(id, request, ct));

    /// <summary>
    /// Sets stock to a counted figure after a physical inventory. The delta is derived and
    /// logged as an InventoryCount movement.
    /// </summary>
    [HttpPost("{id:guid}/recount")]
    [ProducesResponseType(typeof(StockMovementResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<StockMovementResult>> Recount(
        Guid id, StockRecountRequest request, CancellationToken ct)
        => Ok(await _stock.RecountAsync(id, request, ct));

    /// <summary>This ingredient's stock movements, newest first.</summary>
    [HttpGet("{id:guid}/stock-logs")]
    [ProducesResponseType(typeof(IReadOnlyList<StockLogDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<StockLogDto>>> GetLogs(
        Guid id, [FromQuery] int take, CancellationToken ct)
        => Ok(await _stock.GetLogsAsync(id, take, ct));

    /// <summary>Deletes an ingredient. Refused while a recipe still references it.</summary>
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await _ingredients.DeleteAsync(id, ct);

        return NoContent();
    }
}
