using System.Net;
using System.Net.Http.Json;
using Application.Features.Recipes;
using FluentAssertions;
using Xunit;

namespace Api.IntegrationTests;

/// <summary>Mapping ingredients to a product — the data stock deduction walks.</summary>
[Collection(ApiCollection.Name)]
public sealed class RecipeMappingTests
{
    private readonly PostgresApiFactory _factory;

    public RecipeMappingTests(PostgresApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Setting_a_recipe_maps_several_ingredients_at_once()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "map");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 5m);
        var milk = await api.CreateIngredientAsync("Milk", "L", 10m);
        var cups = await api.CreateIngredientAsync("Cups", "unit", 200m);

        var latte = await api.CreateProductAsync("Latte", 4.5m);

        var recipe = await api.SetRecipeAsync(latte,
            (coffee.Id, 0.018m), (milk.Id, 0.2m), (cups.Id, 1m));

        recipe.Items.Should().HaveCount(3);
        recipe.Items.Select(i => i.IngredientName).Should().BeEquivalentTo("Coffee", "Milk", "Cups");
        recipe.Items.Single(i => i.IngredientName == "Milk").QuantityRequired.Should().Be(0.2m);
        recipe.Items.Single(i => i.IngredientName == "Milk").Unit.Should().Be("L");
    }

    [Fact]
    public async Task Setting_a_recipe_replaces_the_previous_lines()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "replace");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 5m);
        var milk = await api.CreateIngredientAsync("Milk", "L", 10m);
        var syrup = await api.CreateIngredientAsync("Syrup", "L", 3m);

        var latte = await api.CreateProductAsync("Latte", 4.5m, (coffee.Id, 0.018m), (milk.Id, 0.2m));

        // Milk stays (with a new quantity), coffee goes, syrup arrives.
        var recipe = await api.SetRecipeAsync(latte, (milk.Id, 0.25m), (syrup.Id, 0.02m));

        recipe.Items.Should().HaveCount(2);
        recipe.Items.Select(i => i.IngredientName).Should().BeEquivalentTo("Milk", "Syrup");
        recipe.Items.Single(i => i.IngredientName == "Milk").QuantityRequired.Should().Be(0.25m);
    }

    [Fact]
    public async Task An_empty_recipe_clears_the_bill_of_materials()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "clear");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 5m);
        var latte = await api.CreateProductAsync("Latte", 4.5m, (coffee.Id, 0.018m));

        var recipe = await api.SetRecipeAsync(latte);

        recipe.Items.Should().BeEmpty();
    }

    [Fact]
    public async Task An_ingredient_cannot_appear_twice_in_one_recipe()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "dupe");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 5m);
        var latte = await api.CreateProductAsync("Latte", 4.5m);

        var request = new SetRecipeRequest(new List<RecipeLineRequest>
        {
            new(coffee.Id, 0.01m),
            new(coffee.Id, 0.02m)
        });

        var response = await api.Client.PostAsJsonAsync(
            $"/api/v1/products/{latte}/recipe", request, TenantApi.Json);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task An_unknown_ingredient_is_rejected()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "unknown");

        var latte = await api.CreateProductAsync("Latte", 4.5m);

        var request = new SetRecipeRequest(new List<RecipeLineRequest> { new(Guid.NewGuid(), 0.01m) });

        var response = await api.Client.PostAsJsonAsync(
            $"/api/v1/products/{latte}/recipe", request, TenantApi.Json);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_recipe_cannot_reference_another_tenants_ingredient()
    {
        var owner = await TenantApi.ProvisionAsync(_factory, "hasflour");
        var stranger = await TenantApi.ProvisionAsync(_factory, "wantsflour");

        var flour = await owner.CreateIngredientAsync("Flour", "kg", 10m);
        var bread = await stranger.CreateProductAsync("Bread", 2m);

        var request = new SetRecipeRequest(new List<RecipeLineRequest> { new(flour.Id, 0.5m) });

        var response = await stranger.Client.PostAsJsonAsync(
            $"/api/v1/products/{bread}/recipe", request, TenantApi.Json);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Max_producible_units_is_capped_by_the_scarcest_ingredient()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "capped");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 1m);   // 1 / 0.018  => 55
        var milk = await api.CreateIngredientAsync("Milk", "L", 2m);        // 2 / 0.2    => 10
        var cups = await api.CreateIngredientAsync("Cups", "unit", 500m);   // 500 / 1    => 500

        var latte = await api.CreateProductAsync("Latte", 4.5m,
            (coffee.Id, 0.018m), (milk.Id, 0.2m), (cups.Id, 1m));

        var response = await api.Client.GetAsync($"/api/v1/products/{latte}/recipe");
        await response.EnsureSuccessAsync();

        var recipe = (await response.Content.ReadFromJsonAsync<ProductRecipeDto>(TenantApi.Json))!;

        recipe.MaxProducibleUnits.Should().Be(10);
    }

    [Fact]
    public async Task Quantities_must_be_greater_than_zero()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "zeroqty");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 5m);
        var latte = await api.CreateProductAsync("Latte", 4.5m);

        var request = new SetRecipeRequest(new List<RecipeLineRequest> { new(coffee.Id, 0m) });

        var response = await api.Client.PostAsJsonAsync(
            $"/api/v1/products/{latte}/recipe", request, TenantApi.Json);

        // Domain invariant, surfaced as 422.
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }
}
