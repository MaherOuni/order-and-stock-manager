using System.Data;
using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Application.Common.Tenancy;
using Application.Features.Inventory;
using Domain.Entities;
using Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Orders;

public interface ICancelOrderCommandHandler
{
    Task<OrderDto> HandleAsync(
        Guid orderId,
        CancelOrderRequest request,
        string? tenantSlug,
        CancellationToken ct = default);
}

/// <summary>
/// Calls an order off and puts its ingredients back.
///
/// This is the half of cancellation that was missing for a long time, and the reason it was:
/// marking an order cancelled is trivial, but if its stock was already deducted then failing to
/// return it makes the inventory quietly wrong. Both happen in one transaction or neither does.
/// </summary>
public sealed class CancelOrderCommandHandler : ICancelOrderCommandHandler
{
    private readonly IApplicationDbContext _db;
    private readonly IStockService _stock;
    private readonly ICurrentTenant _currentTenant;
    private readonly ITenantBinder _tenantBinder;

    public CancelOrderCommandHandler(
        IApplicationDbContext db,
        IStockService stock,
        ICurrentTenant currentTenant,
        ITenantBinder tenantBinder)
    {
        _db = db;
        _stock = stock;
        _currentTenant = currentTenant;
        _tenantBinder = tenantBinder;
    }

    public async Task<OrderDto> HandleAsync(
        Guid orderId,
        CancelOrderRequest request,
        string? tenantSlug,
        CancellationToken ct = default)
    {
        // A customer cancelling from their phone has a slug, not a header; staff have a header.
        if (!string.IsNullOrWhiteSpace(tenantSlug))
            await _tenantBinder.BindBySlugAsync(tenantSlug, ct);

        if (!_currentTenant.IsResolved)
            throw new TenantResolutionException(
                "Identify the restaurant with the X-Tenant-Id header or a 'tenantSlug' query parameter.");

        await using var transaction = await _db.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);

        var order = await _db.Orders
                        .Include(o => o.Items)
                        .ThenInclude(i => i.Customizations)
                        .Include(o => o.Items)
                        .ThenInclude(i => i.Product)
                        .FirstOrDefaultAsync(o => o.Id == orderId, ct)
                    ?? throw new NotFoundException(nameof(Order), orderId);

        // Throws a DomainException (422) for an order that is already served or cancelled.
        order.Cancel(BuildReason(order, request.Reason));

        if (order.StockDeductedAt is not null)
        {
            await _stock.ReturnForOrderAsync(
                CreateOrderCommandHandler.ToRequirements(order), order.Id, ct);

            order.MarkStockReturned();
        }

        await _db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return OrderMapper.ToDto(order);
    }

    /// <summary>
    /// Money that has already been collected is not refunded here — no gateway integration
    /// reverses a charge — so the reason carries the fact that someone owes one.
    /// </summary>
    private static string? BuildReason(Order order, string? reason)
    {
        var trimmed = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();

        if (order.PaymentStatus != PaymentStatus.Paid) return trimmed;

        const string refund = "Refund owed: this order was already paid for.";

        return trimmed is null ? refund : $"{trimmed} — {refund}";
    }
}
