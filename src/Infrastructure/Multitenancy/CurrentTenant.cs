using Application.Common.Interfaces;

namespace Infrastructure.Multitenancy;

/// <summary>
/// Scoped holder for the tenant resolved by <see cref="TenantMiddleware"/>.
/// Registered per request/scope, so background jobs and seeding can set it explicitly too.
/// </summary>
public sealed class CurrentTenant : ICurrentTenant
{
    public Guid? TenantId { get; private set; }

    public string? Slug { get; private set; }

    public bool IsResolved => TenantId.HasValue;

    public Guid TenantIdOrEmpty => TenantId ?? Guid.Empty;

    public void Set(Guid tenantId, string slug)
    {
        if (tenantId == Guid.Empty)
            throw new ArgumentException("Tenant id cannot be empty.", nameof(tenantId));

        // Re-resolving mid-scope would silently change what already-tracked entities belong to.
        if (IsResolved && TenantId != tenantId)
            throw new InvalidOperationException("The tenant context has already been set for this scope.");

        TenantId = tenantId;
        Slug = slug;
    }
}
