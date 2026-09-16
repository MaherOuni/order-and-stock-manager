using Domain.Common;
using Domain.Enums;
using Domain.Exceptions;

namespace Domain.Entities;

/// <summary>
/// A customer order, placed from a QR code at a table or from the counter.
///
/// Two things drive its rules. <see cref="OrderType"/> decides what the order must carry — a
/// dine-in needs a table, a delivery needs an address — and <see cref="PaymentMethod"/> decides
/// *when* the ingredients leave stock: cash deducts at creation because the kitchen starts
/// immediately, while Flouci and Konnect deduct only once their webhook confirms the money.
/// <see cref="StockDeductedAt"/> is what stops that happening twice, and what tells a
/// cancellation whether there is anything to give back.
/// </summary>
public class Order : TenantEntity
{
    public const int TableNumberMaxLength = 32;
    public const int ExternalPaymentRefMaxLength = 128;
    public const int CustomerNameMaxLength = 120;
    public const int CustomerPhoneMaxLength = 32;
    public const int AddressMaxLength = 500;
    public const int NotesMaxLength = 500;

    private readonly List<OrderItem> _items = new();

    private Order() { }

    public Order(OrderType orderType, PaymentMethod paymentMethod = PaymentMethod.Cash)
    {
        OrderType = orderType;
        PaymentMethod = paymentMethod;
        Status = OrderStatus.Pending;
        PaymentStatus = PaymentStatus.Unpaid;
        CreatedAt = DateTimeOffset.UtcNow;
    }

    public OrderType OrderType { get; private set; }

    /// <summary>
    /// Free text rather than an int, and nullable: QR labels read "12", "T4" or "Terrasse 2",
    /// and a takeaway has no table at all.
    /// </summary>
    public string? TableNumber { get; private set; }

    public string? CustomerName { get; private set; }

    public string? CustomerPhone { get; private set; }

    /// <summary>Required for <see cref="OrderType.Delivery"/>, meaningless otherwise.</summary>
    public string? DeliveryAddress { get; private set; }

    /// <summary>
    /// Allergies and anything else the kitchen must read before cooking. Kept on the order
    /// rather than a line because "nut allergy" applies to the whole table's food.
    /// </summary>
    public string? AllergyNotes { get; private set; }

    /// <summary>
    /// How many people are actually eating, for a dine-in order. The floor plan knows a table's
    /// capacity; only the order knows who turned up.
    /// </summary>
    public int? Covers { get; private set; }

    public OrderStatus Status { get; private set; }

    public PaymentStatus PaymentStatus { get; private set; }

    public PaymentMethod PaymentMethod { get; private set; }

    /// <summary>
    /// The bill in millimes, kept in step by <see cref="AddItem"/>. Integer because this is the
    /// number handed to a payment gateway, and money on that wire is never a decimal.
    /// </summary>
    public long TotalAmountMillimes { get; private set; }

    /// <summary>The gateway's own identifier: Flouci's payment_id, Konnect's paymentRef.</summary>
    public string? ExternalPaymentRef { get; private set; }

    /// <summary>
    /// Set the moment the ingredients are taken. Null means they have not been, and it is the
    /// only thing standing between a replayed webhook and a double deduction.
    /// </summary>
    public DateTimeOffset? StockDeductedAt { get; private set; }

    public string? CancellationReason { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public IReadOnlyCollection<OrderItem> Items => _items.AsReadOnly();

    /// <summary>Derived for display; the stored figure is the integer one.</summary>
    public decimal TotalAmount => Millimes.ToAmount(TotalAmountMillimes);

    /// <summary>True while this order still expects money through a gateway.</summary>
    public bool IsDigital => PaymentMethod is PaymentMethod.Flouci or PaymentMethod.Konnect;

    /// <summary>What to print on the ticket where a table number would go.</summary>
    public string FulfilmentLabel => OrderType switch
    {
        OrderType.DineIn => TableNumber ?? "Table",
        OrderType.Takeaway => CustomerName ?? "Takeaway",
        _ => DeliveryAddress ?? "Delivery",
    };

    /// <summary>
    /// Sets where the order is going. Validated together because the rules are about the
    /// combination: a delivery without an address is not an order anyone can fulfil.
    /// </summary>
    public void SetFulfilment(
        OrderType orderType,
        string? tableNumber,
        string? customerName,
        string? customerPhone,
        string? deliveryAddress)
    {
        tableNumber = Trim(tableNumber, TableNumberMaxLength, "Table number");
        customerName = Trim(customerName, CustomerNameMaxLength, "Customer name");
        customerPhone = Trim(customerPhone, CustomerPhoneMaxLength, "Phone number");
        deliveryAddress = Trim(deliveryAddress, AddressMaxLength, "Delivery address");

        switch (orderType)
        {
            case OrderType.DineIn when tableNumber is null:
                throw new DomainException("A dine-in order needs a table number.");

            case OrderType.Delivery when deliveryAddress is null:
                throw new DomainException("A delivery order needs an address.");

            case OrderType.Delivery when customerPhone is null:
                // The driver has to be able to call; this is the one contact detail that is
                // not optional.
                throw new DomainException("A delivery order needs a phone number.");
        }

        OrderType = orderType;
        TableNumber = orderType == OrderType.DineIn ? tableNumber : null;
        DeliveryAddress = orderType == OrderType.Delivery ? deliveryAddress : null;
        CustomerName = customerName;
        CustomerPhone = customerPhone;
    }

    public void SetAllergyNotes(string? notes)
        => AllergyNotes = Trim(notes, NotesMaxLength, "Allergy notes");

    public void SetCovers(int? covers)
    {
        if (covers is null) { Covers = null; return; }

        if (covers < 1)
            throw new DomainException("A table cannot seat fewer than one person.");

        Covers = OrderType == OrderType.DineIn ? covers : null;
    }

    public OrderItem AddItem(Guid productId, int quantity, decimal unitPrice, string? notes = null)
    {
        if (Status != OrderStatus.Pending)
            throw new DomainException($"Cannot add items to a {Status.ToString().ToLowerInvariant()} order.");

        if (PaymentStatus == PaymentStatus.Paid)
            throw new DomainException("Cannot change an order that has already been paid for.");

        // Two lines of the same product would be indistinguishable on a ticket unless they are
        // customised differently, which the caller expresses by merging or not merging.
        var item = new OrderItem(Id, productId, quantity, unitPrice, notes);

        _items.Add(item);
        Recalculate();

        return item;
    }

    /// <summary>
    /// Chooses (or changes) how this order is paid. Only possible while it is unpaid — the
    /// method that collected the money is part of the record afterwards.
    /// </summary>
    public void ChoosePaymentMethod(PaymentMethod method)
    {
        if (PaymentStatus == PaymentStatus.Paid)
            throw new DomainException("This order has already been paid for.");

        if (Status == OrderStatus.Cancelled)
            throw new DomainException("A cancelled order cannot be paid for.");

        PaymentMethod = method;
    }

    /// <summary>Records the gateway's identifier so its webhook can find this order again.</summary>
    public void AttachExternalPaymentRef(string reference)
    {
        if (string.IsNullOrWhiteSpace(reference))
            throw new DomainException("A payment reference is required.");
        if (reference.Length > ExternalPaymentRefMaxLength)
            throw new DomainException(
                $"Payment reference cannot exceed {ExternalPaymentRefMaxLength} characters.");

        ExternalPaymentRef = reference.Trim();
    }

    /// <summary>
    /// The money is in. Idempotent: a gateway that retries its webhook — and they all do —
    /// must not produce a second of anything.
    /// </summary>
    /// <returns>True if this call is what changed the status.</returns>
    public bool MarkPaid()
    {
        if (PaymentStatus == PaymentStatus.Paid) return false;

        PaymentStatus = PaymentStatus.Paid;

        return true;
    }

    public void MarkPaymentFailed()
    {
        // A late failure notice after a confirmed payment is noise, not a reversal.
        if (PaymentStatus == PaymentStatus.Paid) return;

        PaymentStatus = PaymentStatus.Failed;
    }

    /// <summary>
    /// Records that this order's ingredients have left stock. Throws rather than allowing it
    /// twice: the caller is expected to check <see cref="StockDeductedAt"/> first, and reaching
    /// here regardless means a bug that would otherwise quietly halve the inventory.
    /// </summary>
    public void MarkStockDeducted()
    {
        if (StockDeductedAt is not null)
            throw new DomainException("This order's stock has already been deducted.");

        StockDeductedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>Records that a cancellation has put the ingredients back.</summary>
    public void MarkStockReturned() => StockDeductedAt = null;

    /// <summary>Served and closed.</summary>
    public void Complete()
    {
        if (Status != OrderStatus.Pending)
            throw new DomainException($"Only a pending order can be completed; this one is {Status}.");

        Status = OrderStatus.Completed;
    }

    /// <summary>
    /// Called off. The caller is responsible for returning any deducted ingredients to stock —
    /// the entity cannot do it, because stock movements belong to the ledger, not to the order.
    /// </summary>
    public void Cancel(string? reason = null)
    {
        if (Status == OrderStatus.Cancelled) return;

        if (Status != OrderStatus.Pending)
            throw new DomainException($"Only a pending order can be cancelled; this one is {Status}.");

        Status = OrderStatus.Cancelled;
        CancellationReason = Trim(reason, NotesMaxLength, "Cancellation reason");
    }

    private void Recalculate()
        // Summed per line rather than from a decimal grand total: converting once per line and
        // adding integers cannot drift, converting a rounded total can.
        => TotalAmountMillimes = _items.Sum(i => i.LineTotalMillimes);

    private static string? Trim(string? value, int maxLength, string label)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        var trimmed = value.Trim();

        if (trimmed.Length > maxLength)
            throw new DomainException($"{label} cannot exceed {maxLength} characters.");

        return trimmed;
    }
}
