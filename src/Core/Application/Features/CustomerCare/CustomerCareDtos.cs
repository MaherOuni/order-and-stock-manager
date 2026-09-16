using Domain.Enums;

namespace Application.Features.CustomerCare;

/// <summary>A table asking for a human. Public: the QR link's slug names the restaurant.</summary>
public sealed record CreateServiceRequestCommand(
    string TenantSlug,
    string TableNumber,
    ServiceRequestKind Kind = ServiceRequestKind.CallWaiter,
    string? Note = null,
    Guid? OrderId = null);

public sealed record ServiceRequestDto(
    Guid Id,
    string TableNumber,
    ServiceRequestKind Kind,
    string? Note,
    Guid? OrderId,
    ServiceRequestStatus Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ResolvedAt);

/// <summary>What the table thought of the order. Public, like placing it was.</summary>
public sealed record SubmitReviewCommand(
    string TenantSlug,
    int Rating,
    string? Comment = null);

public sealed record OrderReviewDto(
    Guid Id,
    Guid OrderId,
    int Rating,
    string? Comment,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);
