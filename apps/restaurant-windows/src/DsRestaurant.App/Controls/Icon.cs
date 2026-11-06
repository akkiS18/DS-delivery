using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace DsRestaurant.App.Controls;

/// <summary>
/// A vector icon: a 24x24 line drawing (stroke 2, round ends) coloured by the surrounding Foreground, so it follows hover, selected and
/// disabled states of the button it sits in. The drawings are in Resources\Icons.xaml (Lucide icon set, ISC licence).
/// </summary>
public class Icon : Control
{
    public static readonly DependencyProperty DataProperty =
        DependencyProperty.Register(nameof(Data), typeof(Geometry), typeof(Icon), new FrameworkPropertyMetadata(null));

    public Geometry? Data
    {
        get => (Geometry?)GetValue(DataProperty);
        set => SetValue(DataProperty, value);
    }

    static Icon()
    {
        DefaultStyleKeyProperty.OverrideMetadata(typeof(Icon), new FrameworkPropertyMetadata(typeof(Icon)));
    }
}

/// <summary>Attached state used by the navigation and tab buttons: "this is the page / tab that is open now".</summary>
public static class Ui
{
    public static readonly DependencyProperty IsActiveProperty =
        DependencyProperty.RegisterAttached("IsActive", typeof(bool), typeof(Ui), new FrameworkPropertyMetadata(false));

    public static bool GetIsActive(DependencyObject d) => (bool)d.GetValue(IsActiveProperty);
    public static void SetIsActive(DependencyObject d, bool value) => d.SetValue(IsActiveProperty, value);
}
