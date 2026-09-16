namespace Domain.Common;

/// <summary>
/// Conversion between the menu's decimal amounts and the integer millimes both Tunisian
/// gateways speak. 1 TND = 1000 millimes.
///
/// Money crossing a payment API is an integer on purpose: "4.50" is a display concern, and a
/// float rounding error on the way to a gateway is a real charge for the wrong amount.
/// </summary>
public static class Millimes
{
    public const int PerUnit = 1000;

    public static long FromAmount(decimal amount)
        => (long)decimal.Round(amount * PerUnit, 0, MidpointRounding.AwayFromZero);

    public static decimal ToAmount(long millimes) => millimes / (decimal)PerUnit;
}
