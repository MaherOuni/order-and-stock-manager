using Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Infrastructure.Persistence.Configurations;

public sealed class OrderItemCustomizationConfiguration : IEntityTypeConfiguration<OrderItemCustomization>
{
    public void Configure(EntityTypeBuilder<OrderItemCustomization> builder)
    {
        builder.ToTable("order_item_customizations", table =>
            table.HasCheckConstraint(
                "ck_order_item_customizations_quantity_positive",
                "quantity_per_unit > 0"));

        builder.HasKey(c => c.Id);

        builder.Property(c => c.Id).ValueGeneratedNever();

        builder.Property(c => c.TenantId).IsRequired();

        builder.Property(c => c.OrderItemId).IsRequired();

        builder.Property(c => c.IngredientId).IsRequired();

        // Snapshotted so a kitchen ticket keeps reading "no milk" after a rename.
        builder.Property(c => c.IngredientName)
            .IsRequired()
            .HasMaxLength(Ingredient.NameMaxLength);

        builder.Property(c => c.Kind)
            .IsRequired()
            .HasMaxLength(16)
            .HasConversion<string>();

        builder.Property(c => c.QuantityPerUnit)
            .IsRequired()
            .HasPrecision(18, 4);

        // One decision per ingredient per line: you cannot both add and remove the milk.
        builder.HasIndex(c => new { c.OrderItemId, c.IngredientId }).IsUnique();

        // No FK to ingredients on purpose — the name is snapshotted, and an ingredient being
        // retired must not block deleting it or rewrite history.
        builder.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(c => c.TenantId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class ServiceRequestConfiguration : IEntityTypeConfiguration<ServiceRequest>
{
    public void Configure(EntityTypeBuilder<ServiceRequest> builder)
    {
        builder.ToTable("service_requests");

        builder.HasKey(r => r.Id);

        builder.Property(r => r.Id).ValueGeneratedNever();

        builder.Property(r => r.TenantId).IsRequired();

        builder.Property(r => r.TableNumber)
            .IsRequired()
            .HasMaxLength(ServiceRequest.TableNumberMaxLength);

        builder.Property(r => r.Kind)
            .IsRequired()
            .HasMaxLength(16)
            .HasConversion<string>();

        builder.Property(r => r.Note)
            .HasMaxLength(ServiceRequest.NoteMaxLength);

        builder.Property(r => r.Status)
            .IsRequired()
            .HasMaxLength(16)
            .HasConversion<string>();

        builder.Property(r => r.CreatedAt).IsRequired();

        builder.Property(r => r.ResolvedAt);

        // The floor view: open requests, oldest first.
        builder.HasIndex(r => new { r.TenantId, r.Status, r.CreatedAt });

        builder.HasOne<Order>()
            .WithMany()
            .HasForeignKey(r => r.OrderId)
            // A request outlives the order it mentions.
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(r => r.TenantId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class OrderReviewConfiguration : IEntityTypeConfiguration<OrderReview>
{
    public void Configure(EntityTypeBuilder<OrderReview> builder)
    {
        builder.ToTable("order_reviews", table =>
            table.HasCheckConstraint("ck_order_reviews_rating_range", "rating BETWEEN 1 AND 5"));

        builder.HasKey(r => r.Id);

        builder.Property(r => r.Id).ValueGeneratedNever();

        builder.Property(r => r.TenantId).IsRequired();

        builder.Property(r => r.OrderId).IsRequired();

        builder.Property(r => r.Rating).IsRequired();

        builder.Property(r => r.Comment)
            .HasMaxLength(OrderReview.CommentMaxLength);

        builder.Property(r => r.CreatedAt).IsRequired();

        builder.Property(r => r.UpdatedAt);

        // One review per order: a customer changing their mind edits it rather than stacking.
        builder.HasIndex(r => r.OrderId).IsUnique();

        builder.HasIndex(r => new { r.TenantId, r.CreatedAt });

        builder.HasOne(r => r.Order)
            .WithMany()
            .HasForeignKey(r => r.OrderId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(r => r.TenantId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
