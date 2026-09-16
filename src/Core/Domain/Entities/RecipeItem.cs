using Domain.Common;
using Domain.Exceptions;

namespace Domain.Entities;

/// <summary>
/// One line of a product's bill of materials: how much of an ingredient a single unit consumes,
/// expressed in that ingredient's own unit of measure.
/// </summary>
public class RecipeItem : TenantEntity
{
    private RecipeItem() { }

    public RecipeItem(Guid productId, Guid ingredientId, decimal quantityRequired)
    {
        if (productId == Guid.Empty)
            throw new DomainException("Recipe item requires a product.");
        if (ingredientId == Guid.Empty)
            throw new DomainException("Recipe item requires an ingredient.");

        ProductId = productId;
        IngredientId = ingredientId;
        ChangeQuantity(quantityRequired);
    }

    public Guid ProductId { get; private set; }

    public Product? Product { get; private set; }

    public Guid IngredientId { get; private set; }

    public Ingredient? Ingredient { get; private set; }

    public decimal QuantityRequired { get; private set; }

    public void ChangeQuantity(decimal quantityRequired)
    {
        if (quantityRequired <= 0)
            throw new DomainException("Required quantity must be greater than zero.");

        QuantityRequired = decimal.Round(quantityRequired, 4, MidpointRounding.AwayFromZero);
    }
}
