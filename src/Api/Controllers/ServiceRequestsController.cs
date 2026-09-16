using Application.Features.CustomerCare;
using Domain.Enums;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>
/// "Call the waiter", "the bill please", "we need water".
///
/// Raising one is public — a customer at a table has no credentials — while reading and
/// clearing the queue is a staff action and needs the tenant header.
/// </summary>
[ApiController]
[Route("api/v1/service-requests")]
[Produces("application/json")]
public sealed class ServiceRequestsController : ControllerBase
{
    private readonly IServiceRequestService _requests;

    public ServiceRequestsController(IServiceRequestService requests) => _requests = requests;

    /// <summary>Asks for someone to come over.</summary>
    /// <remarks>
    /// Public: no tenant header, the body names the restaurant by slug.
    ///
    /// Repeated taps within a few minutes return the existing request rather than creating a
    /// second one — an impatient customer is still one table wanting one thing.
    ///
    ///     POST /api/v1/service-requests
    ///     { "tenantSlug": "demo-resto", "tableNumber": "12", "kind": "CallWaiter" }
    /// </remarks>
    [HttpPost]
    [ProducesResponseType(typeof(ServiceRequestDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ServiceRequestDto>> Raise(
        CreateServiceRequestCommand command, CancellationToken ct)
    {
        var request = await _requests.RaiseAsync(command, ct);

        return StatusCode(StatusCodes.Status201Created, request);
    }

    /// <summary>The floor queue, oldest unresolved first. Needs the tenant header.</summary>
    /// <param name="status">Optional: <c>Open</c>, <c>Acknowledged</c> or <c>Resolved</c>.</param>
    /// <param name="take">Page size; defaults to 100, capped at 500.</param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<ServiceRequestDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<IReadOnlyList<ServiceRequestDto>>> GetAll(
        [FromQuery] ServiceRequestStatus? status,
        [FromQuery] int take,
        CancellationToken ct)
        => Ok(await _requests.GetAsync(status, take, ct));

    /// <summary>Someone on the floor has seen it. Idempotent.</summary>
    [HttpPost("{id:guid}/acknowledge")]
    [ProducesResponseType(typeof(ServiceRequestDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ServiceRequestDto>> Acknowledge(Guid id, CancellationToken ct)
        => Ok(await _requests.AcknowledgeAsync(id, ct));

    /// <summary>Dealt with.</summary>
    [HttpPost("{id:guid}/resolve")]
    [ProducesResponseType(typeof(ServiceRequestDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ServiceRequestDto>> Resolve(Guid id, CancellationToken ct)
        => Ok(await _requests.ResolveAsync(id, ct));
}

/// <summary>What customers thought, once their order was served.</summary>
[ApiController]
[Route("api/v1/reviews")]
[Produces("application/json")]
public sealed class ReviewsController : ControllerBase
{
    private readonly IOrderReviewService _reviews;

    public ReviewsController(IOrderReviewService reviews) => _reviews = reviews;

    /// <summary>Every review for the restaurant, newest first. Needs the tenant header.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<OrderReviewDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<IReadOnlyList<OrderReviewDto>>> GetAll(
        [FromQuery] int take, CancellationToken ct)
        => Ok(await _reviews.GetAsync(take, ct));
}
