using Application.Features.Tenants;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

/// <summary>
/// System-wide tenant provisioning. Bypassed by the tenant middleware — this is the endpoint
/// that creates the tenants everything else resolves against. Put it behind an admin
/// authorization policy before going to production.
/// </summary>
[ApiController]
[Route("api/v1/tenants")]
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

    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(TenantDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TenantDto>> Update(Guid id, UpdateTenantRequest request, CancellationToken ct)
        => Ok(await _tenants.UpdateAsync(id, request, ct));
}
