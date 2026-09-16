using Domain.Entities;

namespace Application.Features.Orders;

/// <summary>
/// Shared by the read side and the command handlers, so one order looks the same however it
/// was fetched.
/// </summary>
internal static class OrderMapper
{
    /// <summary>For an order whose <c>Items[].Product</c> navigation was included.</summary>
    public static OrderDto ToDto(Order order)
        // Products are never hard-deleted (the FK restricts it), so the name is only missing
        // when the caller forgot the Include.
        => ToDto(order, item => item.Product?.Name ?? string.Empty);

    /// <summary>
    /// For an order built in memory, where the products are already to hand but the navigation
    /// was never loaded.
    /// </summary>
    public static OrderDto ToDto(Order order, IReadOnlyDictionary<Guid, Product> products)
        => ToDto(order, item => products.TryGetValue(item.ProductId, out var product) ? product.Name : string.Empty);

    private static OrderDto ToDto(Order order, Func<OrderItem, string> productName) => new(
        order.Id,
        order.TenantId,
        order.OrderType,
        order.TableNumber,
        order.CustomerName,
        order.CustomerPhone,
        order.DeliveryAddress,
        order.AllergyNotes,
        order.Covers,
        order.FulfilmentLabel,
        order.Status,
        order.PaymentStatus,
        order.PaymentMethod,
        order.TotalAmountMillimes,
        order.TotalAmount,
        order.CancellationReason,
        order.CreatedAt,
        order.Items
            .Select(item => new OrderLineDto(
                item.Id,
                item.ProductId,
                productName(item),
                item.Quantity,
                item.UnitPrice,
                item.LineTotal,
                item.Notes,
                item.Customizations
                    .Select(c => new OrderCustomizationDto(c.IngredientId, c.IngredientName, c.Kind))
                    .OrderBy(c => c.IngredientName)
                    .ToList()))
            .OrderBy(line => line.ProductName)
            .ToList());
}
