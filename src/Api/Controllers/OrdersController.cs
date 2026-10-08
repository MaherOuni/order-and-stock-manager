using Application.Features.CustomerCare;
using Application.Features.Inventory;
using Application.Features.Orders;
using Domain.Enums;
using Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>
/// The QR order engine. Placing an order is public — the customer scans a code, so the
/// restaurant is named in the request rather than in an <c>X-Tenant-Id</c> header.
/// </summary>
[ApiController]
[Route("api/v1/orders")]
[Authorize(Policy = AuthPolicies.StaffMember)]
[Produces("application/json")]
public sealed class OrdersController : ControllerBase
{
    private readonly ICreateOrderCommandHandler _createOrder;
    private readonly ICompleteOrderCommandHandler _completeOrder;
    private readonly ICancelOrderCommandHandler _cancelOrder;
    private readonly IOrderReviewService _reviews;
    private readonly IOrderQueryService _orders;

    public OrdersController(
        ICreateOrderCommandHandler createOrder,
        ICompleteOrderCommandHandler completeOrder,
        ICancelOrderCommandHandler cancelOrder,
        IOrderReviewService reviews,
        IOrderQueryService orders)
    {
        _createOrder = createOrder;
        _completeOrder = completeOrder;
        _cancelOrder = cancelOrder;
        _reviews = reviews;
        _orders = orders;
    }

    /// <summary>Places an order from a table and deducts everything it consumes from stock.</summary>
    /// <remarks>
    /// Public: no tenant header needed, the body names the restaurant by slug. Prices are read
    /// off the menu — anything the client sends for them is ignored.
    ///
    /// The whole thing is one ReadCommitted transaction: the order, its lines and one stock
    /// ledger line per ingredient either all commit or none do. The ingredient rows are locked
    /// (<c>SELECT … FOR UPDATE</c>) before the stock check, so two tables ordering the last
    /// portion at the same time cannot both get it.
    ///
    /// Sample request:
    ///
    ///     POST /api/v1/orders
    ///     {
    ///       "tenantSlug": "demo-resto",
    ///       "tableNumber": "12",
    ///       "items": [
    ///         { "productId": "0f8d…", "quantity": 2 }
    ///       ]
    ///     }
    /// </remarks>
    /// <response code="201">The order, with its priced lines and total.</response>
    /// <response code="400">
    /// The basket is invalid, or stock is insufficient. Nothing was written; when stock is the
    /// cause, the problem document's <c>shortages</c> extension names every ingredient that
    /// fell short, by how much, and which products it blocks.
    /// </response>
    /// <response code="404">The slug matches no restaurant, or a product is not on its menu.</response>
    [AllowAnonymous]
    [HttpPost]
    [ProducesResponseType(typeof(OrderDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderDto>> Create(CreateOrderCommand command, CancellationToken ct)
    {
        try
        {
            var order = await _createOrder.HandleAsync(command, ct);

            return CreatedAtAction(
                nameof(GetById),
                new { id = order.Id, tenantSlug = command.TenantSlug },
                order);
        }
        catch (InsufficientStockException ex)
        {
            // Deliberately 400 here, while POST /api/v1/stock/deduct keeps its 409: to a
            // customer at a table an unfulfillable basket is a bad request, not a race to retry.
            var problem = new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Insufficient stock",
                Detail = ex.Message,
                Type = "https://httpstatuses.io/400"
            };

            problem.Extensions["traceId"] = HttpContext.TraceIdentifier;
            problem.Extensions["shortages"] = ex.Shortages;

            return new ObjectResult(problem)
            {
                StatusCode = StatusCodes.Status400BadRequest,
                ContentTypes = { "application/problem+json" }
            };
        }
    }

    /// <summary>Every order of one restaurant, newest first — the kitchen/admin board.</summary>
    /// <param name="tenantId">The restaurant.</param>
    /// <param name="status">Optional filter: <c>Pending</c>, <c>Completed</c> or <c>Cancelled</c>.</param>
    /// <param name="take">Page size; defaults to 100, capped at 500.</param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet("tenant/{tenantId:guid}")]
    [ProducesResponseType(typeof(IReadOnlyList<OrderDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<OrderDto>>> GetForTenant(
        Guid tenantId,
        [FromQuery] OrderStatus? status,
        [FromQuery] int take,
        CancellationToken ct)
        => Ok(await _orders.GetForTenantAsync(tenantId, status, take, ct));

    /// <summary>Marks a pending order as served. The admin board's one write.</summary>
    /// <remarks>
    /// Needs the <c>X-Tenant-Id</c> header: unlike placing an order, this is a staff action and
    /// the request carries no tenant of its own.
    ///
    /// Stock is not touched — the ingredients were deducted when the order was placed.
    /// </remarks>
    /// <param name="id">The order.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <response code="422">The order is already completed or cancelled.</response>
    [HttpPost("{id:guid}/complete")]
    [ProducesResponseType(typeof(OrderDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<OrderDto>> Complete(Guid id, CancellationToken ct)
        => Ok(await _completeOrder.HandleAsync(id, ct));

    /// <summary>Calls an order off and puts its ingredients back.</summary>
    /// <remarks>
    /// Usable by the customer (pass <c>tenantSlug</c>) or by staff (send the tenant header).
    ///
    /// If the order's stock was already deducted — a cash order, or a digital one whose payment
    /// landed — the ingredients are returned in the same transaction, with a ledger line each.
    /// Money already collected is *not* refunded here; the cancellation reason records that
    /// someone owes one.
    /// </remarks>
    /// <param name="id">The order.</param>
    /// <param name="request">An optional reason, shown on the admin board.</param>
    /// <param name="tenantSlug">Stands in for the tenant header, for a customer's phone.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <response code="422">The order is already served or already cancelled.</response>
    [AllowAnonymous]
    [HttpPost("{id:guid}/cancel")]
    [ProducesResponseType(typeof(OrderDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<OrderDto>> Cancel(
        Guid id,
        CancelOrderRequest request,
        [FromQuery] string? tenantSlug,
        CancellationToken ct)
        => Ok(await _cancelOrder.HandleAsync(id, request, tenantSlug, ct));

    /// <summary>Leaves a rating for an order, or edits the one already left.</summary>
    /// <remarks>Public: the body names the restaurant by slug, as placing the order did.</remarks>
    /// <response code="422">The rating is outside 1–5.</response>
    [AllowAnonymous]
    [HttpPost("{id:guid}/review")]
    [ProducesResponseType(typeof(OrderReviewDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<ActionResult<OrderReviewDto>> Review(
        Guid id, SubmitReviewCommand command, CancellationToken ct)
        => Ok(await _reviews.SubmitAsync(id, command, ct));

    /// <summary>The review left for an order, if there is one.</summary>
    [AllowAnonymous]
    [HttpGet("{id:guid}/review")]
    [ProducesResponseType(typeof(OrderReviewDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderReviewDto>> GetReview(
        Guid id, [FromQuery] string? tenantSlug, CancellationToken ct)
    {
        var review = await _reviews.GetForOrderAsync(id, tenantSlug, ct);

        return review is null ? NotFound() : Ok(review);
    }

    /// <summary>One order.</summary>
    /// <param name="id">The order.</param>
    /// <param name="tenantSlug">
    /// Stands in for the tenant header, so the customer who just ordered can follow the
    /// <c>Location</c> they were given.
    /// </param>
    /// <param name="ct">Cancellation token.</param>
    [AllowAnonymous]
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(OrderDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderDto>> GetById(
        Guid id,
        [FromQuery] string? tenantSlug,
        CancellationToken ct)
        => Ok(await _orders.GetByIdAsync(id, tenantSlug, ct));
}
