namespace Domain.Enums;

/// <summary>
/// Where an order stands. Persisted as text, like <see cref="StockChangeReason"/>, so the
/// value is readable in SQL and adding a status never renumbers existing rows.
/// </summary>
public enum OrderStatus
{
    /// <summary>Placed and paid for in stock: the ingredients are already deducted.</summary>
    Pending = 0,

    /// <summary>Served. Terminal.</summary>
    Completed = 1,

    /// <summary>Called off. Terminal.</summary>
    Cancelled = 2
}
