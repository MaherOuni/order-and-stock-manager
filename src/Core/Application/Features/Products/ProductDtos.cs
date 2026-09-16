namespace Application.Features.Products;

public sealed record ProductDto(
    Guid Id,
    Guid CategoryId,
    string CategoryName,
    string Name,
    string? Description,
    string? ImageUrl,
    decimal Price,
    bool IsActive,
    int RecipeItemCount);

/// <param name="ImageUrl">Menu photo: an http(s) URL, or a path on this host. Optional.</param>
public sealed record CreateProductRequest(
    Guid CategoryId,
    string Name,
    decimal Price,
    string? Description,
    bool IsActive = true,
    string? ImageUrl = null);

public sealed record UpdateProductRequest(
    Guid CategoryId,
    string Name,
    decimal Price,
    string? Description,
    bool IsActive,
    string? ImageUrl = null);
