using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Infrastructure.Persistence.Migrations;

/// <summary>
/// The room drawn in the floor planner, and how many people are actually at a table.
///
/// Both are additive and nullable: existing tenants have no plan, and existing orders never
/// recorded covers. Neither can be inferred, so neither is backfilled — null means "not known",
/// which is the truth.
/// </summary>
public partial class AddFloorPlanAndCovers : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // jsonb, not text: it is JSON, and Postgres can index into it if the floor ever needs
        // reporting. The API stores the planner's document verbatim.
        migrationBuilder.AddColumn<string>(
            name: "floor_plan_json",
            table: "tenants",
            type: "jsonb",
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "covers",
            table: "orders",
            type: "integer",
            nullable: true);

        migrationBuilder.AddCheckConstraint(
            name: "ck_orders_covers_positive",
            table: "orders",
            sql: "covers IS NULL OR covers > 0");
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropCheckConstraint(name: "ck_orders_covers_positive", table: "orders");
        migrationBuilder.DropColumn(name: "covers", table: "orders");
        migrationBuilder.DropColumn(name: "floor_plan_json", table: "tenants");
    }
}
