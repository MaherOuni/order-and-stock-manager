using Domain.Entities;
using Domain.Enums;

namespace Application.Features.Orders;

/// <summary>
/// One change to a line's recipe. The ingredient must already be part of the product's recipe:
/// removing takes it out of the deduction, adding doubles it. Arbitrary extras would need
/// modifier pricing, which the menu does not have yet.
/// </summary>
public sealed record CustomizationRequest(Guid IngredientId, CustomizationKind Kind);

/// <summary>One line of an incoming basket.</summary>
public sealed record OrderLineRequest(
    Guid ProductId,
    int Quantity,
    /// <summary>"Extra hot", "no straw" — read by the kitchen, ignored by stock.</summary>
    string? Notes = null,
    IReadOnlyList<CustomizationRequest>? Customizations = null);

/// <summary>
/// A customer placing an order. Public: the tenant is named in the body (the QR link carries
/// the slug) instead of in the <c>X-Tenant-Id</c> header.
/// </summary>
/// <param name="TenantSlug">The restaurant, e.g. <c>demo-resto</c>.</param>
/// <param name="OrderType">Dine-in needs a table; delivery needs an address and a phone.</param>
/// <param name="TableNumber">Whatever the table label says: "12", "T4", "Terrasse 2".</param>
/// <param name="AllergyNotes">Read by the kitchen before anything is cooked.</param>
/// <param name="PaymentMethod">Cash deducts stock now; a gateway deducts on its webhook.</param>
/// <param name="Items">
/// The basket. Prices are never accepted from the client — the server reads them off the menu.
/// </param>
public sealed record CreateOrderCommand(
    string TenantSlug,
    IReadOnlyList<OrderLineRequest> Items,
    OrderType OrderType = OrderType.DineIn,
    string? TableNumber = null,
    string? CustomerName = null,
    string? CustomerPhone = null,
    string? DeliveryAddress = null,
    string? AllergyNotes = null,
    int? Covers = null,
    PaymentMethod PaymentMethod = PaymentMethod.Cash);

/// <summary>Why an order is being called off, from the customer or the floor.</summary>
public sealed record CancelOrderRequest(string? Reason = null);

public sealed record OrderCustomizationDto(
    Guid IngredientId,
    string IngredientName,
    CustomizationKind Kind);

/// <summary>One line of a placed order, priced as it was at the time.</summary>
public sealed record OrderLineDto(
    Guid Id,
    Guid ProductId,
    string ProductName,
    int Quantity,
    decimal UnitPrice,
    decimal LineTotal,
    string? Notes,
    IReadOnlyList<OrderCustomizationDto> Customizations);

public sealed record OrderDto(
    Guid Id,
    Guid TenantId,
    OrderType OrderType,
    string? TableNumber,
    string? CustomerName,
    string? CustomerPhone,
    string? DeliveryAddress,
    string? AllergyNotes,
    /// <summary>How many people are eating, for a dine-in order.</summary>
    int? Covers,
    /// <summary>What to show where a table number would go, whatever the order type.</summary>
    string FulfilmentLabel,
    OrderStatus Status,
    PaymentStatus PaymentStatus,
    PaymentMethod PaymentMethod,
    long TotalAmountMillimes,
    /// <summary>The same figure as a decimal, for display.</summary>
    decimal TotalAmount,
    string? CancellationReason,
    DateTimeOffset CreatedAt,
    IReadOnlyList<OrderLineDto> Items);
