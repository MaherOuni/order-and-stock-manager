using System.Linq.Expressions;
using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Products;

public interface IProductService
{
    Task<IReadOnlyList<ProductDto>> GetAllAsync(Guid? categoryId, bool includeInactive, CancellationToken ct = default);
    Task<ProductDto> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<ProductDto> CreateAsync(CreateProductRequest request, CancellationToken ct = default);
    Task<ProductDto> UpdateAsync(Guid id, UpdateProductRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}

public sealed class ProductService : IProductService
{
    private readonly IApplicationDbContext _db;

    public ProductService(IApplicationDbContext db) => _db = db;

    public async Task<IReadOnlyList<ProductDto>> GetAllAsync(
        Guid? categoryId, bool includeInactive, CancellationToken ct = default)
    {
        var query = _db.Products.AsNoTracking();

        if (categoryId is { } id)
            query = query.Where(p => p.CategoryId == id);

        if (!includeInactive)
            query = query.Where(p => p.IsActive);

        return await query
            .OrderBy(p => p.Category!.SortOrder).ThenBy(p => p.Name)
            .Select(Projection)
            .ToListAsync(ct);
    }

    public async Task<ProductDto> GetByIdAsync(Guid id, CancellationToken ct = default)
        => await _db.Products
               .AsNoTracking()
               .Where(p => p.Id == id)
               .Select(Projection)
               .FirstOrDefaultAsync(ct)
           ?? throw new NotFoundException(nameof(Product), id);

    public async Task<ProductDto> CreateAsync(CreateProductRequest request, CancellationToken ct = default)
    {
        // The filtered lookup is what prevents attaching a product to another tenant's category.
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == request.CategoryId, ct)
                       ?? throw new NotFoundException(nameof(Category), request.CategoryId);

        if (await _db.Products.AnyAsync(p => p.Name == request.Name, ct))
            throw new ConflictException($"A product named '{request.Name}' already exists.");

        var product = new Product(
            category.Id, request.Name, request.Price, request.Description, request.IsActive, request.ImageUrl);

        _db.Products.Add(product);
        await _db.SaveChangesAsync(ct);

        return new ProductDto(product.Id, category.Id, category.Name, product.Name,
            product.Description, product.ImageUrl, product.Price, product.IsActive, 0);
    }

    public async Task<ProductDto> UpdateAsync(Guid id, UpdateProductRequest request, CancellationToken ct = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id, ct)
                      ?? throw new NotFoundException(nameof(Product), id);

        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == request.CategoryId, ct)
                       ?? throw new NotFoundException(nameof(Category), request.CategoryId);

        if (await _db.Products.AnyAsync(p => p.Name == request.Name && p.Id != id, ct))
            throw new ConflictException($"A product named '{request.Name}' already exists.");

        product.MoveToCategory(category.Id);
        product.Rename(request.Name);
        product.ChangePrice(request.Price);
        product.UpdateDescription(request.Description);
        product.SetImageUrl(request.ImageUrl);
        if (request.IsActive) product.Activate(); else product.Deactivate();

        await _db.SaveChangesAsync(ct);

        var recipeItemCount = await _db.RecipeItems.CountAsync(r => r.ProductId == id, ct);

        return new ProductDto(product.Id, category.Id, category.Name, product.Name,
            product.Description, product.ImageUrl, product.Price, product.IsActive, recipeItemCount);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id, ct)
                      ?? throw new NotFoundException(nameof(Product), id);

        // Recipe lines cascade with the product; ingredients and their stock are untouched.
        _db.Products.Remove(product);
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>Kept as an expression so it composes into the SQL projection.</summary>
    private static readonly Expression<Func<Product, ProductDto>> Projection = p => new ProductDto(
        p.Id,
        p.CategoryId,
        p.Category!.Name,
        p.Name,
        p.Description,
        p.ImageUrl,
        p.Price,
        p.IsActive,
        p.RecipeItems.Count);
}
