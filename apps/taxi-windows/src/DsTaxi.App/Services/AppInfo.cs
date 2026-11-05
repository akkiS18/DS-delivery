using System;
using System.Reflection;

namespace DsTaxi.App.Services;

public static class AppInfo
{
    /// <summary>"1.0.0": the version the installer was built with (build-installer.ps1 passes it to dotnet publish).</summary>
    public static readonly string Version = typeof(AppInfo).Assembly.GetName().Version?.ToString(3) ?? "1.0.0";
}
