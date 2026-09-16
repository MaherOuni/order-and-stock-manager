namespace Application.Features.Inventory;

/// <summary>
/// Raised when an order cannot be fulfilled from current stock. Carries the exact shortfall so
/// the caller can tell the customer which item ran out rather than "something went wrong".
/// Maps to HTTP 409 with a "shortages" extension on the problem document.
/// </summary>
public class InsufficientStockException : Exception
{
    public InsufficientStockException(IReadOnlyList<StockShortageDto> shortages)
        : base(BuildMessage(shortages))
        => Shortages = shortages;

    public IReadOnlyList<StockShortageDto> Shortages { get; }

    private static string BuildMessage(IReadOnlyList<StockShortageDto> shortages)
    {
        var detail = string.Join(", ", shortages.Select(s =>
            $"{s.IngredientName} (short {s.MissingQuantity} {s.Unit})"));

        return $"Insufficient stock: {detail}.";
    }
}
