using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Infrastructure.Persistence.Migrations;

/// <summary>
/// Order types, payment state, per-line customisations, service requests and reviews.
///
/// Two steps here are not reversible by generated code and are the reason this migration is
/// worth reading before running: the money column changes type, and existing orders have to be
/// told that their stock was already deducted. Both are done with data-preserving SQL rather
/// than a drop-and-recreate.
/// </summary>
public partial class AddOrderTypesAndCustomerCare : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // ---------------------------------------------------------------- orders --

        migrationBuilder.DropCheckConstraint(
            name: "ck_orders_total_amount_non_negative",
            table: "orders");

        // A table number only makes sense for a dine-in order.
        migrationBuilder.AlterColumn<string>(
            name: "table_number",
            table: "orders",
            type: "character varying(32)",
            maxLength: 32,
            nullable: true,
            oldClrType: typeof(string),
            oldType: "character varying(32)",
            oldMaxLength: 32);

        migrationBuilder.AddColumn<string>(
            name: "order_type",
            table: "orders",
            type: "character varying(16)",
            maxLength: 16,
            nullable: false,
            // Everything that exists today was ordered at a table.
            defaultValue: "DineIn");

        migrationBuilder.AddColumn<string>(
            name: "customer_name",
            table: "orders",
            type: "character varying(120)",
            maxLength: 120,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "customer_phone",
            table: "orders",
            type: "character varying(32)",
            maxLength: 32,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "delivery_address",
            table: "orders",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "allergy_notes",
            table: "orders",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "payment_status",
            table: "orders",
            type: "character varying(16)",
            maxLength: 16,
            nullable: false,
            defaultValue: "Unpaid");

        migrationBuilder.AddColumn<string>(
            name: "payment_method",
            table: "orders",
            type: "character varying(16)",
            maxLength: 16,
            nullable: false,
            // Before this migration there was only one way to pay.
            defaultValue: "Cash");

        migrationBuilder.AddColumn<string>(
            name: "external_payment_ref",
            table: "orders",
            type: "character varying(128)",
            maxLength: 128,
            nullable: true);

        migrationBuilder.AddColumn<DateTimeOffset>(
            name: "stock_deducted_at",
            table: "orders",
            type: "timestamp with time zone",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "cancellation_reason",
            table: "orders",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<long>(
            name: "total_amount_millimes",
            table: "orders",
            type: "bigint",
            nullable: false,
            defaultValue: 0L);

        // Convert rather than discard: numeric(10,2) → millimes is exact, and the old column is
        // the only record of what these orders cost.
        migrationBuilder.Sql(
            "UPDATE orders SET total_amount_millimes = ROUND(total_amount * 1000)::bigint;");

        // Every order that existed before this migration deducted its stock at creation — that
        // was the only behaviour there was. Saying so stops a later cancellation returning
        // ingredients that were never taken.
        migrationBuilder.Sql(
            "UPDATE orders SET stock_deducted_at = created_at WHERE status <> 'Cancelled';");

        migrationBuilder.DropColumn(name: "total_amount", table: "orders");

        migrationBuilder.AddCheckConstraint(
            name: "ck_orders_total_millimes_non_negative",
            table: "orders",
            sql: "total_amount_millimes >= 0");

        migrationBuilder.AddCheckConstraint(
            name: "ck_orders_dine_in_has_table",
            table: "orders",
            sql: "order_type <> 'DineIn' OR table_number IS NOT NULL");

        migrationBuilder.AddCheckConstraint(
            name: "ck_orders_delivery_has_address",
            table: "orders",
            sql: "order_type <> 'Delivery' OR delivery_address IS NOT NULL");

        migrationBuilder.CreateIndex(
            name: "ix_orders_tenant_id_order_type",
            table: "orders",
            columns: new[] { "tenant_id", "order_type" });

        migrationBuilder.CreateIndex(
            name: "ix_orders_external_payment_ref",
            table: "orders",
            column: "external_payment_ref");

        // ----------------------------------------------------------- order_items --

        migrationBuilder.AddColumn<string>(
            name: "notes",
            table: "order_items",
            type: "character varying(300)",
            maxLength: 300,
            nullable: true);

        // The same drink twice with different customisations is two lines now, so the pair can
        // no longer be unique.
        migrationBuilder.DropIndex(
            name: "ix_order_items_order_id_product_id",
            table: "order_items");

        migrationBuilder.CreateIndex(
            name: "ix_order_items_order_id",
            table: "order_items",
            column: "order_id");

        // ------------------------------------------- order_item_customizations --

        migrationBuilder.CreateTable(
            name: "order_item_customizations",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                order_item_id = table.Column<Guid>(type: "uuid", nullable: false),
                ingredient_id = table.Column<Guid>(type: "uuid", nullable: false),
                ingredient_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                quantity_per_unit = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_order_item_customizations", x => x.id);
                table.CheckConstraint("ck_order_item_customizations_quantity_positive", "quantity_per_unit > 0");
                table.ForeignKey(
                    name: "fk_order_item_customizations_order_items_order_item_id",
                    column: x => x.order_item_id,
                    principalTable: "order_items",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "fk_order_item_customizations_tenants_tenant_id",
                    column: x => x.tenant_id,
                    principalTable: "tenants",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "ix_order_item_customizations_order_item_id_ingredient_id",
            table: "order_item_customizations",
            columns: new[] { "order_item_id", "ingredient_id" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ix_order_item_customizations_tenant_id",
            table: "order_item_customizations",
            column: "tenant_id");

        // ------------------------------------------------------ service_requests --

        migrationBuilder.CreateTable(
            name: "service_requests",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                table_number = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                order_id = table.Column<Guid>(type: "uuid", nullable: true),
                status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                resolved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_service_requests", x => x.id);
                table.ForeignKey(
                    name: "fk_service_requests_orders_order_id",
                    column: x => x.order_id,
                    principalTable: "orders",
                    principalColumn: "id",
                    // A request for water outlives the order it was raised against.
                    onDelete: ReferentialAction.SetNull);
                table.ForeignKey(
                    name: "fk_service_requests_tenants_tenant_id",
                    column: x => x.tenant_id,
                    principalTable: "tenants",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "ix_service_requests_order_id",
            table: "service_requests",
            column: "order_id");

        migrationBuilder.CreateIndex(
            name: "ix_service_requests_tenant_id_status_created_at",
            table: "service_requests",
            columns: new[] { "tenant_id", "status", "created_at" });

        // --------------------------------------------------------- order_reviews --

        migrationBuilder.CreateTable(
            name: "order_reviews",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                tenant_id = table.Column<Guid>(type: "uuid", nullable: false),
                order_id = table.Column<Guid>(type: "uuid", nullable: false),
                rating = table.Column<int>(type: "integer", nullable: false),
                comment = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_order_reviews", x => x.id);
                table.CheckConstraint("ck_order_reviews_rating_range", "rating BETWEEN 1 AND 5");
                table.ForeignKey(
                    name: "fk_order_reviews_orders_order_id",
                    column: x => x.order_id,
                    principalTable: "orders",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "fk_order_reviews_tenants_tenant_id",
                    column: x => x.tenant_id,
                    principalTable: "tenants",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        // One review per order.
        migrationBuilder.CreateIndex(
            name: "ix_order_reviews_order_id",
            table: "order_reviews",
            column: "order_id",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ix_order_reviews_tenant_id_created_at",
            table: "order_reviews",
            columns: new[] { "tenant_id", "created_at" });
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "order_reviews");
        migrationBuilder.DropTable(name: "service_requests");
        migrationBuilder.DropTable(name: "order_item_customizations");

        migrationBuilder.DropIndex(name: "ix_order_items_order_id", table: "order_items");
        migrationBuilder.DropColumn(name: "notes", table: "order_items");

        // Going back requires the pair to be unique again, which only holds if no order has two
        // lines of the same product. Orders placed with customisations will block this.
        migrationBuilder.CreateIndex(
            name: "ix_order_items_order_id_product_id",
            table: "order_items",
            columns: new[] { "order_id", "product_id" },
            unique: true);

        migrationBuilder.DropIndex(name: "ix_orders_external_payment_ref", table: "orders");
        migrationBuilder.DropIndex(name: "ix_orders_tenant_id_order_type", table: "orders");

        migrationBuilder.DropCheckConstraint(name: "ck_orders_delivery_has_address", table: "orders");
        migrationBuilder.DropCheckConstraint(name: "ck_orders_dine_in_has_table", table: "orders");
        migrationBuilder.DropCheckConstraint(name: "ck_orders_total_millimes_non_negative", table: "orders");

        migrationBuilder.AddColumn<decimal>(
            name: "total_amount",
            table: "orders",
            type: "numeric(10,2)",
            precision: 10,
            scale: 2,
            nullable: false,
            defaultValue: 0m);

        migrationBuilder.Sql("UPDATE orders SET total_amount = total_amount_millimes / 1000.0;");

        migrationBuilder.DropColumn(name: "total_amount_millimes", table: "orders");
        migrationBuilder.DropColumn(name: "cancellation_reason", table: "orders");
        migrationBuilder.DropColumn(name: "stock_deducted_at", table: "orders");
        migrationBuilder.DropColumn(name: "external_payment_ref", table: "orders");
        migrationBuilder.DropColumn(name: "payment_method", table: "orders");
        migrationBuilder.DropColumn(name: "payment_status", table: "orders");
        migrationBuilder.DropColumn(name: "allergy_notes", table: "orders");
        migrationBuilder.DropColumn(name: "delivery_address", table: "orders");
        migrationBuilder.DropColumn(name: "customer_phone", table: "orders");
        migrationBuilder.DropColumn(name: "customer_name", table: "orders");
        migrationBuilder.DropColumn(name: "order_type", table: "orders");

        // Takeaway and delivery orders have no table number, so they cannot survive the trip
        // back to a NOT NULL column. Give them a placeholder rather than failing the migration.
        migrationBuilder.Sql("UPDATE orders SET table_number = '—' WHERE table_number IS NULL;");

        migrationBuilder.AlterColumn<string>(
            name: "table_number",
            table: "orders",
            type: "character varying(32)",
            maxLength: 32,
            nullable: false,
            oldClrType: typeof(string),
            oldType: "character varying(32)",
            oldMaxLength: 32,
            oldNullable: true);

        migrationBuilder.AddCheckConstraint(
            name: "ck_orders_total_amount_non_negative",
            table: "orders",
            sql: "total_amount >= 0");
    }
}
