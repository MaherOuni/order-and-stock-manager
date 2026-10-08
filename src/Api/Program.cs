using System.Text.Json.Serialization;
using Api.Middlewares;
using Api.Swagger;
using Application;
using Application.Features.Inventory;
using Infrastructure;
using Infrastructure.Identity;
using Infrastructure.Multitenancy;
using Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.OpenApi.Models;

// `--migrate` and `--seed` are ours, not configuration keys. The command-line configuration
// provider reads `--key value` pairs, so a bare flag would either swallow whatever follows it
// as a value or be rejected outright — strip them before the builder ever sees them.
var runMigrations = args.Contains("--migrate");
var seedDemoTenant = args.Contains("--seed");
var hostArgs = args.Where(arg => arg is not "--migrate" and not "--seed").ToArray();

var builder = WebApplication.CreateBuilder(hostArgs);

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddAppAuthentication(builder.Configuration);

builder.Services
    .AddControllers()
    // Enums travel as names ("Replenish"), which is what the Angular client sends.
    .AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddEndpointsApiExplorer();

builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Order & Stock API",
        Version = "v1",
        Description = "Multi-tenant QR ordering and recipe-based inventory."
    });

    // Adds the X-Tenant-Id box to every tenant-scoped operation in the Swagger UI.
    options.OperationFilter<TenantHeaderOperationFilter>();

    // Controller docs live in Api.xml, DTO/enum docs in Application.xml.
    foreach (var assembly in new[] { typeof(Program).Assembly, typeof(IStockService).Assembly })
    {
        var xmlPath = Path.Combine(AppContext.BaseDirectory, $"{assembly.GetName().Name}.xml");
        if (File.Exists(xmlPath)) options.IncludeXmlComments(xmlPath);
    }

    options.SupportNonNullableReferenceTypes();
});

builder.Services.AddHealthChecks()
    // Tagged so liveness can exclude it: see the probe endpoints below.
    .AddDbContextCheck<ApplicationDbContext>("database", tags: new[] { "ready" });

const string AngularCors = "angular-client";
builder.Services.AddCors(options =>
    options.AddPolicy(AngularCors, policy => policy
        .WithOrigins(builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
                     ?? new[] { "http://localhost:4200" })
        .AllowAnyHeader()
        .AllowAnyMethod()
        .WithExposedHeaders("X-Tenant-Id")));

var app = builder.Build();

// `dotnet Api.dll --migrate` applies pending migrations and exits without serving anything.
// This is how the schema moves forward in production: one Job, once, rather than every replica
// racing the others through EF Core on boot (see k8s/migrate-job.yaml). It keeps the runtime
// image free of the SDK and `dotnet-ef`.
if (runMigrations)
{
    await DbInitializer.MigrateAsync(app.Services);

    if (seedDemoTenant)
        await DbInitializer.SeedDemoTenantAsync(app.Services);

    // After the demo tenant, so Bootstrap:TenantSlug can point at it.
    await IdentitySeeder.SeedAsync(app.Services);

    return;
}

if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    await DbInitializer.MigrateAsync(app.Services);

    if (app.Configuration.GetValue<bool>("Database:SeedDemoTenant"))
        await DbInitializer.SeedDemoTenantAsync(app.Services);

    await IdentitySeeder.SeedAsync(app.Services);
}

app.UseExceptionHandling();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options => options.SwaggerEndpoint("/swagger/v1/swagger.json", "Order & Stock API v1"));
}

app.UseRouting();
app.UseCors(AngularCors);

// Authentication first, because tenant resolution reads the tenant claim off the validated
// principal and treats it as authoritative over the X-Tenant-Id header.
app.UseAuthentication();

// Must sit before the endpoints: everything downstream queries through the tenant filter.
app.UseTenantResolution();

app.UseAuthorization();

app.MapControllers();
// Three probes, because Kubernetes asks two different questions.
//
// Liveness must not depend on PostgreSQL: if the database blips, restarting every API pod
// makes the outage worse, not better. Readiness must, because a pod that cannot reach the
// database has nothing useful to serve and should leave the Service's endpoint list.
//
// All three are explicitly anonymous: the fallback authorization policy demands a signed-in
// user for every endpoint, and a kubelet has no token. Without this, probes 401 and every pod
// is killed as unhealthy.
app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false })
    .AllowAnonymous();
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
}).AllowAnonymous();
app.MapHealthChecks("/health").AllowAnonymous();

app.Run();

/// <summary>Exposed so integration tests can spin the API up with WebApplicationFactory.</summary>
public partial class Program { }
