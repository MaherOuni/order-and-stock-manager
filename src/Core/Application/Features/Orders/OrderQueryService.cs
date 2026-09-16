using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Application.Common.Tenancy;
using Domain.Entities;
using Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Orders;

public interface IOrderQueryService
{
    /// <summary>The admin board: a tenant's orders, newest first, optionally one status only.</summary>
    Task<IReadOnlyList<OrderDto>> GetForTenantAsync(
        Guid tenantId, OrderStatus? status, int take, CancellationToken ct = default);

    /// <summary>
    /// A single order. <paramref name="tenantSlug"/> stands in for the tenant header so a
    /// customer can follow the <c>Location</c> of the order they just placed.
    /// </summary>
    Task<OrderDto> GetByIdAsync(Guid orderId, string? tenantSlug, CancellationToken ct = default);
}

/// <summary>Read side of the order engine. No writes, no transactions.</summary>
public sealed class OrderQueryService : IOrderQueryService
{
    private const int DefaultPageSize = 100;
    private const int MaxPageSize = 500;

    private readonly IApplicationDbContext _db;
    private readonly ICurrentTenant _currentTenant;
    private readonly ITenantBinder _tenantBinder;

    public OrderQueryService(IApplicationDbContext db, ICurrentTenant currentTenant, ITenantBinder tenantBinder)
    {
        _db = db;
        _currentTenant = currentTenant;
        _tenantBinder = tenantBinder;
    }

    public async Task<IReadOnlyList<OrderDto>> GetForTenantAsync(
        Guid tenantId, OrderStatus? status, int take, CancellationToken ct = default)
    {
        // The tenant is named in the route here, so bind from it rather than from the header.
        // A mismatch with an already-bound header tenant is rejected by the binder.
        await _tenantBinder.BindByIdAsync(tenantId, ct);

        var query = _db.Orders.AsNoTracking();

        if (status is { } wanted)
            query = query.Where(o => o.Status == wanted);

        var orders = await query
            .Include(o => o.Items)
            .ThenInclude(i => i.Product)
            .OrderByDescending(o => o.CreatedAt)
            .ThenByDescending(o => o.Id)
            .Take(PageSize(take))
            .ToListAsync(ct);

        return orders.Select(OrderMapper.ToDto).ToList();
    }

    public async Task<OrderDto> GetByIdAsync(Guid orderId, string? tenantSlug, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(tenantSlug))
            await _tenantBinder.BindBySlugAsync(tenantSlug, ct);

        if (!_currentTenant.IsResolved)
            throw new TenantResolutionException(
                "Identify the restaurant with the X-Tenant-Id header or a 'tenantSlug' query parameter.");

        var order = await _db.Orders
                        .AsNoTracking()
                        .Include(o => o.Items)
                        .ThenInclude(i => i.Product)
                        .FirstOrDefaultAsync(o => o.Id == orderId, ct)
                    ?? throw new NotFoundException(nameof(Order), orderId);

        return OrderMapper.ToDto(order);
    }

    private static int PageSize(int take) => take switch
    {
        <= 0 => DefaultPageSize,
        > MaxPageSize => MaxPageSize,
        _ => take
    };

}
