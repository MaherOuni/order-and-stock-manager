namespace Domain.Common;

/// <summary>
/// Marks an entity as tenant-scoped. Every table except system-wide ones carries a tenant_id
/// column and is filtered by the global query filter installed on the DbContext.
/// </summary>
public interface ITenantEntity
{
    Guid TenantId { get; set; }
}

/// <summary>
/// Convenience base class for tenant-scoped entities. TenantId is assigned by the persistence
/// layer on insert from the resolved tenant; it is never trusted from client input.
/// </summary>
public abstract class TenantEntity : BaseEntity, ITenantEntity
{
    public Guid TenantId { get; set; }
}
