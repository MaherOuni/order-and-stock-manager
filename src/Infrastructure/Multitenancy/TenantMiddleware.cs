using Application.Common.Interfaces;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Multitenancy;

public sealed class TenantMiddlewareOptions
{
    /// <summary>Header carrying either the tenant Guid or the tenant slug.</summary>
    public string HeaderName { get; set; } = "X-Tenant-Id";

    /// <summary>
    /// Route prefix for public, slug-addressed URLs used by QR codes: /api/t/{slug}/...
    /// Set to null to disable route-based resolution.
    /// </summary>
    public string? SlugRoutePrefix { get; set; } = "/api/t";

    /// <summary>
    /// Paths that legitimately run without a tenant: Swagger, health probes and tenant
    /// provisioning (which is what creates tenants in the first place).
    /// </summary>
    public IList<string> BypassPathPrefixes { get; } = new List<string>
    {
        "/swagger",
        "/health",
        "/api/v1/tenants"
    };

    /// <summary>
    /// Paths that work either way: they still honour the header when it is sent, but they can
    /// also name their own tenant — the public order endpoint carries the slug in its body,
    /// the admin order view carries the tenant id in its route. Those handlers bind the tenant
    /// themselves (see ITenantBinder), so arriving here without a header is not an error.
    /// </summary>
    public IList<string> TenantOptionalPathPrefixes { get; } = new List<string>
    {
        "/api/v1/orders",
        // Raising one is public (the body carries the slug); reading the queue is not, and the
        // service itself insists on a resolved tenant for that.
        "/api/v1/service-requests"
    };

    /// <summary>
    /// When true, a request that resolves no tenant is rejected with 400 instead of being
    /// allowed through with an empty tenant context.
    /// </summary>
    public bool RequireTenant { get; set; } = true;
}

/// <summary>
/// Resolves the tenant for the current request — from the <c>X-Tenant-Id</c> header (Guid or
/// slug) or from the <c>/api/t/{slug}</c> route — and publishes it into the scoped
/// <see cref="ICurrentTenant"/> that the DbContext global query filter reads.
/// </summary>
public sealed class TenantMiddleware
{
    private readonly RequestDelegate _next;
    private readonly TenantMiddlewareOptions _options;
    private readonly ILogger<TenantMiddleware> _logger;

    public TenantMiddleware(
        RequestDelegate next,
        IOptions<TenantMiddlewareOptions> options,
        ILogger<TenantMiddleware> logger)
    {
        _next = next;
        _options = options.Value;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, ICurrentTenant currentTenant, ITenantLookup tenantLookup)
    {
        if (IsBypassed(context.Request.Path))
        {
            await _next(context);
            return;
        }

        var (rawValue, source) = ExtractTenantKey(context);

        if (string.IsNullOrWhiteSpace(rawValue))
        {
            if (!_options.RequireTenant || IsTenantOptional(context.Request.Path))
            {
                // No tenant yet — the endpoint is expected to bind one from the request itself.
                await _next(context);
                return;
            }

            await WriteProblemAsync(context, StatusCodes.Status400BadRequest,
                "Tenant not specified",
                $"Provide the '{_options.HeaderName}' header (tenant id or slug), or call a '{_options.SlugRoutePrefix}/{{slug}}' route.");
            return;
        }

        var identity = Guid.TryParse(rawValue, out var tenantId)
            ? await tenantLookup.FindByIdAsync(tenantId, context.RequestAborted)
            : await tenantLookup.FindBySlugAsync(rawValue, context.RequestAborted);

        if (identity is null)
        {
            _logger.LogWarning("Unresolved tenant '{TenantKey}' from {Source}.", rawValue, source);

            await WriteProblemAsync(context, StatusCodes.Status404NotFound,
                "Tenant not found",
                $"No tenant matches '{rawValue}'.");
            return;
        }

        currentTenant.Set(identity.Id, identity.Slug);

        // Echoed back so clients (and logs) can confirm which tenant served the request.
        context.Response.Headers["X-Tenant-Id"] = identity.Id.ToString();
        context.Items["TenantId"] = identity.Id;
        context.Items["TenantSlug"] = identity.Slug;

        using (_logger.BeginScope(new Dictionary<string, object>
               {
                   ["TenantId"] = identity.Id,
                   ["TenantSlug"] = identity.Slug
               }))
        {
            await _next(context);
        }
    }

    private bool IsBypassed(PathString path)
        => _options.BypassPathPrefixes.Any(prefix =>
            path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase));

    private bool IsTenantOptional(PathString path)
        => _options.TenantOptionalPathPrefixes.Any(prefix =>
            path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase));

    private (string? Value, string Source) ExtractTenantKey(HttpContext context)
    {
        if (context.Request.Headers.TryGetValue(_options.HeaderName, out var header) &&
            !string.IsNullOrWhiteSpace(header))
        {
            return (header.ToString().Trim(), "header");
        }

        // /api/t/{slug}/rest-of-path
        if (!string.IsNullOrEmpty(_options.SlugRoutePrefix) &&
            context.Request.Path.StartsWithSegments(_options.SlugRoutePrefix, StringComparison.OrdinalIgnoreCase, out var remaining) &&
            remaining.HasValue)
        {
            var slug = remaining.Value!.Trim('/').Split('/', 2)[0];
            if (!string.IsNullOrWhiteSpace(slug)) return (slug, "route");
        }

        return (null, "none");
    }

    private static async Task WriteProblemAsync(HttpContext context, int statusCode, string title, string detail)
    {
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/problem+json";

        await context.Response.WriteAsJsonAsync(new
        {
            type = $"https://httpstatuses.io/{statusCode}",
            title,
            status = statusCode,
            detail,
            traceId = context.TraceIdentifier
        });
    }
}

public static class TenantMiddlewareExtensions
{
    /// <summary>Must run before any endpoint that touches the DbContext.</summary>
    public static IApplicationBuilder UseTenantResolution(this IApplicationBuilder app)
        => app.UseMiddleware<TenantMiddleware>();
}
