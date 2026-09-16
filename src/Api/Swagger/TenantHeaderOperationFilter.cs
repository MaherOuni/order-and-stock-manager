using Microsoft.OpenApi.Any;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace Api.Swagger;

/// <summary>
/// Adds the X-Tenant-Id header parameter to every operation except tenant provisioning,
/// which is what runs without a tenant context. On the order endpoints the header is offered
/// but optional: they name their own tenant (a slug in the body, a tenant id in the route).
/// </summary>
public sealed class TenantHeaderOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var relativePath = context.ApiDescription.RelativePath ?? string.Empty;

        if (relativePath.StartsWith("api/v1/tenants", StringComparison.OrdinalIgnoreCase))
            return;

        var optional = relativePath.StartsWith("api/v1/orders", StringComparison.OrdinalIgnoreCase);

        operation.Parameters ??= new List<OpenApiParameter>();

        operation.Parameters.Add(new OpenApiParameter
        {
            Name = "X-Tenant-Id",
            In = ParameterLocation.Header,
            Required = !optional,
            Description = optional
                ? "Tenant id (Guid) or tenant slug. Optional here — the request names its own tenant."
                : "Tenant id (Guid) or tenant slug.",
            Schema = new OpenApiSchema { Type = "string" },
            Example = new OpenApiString("demo-resto")
        });
    }
}
