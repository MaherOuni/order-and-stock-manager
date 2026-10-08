using Application.Features.Tenants;
using Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>
/// System-wide tenant provisioning. Bypassed by the tenant middleware — this is the endpoint
/// that creates the tenants everything else resolves against, so it cannot itself require one.
///
/// Platform-only, with two exceptions: looking a restaurant up by slug is what bootstraps a QR
/// menu, and an Owner may edit their own restaurant.
/// </summary>
[ApiController]
[Route("api/v1/tenants")]
[Authorize(Policy = AuthPolicies.ManagePlatform)]
[Produces("application/json")]
public sealed class TenantsController : ControllerBase
{
    private readonly ITenantService _tenants;

    public TenantsController(ITenantService tenants) => _tenants = tenants;

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<TenantDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<TenantDto>>> GetAll(CancellationToken ct)
        => Ok(await _tenants.GetAllAsync(ct));

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(TenantDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TenantDto>> GetById(Guid id, CancellationToken ct)
        => Ok(await _tenants.GetByIdAsync(id, ct));

    /// <summary>Public: a scanned QR code names a restaurant by slug and nothing else.</summary>
    [AllowAnonymous]
    [HttpGet("by-slug/{slug}")]
    [ProducesResponseType(typeof(TenantDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TenantDto>> GetBySlug(string slug, CancellationToken ct)
        => Ok(await _tenants.GetBySlugAsync(slug, ct));

    [HttpPost]
    [ProducesResponseType(typeof(TenantDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<TenantDto>> Create(CreateTenantRequest request, CancellationToken ct)
    {
        var tenant = await _tenants.CreateAsync(request, ct);

        return CreatedAtAction(nameof(GetById), new { id = tenant.Id }, tenant);
    }

    /// <summary>
    /// Platform admins may edit any restaurant; an Owner may edit their own and no other.
    /// </summary>
    /// <response code="403">An Owner naming a restaurant that is not theirs.</response>
    [Authorize]
    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(TenantDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TenantDto>> Update(Guid id, UpdateTenantRequest request, CancellationToken ct)
    {
        if (!User.IsInRole(AppRoles.PlatformAdmin) && !OwnsTenant(id))
            return Forbid();

        return Ok(await _tenants.UpdateAsync(id, request, ct));
    }

    /// <summary>
    /// Whether the caller is the Owner of this particular restaurant. The tenant comes from the
    /// token's claim — this route bypasses tenant resolution, so there is no ICurrentTenant to
    /// read here, and the header would not be trustworthy anyway.
    /// </summary>
    private bool OwnsTenant(Guid tenantId)
        => User.IsInRole(AppRoles.Owner)
           && Guid.TryParse(User.FindFirst(AppClaims.TenantId)?.Value, out var claimed)
           && claimed == tenantId;
}
