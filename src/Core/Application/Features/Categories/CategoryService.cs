using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Categories;

public interface ICategoryService
{
    Task<IReadOnlyList<CategoryDto>> GetAllAsync(CancellationToken ct = default);
    Task<CategoryDto> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<CategoryDto> CreateAsync(CreateCategoryRequest request, CancellationToken ct = default);
    Task<CategoryDto> UpdateAsync(Guid id, UpdateCategoryRequest request, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
}

/// <summary>
/// Every query below is implicitly scoped to the resolved tenant by the DbContext global
/// query filter — there is no TenantId in any predicate on purpose.
/// </summary>
public sealed class CategoryService : ICategoryService
{
    private readonly IApplicationDbContext _db;

    public CategoryService(IApplicationDbContext db) => _db = db;

    public async Task<IReadOnlyList<CategoryDto>> GetAllAsync(CancellationToken ct = default)
        => await _db.Categories
            .AsNoTracking()
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Name)
            .Select(c => new CategoryDto(c.Id, c.Name, c.SortOrder, c.Products.Count))
            .ToListAsync(ct);

    public async Task<CategoryDto> GetByIdAsync(Guid id, CancellationToken ct = default)
        => await _db.Categories
               .AsNoTracking()
               .Where(c => c.Id == id)
               .Select(c => new CategoryDto(c.Id, c.Name, c.SortOrder, c.Products.Count))
               .FirstOrDefaultAsync(ct)
           ?? throw new NotFoundException(nameof(Category), id);

    public async Task<CategoryDto> CreateAsync(CreateCategoryRequest request, CancellationToken ct = default)
    {
        if (await _db.Categories.AnyAsync(c => c.Name == request.Name, ct))
            throw new ConflictException($"A category named '{request.Name}' already exists.");

        var category = new Category(request.Name, request.SortOrder);

        _db.Categories.Add(category);
        await _db.SaveChangesAsync(ct);

        return new CategoryDto(category.Id, category.Name, category.SortOrder, 0);
    }

    public async Task<CategoryDto> UpdateAsync(Guid id, UpdateCategoryRequest request, CancellationToken ct = default)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id, ct)
                       ?? throw new NotFoundException(nameof(Category), id);

        if (await _db.Categories.AnyAsync(c => c.Name == request.Name && c.Id != id, ct))
            throw new ConflictException($"A category named '{request.Name}' already exists.");

        category.Rename(request.Name);
        category.Reorder(request.SortOrder);

        await _db.SaveChangesAsync(ct);

        var productCount = await _db.Products.CountAsync(p => p.CategoryId == id, ct);

        return new CategoryDto(category.Id, category.Name, category.SortOrder, productCount);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id, ct)
                       ?? throw new NotFoundException(nameof(Category), id);

        // Products restrict the delete at the database level; fail with a useful message first.
        if (await _db.Products.AnyAsync(p => p.CategoryId == id, ct))
            throw new ConflictException("Cannot delete a category that still contains products.");

        _db.Categories.Remove(category);
        await _db.SaveChangesAsync(ct);
    }
}
