using Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Application.Common.Interfaces;

/// <summary>
/// The Application layer's view of persistence. Every DbSet exposed here is already
/// tenant-filtered by the global query filter on the concrete DbContext.
/// </summary>
public interface IApplicationDbContext
{
    DbSet<Tenant> Tenants { get; }
    DbSet<Category> Categories { get; }
    DbSet<Product> Products { get; }
    DbSet<Ingredient> Ingredients { get; }
    DbSet<RecipeItem> RecipeItems { get; }
    DbSet<StockLog> StockLogs { get; }
    DbSet<Order> Orders { get; }
    DbSet<OrderItem> OrderItems { get; }
    DbSet<OrderItemCustomization> OrderItemCustomizations { get; }
    DbSet<ServiceRequest> ServiceRequests { get; }
    DbSet<OrderReview> OrderReviews { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Explicit transaction scope. Inventory deductions during order creation must run inside
    /// one of these with ReadCommitted isolation (see CLAUDE.md).
    /// </summary>
    /// <summary>
    /// True when a transaction is already open on this context. Lets a service join the
    /// caller's transaction instead of opening a nested one, which EF Core does not allow.
    /// </summary>
    bool HasActiveTransaction { get; }

    Task<IDbContextTransaction> BeginTransactionAsync(
        System.Data.IsolationLevel isolationLevel = System.Data.IsolationLevel.ReadCommitted,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Loads ingredients with <c>SELECT … FOR UPDATE</c>, so two concurrent orders cannot both
    /// read the same stock, both decide it is sufficient, and both deduct it. Call inside a
    /// transaction; the locks are held until it commits.
    /// </summary>
    Task<List<Ingredient>> GetIngredientsForUpdateAsync(
        IReadOnlyCollection<Guid> ingredientIds,
        CancellationToken cancellationToken = default);
}
