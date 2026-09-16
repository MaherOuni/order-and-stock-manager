namespace Application.Common.Interfaces;

/// <summary>
/// Ambient, request-scoped tenant context. Populated once by the TenantMiddleware and read by
/// the DbContext global query filter and by the TenantId stamping on insert.
/// </summary>
public interface ICurrentTenant
{
    Guid? TenantId { get; }

    string? Slug { get; }

    bool IsResolved { get; }

    /// <summary>Tenant id or <see cref="Guid.Empty"/> — the value baked into the query filter.</summary>
    Guid TenantIdOrEmpty { get; }

    /// <summary>Called by the middleware (or seeding/background jobs) exactly once per scope.</summary>
    void Set(Guid tenantId, string slug);
}
