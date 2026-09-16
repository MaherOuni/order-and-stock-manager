using Domain.Common;
using Domain.Enums;
using Domain.Exceptions;

namespace Domain.Entities;

/// <summary>
/// One immutable line of the stock ledger. Every change to <see cref="Ingredient.CurrentStock"/>
/// writes one of these, so the current stock is always reconstructible from history.
/// </summary>
public class StockLog : TenantEntity
{
    public const int NoteMaxLength = 500;

    private StockLog() { }

    /// <param name="changeAmount">Signed: positive adds stock, negative removes it. Never zero.</param>
    /// <param name="orderId">The order that caused the movement, when one did.</param>
    public static StockLog Record(
        Guid ingredientId,
        decimal changeAmount,
        decimal previousStock,
        decimal newStock,
        StockChangeReason reason,
        string? note = null,
        Guid? orderId = null)
    {
        if (ingredientId == Guid.Empty)
            throw new DomainException("Stock log requires an ingredient.");

        if (note is { Length: > NoteMaxLength })
            throw new DomainException($"Note cannot exceed {NoteMaxLength} characters.");

        // Round before validating, not after: a change of 0.00001 stores as 0.0000, and a
        // zero movement is not a movement (the column has a check constraint saying so).
        var change = decimal.Round(changeAmount, 4, MidpointRounding.AwayFromZero);
        var previous = decimal.Round(previousStock, 4, MidpointRounding.AwayFromZero);
        var current = decimal.Round(newStock, 4, MidpointRounding.AwayFromZero);

        if (change == 0)
            throw new DomainException("A stock movement of zero is not a movement.");

        // The ledger is only trustworthy if each line balances.
        if (previous + change != current)
            throw new DomainException(
                $"Stock log does not balance: {previous} + {change} != {current}.");

        return new StockLog
        {
            IngredientId = ingredientId,
            ChangeAmount = change,
            PreviousStock = previous,
            NewStock = current,
            Reason = reason,
            OrderId = orderId,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            CreatedAt = DateTimeOffset.UtcNow
        };
    }

    public Guid IngredientId { get; private set; }

    public Ingredient? Ingredient { get; private set; }

    /// <summary>Signed delta applied to the ingredient.</summary>
    public decimal ChangeAmount { get; private set; }

    public decimal PreviousStock { get; private set; }

    public decimal NewStock { get; private set; }

    public StockChangeReason Reason { get; private set; }

    /// <summary>
    /// The order this movement was booked against, or null for a manual adjustment. Lets the
    /// ledger answer "what did order X consume?" without reverse-engineering it from recipes.
    /// </summary>
    public Guid? OrderId { get; private set; }

    public Order? Order { get; private set; }

    public string? Note { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }
}
