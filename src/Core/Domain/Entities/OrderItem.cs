using Domain.Common;
using Domain.Exceptions;

namespace Domain.Entities;

/// <summary>
/// One line of an order. <see cref="UnitPrice"/> is a snapshot taken when the order was placed:
/// re-pricing the menu tomorrow must not rewrite what a customer was charged today.
/// </summary>
public class OrderItem : TenantEntity
{
    public const int NotesMaxLength = 300;

    private readonly List<OrderItemCustomization> _customizations = new();

    private OrderItem() { }

    internal OrderItem(Guid orderId, Guid productId, int quantity, decimal unitPrice, string? notes = null)
    {
        if (orderId == Guid.Empty)
            throw new DomainException("Order item requires an order.");
        if (productId == Guid.Empty)
            throw new DomainException("Order item requires a product.");
        if (quantity <= 0)
            throw new DomainException("Order item quantity must be greater than zero.");
        if (unitPrice < 0)
            throw new DomainException("Unit price cannot be negative.");
        if (notes is { Length: > NotesMaxLength })
            throw new DomainException($"Item notes cannot exceed {NotesMaxLength} characters.");

        OrderId = orderId;
        ProductId = productId;
        Quantity = quantity;
        UnitPrice = decimal.Round(unitPrice, 2, MidpointRounding.AwayFromZero);
        Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
    }

    public Guid OrderId { get; private set; }

    public Order? Order { get; private set; }

    public Guid ProductId { get; private set; }

    public Product? Product { get; private set; }

    public int Quantity { get; private set; }

    /// <summary>Price per unit at the moment of ordering. decimal(10,2).</summary>
    public decimal UnitPrice { get; private set; }

    /// <summary>"Extra hot", "no straw" — a preference the kitchen reads but stock ignores.</summary>
    public string? Notes { get; private set; }

    /// <summary>
    /// Ingredients added to or removed from this line. Unlike <see cref="Notes"/> these change
    /// what leaves stock.
    /// </summary>
    public IReadOnlyCollection<OrderItemCustomization> Customizations => _customizations.AsReadOnly();

    /// <summary>Derived, never stored — the stored total lives on the order.</summary>
    public decimal LineTotal => decimal.Round(UnitPrice * Quantity, 2, MidpointRounding.AwayFromZero);

    /// <summary>The same figure in millimes, which is what the order totals and gateways use.</summary>
    public long LineTotalMillimes => Millimes.FromAmount(LineTotal);

    /// <summary>
    /// Records a change to the recipe for this line. Adding an ingredient is currently free —
    /// there is no modifier pricing on the menu — but it is still deducted from stock, because
    /// the shelf does not care what was charged.
    /// </summary>
    public OrderItemCustomization Customize(
        Guid ingredientId,
        string ingredientName,
        CustomizationKind kind,
        decimal quantityPerUnit)
    {
        if (_customizations.Any(c => c.IngredientId == ingredientId))
            throw new DomainException(
                $"'{ingredientName}' has already been customised on this line.");

        var customization = new OrderItemCustomization(
            Id, ingredientId, ingredientName, kind, quantityPerUnit);

        _customizations.Add(customization);

        return customization;
    }
}
