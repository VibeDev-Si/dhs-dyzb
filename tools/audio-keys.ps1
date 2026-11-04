# Raise the system volume with real volume-up key events (VK_VOLUME_UP).
# Key events go through the normal audio policy path, so they persist.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\audio-keys.ps1 [count]
param([int]$Count = 20)

$src = @"
using System;
using System.Runtime.InteropServices;
public class VolKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Up(int n) {
    for (int i = 0; i < n; i++) {
      keybd_event(0xAF, 0, 1, UIntPtr.Zero);
      keybd_event(0xAF, 0, 3, UIntPtr.Zero);
      System.Threading.Thread.Sleep(30);
    }
  }
}
"@
Add-Type -TypeDefinition $src -Language CSharp

[VolKeys]::Up($Count)
Write-Output ("pressed volume-up {0} times" -f $Count)
