using System.Data;
using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Application.Common.Tenancy;
using Application.Features.Inventory;
using Domain.Entities;
using Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Orders;

public interface ICreateOrderCommandHandler
{
    Task<OrderDto> HandleAsync(CreateOrderCommand command, CancellationToken ct = default);
}

/// <summary>
/// The write side of the QR order engine. Owns the transaction boundary: the order row, its
/// lines, their customisations and any stock deduction all commit together or none of them do.
///
/// Whether stock moves at all depends on how the order is paid. Cash starts the kitchen
/// immediately, so it deducts here. A gateway order deducts only when its webhook confirms the
/// money — otherwise an abandoned checkout would quietly hold ingredients hostage.
/// </summary>
public sealed class CreateOrderCommandHandler : ICreateOrderCommandHandler
{
    private readonly IApplicationDbContext _db;
    private readonly IStockService _stock;
    private readonly ITenantBinder _tenantBinder;

    public CreateOrderCommandHandler(IApplicationDbContext db, IStockService stock, ITenantBinder tenantBinder)
    {
        _db = db;
        _stock = stock;
        _tenantBinder = tenantBinder;
    }

    /// <exception cref="InsufficientStockException">
    /// One or more ingredients fall short on a cash order. Nothing is written; the exception
    /// names them.
    /// </exception>
    public async Task<OrderDto> HandleAsync(CreateOrderCommand command, CancellationToken ct = default)
    {
        // Public endpoint: the tenant comes from the QR link's slug, not from a header. Binding
        // it before anything else is what turns on the global query filter for this request.
        await _tenantBinder.BindBySlugAsync(command.TenantSlug, ct);

        var lines = Normalize(command.Items);

        // ReadCommitted, per CLAUDE.md. The row locks the deduction takes are what actually
        // serialise concurrent orders; the isolation level only has to not fight them.
        await using var transaction = await _db.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);

        var productIds = lines.Select(l => l.ProductId).Distinct().ToList();

        // Tenant-filtered: a product from another restaurant simply does not exist here.
        var products = await _db.Products
            .Where(p => productIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, ct);

        var missing = productIds.Where(id => !products.ContainsKey(id)).ToList();
        if (missing.Count > 0)
            throw new NotFoundException(nameof(Product), string.Join(", ", missing));

        var unavailable = products.Values.Where(p => !p.IsActive).Select(p => p.Name).ToList();
        if (unavailable.Count > 0)
            throw new ValidationException(
                nameof(CreateOrderCommand.Items),
                $"Not on the menu right now: {string.Join(", ", unavailable)}.");

        // Customisations may only name ingredients the product's recipe already uses; the menu
        // has no modifier pricing, so "add caramel syrup" has nowhere to charge from.
        var recipe = await _db.RecipeItems
            .AsNoTracking()
            .Where(r => productIds.Contains(r.ProductId))
            .Include(r => r.Ingredient)
            .ToListAsync(ct);

        var recipeByProduct = recipe
            .GroupBy(r => r.ProductId)
            .ToDictionary(g => g.Key, g => g.ToDictionary(r => r.IngredientId));

        var order = new Order(command.OrderType, command.PaymentMethod);

        order.SetFulfilment(
            command.OrderType,
            command.TableNumber,
            command.CustomerName,
            command.CustomerPhone,
            command.DeliveryAddress);

        order.SetAllergyNotes(command.AllergyNotes);
        order.SetCovers(command.Covers);

        foreach (var line in lines)
        {
            var product = products[line.ProductId];

            // Price is read off the menu, never taken from the client, and snapshotted onto
            // the line so tonight's bill survives tomorrow's price change.
            var item = order.AddItem(product.Id, line.Quantity, product.Price, line.Notes);

            foreach (var customization in line.Customizations ?? Array.Empty<CustomizationRequest>())
            {
                if (!recipeByProduct.TryGetValue(product.Id, out var ingredients) ||
                    !ingredients.TryGetValue(customization.IngredientId, out var recipeLine))
                {
                    throw new ValidationException(
                        nameof(OrderLineRequest.Customizations),
                        $"'{product.Name}' does not use that ingredient, so it cannot be changed.");
                }

                item.Customize(
                    recipeLine.IngredientId,
                    recipeLine.Ingredient!.Name,
                    customization.Kind,
                    recipeLine.QuantityRequired);
            }
        }

        _db.Orders.Add(order);

        // Flushed before the deduction because every ledger line references this order id.
        await _db.SaveChangesAsync(ct);

        if (order.PaymentMethod == PaymentMethod.Cash)
        {
            // Joins the transaction above: locks the ingredient rows, re-checks them under the
            // lock, deducts, and writes one ledger line per ingredient stamped with this order.
            // A shortage throws, and disposing the un-committed transaction undoes the order too.
            await _stock.DeductForOrderAsync(ToRequirements(order), order.Id, ct);
            order.MarkStockDeducted();

            await _db.SaveChangesAsync(ct);
        }

        await transaction.CommitAsync(ct);

        // TenantId was stamped onto the order by the SaveChanges above.
        return OrderMapper.ToDto(order, products);
    }

    /// <summary>The order's lines as stock sees them, customisations included.</summary>
    internal static List<OrderLineRequirement> ToRequirements(Order order)
        => order.Items
            .Select(item => new OrderLineRequirement(
                item.ProductId,
                item.Quantity,
                item.Customizations
                    .Where(c => c.Kind == CustomizationKind.Removed)
                    .Select(c => c.IngredientId)
                    .ToList(),
                item.Customizations
                    .Where(c => c.Kind == CustomizationKind.Added)
                    .Select(c => c.IngredientId)
                    .ToList()))
            .ToList();

    /// <summary>
    /// Validates the basket and folds identical lines together — a customer tapping "add" twice
    /// means quantity 2, not two lines. Lines only merge when they would be indistinguishable
    /// on a kitchen ticket: same product, same note, same customisations.
    /// </summary>
    private static List<OrderLineRequest> Normalize(IReadOnlyList<OrderLineRequest>? items)
    {
        if (items is null || items.Count == 0)
            throw new ValidationException(nameof(CreateOrderCommand.Items), "An order must contain at least one item.");

        if (items.Any(i => i.Quantity <= 0))
            throw new ValidationException(nameof(OrderLineRequest.Quantity), "Quantity must be greater than zero.");

        if (items.Any(i => i.ProductId == Guid.Empty))
            throw new ValidationException(nameof(OrderLineRequest.ProductId), "Every item must name a product.");

        return items
            .GroupBy(SignatureOf)
            .Select(group =>
            {
                var first = group.First();

                return first with { Quantity = group.Sum(i => i.Quantity) };
            })
            .ToList();
    }

    private static string SignatureOf(OrderLineRequest line)
    {
        var customizations = (line.Customizations ?? Array.Empty<CustomizationRequest>())
            .Select(c => $"{c.Kind}:{c.IngredientId}")
            .OrderBy(value => value, StringComparer.Ordinal);

        return $"{line.ProductId}|{line.Notes?.Trim()}|{string.Join(',', customizations)}";
    }
}
