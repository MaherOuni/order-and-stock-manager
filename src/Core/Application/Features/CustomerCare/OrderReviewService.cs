using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Application.Common.Tenancy;
using Domain.Entities;
using Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.CustomerCare;

public interface IOrderReviewService
{
    /// <summary>Leaves or updates the review for one order. Public: named by slug.</summary>
    Task<OrderReviewDto> SubmitAsync(Guid orderId, SubmitReviewCommand command, CancellationToken ct = default);

    Task<OrderReviewDto?> GetForOrderAsync(Guid orderId, string? tenantSlug, CancellationToken ct = default);

    /// <summary>The staff view, newest first.</summary>
    Task<IReadOnlyList<OrderReviewDto>> GetAsync(int take, CancellationToken ct = default);
}

public sealed class OrderReviewService : IOrderReviewService
{
    private const int DefaultPageSize = 100;
    private const int MaxPageSize = 500;

    private readonly IApplicationDbContext _db;
    private readonly ICurrentTenant _currentTenant;
    private readonly ITenantBinder _tenantBinder;

    public OrderReviewService(
        IApplicationDbContext db,
        ICurrentTenant currentTenant,
        ITenantBinder tenantBinder)
    {
        _db = db;
        _currentTenant = currentTenant;
        _tenantBinder = tenantBinder;
    }

    public async Task<OrderReviewDto> SubmitAsync(
        Guid orderId, SubmitReviewCommand command, CancellationToken ct = default)
    {
        await _tenantBinder.BindBySlugAsync(command.TenantSlug, ct);

        var order = await _db.Orders.FirstOrDefaultAsync(o => o.Id == orderId, ct)
                    ?? throw new NotFoundException(nameof(Order), orderId);

        if (order.Status == OrderStatus.Cancelled)
            throw new ValidationException("rating", "A cancelled order cannot be reviewed.");

        var review = await _db.OrderReviews.FirstOrDefaultAsync(r => r.OrderId == orderId, ct);

        if (review is null)
        {
            // Domain validates the 1–5 range, so an out-of-range rating is a 422 rather than a
            // check-constraint violation surfacing as a 500.
            review = new OrderReview(orderId, command.Rating, command.Comment);
            _db.OrderReviews.Add(review);
        }
        else
        {
            // One review per order: changing your mind edits it rather than stacking a second.
            review.Update(command.Rating, command.Comment);
        }

        await _db.SaveChangesAsync(ct);

        return Map(review);
    }

    public async Task<OrderReviewDto?> GetForOrderAsync(
        Guid orderId, string? tenantSlug, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(tenantSlug))
            await _tenantBinder.BindBySlugAsync(tenantSlug, ct);

        RequireTenant();

        var review = await _db.OrderReviews
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.OrderId == orderId, ct);

        return review is null ? null : Map(review);
    }

    public async Task<IReadOnlyList<OrderReviewDto>> GetAsync(int take, CancellationToken ct = default)
    {
        RequireTenant();

        var reviews = await _db.OrderReviews
            .AsNoTracking()
            .OrderByDescending(r => r.CreatedAt)
            .Take(take switch { <= 0 => DefaultPageSize, > MaxPageSize => MaxPageSize, _ => take })
            .ToListAsync(ct);

        return reviews.Select(Map).ToList();
    }

    private void RequireTenant()
    {
        if (!_currentTenant.IsResolved)
            throw new TenantResolutionException(
                "Identify the restaurant with the X-Tenant-Id header or a 'tenantSlug' query parameter.");
    }

    private static OrderReviewDto Map(OrderReview review) => new(
        review.Id,
        review.OrderId,
        review.Rating,
        review.Comment,
        review.CreatedAt,
        review.UpdatedAt);
}
