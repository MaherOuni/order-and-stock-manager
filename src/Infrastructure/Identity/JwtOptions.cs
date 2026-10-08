using System.ComponentModel.DataAnnotations;

namespace Infrastructure.Identity;

/// <summary>
/// Claim names this API issues and reads. Constants, because a mistyped claim name does not
/// fail — it silently reads null, and a null tenant claim is an authorisation bypass.
/// </summary>
public static class AppClaims
{
    /// <summary>The restaurant the bearer works for. Authoritative over any request header.</summary>
    public const string TenantId = "tenant_id";

    /// <summary>Carried for logging and for building links; never trusted for authorisation.</summary>
    public const string TenantSlug = "tenant_slug";
}

/// <summary>
/// Signing and lifetime settings, bound from the <c>Jwt</c> configuration section.
///
/// There is no default key on purpose. A fallback secret is the kind of thing that ships to
/// production unnoticed and makes every token forgeable, so a missing key fails at start-up
/// instead — see <c>AddAppAuthentication</c>.
/// </summary>
public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    [Required]
    public string Issuer { get; set; } = string.Empty;

    [Required]
    public string Audience { get; set; } = string.Empty;

    /// <summary>
    /// HMAC-SHA256 signing key. At least 32 bytes — shorter keys are rejected by the handler
    /// at run time, which would otherwise surface as a confusing 500 on first login.
    /// </summary>
    [Required]
    [MinLength(32, ErrorMessage = "Jwt:Key must be at least 32 characters.")]
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// Short by design: a stolen access token stays useful only this long, and the refresh
    /// token is what keeps staff signed in across a shift.
    /// </summary>
    [Range(1, 1440)]
    public int AccessTokenMinutes { get; set; } = 15;

    /// <summary>Long enough to cover a shift and the gap to the next one.</summary>
    [Range(1, 90)]
    public int RefreshTokenDays { get; set; } = 14;
}
