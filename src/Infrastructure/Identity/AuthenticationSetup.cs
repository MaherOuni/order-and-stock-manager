using System.Security.Claims;
using Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace Infrastructure.Identity;

public static class AuthenticationSetup
{
    /// <summary>
    /// Identity stores, JWT bearer validation and the authorisation policies.
    ///
    /// Called from the composition root. Start-up fails if <c>Jwt:Key</c> is missing or too
    /// short, which is deliberate: the alternative is an API that boots happily with a
    /// predictable signing key and accepts forged tokens.
    /// </summary>
    public static IServiceCollection AddAppAuthentication(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddOptions<JwtOptions>()
            .Bind(configuration.GetSection(JwtOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        var jwt = configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>()
            ?? throw new InvalidOperationException(
                "The 'Jwt' configuration section is missing. Set Jwt__Key, Jwt__Issuer and Jwt__Audience.");

        services
            .AddIdentityCore<AppUser>(options =>
            {
                options.User.RequireUniqueEmail = true;

                // Staff pick these on a phone in a noisy kitchen. Length does the work;
                // character-class rules mostly produce "Password1!" and a sticky note.
                options.Password.RequiredLength = 10;
                options.Password.RequireNonAlphanumeric = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireDigit = false;

                // A shared terminal is a brute-force surface. Lock out, but not for so long
                // that a mistyped password costs a table its order.
                options.Lockout.MaxFailedAccessAttempts = 8;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(10);
                options.Lockout.AllowedForNewUsers = true;
            })
            .AddRoles<AppRole>()
            .AddEntityFrameworkStores<ApplicationDbContext>()
            .AddSignInManager()
            .AddDefaultTokenProviders();

        // SignInManager takes an IHttpContextAccessor, and AddIdentityCore().AddSignInManager()
        // does not register one — only the full AddIdentity() does, and that drags in cookie
        // schemes this API has no use for.
        services.AddHttpContextAccessor();

        services.AddScoped<ITokenService, TokenService>();

        services
            .AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            })
            .AddJwtBearer(options =>
            {
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = jwt.Issuer,
                    ValidateAudience = true,
                    ValidAudience = jwt.Audience,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = TokenService.SigningKey(jwt.Key),
                    ValidateLifetime = true,
                    // The default is five minutes, which keeps a 15-minute token alive for
                    // twenty. Expiry should mean expiry.
                    ClockSkew = TimeSpan.FromSeconds(30),
                    RoleClaimType = ClaimTypes.Role,
                    NameClaimType = ClaimTypes.NameIdentifier
                };
            });

        services.AddAuthorization(options => options.AddAppPolicies());

        return services;
    }
}
