using Domain.Exceptions;

namespace Domain.ValueObjects;

/// <summary>
/// The unit an ingredient is stocked and consumed in. Recipe lines deduct stock in this unit,
/// so a recipe line and its ingredient always speak the same language.
/// </summary>
/// <remarks>See <see cref="Slug"/> for why this is a class and not a record.</remarks>
public sealed class UnitOfMeasure : IEquatable<UnitOfMeasure>
{
    public const int MaxLength = 16;

    public static readonly UnitOfMeasure Kilogram = new("kg");
    public static readonly UnitOfMeasure Gram = new("g");
    public static readonly UnitOfMeasure Litre = new("L");
    public static readonly UnitOfMeasure Millilitre = new("ml");
    public static readonly UnitOfMeasure Unit = new("unit");

    public static readonly IReadOnlyCollection<UnitOfMeasure> All =
        new[] { Kilogram, Gram, Litre, Millilitre, Unit };

    private UnitOfMeasure(string code) => Code = code;

    public string Code { get; }

    public static UnitOfMeasure From(string code)
    {
        if (string.IsNullOrWhiteSpace(code))
            throw new DomainException("Unit cannot be empty.");

        var match = All.FirstOrDefault(u => string.Equals(u.Code, code.Trim(), StringComparison.OrdinalIgnoreCase));

        return match ?? throw new DomainException(
            $"Unsupported unit '{code}'. Supported units: {string.Join(", ", All.Select(u => u.Code))}.");
    }

    public bool Equals(UnitOfMeasure? other) => other is not null && string.Equals(Code, other.Code, StringComparison.Ordinal);

    public override bool Equals(object? obj) => obj is UnitOfMeasure other && Equals(other);

    public override int GetHashCode() => Code.GetHashCode(StringComparison.Ordinal);

    public override string ToString() => Code;
}
