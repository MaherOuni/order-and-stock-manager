using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Infrastructure.Persistence.Migrations;

/// <inheritdoc />
public partial class AddOrders : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "orders",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                table_number = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                total_amount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_orders", x => x.id);
                table.CheckConstraint("ck_orders_total_amount_non_negative", "total_amount >= 0");
                table.ForeignKey(
                    name: "fk_orders_tenants_tenant_id",
                    column: x => x.tenant_id,
                    principalTable: "tenants",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "order_items",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                order_id = table.Column<Guid>(type: "uuid", nullable: false),
                product_id = table.Column<Guid>(type: "uuid", nullable: false),
                quantity = table.Column<int>(type: "integer", nullable: false),
                unit_price = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_order_items", x => x.id);
                table.CheckConstraint("ck_order_items_quantity_positive", "quantity > 0");
                table.CheckConstraint("ck_order_items_unit_price_non_negative", "unit_price >= 0");
                table.ForeignKey(
                    name: "fk_order_items_orders_order_id",
                    column: x => x.order_id,
                    principalTable: "orders",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "fk_order_items_products_product_id",
                    column: x => x.product_id,
                    principalTable: "products",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "fk_order_items_tenants_tenant_id",
                    column: x => x.tenant_id,
                    principalTable: "tenants",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "ix_orders_tenant_id_created_at",
            table: "orders",
            columns: new[] { "tenant_id", "created_at" });

        migrationBuilder.CreateIndex(
            name: "ix_orders_tenant_id_status",
            table: "orders",
            columns: new[] { "tenant_id", "status" });

        migrationBuilder.CreateIndex(
            name: "ix_order_items_order_id_product_id",
            table: "order_items",
            columns: new[] { "order_id", "product_id" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ix_order_items_product_id",
            table: "order_items",
            column: "product_id");

        migrationBuilder.CreateIndex(
            name: "ix_order_items_tenant_id",
            table: "order_items",
            column: "tenant_id");

        // Ledger lines written by an order point back at it. Nullable: manual adjustments and
        // opening stock have no order, and every row that already exists is one of those.
        migrationBuilder.AddColumn<Guid>(
            name: "order_id",
            table: "stock_logs",
            type: "uuid",
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "ix_stock_logs_order_id",
            table: "stock_logs",
            column: "order_id");

        migrationBuilder.AddForeignKey(
            name: "fk_stock_logs_orders_order_id",
            table: "stock_logs",
            column: "order_id",
            principalTable: "orders",
            principalColumn: "id",
            onDelete: ReferentialAction.Cascade);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "fk_stock_logs_orders_order_id",
            table: "stock_logs");

        migrationBuilder.DropIndex(
            name: "ix_stock_logs_order_id",
            table: "stock_logs");

        migrationBuilder.DropColumn(
            name: "order_id",
            table: "stock_logs");

        migrationBuilder.DropTable(name: "order_items");

        migrationBuilder.DropTable(name: "orders");
    }
}
