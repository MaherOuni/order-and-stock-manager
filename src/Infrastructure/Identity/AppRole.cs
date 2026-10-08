using Microsoft.AspNetCore.Identity;

namespace Infrastructure.Identity;

/// <summary>
/// A staff role. Role names are global; what scopes them to a restaurant is the tenant on the
/// user holding them, which travels in the token alongside the role.
/// </summary>
public sealed class AppRole : IdentityRole<Guid>
{
    public AppRole() { }

    public AppRole(string name) : base(name) => NormalizedName = name.ToUpperInvariant();
}

/// <summary>
/// The three jobs that exist in a restaurant, in increasing order of what they can break.
/// Kept as constants because a typo in a role string is an authorisation hole that compiles.
/// </summary>
public static class AppRoles
{
    /// <summary>
    /// Us, not a customer. Provisions restaurants and can see across all of them, which is why
    /// it is deliberately not grantable through any tenant-facing screen.
    /// </summary>
    public const string PlatformAdmin = "PlatformAdmin";

    /// <summary>Owns the business: billing, staff accounts, tenant settings.</summary>
    public const string Owner = "Owner";

    /// <summary>Runs the restaurant: menu, recipes, stock, reports.</summary>
    public const string Manager = "Manager";

    /// <summary>Works the floor: the order board, the service desk, stock adjustments.</summary>
    public const string Staff = "Staff";

    /// <summary>The roles a restaurant can hand out. PlatformAdmin is not among them.</summary>
    public static readonly IReadOnlyList<string> TenantRoles = new[] { Owner, Manager, Staff };

    public static readonly IReadOnlyList<string> All = new[] { PlatformAdmin, Owner, Manager, Staff };
}
