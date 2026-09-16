using Domain.Entities;
using Domain.ValueObjects;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Infrastructure.Persistence.Configurations;

public sealed class TenantConfiguration : IEntityTypeConfiguration<Tenant>
{
    public void Configure(EntityTypeBuilder<Tenant> builder)
    {
        builder.ToTable("tenants");

        builder.HasKey(t => t.Id);

        builder.Property(t => t.Id).ValueGeneratedNever();

        builder.Property(t => t.Name)
            .IsRequired()
            .HasMaxLength(Tenant.NameMaxLength);

        builder.Property(t => t.Slug)
            .IsRequired()
            .HasMaxLength(Slug.MaxLength)
            .HasConversion(
                slug => slug.Value,
                value => Slug.From(value),
                new ValueComparer<Slug>(
                    (left, right) => left!.Value == right!.Value,
                    slug => slug.Value.GetHashCode(),
                    slug => Slug.From(slug.Value)));

        builder.Property(t => t.Currency)
            .IsRequired()
            .HasMaxLength(Tenant.CurrencyLength);

        builder.Property(t => t.CreatedAt).IsRequired();

        // jsonb rather than text: it is JSON, and Postgres can query into it later if the
        // floor ever needs reporting on.
        builder.Property(t => t.FloorPlanJson)
            .HasColumnType("jsonb");

        // The slug addresses the tenant publicly, so it must be globally unique.
        builder.HasIndex(t => t.Slug).IsUnique();
    }
}
