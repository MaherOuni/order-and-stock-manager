using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Orders;

public interface ICompleteOrderCommandHandler
{
    Task<OrderDto> HandleAsync(Guid orderId, CancellationToken ct = default);
}

/// <summary>
/// Marks a pending order as served — the admin board's one write.
/// </summary>
/// <remarks>
/// No transaction and no stock movement: the ingredients were consumed when the order was
/// created, so completing it only closes the ticket. Cancelling is the case that *would* need
/// to move stock back, which is why it is not here yet.
/// </remarks>
public sealed class CompleteOrderCommandHandler : ICompleteOrderCommandHandler
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentTenant _currentTenant;

    public CompleteOrderCommandHandler(IApplicationDbContext db, ICurrentTenant currentTenant)
    {
        _db = db;
        _currentTenant = currentTenant;
    }

    public async Task<OrderDto> HandleAsync(Guid orderId, CancellationToken ct = default)
    {
        // The order routes are tenant-optional for the customer's sake; this one is not.
        if (!_currentTenant.IsResolved)
            throw new TenantResolutionException(
                "Identify the restaurant with the X-Tenant-Id header.");

        var order = await _db.Orders
                        .Include(o => o.Items)
                        .ThenInclude(i => i.Product)
                        .FirstOrDefaultAsync(o => o.Id == orderId, ct)
                    ?? throw new NotFoundException(nameof(Order), orderId);

        // Throws a DomainException (422) for an order that is already served or cancelled,
        // so a double tap on the board cannot silently reopen anything.
        order.Complete();

        await _db.SaveChangesAsync(ct);

        return OrderMapper.ToDto(order);
    }
}
