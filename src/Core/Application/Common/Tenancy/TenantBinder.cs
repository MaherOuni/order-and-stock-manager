using Application.Common.Exceptions;
using Application.Common.Interfaces;

namespace Application.Common.Tenancy;

/// <summary>
/// Binds the tenant context from a value carried in the request itself rather than in the
/// <c>X-Tenant-Id</c> header — the QR menu posts a slug in the body, and the admin order view
/// puts the tenant id in the route.
/// </summary>
public interface ITenantBinder
{
    Task<TenantIdentity> BindBySlugAsync(string slug, CancellationToken ct = default);

    Task<TenantIdentity> BindByIdAsync(Guid tenantId, CancellationToken ct = default);
}

public sealed class TenantBinder : ITenantBinder
{
    private readonly ICurrentTenant _currentTenant;
    private readonly ITenantLookup _lookup;

    public TenantBinder(ICurrentTenant currentTenant, ITenantLookup lookup)
    {
        _currentTenant = currentTenant;
        _lookup = lookup;
    }

    public async Task<TenantIdentity> BindBySlugAsync(string slug, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(slug))
            throw new ValidationException("tenantSlug", "A tenant slug is required.");

        var identity = await _lookup.FindBySlugAsync(slug.Trim(), ct)
                       ?? throw new NotFoundException($"No tenant matches '{slug}'.");

        return Bind(identity);
    }

    public async Task<TenantIdentity> BindByIdAsync(Guid tenantId, CancellationToken ct = default)
    {
        if (tenantId == Guid.Empty)
            throw new ValidationException("tenantId", "A tenant id is required.");

        var identity = await _lookup.FindByIdAsync(tenantId, ct)
                       ?? throw new NotFoundException($"No tenant matches '{tenantId}'.");

        return Bind(identity);
    }

    private TenantIdentity Bind(TenantIdentity identity)
    {
        // The middleware may already have bound a tenant from the header. Silently switching
        // would let a request read one tenant and write to another, so refuse instead.
        if (_currentTenant.IsResolved)
        {
            if (_currentTenant.TenantId != identity.Id)
                throw new ValidationException(
                    "tenant",
                    $"This request is already scoped to tenant '{_currentTenant.Slug}'; it cannot also address '{identity.Slug}'.");

            return identity;
        }

        _currentTenant.Set(identity.Id, identity.Slug);

        return identity;
    }
}
