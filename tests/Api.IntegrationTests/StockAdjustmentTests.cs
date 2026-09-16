using System.Net;
using System.Net.Http.Json;
using Application.Features.Ingredients;
using Application.Features.Inventory;
using Domain.Enums;
using FluentAssertions;
using Xunit;

namespace Api.IntegrationTests;

/// <summary>
/// Manual stock movements. The invariant under test: stock never moves without a ledger line,
/// and never goes negative.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class StockAdjustmentTests
{
    private readonly PostgresApiFactory _factory;

    public StockAdjustmentTests(PostgresApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Opening_stock_is_recorded_as_the_first_ledger_line()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "opening");

        var flour = await api.CreateIngredientAsync("Flour", "kg", 25m);

        var logs = await api.GetLogsAsync(flour.Id);

        logs.Should().ContainSingle();
        logs[0].ChangeAmount.Should().Be(25m);
        logs[0].PreviousStock.Should().Be(0m);
        logs[0].NewStock.Should().Be(25m);
        logs[0].Reason.Should().Be(StockChangeReason.InventoryCount);
    }

    [Fact]
    public async Task Positive_adjustment_adds_stock_and_logs_the_reason()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "delivery");

        var flour = await api.CreateIngredientAsync("Flour", "kg", 10m);

        var response = await api.AdjustAsync(flour.Id,
            new StockAdjustmentRequest(15.5m, StockChangeReason.Delivery, "Pallet #42"));

        await response.EnsureSuccessAsync();

        var result = (await response.Content.ReadFromJsonAsync<StockMovementResult>(TenantApi.Json))!;

        result.CurrentStock.Should().Be(25.5m);
        result.Log.ChangeAmount.Should().Be(15.5m);
        result.Log.PreviousStock.Should().Be(10m);
        result.Log.NewStock.Should().Be(25.5m);
        result.Log.Reason.Should().Be(StockChangeReason.Delivery);
        result.Log.Note.Should().Be("Pallet #42");
    }

    [Fact]
    public async Task Negative_adjustment_removes_stock_and_logs_the_reason()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "waste");

        var milk = await api.CreateIngredientAsync("Milk", "L", 8m);

        var response = await api.AdjustAsync(milk.Id,
            new StockAdjustmentRequest(-1.25m, StockChangeReason.Waste, "Spilled crate"));

        await response.EnsureSuccessAsync();

        var result = (await response.Content.ReadFromJsonAsync<StockMovementResult>(TenantApi.Json))!;

        result.CurrentStock.Should().Be(6.75m);
        result.Log.ChangeAmount.Should().Be(-1.25m);
        result.Log.Reason.Should().Be(StockChangeReason.Waste);
    }

    [Fact]
    public async Task Adjustment_below_zero_is_rejected_and_leaves_stock_alone()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "negative");

        var milk = await api.CreateIngredientAsync("Milk", "L", 2m);

        var response = await api.AdjustAsync(milk.Id,
            new StockAdjustmentRequest(-5m, StockChangeReason.Waste, null));

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);

        (await api.GetIngredientAsync(milk.Id)).CurrentStock.Should().Be(2m);
        (await api.GetLogsAsync(milk.Id)).Should().ContainSingle(); // opening stock only
    }

    [Fact]
    public async Task Adjustment_of_zero_is_rejected()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "zero");

        var milk = await api.CreateIngredientAsync("Milk", "L", 2m);

        var response = await api.AdjustAsync(milk.Id,
            new StockAdjustmentRequest(0m, StockChangeReason.Manual, null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Recount_logs_the_difference_between_counted_and_recorded_stock()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "recount");

        var sugar = await api.CreateIngredientAsync("Sugar", "kg", 10m);

        var response = await api.Client.PostAsJsonAsync(
            $"/api/v1/ingredients/{sugar.Id}/recount",
            new StockRecountRequest(8.4m, "Monthly count"), TenantApi.Json);

        await response.EnsureSuccessAsync();

        var result = (await response.Content.ReadFromJsonAsync<StockMovementResult>(TenantApi.Json))!;

        result.CurrentStock.Should().Be(8.4m);
        result.Log.ChangeAmount.Should().Be(-1.6m);
        result.Log.Reason.Should().Be(StockChangeReason.InventoryCount);
    }

    [Fact]
    public async Task Recount_that_matches_current_stock_writes_no_ledger_line()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "nochange");

        var sugar = await api.CreateIngredientAsync("Sugar", "kg", 10m);

        var response = await api.Client.PostAsJsonAsync(
            $"/api/v1/ingredients/{sugar.Id}/recount",
            new StockRecountRequest(10m, null), TenantApi.Json);

        await response.EnsureSuccessAsync();

        (await api.GetLogsAsync(sugar.Id)).Should().ContainSingle(); // opening stock only
    }

    [Fact]
    public async Task Low_stock_filter_returns_ingredients_at_or_below_their_alert()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "lowstock");

        await api.CreateIngredientAsync("Plenty", "kg", 50m, minimumAlert: 5m);
        await api.CreateIngredientAsync("Running out", "kg", 2m, minimumAlert: 5m);

        var response = await api.Client.GetAsync("/api/v1/ingredients?lowStockOnly=true");
        await response.EnsureSuccessAsync();

        var lowStock = (await response.Content.ReadFromJsonAsync<List<IngredientDto>>(TenantApi.Json))!;

        lowStock.Should().ContainSingle();
        lowStock[0].Name.Should().Be("Running out");
        lowStock[0].IsBelowMinimum.Should().BeTrue();
    }

    [Fact]
    public async Task Adjusting_another_tenants_ingredient_is_not_found()
    {
        var owner = await TenantApi.ProvisionAsync(_factory, "owns");
        var stranger = await TenantApi.ProvisionAsync(_factory, "other");

        var flour = await owner.CreateIngredientAsync("Flour", "kg", 10m);

        var response = await stranger.AdjustAsync(flour.Id,
            new StockAdjustmentRequest(-5m, StockChangeReason.Waste, null));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        (await owner.GetIngredientAsync(flour.Id)).CurrentStock.Should().Be(10m);
    }
}
