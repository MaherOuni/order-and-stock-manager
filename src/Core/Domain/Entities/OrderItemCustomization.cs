using Domain.Common;
using Domain.Exceptions;

namespace Domain.Entities;

/// <summary>Whether the customer wanted an ingredient taken out or put in.</summary>
public enum CustomizationKind
{
    /// <summary>Hold the milk. The ingredient is not deducted for this line.</summary>
    Removed = 0,

    /// <summary>An extra shot. Deducted on top of the recipe.</summary>
    Added = 1
}

/// <summary>
/// One change a customer made to a product's recipe on their line.
///
/// It is stored rather than reduced to free text because it has to be *applied*: a removed
/// ingredient must not leave stock, and an added one must. A kitchen note cannot do that.
/// </summary>
public class OrderItemCustomization : TenantEntity
{
    private OrderItemCustomization() => IngredientName = null!;

    internal OrderItemCustomization(
        Guid orderItemId,
        Guid ingredientId,
        string ingredientName,
        CustomizationKind kind,
        decimal quantityPerUnit)
    {
        if (orderItemId == Guid.Empty)
            throw new DomainException("A customization belongs to an order line.");
        if (ingredientId == Guid.Empty)
            throw new DomainException("A customization must name an ingredient.");
        if (quantityPerUnit <= 0)
            throw new DomainException("Customization quantity must be greater than zero.");

        OrderItemId = orderItemId;
        IngredientId = ingredientId;
        IngredientName = ingredientName;
        Kind = kind;
        QuantityPerUnit = decimal.Round(quantityPerUnit, 4, MidpointRounding.AwayFromZero);
    }

    public Guid OrderItemId { get; private set; }

    public OrderItem? OrderItem { get; private set; }

    public Guid IngredientId { get; private set; }

    /// <summary>
    /// Snapshotted alongside the id: the kitchen ticket has to keep reading "no milk" even if
    /// the ingredient is renamed or deleted later.
    /// </summary>
    public string IngredientName { get; private set; }

    public CustomizationKind Kind { get; private set; }

    /// <summary>How much of it, for one unit of the product. In the ingredient's own unit.</summary>
    public decimal QuantityPerUnit { get; private set; }
}
