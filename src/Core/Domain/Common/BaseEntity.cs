namespace Domain.Common;

/// <summary>
/// Base for every persisted entity. Ids are client-generated Guids so an entity graph
/// can be built before it ever reaches the database.
/// </summary>
public abstract class BaseEntity
{
    public Guid Id { get; protected set; } = Guid.NewGuid();

    public override bool Equals(object? obj)
        => obj is BaseEntity other && other.GetType() == GetType() && other.Id == Id && Id != Guid.Empty;

    public override int GetHashCode() => HashCode.Combine(GetType(), Id);
}
