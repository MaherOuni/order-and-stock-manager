using Domain.Common;
using Domain.Exceptions;

namespace Domain.Entities;

/// <summary>A menu section ("Starters", "Drinks") owned by a single tenant.</summary>
public class Category : TenantEntity
{
    public const int NameMaxLength = 150;

    private readonly List<Product> _products = new();

    private Category() => Name = null!;

    public Category(string name, int sortOrder = 0)
    {
        Rename(name);
        Reorder(sortOrder);
    }

    public string Name { get; private set; }

    /// <summary>Ascending display order on the QR menu.</summary>
    public int SortOrder { get; private set; }

    public IReadOnlyCollection<Product> Products => _products.AsReadOnly();

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("Category name is required.");
        if (name.Length > NameMaxLength)
            throw new DomainException($"Category name cannot exceed {NameMaxLength} characters.");

        Name = name.Trim();
    }

    public void Reorder(int sortOrder)
    {
        if (sortOrder < 0)
            throw new DomainException("Sort order cannot be negative.");

        SortOrder = sortOrder;
    }
}
