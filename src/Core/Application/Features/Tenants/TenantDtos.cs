namespace Application.Features.Tenants;

public sealed record TenantDto(Guid Id, string Name, string Slug, string Currency, DateTimeOffset CreatedAt);

/// <summary>Slug is optional: it is derived from the name when omitted.</summary>
public sealed record CreateTenantRequest(string Name, string? Slug, string Currency);

public sealed record UpdateTenantRequest(string Name, string Currency);
