using Application.Common.Interfaces;
using Domain.Exceptions;
using Domain.ValueObjects;
using Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Infrastructure.Multitenancy;

/// <summary>
/// Resolves tenants for the middleware. Tenants are a system-wide table (no query filter),
/// and results are cached briefly so the lookup does not add a round-trip to every request.
/// </summary>
public sealed class TenantLookup : ITenantLookup
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(5);

    private readonly ApplicationDbContext _db;
    private readonly IMemoryCache _cache;

    public TenantLookup(ApplicationDbContext db, IMemoryCache cache)
    {
        _db = db;
        _cache = cache;
    }

    public Task<TenantIdentity?> FindByIdAsync(Guid tenantId, CancellationToken cancellationToken = default)
        => GetOrAddAsync($"tenant:id:{tenantId}",
            ct => _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct),
            cancellationToken);

    public Task<TenantIdentity?> FindBySlugAsync(string slug, CancellationToken cancellationToken = default)
    {
        Slug parsed;
        try
        {
            parsed = Slug.From(slug);
        }
        catch (DomainException)
        {
            // A malformed slug simply cannot match any tenant.
            return Task.FromResult<TenantIdentity?>(null);
        }

        return GetOrAddAsync($"tenant:slug:{parsed.Value}",
            // Compared as a whole value object: EF pushes it through the converter, so this
            // stays a plain indexed lookup on the slug column.
            ct => _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Slug == parsed, ct),
            cancellationToken);
    }

    private async Task<TenantIdentity?> GetOrAddAsync(
        string cacheKey,
        Func<CancellationToken, Task<Domain.Entities.Tenant?>> load,
        CancellationToken cancellationToken)
    {
        if (_cache.TryGetValue<TenantIdentity>(cacheKey, out var cached))
            return cached;

        var tenant = await load(cancellationToken);
        if (tenant is null) return null;

        var identity = new TenantIdentity(tenant.Id, tenant.Slug.Value, tenant.Currency);

        _cache.Set(cacheKey, identity, CacheDuration);
        _cache.Set($"tenant:id:{identity.Id}", identity, CacheDuration);
        _cache.Set($"tenant:slug:{identity.Slug}", identity, CacheDuration);

        return identity;
    }
}
