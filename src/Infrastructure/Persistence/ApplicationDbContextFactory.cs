using Infrastructure.Multitenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Infrastructure.Persistence;

/// <summary>
/// Used by `dotnet ef` so migrations can be created/applied without booting the API host.
/// Override the connection with the ConnectionStrings__Default environment variable.
/// </summary>
public sealed class ApplicationDbContextFactory : IDesignTimeDbContextFactory<ApplicationDbContext>
{
    private const string DefaultConnection =
        "Host=localhost;Port=5432;Database=orderstock;Username=orderstock;Password=orderstock";

    public ApplicationDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Default") ?? DefaultConnection;

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseNpgsql(connectionString, npgsql =>
            {
                npgsql.MigrationsAssembly(typeof(ApplicationDbContext).Assembly.GetName().Name);
                npgsql.MigrationsHistoryTable("__ef_migrations_history");
            })
            .UseSnakeCaseNamingConvention()
            .Options;

        // No tenant at design time; the query filter simply resolves to Guid.Empty.
        return new ApplicationDbContext(options, new CurrentTenant());
    }
}
