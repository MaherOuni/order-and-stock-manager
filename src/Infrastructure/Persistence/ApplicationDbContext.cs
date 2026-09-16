using System.Data;
using System.Reflection;
using Application.Common.Interfaces;
using Domain.Common;
using Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Infrastructure.Persistence;

public class ApplicationDbContext : DbContext, IApplicationDbContext
{
    private readonly ICurrentTenant _currentTenant;

    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options, ICurrentTenant currentTenant)
        : base(options)
        => _currentTenant = currentTenant;

    /// <summary>
    /// The value the global query filter compares against. EF re-reads this property from the
    /// *current* context instance on every query, so the compiled model stays shareable while the
    /// filter still tracks the request's tenant. Unresolved tenant =&gt; Guid.Empty =&gt; no rows.
    /// </summary>
    public Guid CurrentTenantId => _currentTenant.TenantIdOrEmpty;

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Ingredient> Ingredients => Set<Ingredient>();
    public DbSet<RecipeItem> RecipeItems => Set<RecipeItem>();
    public DbSet<StockLog> StockLogs => Set<StockLog>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();
    public DbSet<OrderItemCustomization> OrderItemCustomizations => Set<OrderItemCustomization>();
    public DbSet<ServiceRequest> ServiceRequests => Set<ServiceRequest>();
    public DbSet<OrderReview> OrderReviews => Set<OrderReview>();

    public bool HasActiveTransaction => Database.CurrentTransaction is not null;

    public Task<IDbContextTransaction> BeginTransactionAsync(
        IsolationLevel isolationLevel = IsolationLevel.ReadCommitted,
        CancellationToken cancellationToken = default)
        => Database.BeginTransactionAsync(isolationLevel, cancellationToken);

    /// <summary>
    /// <c>SELECT … FOR UPDATE</c> on the given ingredients. The tenant predicate is written into
    /// the SQL (and the global filter suppressed) because the filter cannot be composed onto a
    /// locking read without wrapping it in a subquery, which changes what actually gets locked.
    /// Ordering by id gives every caller the same lock order, so two concurrent orders queue
    /// instead of deadlocking.
    /// </summary>
    public Task<List<Ingredient>> GetIngredientsForUpdateAsync(
        IReadOnlyCollection<Guid> ingredientIds,
        CancellationToken cancellationToken = default)
    {
        if (ingredientIds.Count == 0)
            return Task.FromResult(new List<Ingredient>());

        if (Database.CurrentTransaction is null)
            throw new InvalidOperationException(
                "GetIngredientsForUpdateAsync must run inside a transaction; row locks are released at commit.");

        var ids = ingredientIds.Distinct().ToArray();
        var tenantId = CurrentTenantId;

        return Ingredients
            .FromSql($"""
                      SELECT * FROM ingredients
                      WHERE tenant_id = {tenantId} AND id = ANY({ids})
                      ORDER BY id
                      FOR UPDATE
                      """)
            .IgnoreQueryFilters()
            .ToListAsync(cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(Assembly.GetExecutingAssembly());

        ApplyTenantQueryFilters(modelBuilder);

        base.OnModelCreating(modelBuilder);
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        StampTenantId();
        return base.SaveChangesAsync(cancellationToken);
    }

    public override int SaveChanges()
    {
        StampTenantId();
        return base.SaveChanges();
    }

    /// <summary>
    /// Installs <c>HasQueryFilter(e =&gt; e.TenantId == CurrentTenantId)</c> on every ITenantEntity,
    /// so a new tenant-scoped entity is covered the moment it is added to the model.
    /// </summary>
    private void ApplyTenantQueryFilters(ModelBuilder modelBuilder)
    {
        var applyMethod = typeof(ApplicationDbContext)
            .GetMethod(nameof(ApplyTenantQueryFilter), BindingFlags.NonPublic | BindingFlags.Instance)!;

        // Materialised: configuring an entity type while enumerating the model is not safe.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes().ToList())
        {
            if (entityType.BaseType is not null) continue;
            if (!typeof(ITenantEntity).IsAssignableFrom(entityType.ClrType)) continue;

            applyMethod.MakeGenericMethod(entityType.ClrType).Invoke(this, new object[] { modelBuilder });
        }
    }

    private void ApplyTenantQueryFilter<TEntity>(ModelBuilder modelBuilder)
        where TEntity : class, ITenantEntity
        => modelBuilder.Entity<TEntity>().HasQueryFilter(e => e.TenantId == CurrentTenantId);

    /// <summary>
    /// Stamps the resolved tenant onto new rows and refuses to let an existing row be moved to
    /// another tenant. Clients never supply a TenantId.
    /// </summary>
    private void StampTenantId()
    {
        var tenantId = _currentTenant.TenantId;

        foreach (var entry in ChangeTracker.Entries<ITenantEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    if (tenantId is null)
                        throw new InvalidOperationException(
                            $"Cannot persist {entry.Entity.GetType().Name}: no tenant has been resolved for this scope.");

                    entry.Entity.TenantId = tenantId.Value;
                    break;

                case EntityState.Modified:
                    // Defence in depth: the query filter already hides other tenants' rows.
                    entry.Property(nameof(ITenantEntity.TenantId)).IsModified = false;
                    break;
            }
        }
    }
}
