using DsRestaurant.Core.Finance;
using FluentAssertions;
using Xunit;

namespace DsRestaurant.Core.Tests;

public class FinanceFormatTests
{
    private const char Nbsp = '\u00A0';

    [Fact]
    public void SmallAmountInFull()
    {
        FinanceFormat.Som(450_000).Should().Be($"450{Nbsp}000 so\u2018m");
    }

    [Fact]
    public void Zero()
    {
        FinanceFormat.Som(0).Should().Be("0 so\u2018m");
    }

    [Fact]
    public void Under10MlnStaysInFull()
    {
        FinanceFormat.Som(9_999_999).Should().Be($"9{Nbsp}999{Nbsp}999 so\u2018m");
    }

    [Fact]
    public void Exactly10MlnIsShortened()
    {
        FinanceFormat.Som(10_000_000).Should().Be("10 mln so\u2018m");
    }

    [Fact]
    public void TwelvePointFourMln()
    {
        FinanceFormat.Som(12_400_000).Should().Be("12,4 mln so\u2018m");
    }

    [Fact]
    public void Billions()
    {
        FinanceFormat.Som(1_250_000_000).Should().Be("1,3 mlrd so\u2018m");
    }

    [Fact]
    public void Negative()
    {
        FinanceFormat.Som(-5_000).Should().Be($"\u22125{Nbsp}000 so\u2018m");
    }

    [Fact]
    public void SignedPlus()
    {
        FinanceFormat.Signed(49_000).Should().Be($"+49{Nbsp}000 so\u2018m");
    }

    [Fact]
    public void SignedMinus()
    {
        FinanceFormat.Signed(-5_000).Should().Be($"\u22125{Nbsp}000 so\u2018m");
    }

    [Fact]
    public void ShareOfAHalf()
    {
        FinanceFormat.Share(450_000, 900_000).Should().Be(0.5f);
    }

    [Fact]
    public void ShareWithNothingEarned()
    {
        FinanceFormat.Share(10, 0).Should().Be(0f);
    }

    [Fact]
    public void ShareNeverAboveOne()
    {
        FinanceFormat.Share(2_000, 1_000).Should().Be(1f);
    }
}
