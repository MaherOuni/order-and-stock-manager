using Domain.Common;
using Domain.Exceptions;

namespace Domain.Entities;

/// <summary>A sellable menu item. Its recipe drives the stock deductions when it is ordered.</summary>
public class Product : TenantEntity
{
    public const int NameMaxLength = 200;
    public const int DescriptionMaxLength = 1000;
    public const int ImageUrlMaxLength = 2048;

    private readonly List<RecipeItem> _recipeItems = new();

    private Product() => Name = null!;

    public Product(
        Guid categoryId,
        string name,
        decimal price,
        string? description = null,
        bool isActive = true,
        string? imageUrl = null)
    {
        MoveToCategory(categoryId);
        Rename(name);
        ChangePrice(price);
        UpdateDescription(description);
        SetImageUrl(imageUrl);
        IsActive = isActive;
    }

    public Guid CategoryId { get; private set; }

    public Category? Category { get; private set; }

    public string Name { get; private set; }

    public string? Description { get; private set; }

    /// <summary>Menu price in the tenant's currency. decimal(10,2) in PostgreSQL.</summary>
    public decimal Price { get; private set; }

    /// <summary>Photo shown on the QR menu. Absolute http(s) URL, or a path on this host.</summary>
    public string? ImageUrl { get; private set; }

    /// <summary>Inactive products stay in history but disappear from the QR menu.</summary>
    public bool IsActive { get; private set; }

    /// <summary>The bill of materials consumed from stock for one unit sold.</summary>
    public IReadOnlyCollection<RecipeItem> RecipeItems => _recipeItems.AsReadOnly();

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("Product name is required.");
        if (name.Length > NameMaxLength)
            throw new DomainException($"Product name cannot exceed {NameMaxLength} characters.");

        Name = name.Trim();
    }

    public void ChangePrice(decimal price)
    {
        if (price < 0)
            throw new DomainException("Price cannot be negative.");

        Price = decimal.Round(price, 2, MidpointRounding.AwayFromZero);
    }

    public void UpdateDescription(string? description)
    {
        if (description is { Length: > DescriptionMaxLength })
            throw new DomainException($"Description cannot exceed {DescriptionMaxLength} characters.");

        Description = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
    }

    /// <summary>
    /// Sets the menu photo. Only http(s) and host-relative paths are accepted: the value ends
    /// up in an <c>img src</c> on a customer's phone, and this is the cheapest place to keep
    /// odd schemes out of it.
    /// </summary>
    public void SetImageUrl(string? imageUrl)
    {
        if (string.IsNullOrWhiteSpace(imageUrl))
        {
            ImageUrl = null;
            return;
        }

        var trimmed = imageUrl.Trim();

        if (trimmed.Length > ImageUrlMaxLength)
            throw new DomainException($"Image URL cannot exceed {ImageUrlMaxLength} characters.");

        var isRelative = trimmed.StartsWith('/');
        var isHttp = Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) &&
                     (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);

        if (!isRelative && !isHttp)
            throw new DomainException("Image URL must be an http(s) URL or start with '/'.");

        ImageUrl = trimmed;
    }

    public void MoveToCategory(Guid categoryId)
    {
        if (categoryId == Guid.Empty)
            throw new DomainException("A product must belong to a category.");

        CategoryId = categoryId;
    }

    public void Activate() => IsActive = true;

    public void Deactivate() => IsActive = false;
}
