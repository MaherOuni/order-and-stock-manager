using Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;
using Xunit;

namespace Api.IntegrationTests;

/// <summary>
/// Boots the real API against a throwaway PostgreSQL 16 container. Migrations are applied once;
/// each test then provisions its own tenant, so tests never see each other's data.
/// </summary>
public sealed class PostgresApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("orderstock_tests")
        .WithUsername("orderstock")
        .WithPassword("orderstock")
        .Build();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        // The container is running by the time the host is built (see InitializeAsync).
        builder.UseSetting("ConnectionStrings:Default", _postgres.GetConnectionString());

        // The fixture owns schema creation; the app must not race it on start-up.
        builder.UseSetting("Database:MigrateOnStartup", "false");
        builder.UseSetting("Database:SeedDemoTenant", "false");

        // "Testing" does not load appsettings.Development.json, and the API refuses to start
        // without a signing key — which is the point of that check. Supply a throwaway one.
        builder.UseSetting("Jwt:Issuer", "orderstock-tests");
        builder.UseSetting("Jwt:Audience", "orderstock-tests");
        builder.UseSetting("Jwt:Key", "integration-test-signing-key-at-least-32-chars");
    }

    async Task IAsyncLifetime.InitializeAsync()
    {
        await _postgres.StartAsync();

        // Touching Services builds the host, which needs the connection string above.
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        await db.Database.MigrateAsync();
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        await _postgres.DisposeAsync();
        await base.DisposeAsync();
    }
}

[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<PostgresApiFactory>
{
    public const string Name = "api";
}
