using System.Data;
using Application.Common.Exceptions;
using Application.Common.Interfaces;
using Domain.Entities;
using Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace Application.Features.Inventory;

public interface IStockService
{
    /// <summary>Manual signed movement (delivery, waste, …). Always writes a ledger line.</summary>
    Task<StockMovementResult> AdjustAsync(Guid ingredientId, StockAdjustmentRequest request, CancellationToken ct = default);

    /// <summary>Absolute correction after a physical count; the delta is derived and logged.</summary>
    Task<StockMovementResult> RecountAsync(Guid ingredientId, StockRecountRequest request, CancellationToken ct = default);

    /// <summary>
    /// Verifies that every ingredient every requested product needs is in stock in sufficient
    /// quantity. Read-only: it reports, it does not reserve.
    /// </summary>
    Task<StockAvailabilityResult> CheckStockAvailabilityAsync(IReadOnlyList<OrderItemDto> items, CancellationToken ct = default);

    /// <summary>What the order lines consume, aggregated per ingredient across all products.</summary>
    Task<IReadOnlyList<IngredientRequirementDto>> GetRequirementsAsync(IReadOnlyList<OrderItemDto> items, CancellationToken ct = default);

    /// <summary>
    /// Deducts the order's ingredients atomically, or throws
    /// <see cref="InsufficientStockException"/> and changes nothing.
    /// </summary>
    /// <param name="items">The order lines to charge stock for.</param>
    /// <param name="orderId">
    /// Stamped onto every ledger line written. Pass null for a standalone deduction.
    /// </param>
    /// <param name="ct">Cancellation token.</param>
    /// <remarks>
    /// Opens its own ReadCommitted transaction unless the caller already has one open, in which
    /// case it joins it — order creation owns the boundary so the order row and its stock
    /// movements commit or roll back together.
    /// </remarks>
    Task<StockDeductionResult> DeductForOrderAsync(
        IReadOnlyList<OrderItemDto> items, Guid? orderId = null, CancellationToken ct = default);

    /// <summary>
    /// The same deduction, for a basket whose lines carry customisations. Order creation uses
    /// this one; a line with "no milk" must not take milk off the shelf.
    /// </summary>
    Task<StockDeductionResult> DeductForOrderAsync(
        IReadOnlyList<OrderLineRequirement> lines, Guid? orderId = null, CancellationToken ct = default);

    /// <summary>
    /// Puts an order's ingredients back, one ledger line per ingredient, tagged
    /// <see cref="StockChangeReason.OrderCancellation"/>. Joins an open transaction like the
    /// deduction does.
    /// </summary>
    Task<StockDeductionResult> ReturnForOrderAsync(
        IReadOnlyList<OrderLineRequirement> lines, Guid orderId, CancellationToken ct = default);

    /// <summary>Ledger history, newest first.</summary>
    Task<IReadOnlyList<StockLogDto>> GetLogsAsync(Guid? ingredientId, int take, CancellationToken ct = default);
}

public sealed class StockService : IStockService
{
    private const int MaxLogPageSize = 500;

    private readonly IApplicationDbContext _db;

    public StockService(IApplicationDbContext db) => _db = db;

    public async Task<StockMovementResult> AdjustAsync(
        Guid ingredientId, StockAdjustmentRequest request, CancellationToken ct = default)
    {
        // Rounded once, here, and then used for both the mutation and the ledger line —
        // rounding the delta and rounding (stock - delta) separately can disagree by a tick.
        var changeAmount = decimal.Round(request.ChangeAmount, 4, MidpointRounding.AwayFromZero);

        if (changeAmount == 0)
            throw new ValidationException(nameof(request.ChangeAmount),
                "Change amount cannot be zero (values below 0.0001 round to zero).");

        var ingredient = await _db.Ingredients.FirstOrDefaultAsync(i => i.Id == ingredientId, ct)
                         ?? throw new NotFoundException(nameof(Ingredient), ingredientId);

        var previousStock = ingredient.CurrentStock;

        if (changeAmount > 0)
        {
            ingredient.Replenish(changeAmount);
        }
        else
        {
            var required = Math.Abs(changeAmount);

            // Manual deductions get the same protection as order deductions.
            if (required > ingredient.CurrentStock)
                throw new InsufficientStockException(new[]
                {
                    new StockShortageDto(
                        ingredient.Id, ingredient.Name, ingredient.Unit.Code,
                        required, ingredient.CurrentStock, required - ingredient.CurrentStock,
                        Array.Empty<Guid>())
                });

            ingredient.Consume(required);
        }

        var log = StockLog.Record(
            ingredient.Id, changeAmount, previousStock, ingredient.CurrentStock,
            request.Reason, request.Note);

        _db.StockLogs.Add(log);
        await _db.SaveChangesAsync(ct);

        return MapMovement(ingredient, log);
    }

    public async Task<StockMovementResult> RecountAsync(
        Guid ingredientId, StockRecountRequest request, CancellationToken ct = default)
    {
        if (request.CountedStock < 0)
            throw new ValidationException(nameof(request.CountedStock), "Counted stock cannot be negative.");

        var ingredient = await _db.Ingredients.FirstOrDefaultAsync(i => i.Id == ingredientId, ct)
                         ?? throw new NotFoundException(nameof(Ingredient), ingredientId);

        var previousStock = ingredient.CurrentStock;

        // Round the count, then take the delta, so the two always agree to the last tick.
        var countedStock = decimal.Round(request.CountedStock, 4, MidpointRounding.AwayFromZero);
        var delta = countedStock - previousStock;

        if (delta == 0)
            // Nothing moved, so nothing is logged: a ledger line of zero would be noise.
            return MapMovement(ingredient, log: null);

        ingredient.SetStock(countedStock);

        var log = StockLog.Record(
            ingredient.Id, delta, previousStock, ingredient.CurrentStock,
            StockChangeReason.InventoryCount, request.Note);

        _db.StockLogs.Add(log);
        await _db.SaveChangesAsync(ct);

        return MapMovement(ingredient, log);
    }

    public async Task<StockAvailabilityResult> CheckStockAvailabilityAsync(
        IReadOnlyList<OrderItemDto> items, CancellationToken ct = default)
    {
        var requirements = await BuildRequirementsAsync(AsLines(items), ct);

        var shortages = requirements.Values
            .Where(r => r.Required > r.Ingredient.CurrentStock)
            .OrderBy(r => r.Ingredient.Name)
            .Select(ToShortage)
            .ToList();

        return shortages.Count == 0
            ? StockAvailabilityResult.Available
            : StockAvailabilityResult.Unavailable(shortages);
    }

    public async Task<IReadOnlyList<IngredientRequirementDto>> GetRequirementsAsync(
        IReadOnlyList<OrderItemDto> items, CancellationToken ct = default)
    {
        var requirements = await BuildRequirementsAsync(AsLines(items), ct);

        return requirements.Values
            .OrderBy(r => r.Ingredient.Name)
            .Select(r => new IngredientRequirementDto(
                r.Ingredient.Id, r.Ingredient.Name, r.Ingredient.Unit.Code,
                r.Required, r.Ingredient.CurrentStock))
            .ToList();
    }

    public Task<StockDeductionResult> DeductForOrderAsync(
        IReadOnlyList<OrderItemDto> items, Guid? orderId = null, CancellationToken ct = default)
        => DeductForOrderAsync(
            (items ?? Array.Empty<OrderItemDto>()).Select(OrderLineRequirement.From).ToList(),
            orderId,
            ct);

    public async Task<StockDeductionResult> DeductForOrderAsync(
        IReadOnlyList<OrderLineRequirement> lines, Guid? orderId = null, CancellationToken ct = default)
    {
        // Null when the caller already owns a transaction: order creation begins one so that the
        // order row and these movements commit together, and EF Core has no nested transactions.
        var ownedTransaction = _db.HasActiveTransaction
            ? null
            : await _db.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);

        try
        {
            var requirements = await BuildRequirementsAsync(lines, ct);

            if (requirements.Count == 0)
            {
                // Nothing in the order has a recipe; there is nothing to deduct.
                if (ownedTransaction is not null) await ownedTransaction.CommitAsync(ct);
                return new StockDeductionResult(Array.Empty<StockLogDto>());
            }

            // Lock the rows before deciding: without this, two concurrent orders can both read
            // the same stock, both find it sufficient, and both deduct — overselling the last
            // portion.
            var locked = await _db.GetIngredientsForUpdateAsync(requirements.Keys.ToList(), ct);
            var lockedById = locked.ToDictionary(i => i.Id);

            var shortages = new List<StockShortageDto>();
            foreach (var requirement in requirements.Values.OrderBy(r => r.Ingredient.Name))
            {
                // Re-read post-lock: the value we checked a moment ago may be stale.
                if (!lockedById.TryGetValue(requirement.IngredientId, out var ingredient))
                    throw new NotFoundException(nameof(Ingredient), requirement.IngredientId);

                if (requirement.Required > ingredient.CurrentStock)
                    shortages.Add(new StockShortageDto(
                        ingredient.Id, ingredient.Name, ingredient.Unit.Code,
                        requirement.Required, ingredient.CurrentStock,
                        decimal.Round(requirement.Required - ingredient.CurrentStock, 4),
                        requirement.BlockedProductIds.ToList()));
            }

            if (shortages.Count > 0)
            {
                // All-or-nothing: a half-deducted order would corrupt the ledger. When the
                // transaction belongs to the caller, throwing is what rolls it back.
                if (ownedTransaction is not null) await ownedTransaction.RollbackAsync(ct);
                throw new InsufficientStockException(shortages);
            }

            var logs = new List<StockLogDto>(requirements.Count);

            foreach (var requirement in requirements.Values)
            {
                var ingredient = lockedById[requirement.IngredientId];
                var previousStock = ingredient.CurrentStock;

                ingredient.Consume(requirement.Required);

                var log = StockLog.Record(
                    ingredient.Id, -requirement.Required, previousStock, ingredient.CurrentStock,
                    StockChangeReason.OrderConsumption,
                    $"Order consumption for {requirement.BlockedProductIds.Count} product(s).",
                    orderId);

                _db.StockLogs.Add(log);
                logs.Add(MapLog(log, ingredient));
            }

            await _db.SaveChangesAsync(ct);

            if (ownedTransaction is not null) await ownedTransaction.CommitAsync(ct);

            return new StockDeductionResult(logs.OrderBy(l => l.IngredientName).ToList());
        }
        finally
        {
            if (ownedTransaction is not null) await ownedTransaction.DisposeAsync();
        }
    }

    public async Task<IReadOnlyList<StockLogDto>> GetLogsAsync(
        Guid? ingredientId, int take, CancellationToken ct = default)
    {
        var pageSize = take switch
        {
            <= 0 => 100,
            > MaxLogPageSize => MaxLogPageSize,
            _ => take
        };

        var query = _db.StockLogs.AsNoTracking();

        if (ingredientId is { } id)
            query = query.Where(l => l.IngredientId == id);

        var logs = await query
            .Include(l => l.Ingredient)
            .OrderByDescending(l => l.CreatedAt)
            .ThenByDescending(l => l.Id)
            .Take(pageSize)
            .ToListAsync(ct);

        return logs.Select(l => MapLog(l, l.Ingredient!)).ToList();
    }

    private static List<OrderLineRequirement> AsLines(IReadOnlyList<OrderItemDto> items)
        => (items ?? Array.Empty<OrderItemDto>()).Select(OrderLineRequirement.From).ToList();

    /// <summary>
    /// Expands basket lines through their recipes into a per-ingredient requirement.
    /// Products without a recipe consume nothing.
    ///
    /// Lines are expanded individually rather than grouped by product, because two lines of the
    /// same drink can carry different customisations — one with milk, one without — and folding
    /// them together would deduct milk for both.
    /// </summary>
    private async Task<Dictionary<Guid, Requirement>> BuildRequirementsAsync(
        IReadOnlyList<OrderLineRequirement> lines, CancellationToken ct)
    {
        if (lines is null || lines.Count == 0)
            throw new ValidationException(nameof(lines), "An order must contain at least one item.");

        if (lines.Any(l => l.Quantity <= 0))
            throw new ValidationException(nameof(OrderItemDto.Quantity), "Quantity must be greater than zero.");

        var productIds = lines.Select(l => l.ProductId).Distinct().ToList();

        // Tenant-filtered: a product from another tenant simply does not exist here.
        var foundProductIds = await _db.Products
            .AsNoTracking()
            .Where(p => productIds.Contains(p.Id))
            .Select(p => p.Id)
            .ToListAsync(ct);

        var missing = productIds.Except(foundProductIds).ToList();
        if (missing.Count > 0)
            throw new NotFoundException(nameof(Product), string.Join(", ", missing));

        var recipeLines = await _db.RecipeItems
            .AsNoTracking()
            .Where(r => productIds.Contains(r.ProductId))
            .Include(r => r.Ingredient)
            .ToListAsync(ct);

        var recipesByProduct = recipeLines
            .GroupBy(r => r.ProductId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var requirements = new Dictionary<Guid, Requirement>();

        foreach (var line in lines)
        {
            if (!recipesByProduct.TryGetValue(line.ProductId, out var recipe)) continue;

            foreach (var recipeLine in recipe)
            {
                if (line.RemovedIngredientIds.Contains(recipeLine.IngredientId)) continue;

                // "Extra shot" is a second helping of what the recipe already calls for.
                var helpings = line.AddedIngredientIds.Contains(recipeLine.IngredientId) ? 2 : 1;
                var consumed = decimal.Round(recipeLine.QuantityRequired * line.Quantity * helpings, 4);

                if (!requirements.TryGetValue(recipeLine.IngredientId, out var requirement))
                {
                    requirement = new Requirement(recipeLine.IngredientId, recipeLine.Ingredient!);
                    requirements[recipeLine.IngredientId] = requirement;
                }

                requirement.Add(consumed, line.ProductId);
            }
        }

        return requirements;
    }

    /// <summary>
    /// The mirror image of the deduction: a cancelled order gives its ingredients back, with a
    /// ledger line each so the shelf and the history still agree.
    /// </summary>
    public async Task<StockDeductionResult> ReturnForOrderAsync(
        IReadOnlyList<OrderLineRequirement> lines, Guid orderId, CancellationToken ct = default)
    {
        var ownedTransaction = _db.HasActiveTransaction
            ? null
            : await _db.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);

        try
        {
            var requirements = await BuildRequirementsAsync(lines, ct);

            if (requirements.Count == 0)
            {
                if (ownedTransaction is not null) await ownedTransaction.CommitAsync(ct);
                return new StockDeductionResult(Array.Empty<StockLogDto>());
            }

            // Locked for the same reason a deduction locks: the figure written to the ledger
            // has to be the one that was on the shelf when it was written.
            var locked = await _db.GetIngredientsForUpdateAsync(requirements.Keys.ToList(), ct);
            var lockedById = locked.ToDictionary(i => i.Id);

            var logs = new List<StockLogDto>(requirements.Count);

            foreach (var requirement in requirements.Values)
            {
                if (!lockedById.TryGetValue(requirement.IngredientId, out var ingredient))
                    throw new NotFoundException(nameof(Ingredient), requirement.IngredientId);

                var previousStock = ingredient.CurrentStock;

                ingredient.Replenish(requirement.Required);

                var log = StockLog.Record(
                    ingredient.Id, requirement.Required, previousStock, ingredient.CurrentStock,
                    StockChangeReason.OrderCancellation,
                    "Returned to stock by a cancelled order.",
                    orderId);

                _db.StockLogs.Add(log);
                logs.Add(MapLog(log, ingredient));
            }

            await _db.SaveChangesAsync(ct);

            if (ownedTransaction is not null) await ownedTransaction.CommitAsync(ct);

            return new StockDeductionResult(logs.OrderBy(l => l.IngredientName).ToList());
        }
        finally
        {
            if (ownedTransaction is not null) await ownedTransaction.DisposeAsync();
        }
    }

    private static StockShortageDto ToShortage(Requirement r) => new(
        r.Ingredient.Id,
        r.Ingredient.Name,
        r.Ingredient.Unit.Code,
        r.Required,
        r.Ingredient.CurrentStock,
        decimal.Round(r.Required - r.Ingredient.CurrentStock, 4),
        r.BlockedProductIds.ToList());

    private static StockMovementResult MapMovement(Ingredient ingredient, StockLog? log) => new(
        ingredient.Id,
        ingredient.Name,
        ingredient.Unit.Code,
        ingredient.CurrentStock,
        ingredient.MinimumStockAlert,
        ingredient.IsBelowMinimum,
        log is null
            ? new StockLogDto(Guid.Empty, ingredient.Id, ingredient.Name, ingredient.Unit.Code,
                0m, ingredient.CurrentStock, ingredient.CurrentStock,
                StockChangeReason.InventoryCount, "No change.", null, DateTimeOffset.UtcNow)
            : MapLog(log, ingredient));

    private static StockLogDto MapLog(StockLog log, Ingredient ingredient) => new(
        log.Id,
        log.IngredientId,
        ingredient.Name,
        ingredient.Unit.Code,
        log.ChangeAmount,
        log.PreviousStock,
        log.NewStock,
        log.Reason,
        log.Note,
        log.OrderId,
        log.CreatedAt);

    /// <summary>Mutable accumulator used while expanding recipes.</summary>
    private sealed class Requirement
    {
        private readonly HashSet<Guid> _blockedProductIds = new();

        public Requirement(Guid ingredientId, Ingredient ingredient)
        {
            IngredientId = ingredientId;
            Ingredient = ingredient;
        }

        public Guid IngredientId { get; }

        public Ingredient Ingredient { get; }

        public decimal Required { get; private set; }

        /// <summary>Products that would fail if this ingredient runs out.</summary>
        public IReadOnlyCollection<Guid> BlockedProductIds => _blockedProductIds;

        public void Add(decimal quantity, Guid productId)
        {
            Required = decimal.Round(Required + quantity, 4);
            _blockedProductIds.Add(productId);
        }
    }
}
