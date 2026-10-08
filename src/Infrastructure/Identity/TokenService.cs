using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Identity;

/// <summary>What a successful sign-in or refresh hands back.</summary>
public sealed record TokenPair(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt);

/// <summary>
/// The tokens plus who they were issued to. Refresh runs anonymously — there is no principal
/// on the request to read the user from — so the service has to say which account it rotated.
/// </summary>
public sealed record TokenIssue(
    TokenPair Tokens,
    Guid UserId,
    Guid TenantId,
    string TenantSlug,
    string DisplayName,
    IReadOnlyList<string> Roles);

public interface ITokenService
{
    Task<TokenIssue> IssueAsync(AppUser user, CancellationToken ct = default);

    /// <summary>
    /// Rotates a refresh token. Returns null when the token is unknown, expired or already
    /// revoked — the caller must not distinguish between those for the client.
    /// </summary>
    Task<TokenIssue?> RefreshAsync(string refreshToken, CancellationToken ct = default);

    /// <summary>Revokes a single token. Signing out should not end a user's other sessions.</summary>
    Task RevokeAsync(string refreshToken, CancellationToken ct = default);
}

public sealed class TokenService : ITokenService
{
    private readonly ApplicationDbContext _db;
    private readonly UserManager<AppUser> _users;
    private readonly JwtOptions _options;

    public TokenService(ApplicationDbContext db, UserManager<AppUser> users, IOptions<JwtOptions> options)
    {
        _db = db;
        _users = users;
        _options = options.Value;
    }

    public async Task<TokenIssue> IssueAsync(AppUser user, CancellationToken ct = default)
    {
        // IgnoreQueryFilters because sign-in happens before any tenant is resolved, so the
        // global filter would compare against Guid.Empty and find nothing.
        var tenantSlug = await _db.Tenants
            .IgnoreQueryFilters()
            .Where(t => t.Id == user.TenantId)
            .Select(t => t.Slug)
            .FirstOrDefaultAsync(ct);

        // Slug is a value object; unwrap after materialising rather than pushing .Value into
        // the query, which would have to go through the converter.
        var slug = tenantSlug?.Value ?? string.Empty;

        var roles = await _users.GetRolesAsync(user);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            // Every token is individually identifiable, which is what makes revocation
            // auditable later even though access tokens themselves are not revocable.
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(AppClaims.TenantId, user.TenantId.ToString()),
            new(AppClaims.TenantSlug, slug)
        };

        if (!string.IsNullOrWhiteSpace(user.Email))
            claims.Add(new Claim(JwtRegisteredClaimNames.Email, user.Email));

        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(_options.AccessTokenMinutes);

        var jwt = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: expiresAt.UtcDateTime,
            signingCredentials: new SigningCredentials(SigningKey(_options.Key), SecurityAlgorithms.HmacSha256));

        var access = new JwtSecurityTokenHandler().WriteToken(jwt);

        var (refresh, hash) = RefreshToken.Generate();
        var refreshExpires = DateTimeOffset.UtcNow.AddDays(_options.RefreshTokenDays);

        _db.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = hash,
            ExpiresAt = refreshExpires
        });

        await _db.SaveChangesAsync(ct);

        return new TokenIssue(
            new TokenPair(access, expiresAt, refresh, refreshExpires),
            user.Id,
            user.TenantId,
            slug,
            user.DisplayName,
            roles.ToList());
    }

    public async Task<TokenIssue?> RefreshAsync(string refreshToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken)) return null;

        var hash = RefreshToken.Hash(refreshToken);

        var stored = await _db.RefreshTokens
            .FirstOrDefaultAsync(t => t.TokenHash == hash, ct);

        if (stored is null) return null;

        // A token presented after revocation means it was replayed. We cannot tell whether the
        // replay came from the legitimate client or from someone who stole it, so the safe move
        // is to end the whole family and make everyone sign in again.
        if (stored.RevokedAt is not null)
        {
            await RevokeDescendantsAsync(stored, ct);
            return null;
        }

        if (!stored.IsActive) return null;

        // Re-read rather than trusting the old token's claims: a role revoked or an account
        // disabled mid-session must take effect at the next refresh, not at its expiry.
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == stored.UserId, ct);
        if (user is null || !user.IsActive) return null;

        var issue = await IssueAsync(user, ct);

        stored.RevokedAt = DateTimeOffset.UtcNow;
        stored.ReplacedByTokenId = await _db.RefreshTokens
            .Where(t => t.UserId == user.Id && t.TokenHash == RefreshToken.Hash(issue.Tokens.RefreshToken))
            .Select(t => (Guid?)t.Id)
            .FirstOrDefaultAsync(ct);

        await _db.SaveChangesAsync(ct);

        return issue;
    }

    public async Task RevokeAsync(string refreshToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken)) return;

        var hash = RefreshToken.Hash(refreshToken);

        var stored = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (stored is null || stored.RevokedAt is not null) return;

        stored.RevokedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>Walks the replacement chain forward and revokes everything still live on it.</summary>
    private async Task RevokeDescendantsAsync(RefreshToken replayed, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var cursor = replayed;

        while (cursor?.ReplacedByTokenId is { } nextId)
        {
            cursor = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.Id == nextId, ct);

            if (cursor is null) break;
            if (cursor.RevokedAt is null) cursor.RevokedAt = now;
        }

        await _db.SaveChangesAsync(ct);
    }

    internal static SymmetricSecurityKey SigningKey(string key)
        => new(Encoding.UTF8.GetBytes(key));
}
