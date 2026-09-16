using System.Net;
using System.Net.Http.Json;
using Application.Features.Inventory;
using Domain.Enums;
using FluentAssertions;
using Xunit;

namespace Api.IntegrationTests;

/// <summary>
/// Deduction is the operation an order will call, so these cover the paths that would cost
/// real money if they were wrong: overselling, partial deduction, and cross-tenant reads.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class StockDeductionTests
{
    private readonly PostgresApiFactory _factory;

    public StockDeductionTests(PostgresApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Deduct_reduces_stock_and_writes_one_ledger_line_per_ingredient()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "deduct");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 12m);
        var milk = await api.CreateIngredientAsync("Milk", "L", 20m);
        var cups = await api.CreateIngredientAsync("Cups", "unit", 500m);

        var latte = await api.CreateProductAsync("Latte", 4.5m,
            (coffee.Id, 0.018m), (milk.Id, 0.2m), (cups.Id, 1m));

        var response = await api.DeductAsync(new OrderItemDto(latte, 3));

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var result = (await response.Content.ReadFromJsonAsync<StockDeductionResult>(TenantApi.Json))!;
        result.Movements.Should().HaveCount(3);

        (await api.GetIngredientAsync(coffee.Id)).CurrentStock.Should().Be(11.946m); // 12 - 3 × 0.018
        (await api.GetIngredientAsync(milk.Id)).CurrentStock.Should().Be(19.4m);     // 20 - 3 × 0.2
        (await api.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(497m);

        var coffeeLog = (await api.GetLogsAsync(coffee.Id)).First();
        coffeeLog.Reason.Should().Be(StockChangeReason.OrderConsumption);
        coffeeLog.ChangeAmount.Should().Be(-0.054m);
        coffeeLog.PreviousStock.Should().Be(12m);
        coffeeLog.NewStock.Should().Be(11.946m);
    }

    [Fact]
    public async Task Deduct_changes_nothing_when_a_single_ingredient_is_short()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "short");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 5m);
        var milk = await api.CreateIngredientAsync("Milk", "L", 0.1m);
        var cups = await api.CreateIngredientAsync("Cups", "unit", 500m);

        var latte = await api.CreateProductAsync("Latte", 4.5m,
            (coffee.Id, 0.018m), (milk.Id, 0.2m), (cups.Id, 1m));

        var response = await api.DeductAsync(new OrderItemDto(latte, 3));

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);

        var problem = (await response.Content.ReadFromJsonAsync<ShortageProblem>(TenantApi.Json))!;
        problem.Shortages.Should().ContainSingle();

        var shortage = problem.Shortages[0];
        shortage.IngredientName.Should().Be("Milk");
        shortage.RequiredQuantity.Should().Be(0.6m);
        shortage.AvailableQuantity.Should().Be(0.1m);
        shortage.MissingQuantity.Should().Be(0.5m);
        shortage.BlockedProductIds.Should().Contain(latte);

        // All-or-nothing: the ingredients that *were* sufficient must be untouched.
        (await api.GetIngredientAsync(coffee.Id)).CurrentStock.Should().Be(5m);
        (await api.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(500m);
        (await api.GetIngredientAsync(milk.Id)).CurrentStock.Should().Be(0.1m);

        (await api.GetLogsAsync(coffee.Id))
            .Should().NotContain(l => l.Reason == StockChangeReason.OrderConsumption);
    }

    [Fact]
    public async Task Availability_reports_every_shortage_without_touching_stock()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "avail");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 0.01m);
        var milk = await api.CreateIngredientAsync("Milk", "L", 0.1m);

        var latte = await api.CreateProductAsync("Latte", 4.5m, (coffee.Id, 0.018m), (milk.Id, 0.2m));

        var response = await api.CheckAvailabilityAsync(new OrderItemDto(latte, 2));

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var result = (await response.Content.ReadFromJsonAsync<StockAvailabilityResult>(TenantApi.Json))!;

        result.IsAvailable.Should().BeFalse();
        result.Shortages.Should().HaveCount(2);
        result.Shortages.Select(s => s.IngredientName).Should().BeEquivalentTo("Coffee", "Milk");
        result.Shortages.Single(s => s.IngredientName == "Coffee").MissingQuantity.Should().Be(0.026m);

        // A check is a read: stock must be exactly where it was.
        (await api.GetIngredientAsync(coffee.Id)).CurrentStock.Should().Be(0.01m);
        (await api.GetIngredientAsync(milk.Id)).CurrentStock.Should().Be(0.1m);
    }

    [Fact]
    public async Task Availability_is_true_when_every_ingredient_suffices()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "ok");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 1m);
        var latte = await api.CreateProductAsync("Latte", 4.5m, (coffee.Id, 0.018m));

        var response = await api.CheckAvailabilityAsync(new OrderItemDto(latte, 10));
        var result = (await response.Content.ReadFromJsonAsync<StockAvailabilityResult>(TenantApi.Json))!;

        result.IsAvailable.Should().BeTrue();
        result.Shortages.Should().BeEmpty();
    }

    [Fact]
    public async Task Deduct_charges_the_total_when_a_product_appears_on_several_lines()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "dupes");

        var cups = await api.CreateIngredientAsync("Cups", "unit", 100m);
        var latte = await api.CreateProductAsync("Latte", 4.5m, (cups.Id, 1m));

        var response = await api.DeductAsync(
            new OrderItemDto(latte, 2),
            new OrderItemDto(latte, 3));

        await response.EnsureSuccessAsync();

        (await api.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(95m);

        // One aggregated movement, not one per line.
        (await api.GetLogsAsync(cups.Id))
            .Count(l => l.Reason == StockChangeReason.OrderConsumption)
            .Should().Be(1);
    }

    [Fact]
    public async Task Concurrent_deductions_cannot_oversell_the_last_portions()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "race");

        const int available = 5;
        const int attempts = 8;

        var cups = await api.CreateIngredientAsync("Cups", "unit", available);
        var espresso = await api.CreateProductAsync("Espresso", 3m, (cups.Id, 1m));

        // Row locking is what makes this deterministic: the losers see the updated stock.
        var responses = await Task.WhenAll(Enumerable.Range(0, attempts)
            .Select(_ => api.DeductAsync(new OrderItemDto(espresso, 1))));

        responses.Count(r => r.StatusCode == HttpStatusCode.OK).Should().Be(available);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).Should().Be(attempts - available);

        (await api.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(0m);

        (await api.GetLogsAsync(cups.Id))
            .Count(l => l.Reason == StockChangeReason.OrderConsumption)
            .Should().Be(available);
    }

    [Fact]
    public async Task Deduct_succeeds_and_moves_nothing_for_a_product_without_a_recipe()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "norecipe");

        var water = await api.CreateProductAsync("Bottled water", 2m);

        var response = await api.DeductAsync(new OrderItemDto(water, 4));

        await response.EnsureSuccessAsync();

        var result = (await response.Content.ReadFromJsonAsync<StockDeductionResult>(TenantApi.Json))!;
        result.Movements.Should().BeEmpty();
    }

    [Fact]
    public async Task Deduct_rejects_a_product_belonging_to_another_tenant()
    {
        var owner = await TenantApi.ProvisionAsync(_factory, "owner");
        var stranger = await TenantApi.ProvisionAsync(_factory, "stranger");

        var cups = await owner.CreateIngredientAsync("Cups", "unit", 50m);
        var latte = await owner.CreateProductAsync("Latte", 4.5m, (cups.Id, 1m));

        var response = await stranger.DeductAsync(new OrderItemDto(latte, 1));

        // The query filter hides it, so it does not exist for this tenant.
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        (await owner.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(50m);
    }

    [Fact]
    public async Task Deduct_is_rejected_for_an_empty_order()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "empty");

        var response = await api.DeductAsync();

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Ledger_reconciles_with_current_stock_after_a_deduction()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "ledger");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 2m);
        var latte = await api.CreateProductAsync("Latte", 4.5m, (coffee.Id, 0.018m));

        await (await api.DeductAsync(new OrderItemDto(latte, 5))).EnsureSuccessAsync();
        await (await api.AdjustAsync(coffee.Id,
            new StockAdjustmentRequest(1.5m, StockChangeReason.Delivery, "Weekly delivery"))).EnsureSuccessAsync();

        var logs = await api.GetLogsAsync(coffee.Id);
        var ingredient = await api.GetIngredientAsync(coffee.Id);

        // Opening stock, the order consumption and the delivery must add back up.
        logs.Sum(l => l.ChangeAmount).Should().Be(ingredient.CurrentStock);
    }

    /// <summary>The 409 problem document, with the shortages extension the API adds.</summary>
    private sealed record ShortageProblem(
        string Title,
        int Status,
        string Detail,
        List<StockShortageDto> Shortages);
}
