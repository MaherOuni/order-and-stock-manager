using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Infrastructure.Persistence.Migrations;

/// <inheritdoc />
public partial class AddStockLog : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "stock_logs",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                ingredient_id = table.Column<Guid>(type: "uuid", nullable: false),
                change_amount = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                previous_stock = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                new_stock = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false),
                reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_stock_logs", x => x.id);
                table.CheckConstraint("ck_stock_logs_balances", "previous_stock + change_amount = new_stock");
                table.CheckConstraint("ck_stock_logs_change_amount_not_zero", "change_amount <> 0");
                table.CheckConstraint("ck_stock_logs_new_stock_non_negative", "new_stock >= 0");
                table.ForeignKey(
                    name: "fk_stock_logs_ingredients_ingredient_id",
                    column: x => x.ingredient_id,
                    principalTable: "ingredients",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "fk_stock_logs_tenants_tenant_id",
                    column: x => x.tenant_id,
                    principalTable: "tenants",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "ix_stock_logs_ingredient_id_created_at",
            table: "stock_logs",
            columns: new[] { "ingredient_id", "created_at" });

        migrationBuilder.CreateIndex(
            name: "ix_stock_logs_tenant_id_created_at",
            table: "stock_logs",
            columns: new[] { "tenant_id", "created_at" });
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "stock_logs");
    }
}
