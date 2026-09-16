namespace Domain.Enums;

/// <summary>
/// How the order leaves the counter. Persisted as text like every other enum here.
///
/// It is not a cosmetic label: a takeaway has no table to deliver to, and a delivery needs an
/// address before it can be accepted. <see cref="Entities.Order"/> enforces both.
/// </summary>
public enum OrderType
{
    /// <summary>Eaten in, at a table. The QR code on that table names it.</summary>
    DineIn = 0,

    /// <summary>Collected at the counter.</summary>
    Takeaway = 1,

    /// <summary>Sent to an address.</summary>
    Delivery = 2
}
