using System.Security.Cryptography;

namespace Infrastructure.Identity;

/// <summary>
/// One issued refresh token.
///
/// Rotating: redeeming a token revokes it and records which token replaced it. That chain is
/// what makes theft detectable — if a revoked token is presented again, either the legitimate
/// client or an attacker is replaying, and we cannot tell which, so the whole chain is killed.
///
/// Only the hash is stored. A leaked database should not hand out working sessions.
/// </summary>
public sealed class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid UserId { get; set; }

    /// <summary>SHA-256 of the token the client holds. The token itself is never persisted.</summary>
    public string TokenHash { get; set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>Set when this token was rotated; points at the token issued in its place.</summary>
    public Guid? ReplacedByTokenId { get; set; }

    public bool IsActive => RevokedAt is null && DateTimeOffset.UtcNow < ExpiresAt;

    /// <summary>
    /// 256 bits from a cryptographic RNG, base64url so it survives a header or a JSON body.
    /// Returns the clear token for the caller to hand over, and its hash for storage.
    /// </summary>
    public static (string Token, string Hash) Generate()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        var token = Base64UrlEncode(bytes);

        return (token, Hash(token));
    }

    public static string Hash(string token)
        => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));

    private static string Base64UrlEncode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
