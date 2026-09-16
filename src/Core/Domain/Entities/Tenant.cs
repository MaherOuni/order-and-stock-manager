using Domain.Common;
using Domain.Exceptions;
using Domain.ValueObjects;

namespace Domain.Entities;

/// <summary>
/// A restaurant account. This is the one system-wide table: it has no TenantId of its own
/// and is therefore not covered by the global query filter.
/// </summary>
public class Tenant : BaseEntity
{
    public const int NameMaxLength = 200;
    public const int CurrencyLength = 3;

    // Required by EF Core materialisation.
    private Tenant()
    {
        Name = null!;
        Slug = null!;
        Currency = null!;
    }

    public Tenant(string name, Slug slug, string currency)
    {
        Rename(name);
        Slug = slug ?? throw new DomainException("Slug is required.");
        ChangeCurrency(currency);
        CreatedAt = DateTimeOffset.UtcNow;
    }

    public string Name { get; private set; }

    /// <summary>Immutable once issued: QR codes in the wild point at it.</summary>
    public Slug Slug { get; private set; }

    /// <summary>ISO 4217 alphabetic code, e.g. "TND", "EUR".</summary>
    public string Currency { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>
    /// The room drawn in the floor planner, stored as the JSON that tool exports. Kept opaque
    /// on purpose: the shape belongs to the planner and the waiter view, and parsing it here
    /// would mean a migration every time a drawing tool grows a feature.
    /// </summary>
    public string? FloorPlanJson { get; private set; }

    /// <summary>Replaces the saved plan. Null clears it.</summary>
    public void SetFloorPlan(string? json)
        => FloorPlanJson = string.IsNullOrWhiteSpace(json) ? null : json;

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new DomainException("Tenant name is required.");
        if (name.Length > NameMaxLength)
            throw new DomainException($"Tenant name cannot exceed {NameMaxLength} characters.");

        Name = name.Trim();
    }

    public void ChangeCurrency(string currency)
    {
        if (string.IsNullOrWhiteSpace(currency) || currency.Trim().Length != CurrencyLength)
            throw new DomainException("Currency must be a 3-letter ISO 4217 code.");

        Currency = currency.Trim().ToUpperInvariant();
    }
}
