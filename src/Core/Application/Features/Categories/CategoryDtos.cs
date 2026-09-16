namespace Application.Features.Categories;

public sealed record CategoryDto(Guid Id, string Name, int SortOrder, int ProductCount);

public sealed record CreateCategoryRequest(string Name, int SortOrder);

public sealed record UpdateCategoryRequest(string Name, int SortOrder);
