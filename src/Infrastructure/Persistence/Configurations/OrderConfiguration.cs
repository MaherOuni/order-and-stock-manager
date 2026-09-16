using Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Infrastructure.Persistence.Configurations;

public sealed class OrderConfiguration : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> builder)
    {
        builder.ToTable("orders", table =>
        {
            table.HasCheckConstraint("ck_orders_total_millimes_non_negative", "total_amount_millimes >= 0");

            // The rules the domain enforces, restated where nothing can bypass them: a dine-in
            // order without a table or a delivery without an address is not fulfillable, and a
            // row written by anything other than the API should not be either.
            table.HasCheckConstraint(
                "ck_orders_dine_in_has_table",
                "order_type <> 'DineIn' OR table_number IS NOT NULL");
            table.HasCheckConstraint(
                "ck_orders_delivery_has_address",
                "order_type <> 'Delivery' OR delivery_address IS NOT NULL");
            table.HasCheckConstraint("ck_orders_covers_positive", "covers IS NULL OR covers > 0");
        });

        builder.HasKey(o => o.Id);

        builder.Property(o => o.Id).ValueGeneratedNever();

        builder.Property(o => o.TenantId).IsRequired();

        // Text, like every other enum here: readable in SQL and stable when the enum grows.
        builder.Property(o => o.OrderType)
            .IsRequired()
            .HasMaxLength(16)
            .HasConversion<string>();

        builder.Property(o => o.TableNumber)
            .HasMaxLength(Order.TableNumberMaxLength);

        builder.Property(o => o.CustomerName)
            .HasMaxLength(Order.CustomerNameMaxLength);

        builder.Property(o => o.CustomerPhone)
            .HasMaxLength(Order.CustomerPhoneMaxLength);

        builder.Property(o => o.DeliveryAddress)
            .HasMaxLength(Order.AddressMaxLength);

        builder.Property(o => o.AllergyNotes)
            .HasMaxLength(Order.NotesMaxLength);

        builder.Property(o => o.Covers);

        builder.Property(o => o.Status)
            .IsRequired()
            .HasMaxLength(16)
            .HasConversion<string>();

        builder.Property(o => o.PaymentStatus)
            .IsRequired()
            .HasMaxLength(16)
            .HasConversion<string>();

        builder.Property(o => o.PaymentMethod)
            .IsRequired()
            .HasMaxLength(16)
            .HasConversion<string>();

        // bigint millimes, not numeric: this is the figure handed to a payment gateway.
        builder.Property(o => o.TotalAmountMillimes).IsRequired();

        builder.Property(o => o.ExternalPaymentRef)
            .HasMaxLength(Order.ExternalPaymentRefMaxLength);

        builder.Property(o => o.StockDeductedAt);

        builder.Property(o => o.CancellationReason)
            .HasMaxLength(Order.NotesMaxLength);

        builder.Property(o => o.CreatedAt).IsRequired();

        // Derived from the stored columns; nothing to persist.
        builder.Ignore(o => o.TotalAmount);
        builder.Ignore(o => o.IsDigital);
        builder.Ignore(o => o.FulfilmentLabel);

        // The ways the admin board reads this table: the feed, one status at a time, and one
        // fulfilment type at a time.
        builder.HasIndex(o => new { o.TenantId, o.CreatedAt });
        builder.HasIndex(o => new { o.TenantId, o.Status });
        builder.HasIndex(o => new { o.TenantId, o.OrderType });

        // How a payment webhook finds the order it is about.
        builder.HasIndex(o => o.ExternalPaymentRef);

        builder.HasMany(o => o.Items)
            .WithOne(i => i.Order)
            .HasForeignKey(i => i.OrderId)
            // Lines have no life of their own.
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(o => o.TenantId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Metadata
            .FindNavigation(nameof(Order.Items))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}
