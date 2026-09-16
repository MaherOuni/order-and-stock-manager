namespace Domain.Enums;

/// <summary>
/// Why an ingredient's stock moved. Persisted as text so the ledger stays readable in SQL
/// and adding a reason never renumbers existing rows.
/// </summary>
public enum StockChangeReason
{
    /// <summary>Goods-in from a supplier.</summary>
    Delivery = 0,

    /// <summary>Thrown away: spillage, prep errors, over-production.</summary>
    Waste = 1,

    /// <summary>Expired or otherwise unusable.</summary>
    Spoilage = 2,

    /// <summary>Correction after a physical count.</summary>
    InventoryCount = 3,

    /// <summary>Deducted because an order consumed it through a recipe.</summary>
    OrderConsumption = 4,

    /// <summary>Returned to stock because an order was cancelled or refunded.</summary>
    OrderCancellation = 5,

    /// <summary>Anything else; use the note to say what.</summary>
    Manual = 6
}
