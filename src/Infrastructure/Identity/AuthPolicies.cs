using Microsoft.AspNetCore.Authorization;

namespace Infrastructure.Identity;

/// <summary>
/// The authorisation vocabulary the controllers use.
///
/// Policies rather than <c>[Authorize(Roles = "Owner,Manager")]</c> strings scattered across
/// controllers: when the role set behind "may change the menu" changes, it changes in one
/// place, and nothing silently keeps the old list.
///
/// Every policy also demands a tenant claim. Without that, a token with no tenant would pass a
/// role check and then run against whatever tenant the request header asked for.
/// </summary>
public static class AuthPolicies
{
    /// <summary>Signed in as staff of some restaurant. The floor-level baseline.</summary>
    public const string StaffMember = "staff-member";

    /// <summary>Menu, recipes, stock, reports.</summary>
    public const string ManageRestaurant = "manage-restaurant";

    /// <summary>Billing, staff accounts, tenant settings.</summary>
    public const string ManageTenant = "manage-tenant";

    /// <summary>
    /// Across all restaurants: provisioning, the tenant list. Ours, not a customer's — and
    /// notably it does not require a tenant claim, because it is not scoped to one.
    /// </summary>
    public const string ManagePlatform = "manage-platform";

    public static AuthorizationOptions AddAppPolicies(this AuthorizationOptions options)
    {
        // Deny by default. Every endpoint without explicit authorization metadata requires a
        // signed-in user, so forgetting an attribute on a new controller fails closed instead
        // of quietly publishing it — which is how the admin API came to be open in the first
        // place. The customer-facing routes opt out with [AllowAnonymous].
        options.FallbackPolicy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .Build();

        options.AddPolicy(ManagePlatform, policy => policy
            .RequireAuthenticatedUser()
            .RequireRole(AppRoles.PlatformAdmin));

        options.AddPolicy(StaffMember, policy => policy
            .RequireAuthenticatedUser()
            .RequireClaim(AppClaims.TenantId)
            .RequireRole(AppRoles.Owner, AppRoles.Manager, AppRoles.Staff));

        options.AddPolicy(ManageRestaurant, policy => policy
            .RequireAuthenticatedUser()
            .RequireClaim(AppClaims.TenantId)
            .RequireRole(AppRoles.Owner, AppRoles.Manager));

        options.AddPolicy(ManageTenant, policy => policy
            .RequireAuthenticatedUser()
            .RequireClaim(AppClaims.TenantId)
            .RequireRole(AppRoles.Owner));

        return options;
    }
}
