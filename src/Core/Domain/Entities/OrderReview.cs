using Domain.Common;
using Domain.Exceptions;

namespace Domain.Entities;

/// <summary>
/// What the table thought. One per order — a second submission edits the first rather than
/// stacking, because a customer changing their mind is not two opinions.
/// </summary>
public class OrderReview : TenantEntity
{
    public const int CommentMaxLength = 1000;
    public const int MinRating = 1;
    public const int MaxRating = 5;

    private OrderReview() { }

    public OrderReview(Guid orderId, int rating, string? comment = null)
    {
        if (orderId == Guid.Empty)
            throw new DomainException("A review belongs to an order.");

        OrderId = orderId;
        // Update() stamps UpdatedAt whenever CreatedAt is already set, so the timestamp goes on
        // after the first Update, not before it.
        Update(rating, comment);
        CreatedAt = DateTimeOffset.UtcNow;
    }

    public Guid OrderId { get; private set; }

    public Order? Order { get; private set; }

    /// <summary>1 to 5 stars.</summary>
    public int Rating { get; private set; }

    public string? Comment { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? UpdatedAt { get; private set; }

    public void Update(int rating, string? comment)
    {
        if (rating is < MinRating or > MaxRating)
            throw new DomainException($"A rating must be between {MinRating} and {MaxRating}.");
        if (comment is { Length: > CommentMaxLength })
            throw new DomainException($"Comment cannot exceed {CommentMaxLength} characters.");

        Rating = rating;
        Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();

        if (CreatedAt != default) UpdatedAt = DateTimeOffset.UtcNow;
    }
}
