using Application.Features.Tenants;
using Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>
/// The restaurant's floor plan, as drawn in the floor planner and rendered by the waiter view.
/// Tenant-scoped like the rest of the admin surface.
/// </summary>
[ApiController]
[Route("api/v1/floor-plan")]
[Authorize(Policy = AuthPolicies.StaffMember)]
[Produces("application/json")]
public sealed class FloorPlanController : ControllerBase
{
    private readonly IFloorPlanService _plans;

    public FloorPlanController(IFloorPlanService plans) => _plans = plans;

    /// <summary>The saved plan.</summary>
    /// <response code="404">Nobody has drawn one yet — a normal state, not a failure.</response>
    [HttpGet]
    [ProducesResponseType(typeof(object), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var json = await _plans.GetAsync(ct);

        // Returned as raw JSON: the API stores the planner's document verbatim rather than
        // re-serialising a model it does not have.
        return json is null ? NotFound() : Content(json, "application/json");
    }

    /// <summary>Replaces the plan with the JSON the floor planner generated.</summary>
    /// <response code="400">Not valid JSON, or not a floor plan.</response>
    [Authorize(Policy = AuthPolicies.ManageRestaurant)]
    [HttpPut]
    [Consumes("application/json")]
    [ProducesResponseType(typeof(object), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Put(CancellationToken ct)
    {
        using var reader = new StreamReader(Request.Body);
        var json = await reader.ReadToEndAsync(ct);

        return Content(await _plans.SaveAsync(json, ct), "application/json");
    }
}
