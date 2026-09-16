using Domain.Entities;
using Domain.ValueObjects;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Infrastructure.Persistence.Configurations;

public sealed class IngredientConfiguration : IEntityTypeConfiguration<Ingredient>
{
    public void Configure(EntityTypeBuilder<Ingredient> builder)
    {
        builder.ToTable("ingredients", table =>
        {
            table.HasCheckConstraint("ck_ingredients_current_stock_non_negative", "current_stock >= 0");
            table.HasCheckConstraint("ck_ingredients_minimum_stock_alert_non_negative", "minimum_stock_alert >= 0");
        });

        builder.HasKey(i => i.Id);

        builder.Property(i => i.Id).ValueGeneratedNever();

        builder.Property(i => i.TenantId).IsRequired();

        builder.Property(i => i.Name)
            .IsRequired()
            .HasMaxLength(Ingredient.NameMaxLength);

        builder.Property(i => i.Unit)
            .IsRequired()
            .HasMaxLength(UnitOfMeasure.MaxLength)
            .HasConversion(
                unit => unit.Code,
                code => UnitOfMeasure.From(code),
                new ValueComparer<UnitOfMeasure>(
                    (left, right) => left!.Code == right!.Code,
                    unit => unit.Code.GetHashCode(),
                    unit => UnitOfMeasure.From(unit.Code)));

        // decimal(18,4) for stock quantities, per CLAUDE.md.
        builder.Property(i => i.CurrentStock)
            .IsRequired()
            .HasPrecision(18, 4);

        builder.Property(i => i.MinimumStockAlert)
            .IsRequired()
            .HasPrecision(18, 4);

        builder.HasIndex(i => new { i.TenantId, i.Name }).IsUnique();

        builder.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(i => i.TenantId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Metadata
            .FindNavigation(nameof(Ingredient.RecipeItems))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}
