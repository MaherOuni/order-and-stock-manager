using Application.Common.Interfaces;
using Infrastructure.Multitenancy;
using Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException(
                "Connection string 'Default' is not configured (ConnectionStrings__Default).");

        services.AddMemoryCache();

        // Scoped: one resolved tenant per request, read by the DbContext query filter.
        services.AddScoped<ICurrentTenant, CurrentTenant>();
        services.AddScoped<ITenantLookup, TenantLookup>();

        services.AddDbContext<ApplicationDbContext>(options =>
            options
                .UseNpgsql(connectionString, npgsql =>
                {
                    npgsql.MigrationsAssembly(typeof(ApplicationDbContext).Assembly.GetName().Name);
                    npgsql.MigrationsHistoryTable("__ef_migrations_history");
                    npgsql.CommandTimeout(30);
                    // No EnableRetryOnFailure here on purpose: a retrying execution strategy
                    // rejects user-initiated transactions, and inventory deduction needs one.
                })
                .UseSnakeCaseNamingConvention());

        services.AddScoped<IApplicationDbContext>(sp => sp.GetRequiredService<ApplicationDbContext>());

        services.Configure<TenantMiddlewareOptions>(configuration.GetSection("Multitenancy"));

        return services;
    }
}
