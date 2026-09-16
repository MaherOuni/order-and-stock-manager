using Domain.Common;
using Domain.Enums;
using Domain.Exceptions;

namespace Domain.Entities;

/// <summary>
/// A table asking for a human: "call the waiter", "the bill please", "we need water".
///
/// Separate from <see cref="Order"/> on purpose — someone can need a waiter without having
/// ordered anything, and an order being served does not resolve a request for napkins.
/// </summary>
public class ServiceRequest : TenantEntity
{
    public const int NoteMaxLength = 500;
    public const int TableNumberMaxLength = 32;

    private ServiceRequest() => TableNumber = null!;

    public ServiceRequest(string tableNumber, ServiceRequestKind kind, string? note = null, Guid? orderId = null)
    {
        if (string.IsNullOrWhiteSpace(tableNumber))
            throw new DomainException("A service request needs to say which table it came from.");
        if (tableNumber.Length > TableNumberMaxLength)
            throw new DomainException($"Table number cannot exceed {TableNumberMaxLength} characters.");
        if (note is { Length: > NoteMaxLength })
            throw new DomainException($"Note cannot exceed {NoteMaxLength} characters.");

        TableNumber = tableNumber.Trim();
        Kind = kind;
        Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        OrderId = orderId;
        Status = ServiceRequestStatus.Open;
        CreatedAt = DateTimeOffset.UtcNow;
    }

    public string TableNumber { get; private set; }

    public ServiceRequestKind Kind { get; private set; }

    public string? Note { get; private set; }

    /// <summary>The order it is about, when it is about one.</summary>
    public Guid? OrderId { get; private set; }

    public ServiceRequestStatus Status { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? ResolvedAt { get; private set; }

    /// <summary>Someone on the floor has seen it. Idempotent — two taps is not two waiters.</summary>
    public void Acknowledge()
    {
        if (Status != ServiceRequestStatus.Open) return;

        Status = ServiceRequestStatus.Acknowledged;
    }

    public void Resolve()
    {
        if (Status == ServiceRequestStatus.Resolved) return;

        Status = ServiceRequestStatus.Resolved;
        ResolvedAt = DateTimeOffset.UtcNow;
    }
}
