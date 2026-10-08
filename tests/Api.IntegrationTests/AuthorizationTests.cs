using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Application.Features.Products;
using Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Api.IntegrationTests;

/// <summary>
/// What the API lets an anonymous caller do, and what it does not.
///
/// The admin surface used to be entirely open — a slug in a header was the only thing standing
/// between a stranger and another restaurant's menu and stock. These tests pin the boundary so
/// it cannot drift back.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class AuthorizationTests
{
    private const string Password = "role-test-password";

    private readonly PostgresApiFactory _factory;

    public AuthorizationTests(PostgresApiFactory factory) => _factory = factory;

    // ----------------------------------------------------- the customer may still order --

    [Fact]
    public async Task A_customer_can_read_the_menu_without_signing_in()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "pub");
        await api.CreateProductAsync("Espresso", 2.2m);

        using var anonymous = Anonymous(api.Slug);

        foreach (var path in new[] { "/api/v1/products", "/api/v1/categories" })
        {
            var response = await anonymous.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        var bySlug = await _factory.CreateClient().GetAsync($"/api/v1/tenants/by-slug/{api.Slug}");
        Assert.Equal(HttpStatusCode.OK, bySlug.StatusCode);
    }

    [Fact]
    public async Task A_customer_can_read_the_customizations_for_a_dish()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "pubcust");
        var product = await api.CreateProductAsync("Café Crème", 3.5m);

        using var anonymous = Anonymous(api.Slug);

        var response = await anonymous.GetAsync($"/api/v1/products/{product}/customizations");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ------------------------------------------------ but not learn the restaurant's business --

    /// <summary>
    /// The full recipe carries quantities, live stock and how many units are still makeable.
    /// That is the formulation and the inventory; a scanned QR code does not entitle you to it.
    /// </summary>
    [Fact]
    public async Task A_customer_cannot_read_the_full_recipe()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "recipe");
        var product = await api.CreateProductAsync("Café Crème", 3.5m);

        using var anonymous = Anonymous(api.Slug);

        var response = await anonymous.GetAsync($"/api/v1/products/{product}/recipe");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// `includeInactive=true` is how the admin screen sees hidden dishes. Asking for it without
    /// signing in must not widen what comes back.
    /// </summary>
    [Fact]
    public async Task IncludeInactive_is_ignored_for_anonymous_callers()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "hidden");

        var visible = await api.CreateProductAsync("On the menu", 4m);
        var hidden = await api.CreateProductAsync("Taken off", 5m);

        // Update is a full replacement, so the category has to be carried over or the product
        // would be moved to an empty one.
        var current = await api.Client.GetFromJsonAsync<ProductDto>(
            $"/api/v1/products/{hidden}", TenantApi.Json);

        var deactivated = await api.Client.PutAsJsonAsync($"/api/v1/products/{hidden}",
            new UpdateProductRequest(current!.CategoryId, current.Name, current.Price, null, IsActive: false),
            TenantApi.Json);

        await deactivated.EnsureSuccessAsync();

        using var anonymous = Anonymous(api.Slug);

        var response = await anonymous.GetAsync("/api/v1/products?includeInactive=true");
        await response.EnsureSuccessAsync();

        var body = await response.Content.ReadAsStringAsync();

        Assert.Contains(visible.ToString(), body);
        Assert.DoesNotContain(hidden.ToString(), body);
    }

    [Theory]
    [InlineData("GET", "/api/v1/ingredients")]
    [InlineData("GET", "/api/v1/stock/logs")]
    [InlineData("GET", "/api/v1/floor-plan")]
    [InlineData("GET", "/api/v1/service-requests")]
    [InlineData("GET", "/api/v1/reviews")]
    [InlineData("GET", "/api/v1/tenants")]
    public async Task Staff_only_reads_are_refused_without_a_token(string method, string path)
    {
        var api = await TenantApi.ProvisionAsync(_factory, "deny");

        using var anonymous = Anonymous(api.Slug);

        var response = await anonymous.SendAsync(new HttpRequestMessage(new HttpMethod(method), path));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Anonymous_callers_cannot_change_the_menu()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "nowrite");
        var product = await api.CreateProductAsync("Espresso", 2.2m);

        using var anonymous = Anonymous(api.Slug);

        var created = await anonymous.PostAsJsonAsync("/api/v1/products",
            new { name = "Free coffee", price = 0m }, TenantApi.Json);
        Assert.Equal(HttpStatusCode.Unauthorized, created.StatusCode);

        var deleted = await anonymous.DeleteAsync($"/api/v1/products/{product}");
        Assert.Equal(HttpStatusCode.Unauthorized, deleted.StatusCode);

        var priced = await anonymous.PutAsJsonAsync($"/api/v1/products/{product}",
            new { name = "Espresso", price = 0.01m, isActive = true }, TenantApi.Json);
        Assert.Equal(HttpStatusCode.Unauthorized, priced.StatusCode);
    }

    [Fact]
    public async Task Anonymous_callers_cannot_provision_a_restaurant()
    {
        using var anonymous = _factory.CreateClient();

        var response = await anonymous.PostAsJsonAsync("/api/v1/tenants",
            new { name = "Squatter", slug = $"squat-{Guid.NewGuid():N}", currency = "TND" },
            TenantApi.Json);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ------------------------------------------------------------ roles separate duties --

    /// <summary>Floor staff run the service desk; they do not get to reprice the menu.</summary>
    [Fact]
    public async Task Floor_staff_cannot_change_the_menu()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "roles");
        var product = await api.CreateProductAsync("Espresso", 2.2m);

        using var floor = await SignedInAsAsync(api.Id, AppRoles.Staff);

        var priced = await floor.PutAsJsonAsync($"/api/v1/products/{product}",
            new { name = "Espresso", price = 0.01m, isActive = true }, TenantApi.Json);

        Assert.Equal(HttpStatusCode.Forbidden, priced.StatusCode);
    }

    [Fact]
    public async Task Floor_staff_can_work_the_service_desk()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "desk");

        using var floor = await SignedInAsAsync(api.Id, AppRoles.Staff);

        var response = await floor.GetAsync("/api/v1/service-requests");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task An_owner_cannot_provision_other_restaurants()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "ownerlimit");

        // api.Client is already signed in as this restaurant's Owner.
        var response = await api.Client.PostAsJsonAsync("/api/v1/tenants",
            new { name = "Second site", slug = $"second-{Guid.NewGuid():N}", currency = "TND" },
            TenantApi.Json);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ------------------------------------------------------------------------- helpers --

    /// <summary>A customer's client: the tenant header a QR link implies, and no token.</summary>
    private HttpClient Anonymous(string slug)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Tenant-Id", slug);

        return client;
    }

    private async Task<HttpClient> SignedInAsAsync(Guid tenantId, string role)
    {
        var email = $"{role.ToLowerInvariant()}-{Guid.NewGuid():N}@example.test";

        using (var scope = _factory.Services.CreateScope())
        {
            var sp = scope.ServiceProvider;

            var roles = sp.GetRequiredService<RoleManager<AppRole>>();
            if (!await roles.RoleExistsAsync(role)) await roles.CreateAsync(new AppRole(role));

            var users = sp.GetRequiredService<UserManager<AppUser>>();
            var user = new AppUser
            {
                Id = Guid.NewGuid(),
                UserName = email,
                Email = email,
                DisplayName = role,
                TenantId = tenantId,
                EmailConfirmed = true
            };

            var created = await users.CreateAsync(user, Password);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));

            await users.AddToRoleAsync(user, role);
        }

        var client = _factory.CreateClient();

        var signIn = await client.PostAsJsonAsync("/api/v1/auth/login",
            new { email, password = Password }, TenantApi.Json);

        await signIn.EnsureSuccessAsync();

        var token = (await signIn.Content.ReadFromJsonAsync<TokenOnly>(TenantApi.Json))!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return client;
    }

    private sealed record TokenOnly(string AccessToken);
}
