using Application.Common.Tenancy;
using Application.Features.Categories;
using Application.Features.CustomerCare;
using Application.Features.Ingredients;
using Application.Features.Inventory;
using Application.Features.Orders;
using Application.Features.Products;
using Application.Features.Recipes;
using Application.Features.Tenants;
using Microsoft.Extensions.DependencyInjection;

namespace Application;

public static class DependencyInjection
{
    /// <summary>Registers the business services. All are scoped: they ride the request's tenant context.</summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<ITenantBinder, TenantBinder>();
        services.AddScoped<ITenantService, TenantService>();
        services.AddScoped<IFloorPlanService, FloorPlanService>();
        services.AddScoped<ICategoryService, CategoryService>();
        services.AddScoped<IProductService, ProductService>();
        services.AddScoped<IIngredientService, IngredientService>();
        services.AddScoped<IRecipeService, RecipeService>();
        services.AddScoped<IStockService, StockService>();
        services.AddScoped<ICreateOrderCommandHandler, CreateOrderCommandHandler>();
        services.AddScoped<ICompleteOrderCommandHandler, CompleteOrderCommandHandler>();
        services.AddScoped<ICancelOrderCommandHandler, CancelOrderCommandHandler>();
        services.AddScoped<IServiceRequestService, ServiceRequestService>();
        services.AddScoped<IOrderReviewService, OrderReviewService>();
        services.AddScoped<IOrderQueryService, OrderQueryService>();

        return services;
    }
}
