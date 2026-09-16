namespace Application.Common.Interfaces;

/// <summary>Resolved tenant identity, cached by the infrastructure implementation.</summary>
public sealed record TenantIdentity(Guid Id, string Slug, string Currency);

/// <summary>
/// Looks tenants up outside the global query filter — the middleware needs this before a
/// tenant context exists.
/// </summary>
public interface ITenantLookup
{
    Task<TenantIdentity?> FindByIdAsync(Guid tenantId, CancellationToken cancellationToken = default);

    Task<TenantIdentity?> FindBySlugAsync(string slug, CancellationToken cancellationToken = default);
}
