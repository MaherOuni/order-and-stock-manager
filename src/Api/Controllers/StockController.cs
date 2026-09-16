using Application.Features.Inventory;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>
/// Order-facing inventory operations: what an order would consume, whether it can be fulfilled,
/// and the deduction itself.
/// </summary>
[ApiController]
[Route("api/v1/stock")]
[Produces("application/json")]
public sealed class StockController : ControllerBase
{
    private readonly IStockService _stock;

    public StockController(IStockService stock) => _stock = stock;

    /// <summary>
    /// Checks whether every ingredient needed by the requested products is in stock in
    /// sufficient quantity. Read-only — it reports, it does not reserve.
    /// </summary>
    /// <remarks>
    /// Always returns 200. Read <c>isAvailable</c>: when false, <c>shortages</c> names each
    /// ingredient that falls short, by how much, and which products it blocks.
    ///
    /// Sample request:
    ///
    ///     POST /api/v1/stock/availability
    ///     X-Tenant-Id: demo-resto
    ///     [
    ///       { "productId": "0f8d…", "quantity": 3 }
    ///     ]
    /// </remarks>
    [HttpPost("availability")]
    [ProducesResponseType(typeof(StockAvailabilityResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<StockAvailabilityResult>> CheckAvailability(
        List<OrderItemDto> items, CancellationToken ct)
        => Ok(await _stock.CheckStockAvailabilityAsync(items, ct));

    /// <summary>What the given order lines consume, aggregated per ingredient.</summary>
    [HttpPost("requirements")]
    [ProducesResponseType(typeof(IReadOnlyList<IngredientRequirementDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<IngredientRequirementDto>>> GetRequirements(
        List<OrderItemDto> items, CancellationToken ct)
        => Ok(await _stock.GetRequirementsAsync(items, ct));

    /// <summary>
    /// Deducts the order's ingredients from stock, all-or-nothing, and writes one ledger line
    /// per ingredient. This is the operation order creation will call.
    /// </summary>
    /// <remarks>
    /// Runs in a ReadCommitted transaction that locks the ingredient rows before checking them,
    /// so two concurrent orders cannot both deduct the last portion.
    /// </remarks>
    /// <response code="409">
    /// Stock is insufficient. Nothing was deducted; the problem document's <c>shortages</c>
    /// extension lists what is missing.
    /// </response>
    [HttpPost("deduct")]
    [ProducesResponseType(typeof(StockDeductionResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<StockDeductionResult>> Deduct(
        List<OrderItemDto> items, CancellationToken ct)
        => Ok(await _stock.DeductForOrderAsync(items, orderId: null, ct));

    /// <summary>The tenant's stock ledger, newest first.</summary>
    /// <param name="ingredientId">Optional filter.</param>
    /// <param name="take">Page size; defaults to 100, capped at 500.</param>
    [HttpGet("logs")]
    [ProducesResponseType(typeof(IReadOnlyList<StockLogDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<StockLogDto>>> GetLogs(
        [FromQuery] Guid? ingredientId,
        [FromQuery] int take,
        CancellationToken ct)
        => Ok(await _stock.GetLogsAsync(ingredientId, take, ct));
}
