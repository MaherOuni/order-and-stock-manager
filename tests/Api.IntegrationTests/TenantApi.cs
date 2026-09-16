using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Application.Features.Categories;
using Application.Features.Ingredients;
using Application.Features.Inventory;
using Application.Features.Orders;
using Application.Features.Products;
using Application.Features.Recipes;
using Application.Features.Tenants;
using Domain.Enums;

namespace Api.IntegrationTests;

/// <summary>
/// A freshly provisioned tenant plus an <see cref="HttpClient"/> already carrying its
/// X-Tenant-Id header. Every test gets its own, so nothing leaks between them.
/// </summary>
public sealed class TenantApi
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };

    private readonly PostgresApiFactory _factory;

    private TenantApi(PostgresApiFactory factory, HttpClient client, Guid id, string slug)
    {
        _factory = factory;
        Client = client;
        Id = id;
        Slug = slug;
    }

    public HttpClient Client { get; }

    public Guid Id { get; }

    public string Slug { get; }

    /// <summary>A client with no X-Tenant-Id header, as a customer scanning a QR code has.</summary>
    public HttpClient PublicClient() => _factory.CreateClient();

    public static async Task<TenantApi> ProvisionAsync(PostgresApiFactory factory, string prefix = "t")
    {
        var slug = $"{prefix}-{Guid.NewGuid():N}";

        // /api/v1/tenants is bypassed by the tenant middleware — it is what creates tenants.
        using var admin = factory.CreateClient();
        var response = await admin.PostAsJsonAsync("/api/v1/tenants",
            new { name = $"Test {prefix}", slug, currency = "TND" }, Json);

        await response.EnsureSuccessAsync();

        var tenant = (await response.Content.ReadFromJsonAsync<TenantDto>(Json))!;

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Tenant-Id", slug);

        return new TenantApi(factory, client, tenant.Id, slug);
    }

    public async Task<IngredientDto> CreateIngredientAsync(
        string name, string unit = "kg", decimal stock = 0m, decimal minimumAlert = 0m)
    {
        var response = await Client.PostAsJsonAsync("/api/v1/ingredients",
            new CreateIngredientRequest(name, unit, stock, minimumAlert), Json);

        await response.EnsureSuccessAsync();

        return (await response.Content.ReadFromJsonAsync<IngredientDto>(Json))!;
    }

    public async Task<Guid> CreateCategoryAsync(string name = "Menu", int sortOrder = 1)
    {
        var response = await Client.PostAsJsonAsync("/api/v1/categories",
            new CreateCategoryRequest(name, sortOrder), Json);

        await response.EnsureSuccessAsync();

        return (await response.Content.ReadFromJsonAsync<CategoryDto>(Json))!.Id;
    }

    /// <summary>Creates a product and maps its recipe in one go.</summary>
    public async Task<Guid> CreateProductAsync(
        string name, decimal price = 5m, params (Guid IngredientId, decimal Quantity)[] recipe)
    {
        var categoryId = await CreateCategoryAsync($"cat-{Guid.NewGuid():N}");

        var response = await Client.PostAsJsonAsync("/api/v1/products",
            new CreateProductRequest(categoryId, name, price, null), Json);

        await response.EnsureSuccessAsync();

        var product = (await response.Content.ReadFromJsonAsync<ProductDto>(Json))!;

        if (recipe.Length > 0)
            await SetRecipeAsync(product.Id, recipe);

        return product.Id;
    }

    public async Task<ProductRecipeDto> SetRecipeAsync(
        Guid productId, params (Guid IngredientId, decimal Quantity)[] recipe)
    {
        var request = new SetRecipeRequest(
            recipe.Select(r => new RecipeLineRequest(r.IngredientId, r.Quantity)).ToList());

        var response = await Client.PostAsJsonAsync($"/api/v1/products/{productId}/recipe", request, Json);

        await response.EnsureSuccessAsync();

        return (await response.Content.ReadFromJsonAsync<ProductRecipeDto>(Json))!;
    }

    public async Task<IngredientDto> GetIngredientAsync(Guid ingredientId)
    {
        var response = await Client.GetAsync($"/api/v1/ingredients/{ingredientId}");

        await response.EnsureSuccessAsync();

        return (await response.Content.ReadFromJsonAsync<IngredientDto>(Json))!;
    }

    public async Task<IReadOnlyList<StockLogDto>> GetLogsAsync(Guid ingredientId)
    {
        var response = await Client.GetAsync($"/api/v1/ingredients/{ingredientId}/stock-logs?take=100");

        await response.EnsureSuccessAsync();

        return (await response.Content.ReadFromJsonAsync<List<StockLogDto>>(Json))!;
    }

    public Task<HttpResponseMessage> CheckAvailabilityAsync(params OrderItemDto[] items)
        => Client.PostAsJsonAsync("/api/v1/stock/availability", items, Json);

    public Task<HttpResponseMessage> DeductAsync(params OrderItemDto[] items)
        => Client.PostAsJsonAsync("/api/v1/stock/deduct", items, Json);

    public Task<HttpResponseMessage> AdjustAsync(Guid ingredientId, StockAdjustmentRequest request)
        => Client.PostAsJsonAsync($"/api/v1/ingredients/{ingredientId}/adjust", request, Json);

    /// <summary>
    /// Places an order the way a customer does: an anonymous client, no tenant header, the
    /// restaurant named by slug in the body.
    /// </summary>
    public Task<HttpResponseMessage> PlaceOrderAsync(string tableNumber, params OrderItemDto[] items)
        => PlaceOrderAsAsync(Slug, tableNumber, items);

    /// <summary>Same, but addressing an arbitrary slug — for the "wrong restaurant" cases.</summary>
    public Task<HttpResponseMessage> PlaceOrderAsAsync(
        string tenantSlug, string tableNumber, params OrderItemDto[] items)
        => PublicClient().PostAsJsonAsync("/api/v1/orders", DineIn(tenantSlug, tableNumber, items), Json);

    /// <summary>The common case these tests exercise: a dine-in order paid in cash.</summary>
    public static CreateOrderCommand DineIn(
        string tenantSlug, string tableNumber, params OrderItemDto[] items)
        => new(
            tenantSlug,
            items.Select(i => new OrderLineRequest(i.ProductId, i.Quantity)).ToList(),
            OrderType.DineIn,
            tableNumber);

    public async Task<OrderDto> PlaceOrderOkAsync(string tableNumber, params OrderItemDto[] items)
    {
        var response = await PlaceOrderAsync(tableNumber, items);

        await response.EnsureSuccessAsync();

        return (await response.Content.ReadFromJsonAsync<OrderDto>(Json))!;
    }

    /// <summary>The admin board, addressed by tenant id in the route.</summary>
    public async Task<IReadOnlyList<OrderDto>> GetOrdersAsync(OrderStatus? status = null)
    {
        var query = status is { } s ? $"?status={s}" : string.Empty;

        var response = await Client.GetAsync($"/api/v1/orders/tenant/{Id}{query}");

        await response.EnsureSuccessAsync();

        return (await response.Content.ReadFromJsonAsync<List<OrderDto>>(Json))!;
    }

    /// <summary>Marks an order served, as the admin board does. Needs the tenant header.</summary>
    public Task<HttpResponseMessage> CompleteOrderAsync(Guid orderId)
        => Client.PostAsync($"/api/v1/orders/{orderId}/complete", content: null);

    /// <summary>Takes a product off the menu without deleting it.</summary>
    public async Task DeactivateProductAsync(Guid productId)
    {
        var current = (await (await Client.GetAsync($"/api/v1/products/{productId}"))
            .Content.ReadFromJsonAsync<ProductDto>(Json))!;

        var response = await Client.PutAsJsonAsync(
            $"/api/v1/products/{productId}",
            // PUT replaces the whole product, so every field is echoed back except the one
            // under test.
            new UpdateProductRequest(
                current.CategoryId, current.Name, current.Price, current.Description,
                IsActive: false, ImageUrl: current.ImageUrl),
            Json);

        await response.EnsureSuccessAsync();
    }
}

internal static class HttpResponseMessageExtensions
{
    /// <summary>Like EnsureSuccessStatusCode, but puts the problem document in the failure message.</summary>
    public static async Task EnsureSuccessAsync(this HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;

        var body = await response.Content.ReadAsStringAsync();

        throw new HttpRequestException(
            $"{(int)response.StatusCode} {response.StatusCode} from {response.RequestMessage?.RequestUri}: {body}");
    }
}
