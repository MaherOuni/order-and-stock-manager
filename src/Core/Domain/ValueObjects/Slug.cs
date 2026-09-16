using System.Text;
using System.Text.RegularExpressions;
using Domain.Exceptions;

namespace Domain.ValueObjects;

/// <summary>
/// URL-safe tenant identifier used in QR codes and public routes (e.g. /api/t/{slug}/menu).
/// </summary>
/// <remarks>
/// Deliberately a class with overridden Equals rather than a record: a record's generated
/// <c>operator ==</c> is a method call in an expression tree, which EF Core cannot translate.
/// With plain reference-equality syntax, <c>t.Slug == someSlug</c> becomes an Equal node and
/// EF pushes it through the value converter into a normal indexed column comparison.
/// </remarks>
public sealed partial class Slug : IEquatable<Slug>
{
    public const int MaxLength = 120;

    private Slug(string value) => Value = value;

    public string Value { get; }

    public static Slug From(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new DomainException("Slug cannot be empty.");

        var normalized = value.Trim().ToLowerInvariant();

        if (normalized.Length > MaxLength)
            throw new DomainException($"Slug cannot exceed {MaxLength} characters.");

        if (!SlugPattern().IsMatch(normalized))
            throw new DomainException("Slug must contain only lowercase letters, digits and single hyphens.");

        return new Slug(normalized);
    }

    /// <summary>Best-effort conversion of a display name into a valid slug ("Chez Maher!" =&gt; "chez-maher").</summary>
    public static Slug FromName(string name)
    {
        var builder = new StringBuilder(name.Length);
        foreach (var ch in name.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch)) builder.Append(ch);
            else if (builder.Length > 0 && builder[^1] != '-') builder.Append('-');
        }

        return From(builder.ToString().Trim('-'));
    }

    public bool Equals(Slug? other) => other is not null && string.Equals(Value, other.Value, StringComparison.Ordinal);

    public override bool Equals(object? obj) => obj is Slug other && Equals(other);

    public override int GetHashCode() => Value.GetHashCode(StringComparison.Ordinal);

    public override string ToString() => Value;

    [GeneratedRegex("^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex SlugPattern();
}
