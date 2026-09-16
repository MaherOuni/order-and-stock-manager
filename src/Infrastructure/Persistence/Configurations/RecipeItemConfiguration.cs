using Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Infrastructure.Persistence.Configurations;

public sealed class RecipeItemConfiguration : IEntityTypeConfiguration<RecipeItem>
{
    public void Configure(EntityTypeBuilder<RecipeItem> builder)
    {
        builder.ToTable("recipe_items", table =>
            table.HasCheckConstraint("ck_recipe_items_quantity_required_positive", "quantity_required > 0"));

        builder.HasKey(r => r.Id);

        builder.Property(r => r.Id).ValueGeneratedNever();

        // Denormalised from the parent product so the row is covered by the global query filter
        // like every other tenant table (CLAUDE.md: every table carries a TenantId).
        builder.Property(r => r.TenantId).IsRequired();

        builder.Property(r => r.QuantityRequired)
            .IsRequired()
            .HasPrecision(18, 4);

        // One line per ingredient per product; quantities are edited, never duplicated.
        builder.HasIndex(r => new { r.ProductId, r.IngredientId }).IsUnique();
        builder.HasIndex(r => r.TenantId);

        builder.HasOne(r => r.Product)
            .WithMany(p => p.RecipeItems)
            .HasForeignKey(r => r.ProductId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(r => r.Ingredient)
            .WithMany(i => i.RecipeItems)
            .HasForeignKey(r => r.IngredientId)
            // An ingredient still used by a recipe cannot be deleted.
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(r => r.TenantId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
