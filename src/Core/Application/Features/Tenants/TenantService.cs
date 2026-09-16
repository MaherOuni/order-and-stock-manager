using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Domain.Entities;
using Domain.ValueObjects;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Tenants;

/// <summary>
/// Tenant provisioning. This is the one service that operates outside a tenant context —
/// it is what creates the context other requests resolve against.
/// </summary>
public interface ITenantService
{
    Task<IReadOnlyList<TenantDto>> GetAllAsync(CancellationToken ct = default);
    Task<TenantDto> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<TenantDto> GetBySlugAsync(string slug, CancellationToken ct = default);
    Task<TenantDto> CreateAsync(CreateTenantRequest request, CancellationToken ct = default);
    Task<TenantDto> UpdateAsync(Guid id, UpdateTenantRequest request, CancellationToken ct = default);
}

public sealed class TenantService : ITenantService
{
    private readonly IApplicationDbContext _db;

    public TenantService(IApplicationDbContext db) => _db = db;

    public async Task<IReadOnlyList<TenantDto>> GetAllAsync(CancellationToken ct = default)
    {
        // Materialised before mapping: Slug is a value object behind a converter, so
        // t.Slug.Value cannot be translated inside the SQL projection.
        var tenants = await _db.Tenants.AsNoTracking().OrderBy(t => t.Name).ToListAsync(ct);

        return tenants.Select(Map).ToList();
    }

    public async Task<TenantDto> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id, ct)
                     ?? throw new NotFoundException(nameof(Tenant), id);

        return Map(tenant);
    }

    public async Task<TenantDto> GetBySlugAsync(string slug, CancellationToken ct = default)
    {
        var normalized = Slug.From(slug);
        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Slug == normalized, ct)
                     ?? throw new NotFoundException(nameof(Tenant), slug);

        return Map(tenant);
    }

    public async Task<TenantDto> CreateAsync(CreateTenantRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            throw new ValidationException(nameof(request.Name), "Tenant name is required.");

        var slug = string.IsNullOrWhiteSpace(request.Slug)
            ? Slug.FromName(request.Name)
            : Slug.From(request.Slug);

        if (await _db.Tenants.AnyAsync(t => t.Slug == slug, ct))
            throw new ConflictException($"Slug '{slug}' is already taken.");

        var tenant = new Tenant(request.Name, slug, request.Currency);

        _db.Tenants.Add(tenant);
        await _db.SaveChangesAsync(ct);

        return Map(tenant);
    }

    public async Task<TenantDto> UpdateAsync(Guid id, UpdateTenantRequest request, CancellationToken ct = default)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == id, ct)
                     ?? throw new NotFoundException(nameof(Tenant), id);

        // The slug is intentionally immutable: printed QR codes point at it.
        tenant.Rename(request.Name);
        tenant.ChangeCurrency(request.Currency);

        await _db.SaveChangesAsync(ct);

        return Map(tenant);
    }

    private static TenantDto Map(Tenant t) => new(t.Id, t.Name, t.Slug.Value, t.Currency, t.CreatedAt);
}
