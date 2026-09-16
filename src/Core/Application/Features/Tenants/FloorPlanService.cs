using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Tenants;

public interface IFloorPlanService
{
    /// <summary>The saved plan as raw JSON, or null when nobody has drawn one.</summary>
    Task<string?> GetAsync(CancellationToken ct = default);

    Task<string> SaveAsync(string json, CancellationToken ct = default);
}

/// <summary>
/// Stores the room drawn in the floor planner.
///
/// The JSON is kept opaque — validated as JSON and as carrying the right schema marker, but not
/// parsed into a model. The waiter view and the planner own that shape between them, and
/// pinning it here would mean a migration every time the drawing tool grows a feature.
/// </summary>
public sealed class FloorPlanService : IFloorPlanService
{
    private const string Schema = "restaurant-floor-plan";
    private const int MaxLength = 512 * 1024;

    private readonly IApplicationDbContext _db;
    private readonly ICurrentTenant _currentTenant;

    public FloorPlanService(IApplicationDbContext db, ICurrentTenant currentTenant)
    {
        _db = db;
        _currentTenant = currentTenant;
    }

    public async Task<string?> GetAsync(CancellationToken ct = default)
        => (await RequireTenantAsync(ct)).FloorPlanJson;

    public async Task<string> SaveAsync(string json, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(json))
            throw new ValidationException("plan", "A floor plan is required.");

        if (json.Length > MaxLength)
            throw new ValidationException("plan", "That floor plan is too large.");

        System.Text.Json.JsonDocument document;

        try
        {
            document = System.Text.Json.JsonDocument.Parse(json);
        }
        catch (System.Text.Json.JsonException)
        {
            throw new ValidationException("plan", "That is not valid JSON.");
        }

        using (document)
        {
            if (!document.RootElement.TryGetProperty("schema", out var schema) ||
                schema.GetString() != Schema)
            {
                throw new ValidationException(
                    "plan", "That JSON is not a floor plan — generate one from the floor planner.");
            }

            RequireDistinctTableNumbers(document.RootElement);
        }

        var tenant = await RequireTenantAsync(ct);

        tenant.SetFloorPlan(json);
        await _db.SaveChangesAsync(ct);

        return json;
    }

    /// <summary>
    /// The one part of the plan this service does look inside. Table numbers are the join key
    /// between the drawing and <see cref="Domain.Entities.Order.TableNumber"/>, so a repeated
    /// number would make two tables claim the same order — and it would look perfectly normal
    /// on screen. Everything else about the shape stays the planner's business.
    /// </summary>
    private static void RequireDistinctTableNumbers(System.Text.Json.JsonElement root)
    {
        if (!root.TryGetProperty("tables", out var tables) ||
            tables.ValueKind != System.Text.Json.JsonValueKind.Array)
        {
            return;
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var table in tables.EnumerateArray())
        {
            if (!table.TryGetProperty("label", out var label) ||
                label.ValueKind != System.Text.Json.JsonValueKind.String)
            {
                continue;
            }

            var number = label.GetString()?.Trim();

            if (string.IsNullOrEmpty(number))
                continue;

            if (!seen.Add(number))
            {
                throw new ValidationException(
                    "plan",
                    $"Two tables share the number '{number}'. Numbers must be unique — they are how an order finds its table.");
            }
        }
    }

    private async Task<Tenant> RequireTenantAsync(CancellationToken ct)
    {
        if (!_currentTenant.IsResolved)
            throw new TenantResolutionException("Identify the restaurant with the X-Tenant-Id header.");

        var id = _currentTenant.TenantIdOrEmpty;

        // Tenants are system-wide, so this reads outside the per-tenant query filter.
        return await _db.Tenants.FirstOrDefaultAsync(t => t.Id == id, ct)
               ?? throw new NotFoundException(nameof(Tenant), id);
    }
}
