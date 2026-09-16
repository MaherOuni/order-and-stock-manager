using Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Infrastructure.Persistence.Configurations;

public sealed class OrderItemConfiguration : IEntityTypeConfiguration<OrderItem>
{
    public void Configure(EntityTypeBuilder<OrderItem> builder)
    {
        builder.ToTable("order_items", table =>
        {
            table.HasCheckConstraint("ck_order_items_quantity_positive", "quantity > 0");
            table.HasCheckConstraint("ck_order_items_unit_price_non_negative", "unit_price >= 0");
        });

        builder.HasKey(i => i.Id);

        builder.Property(i => i.Id).ValueGeneratedNever();

        builder.Property(i => i.TenantId).IsRequired();

        builder.Property(i => i.OrderId).IsRequired();

        builder.Property(i => i.ProductId).IsRequired();

        builder.Property(i => i.Quantity).IsRequired();

        builder.Property(i => i.UnitPrice)
            .IsRequired()
            .HasPrecision(10, 2);

        builder.Property(i => i.Notes)
            .HasMaxLength(OrderItem.NotesMaxLength);

        // Derived from quantity and unit price; the order stores the only total worth keeping.
        builder.Ignore(i => i.LineTotal);
        builder.Ignore(i => i.LineTotalMillimes);

        // Deliberately not unique on (order_id, product_id) any more: the same drink ordered
        // twice with different customisations is two lines, and merging them would lose the
        // "no milk" on one of them.
        builder.HasIndex(i => i.OrderId);

        builder.HasMany(i => i.Customizations)
            .WithOne(c => c.OrderItem)
            .HasForeignKey(c => c.OrderItemId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(i => i.Product)
            .WithMany()
            .HasForeignKey(i => i.ProductId)
            // A product that has ever been sold cannot be deleted; deactivate it instead.
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(i => i.TenantId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Metadata
            .FindNavigation(nameof(OrderItem.Customizations))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}
