namespace Domain.Enums;

/// <summary>How the customer is paying. Decides *when* the ingredients leave stock.</summary>
public enum PaymentMethod
{
    /// <summary>
    /// Settled at the table. The kitchen starts immediately, so stock is deducted when the
    /// order is created.
    /// </summary>
    Cash = 0,

    /// <summary>Flouci — Tunisian wallet and card gateway.</summary>
    Flouci = 1,

    /// <summary>Konnect — Tunisian wallet, bank card and e-DINAR gateway.</summary>
    Konnect = 2
}
