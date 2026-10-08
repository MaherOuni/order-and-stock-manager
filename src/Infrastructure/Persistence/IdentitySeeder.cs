using Domain.ValueObjects;
using Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Persistence;

/// <summary>
/// Creates the roles, and the first account that can sign in.
///
/// Without this a freshly migrated database has a locked admin area and nobody who can open it,
/// because every way of creating a staff account is itself behind authentication. This is the
/// bootstrap that breaks that circle, and it is driven by configuration so the credentials
/// never live in the repository.
/// </summary>
public static class IdentitySeeder
{
    /// <summary>
    /// Ensures all four roles exist, then creates the configured first user if it is missing.
    ///
    /// Idempotent and non-destructive: an existing account is never modified, so re-running a
    /// migration job cannot reset somebody's password or re-grant a role that was taken away.
    /// </summary>
    public static async Task SeedAsync(IServiceProvider services, CancellationToken ct = default)
    {
        await using var scope = services.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger(nameof(IdentitySeeder));
        var roles = sp.GetRequiredService<RoleManager<AppRole>>();

        foreach (var known in AppRoles.All)
        {
            if (await roles.RoleExistsAsync(known)) continue;

            await roles.CreateAsync(new AppRole(known));
            logger.LogInformation("Created role {Role}.", known);
        }

        var configuration = sp.GetRequiredService<IConfiguration>();
        var section = configuration.GetSection("Bootstrap");

        var email = section["Email"];
        var password = section["Password"];

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            logger.LogInformation(
                "No Bootstrap:Email/Bootstrap:Password configured; skipping first-user creation.");
            return;
        }

        var users = sp.GetRequiredService<UserManager<AppUser>>();

        if (await users.FindByEmailAsync(email) is not null)
        {
            logger.LogInformation("Bootstrap user already exists; leaving it untouched.");
            return;
        }

        // A platform admin belongs to no restaurant, but AppUser.TenantId is not nullable and
        // the token always carries the claim. Which tenant it names is decided below.
        var role = section["Role"] ?? AppRoles.PlatformAdmin;
        var tenantSlug = section["TenantSlug"];

        var db = sp.GetRequiredService<ApplicationDbContext>();
        Guid tenantId;

        if (string.IsNullOrWhiteSpace(tenantSlug))
        {
            if (role != AppRoles.PlatformAdmin)
            {
                logger.LogError(
                    "Bootstrap:Role is {Role}, which belongs to a restaurant, but no " +
                    "Bootstrap:TenantSlug was given. Skipping.", role);
                return;
            }

            tenantId = Guid.Empty;
        }
        else
        {
            var slug = Slug.From(tenantSlug);

            var tenant = await db.Tenants.IgnoreQueryFilters()
                .FirstOrDefaultAsync(t => t.Slug == slug, ct);

            if (tenant is null)
            {
                logger.LogError(
                    "Bootstrap:TenantSlug '{Slug}' matches no restaurant. Skipping.", tenantSlug);
                return;
            }

            tenantId = tenant.Id;
        }

        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            UserName = email,
            Email = email,
            DisplayName = section["DisplayName"] ?? email,
            TenantId = tenantId,
            // There is no mail delivery yet; the operator who set this password is the proof.
            EmailConfirmed = true
        };

        var created = await users.CreateAsync(user, password);

        if (!created.Succeeded)
        {
            logger.LogError("Could not create the bootstrap user: {Errors}",
                string.Join("; ", created.Errors.Select(e => e.Description)));
            return;
        }

        await users.AddToRoleAsync(user, role);

        logger.LogWarning(
            "Created bootstrap user {Email} with role {Role}. Change this password now.",
            email, role);
    }
}
