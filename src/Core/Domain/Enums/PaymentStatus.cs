namespace Domain.Enums;

/// <summary>
/// Where the money is. Persisted as text, like every other enum here.
/// </summary>
public enum PaymentStatus
{
    /// <summary>Nothing collected yet. Every order starts here, cash included.</summary>
    Unpaid = 0,

    /// <summary>
    /// Settled. For a digital order this is set only by the webhook, after the gateway has been
    /// asked directly — never on the strength of a redirect the customer's browser performed.
    /// </summary>
    Paid = 1,

    /// <summary>The gateway reported a failed, expired or cancelled payment.</summary>
    Failed = 2
}
