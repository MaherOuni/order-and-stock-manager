using Microsoft.AspNetCore.Identity;

namespace Infrastructure.Identity;

/// <summary>
/// A member of one restaurant's staff.
///
/// Deliberately <em>not</em> an <c>ITenantEntity</c>: the global query filter compares against
/// the tenant resolved for the request, and sign-in has to find a user before any tenant exists
/// to compare with. The tenant is carried as a plain column and enforced in the token instead —
/// see <see cref="TokenService"/> and the tenant check in the middleware.
/// </summary>
public sealed class AppUser : IdentityUser<Guid>
{
    /// <summary>The restaurant this account belongs to. Never changes after creation.</summary>
    public Guid TenantId { get; set; }

    /// <summary>Shown on the order board and in the audit trail; not an identifier.</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>
    /// A disabled account keeps its history but cannot sign in or refresh. Used for staff who
    /// have left, which is the common case — deleting them would orphan the audit trail.
    /// </summary>
    public bool IsActive { get; set; } = true;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
