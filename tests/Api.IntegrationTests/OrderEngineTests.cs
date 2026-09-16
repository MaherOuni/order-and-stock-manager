using System.Net;
using System.Net.Http.Json;
using Application.Features.Inventory;
using Application.Features.Orders;
using Domain.Enums;
using FluentAssertions;
using Xunit;

namespace Api.IntegrationTests;

/// <summary>
/// The QR order engine end to end. Everything here goes through the public endpoint the way a
/// customer's phone does — no tenant header — and checks the one property that matters most:
/// an order and the stock it consumes are written together or not at all.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class OrderEngineTests
{
    private readonly PostgresApiFactory _factory;

    public OrderEngineTests(PostgresApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Placing_an_order_prices_it_from_the_menu_and_deducts_its_ingredients()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "order");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 12m);
        var milk = await api.CreateIngredientAsync("Milk", "L", 20m);
        var cups = await api.CreateIngredientAsync("Cups", "unit", 500m);

        var latte = await api.CreateProductAsync("Latte", 4.5m,
            (coffee.Id, 0.018m), (milk.Id, 0.2m), (cups.Id, 1m));

        var response = await api.PlaceOrderAsync("12", new OrderItemDto(latte, 3));

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var order = (await response.Content.ReadFromJsonAsync<OrderDto>(TenantApi.Json))!;
        order.TableNumber.Should().Be("12");
        order.Status.Should().Be(OrderStatus.Pending);
        order.TenantId.Should().Be(api.Id);

        // Priced by the server from the menu, not by the client.
        order.Items.Should().ContainSingle();
        order.Items[0].UnitPrice.Should().Be(4.5m);
        order.Items[0].Quantity.Should().Be(3);
        order.Items[0].LineTotal.Should().Be(13.5m);
        order.TotalAmount.Should().Be(13.5m);

        (await api.GetIngredientAsync(coffee.Id)).CurrentStock.Should().Be(11.946m); // 12 - 3 × 0.018
        (await api.GetIngredientAsync(milk.Id)).CurrentStock.Should().Be(19.4m);     // 20 - 3 × 0.2
        (await api.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(497m);      // 500 - 3

        // Every movement points back at the order that caused it.
        var consumption = (await api.GetLogsAsync(coffee.Id))
            .Where(l => l.Reason == StockChangeReason.OrderConsumption)
            .ToList();

        consumption.Should().ContainSingle();
        consumption[0].OrderId.Should().Be(order.Id);
        consumption[0].ChangeAmount.Should().Be(-0.054m);
    }

    [Fact]
    public async Task Placing_an_order_needs_no_tenant_header()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "public");

        var water = await api.CreateProductAsync("Bottled water", 2m);

        using var anonymous = api.PublicClient();
        anonymous.DefaultRequestHeaders.Contains("X-Tenant-Id").Should().BeFalse();

        var response = await anonymous.PostAsJsonAsync(
            "/api/v1/orders",
            TenantApi.DineIn(api.Slug, "T4", new OrderItemDto(water, 1)),
            TenantApi.Json);

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        // The Location it hands back is followable by the same anonymous client.
        var created = await anonymous.GetAsync(response.Headers.Location);
        created.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Insufficient_stock_aborts_the_whole_order_with_400_and_shortage_details()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "short");

        var coffee = await api.CreateIngredientAsync("Coffee", "kg", 12m);
        var milk = await api.CreateIngredientAsync("Milk", "L", 0.1m);

        var latte = await api.CreateProductAsync("Latte", 4.5m, (coffee.Id, 0.018m), (milk.Id, 0.2m));

        var response = await api.PlaceOrderAsync("7", new OrderItemDto(latte, 3));

        // 400 here rather than the 409 POST /api/v1/stock/deduct returns: to the customer this
        // basket is simply not orderable.
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var problem = (await response.Content.ReadFromJsonAsync<ShortageProblem>(TenantApi.Json))!;
        problem.Shortages.Should().ContainSingle();
        problem.Shortages[0].IngredientName.Should().Be("Milk");
        problem.Shortages[0].RequiredQuantity.Should().Be(0.6m);
        problem.Shortages[0].AvailableQuantity.Should().Be(0.1m);
        problem.Shortages[0].MissingQuantity.Should().Be(0.5m);
        problem.Shortages[0].BlockedProductIds.Should().Contain(latte);

        // Nothing survived the rollback: not the sufficient ingredient, not the order row.
        (await api.GetIngredientAsync(coffee.Id)).CurrentStock.Should().Be(12m);
        (await api.GetIngredientAsync(milk.Id)).CurrentStock.Should().Be(0.1m);
        (await api.GetOrdersAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task Concurrent_orders_cannot_oversell_the_last_portions()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "rush");

        const int available = 5;
        const int attempts = 8;

        var cups = await api.CreateIngredientAsync("Cups", "unit", available);
        var espresso = await api.CreateProductAsync("Espresso", 3m, (cups.Id, 1m));

        // Eight tables tapping "order" at once against five remaining cups. The row lock the
        // deduction takes is what makes the outcome deterministic rather than a coin toss.
        var responses = await Task.WhenAll(Enumerable.Range(0, attempts)
            .Select(i => api.PlaceOrderAsync($"T{i}", new OrderItemDto(espresso, 1))));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().Be(available);
        responses.Count(r => r.StatusCode == HttpStatusCode.BadRequest).Should().Be(attempts - available);

        (await api.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(0m);

        // The losers left no half-written orders behind.
        (await api.GetOrdersAsync()).Should().HaveCount(available);
    }

    [Fact]
    public async Task Repeated_products_are_merged_into_a_single_priced_line()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "merge");

        var cups = await api.CreateIngredientAsync("Cups", "unit", 100m);
        var espresso = await api.CreateProductAsync("Espresso", 3m, (cups.Id, 1m));

        // Two taps on "add" is a quantity of 2, not two lines.
        var order = await api.PlaceOrderOkAsync("9",
            new OrderItemDto(espresso, 2), new OrderItemDto(espresso, 3));

        order.Items.Should().ContainSingle();
        order.Items[0].Quantity.Should().Be(5);
        order.TotalAmount.Should().Be(15m);

        (await api.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(95m);

        (await api.GetLogsAsync(cups.Id))
            .Count(l => l.Reason == StockChangeReason.OrderConsumption)
            .Should().Be(1);
    }

    [Fact]
    public async Task A_product_without_a_recipe_is_ordered_without_moving_stock()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "norecipe-order");

        var water = await api.CreateProductAsync("Bottled water", 2m);

        var order = await api.PlaceOrderOkAsync("3", new OrderItemDto(water, 4));

        order.TotalAmount.Should().Be(8m);
        order.Items.Should().ContainSingle();
    }

    [Fact]
    public async Task A_product_belonging_to_another_restaurant_cannot_be_ordered()
    {
        var owner = await TenantApi.ProvisionAsync(_factory, "owner-order");
        var stranger = await TenantApi.ProvisionAsync(_factory, "stranger-order");

        var cups = await owner.CreateIngredientAsync("Cups", "unit", 50m);
        var espresso = await owner.CreateProductAsync("Espresso", 3m, (cups.Id, 1m));

        var response = await stranger.PlaceOrderAsync("1", new OrderItemDto(espresso, 1));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        (await owner.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(50m);
        (await stranger.GetOrdersAsync()).Should().BeEmpty();
    }

    [Fact]
    public async Task An_order_naming_an_unknown_restaurant_is_rejected()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "unknown-slug");

        var water = await api.CreateProductAsync("Bottled water", 2m);

        var response = await api.PlaceOrderAsAsync(
            $"no-such-restaurant-{Guid.NewGuid():N}", "1", new OrderItemDto(water, 1));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task An_empty_order_is_rejected()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "empty-order");

        var response = await api.PlaceOrderAsync("1");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_product_taken_off_the_menu_cannot_be_ordered()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "inactive-order");

        var cups = await api.CreateIngredientAsync("Cups", "unit", 50m);
        var espresso = await api.CreateProductAsync("Espresso", 3m, (cups.Id, 1m));

        await api.DeactivateProductAsync(espresso);

        var response = await api.PlaceOrderAsync("1", new OrderItemDto(espresso, 1));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        (await api.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(50m);
    }

    [Fact]
    public async Task The_admin_view_lists_the_restaurants_orders_and_filters_by_status()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "board");

        var water = await api.CreateProductAsync("Bottled water", 2m);

        await api.PlaceOrderOkAsync("1", new OrderItemDto(water, 1));
        await api.PlaceOrderOkAsync("2", new OrderItemDto(water, 2));

        var all = await api.GetOrdersAsync();
        all.Should().HaveCount(2);
        all.Should().BeInDescendingOrder(o => o.CreatedAt);
        all.Should().OnlyContain(o => o.Items.Count == 1);

        (await api.GetOrdersAsync(OrderStatus.Pending)).Should().HaveCount(2);
        (await api.GetOrdersAsync(OrderStatus.Completed)).Should().BeEmpty();
        (await api.GetOrdersAsync(OrderStatus.Cancelled)).Should().BeEmpty();
    }

    [Fact]
    public async Task The_admin_view_never_shows_another_restaurants_orders()
    {
        var mine = await TenantApi.ProvisionAsync(_factory, "mine-board");
        var theirs = await TenantApi.ProvisionAsync(_factory, "theirs-board");

        var myWater = await mine.CreateProductAsync("Bottled water", 2m);
        var theirWater = await theirs.CreateProductAsync("Bottled water", 2m);

        await mine.PlaceOrderOkAsync("1", new OrderItemDto(myWater, 1));
        await theirs.PlaceOrderOkAsync("1", new OrderItemDto(theirWater, 1));

        var board = await mine.GetOrdersAsync();

        board.Should().ContainSingle();
        board[0].TenantId.Should().Be(mine.Id);
    }

    [Fact]
    public async Task Reading_another_restaurants_board_with_my_header_is_refused()
    {
        var mine = await TenantApi.ProvisionAsync(_factory, "hijack-mine");
        var theirs = await TenantApi.ProvisionAsync(_factory, "hijack-theirs");

        // Header says one restaurant, route says another. Rather than silently pick a winner,
        // the binder refuses — this is the shape a real auth check would plug into.
        var response = await mine.Client.GetAsync($"/api/v1/orders/tenant/{theirs.Id}");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Completing_a_pending_order_marks_it_served_and_moves_no_stock()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "complete");

        var cups = await api.CreateIngredientAsync("Cups", "unit", 20m);
        var espresso = await api.CreateProductAsync("Espresso", 3m, (cups.Id, 1m));

        var placed = await api.PlaceOrderOkAsync("5", new OrderItemDto(espresso, 2));

        var stockAfterOrder = (await api.GetIngredientAsync(cups.Id)).CurrentStock;
        var ledgerAfterOrder = (await api.GetLogsAsync(cups.Id)).Count;

        var response = await api.CompleteOrderAsync(placed.Id);

        await response.EnsureSuccessAsync();

        var completed = (await response.Content.ReadFromJsonAsync<OrderDto>(TenantApi.Json))!;
        completed.Status.Should().Be(OrderStatus.Completed);
        completed.Items.Should().ContainSingle();
        completed.Items[0].ProductName.Should().Be("Espresso");

        // Serving an order is a ticket change, not a stock movement — the ingredients went
        // when it was placed.
        (await api.GetIngredientAsync(cups.Id)).CurrentStock.Should().Be(stockAfterOrder);
        (await api.GetLogsAsync(cups.Id)).Count.Should().Be(ledgerAfterOrder);

        (await api.GetOrdersAsync(OrderStatus.Completed)).Should().ContainSingle();
        (await api.GetOrdersAsync(OrderStatus.Pending)).Should().BeEmpty();
    }

    [Fact]
    public async Task Completing_the_same_order_twice_is_refused()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "twice");

        var water = await api.CreateProductAsync("Bottled water", 2m);
        var placed = await api.PlaceOrderOkAsync("6", new OrderItemDto(water, 1));

        await (await api.CompleteOrderAsync(placed.Id)).EnsureSuccessAsync();

        // A second tap on the board must not reopen or re-close anything.
        var again = await api.CompleteOrderAsync(placed.Id);

        again.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        (await api.GetOrdersAsync(OrderStatus.Completed)).Should().ContainSingle();
    }

    [Fact]
    public async Task Completing_another_restaurants_order_is_refused()
    {
        var owner = await TenantApi.ProvisionAsync(_factory, "owner-complete");
        var stranger = await TenantApi.ProvisionAsync(_factory, "stranger-complete");

        var water = await owner.CreateProductAsync("Bottled water", 2m);
        var placed = await owner.PlaceOrderOkAsync("1", new OrderItemDto(water, 1));

        var response = await stranger.CompleteOrderAsync(placed.Id);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        (await owner.GetOrdersAsync(OrderStatus.Pending)).Should().ContainSingle();
    }

    [Fact]
    public async Task Completing_an_order_without_a_tenant_header_is_refused()
    {
        var api = await TenantApi.ProvisionAsync(_factory, "noheader-complete");

        var water = await api.CreateProductAsync("Bottled water", 2m);
        var placed = await api.PlaceOrderOkAsync("1", new OrderItemDto(water, 1));

        // The order routes are tenant-optional for the customer's sake; staff actions are not.
        using var anonymous = api.PublicClient();
        var response = await anonymous.PostAsync($"/api/v1/orders/{placed.Id}/complete", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>The 400 problem document, with the shortages extension the API adds.</summary>
    private sealed record ShortageProblem(
        string Title,
        int Status,
        string Detail,
        List<StockShortageDto> Shortages);
}
