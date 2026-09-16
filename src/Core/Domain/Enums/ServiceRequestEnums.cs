namespace Domain.Enums;

/// <summary>What the table is asking for when it presses the button.</summary>
public enum ServiceRequestKind
{
    /// <summary>"Someone come over" — the catch-all.</summary>
    CallWaiter = 0,

    /// <summary>Ready to pay at the table.</summary>
    RequestBill = 1,

    /// <summary>Water, napkins, cutlery — small things that do not need a waiter's judgement.</summary>
    Supplies = 2,

    /// <summary>Something is wrong with the order.</summary>
    Problem = 3
}

/// <summary>
/// Where a service request has got to. Deliberately three states: the floor needs to know
/// "seen" is different from "done", or two waiters walk to the same table.
/// </summary>
public enum ServiceRequestStatus
{
    Open = 0,
    Acknowledged = 1,
    Resolved = 2
}
