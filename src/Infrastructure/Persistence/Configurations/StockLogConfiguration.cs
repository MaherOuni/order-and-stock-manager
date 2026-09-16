using Domain.Entities;
using Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Infrastructure.Persistence.Configurations;

public sealed class StockLogConfiguration : IEntityTypeConfiguration<StockLog>
{
    public void Configure(EntityTypeBuilder<StockLog> builder)
    {
        builder.ToTable("stock_logs", table =>
        {
            // The ledger is only trustworthy if each line balances and actually moved something.
            table.HasCheckConstraint(
                "ck_stock_logs_balances",
                "previous_stock + change_amount = new_stock");
            table.HasCheckConstraint(
                "ck_stock_logs_change_amount_not_zero",
                "change_amount <> 0");
            table.HasCheckConstraint(
                "ck_stock_logs_new_stock_non_negative",
                "new_stock >= 0");
        });

        builder.HasKey(l => l.Id);

        builder.Property(l => l.Id).ValueGeneratedNever();

        builder.Property(l => l.TenantId).IsRequired();

        builder.Property(l => l.IngredientId).IsRequired();

        // Signed: positive is goods-in, negative is goods-out.
        builder.Property(l => l.ChangeAmount)
            .IsRequired()
            .HasPrecision(18, 4);

        builder.Property(l => l.PreviousStock)
            .IsRequired()
            .HasPrecision(18, 4);

        builder.Property(l => l.NewStock)
            .IsRequired()
            .HasPrecision(18, 4);

        // Stored as text: readable in SQL, and a new reason never renumbers existing rows.
        builder.Property(l => l.Reason)
            .IsRequired()
            .HasMaxLength(32)
            .HasConversion<string>();

        // Null for manual adjustments; set for anything an order caused.
        builder.Property(l => l.OrderId);

        builder.Property(l => l.Note)
            .HasMaxLength(StockLog.NoteMaxLength);

        builder.Property(l => l.CreatedAt).IsRequired();

        // Serves the ledger views: movements of one ingredient, and the tenant-wide feed.
        // Ascending is enough — PostgreSQL scans an index backwards just as cheaply.
        builder.HasIndex(l => new { l.IngredientId, l.CreatedAt });

        builder.HasIndex(l => new { l.TenantId, l.CreatedAt });

        // Answers "what did this order consume?" in one seek.
        builder.HasIndex(l => l.OrderId);

        builder.HasOne(l => l.Ingredient)
            .WithMany()
            .HasForeignKey(l => l.IngredientId)
            // History belongs to the ingredient: deleting it takes its ledger with it.
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(l => l.Order)
            .WithMany()
            .HasForeignKey(l => l.OrderId)
            // Orders are never deleted by the API; if one ever is, its movements go with it
            // rather than blocking the delete or leaving dangling references.
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(l => l.TenantId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
