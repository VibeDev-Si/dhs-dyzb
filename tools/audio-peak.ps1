# Read real-time peak level of the DEFAULT playback device.
# peak > 0 means audio is actually flowing to that device.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\audio-peak.ps1
$code = @'
using System;
using System.Runtime.InteropServices;

public static class PeakMeter
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        int NotImpl1();
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioMeterInformation
    {
        int GetPeakValue(out float pfPeak);
    }

    public static float Peak()
    {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        enumerator.GetDefaultAudioEndpoint(0, 0, out dev);
        var iid = typeof(IAudioMeterInformation).GUID;
        object meterObj;
        dev.Activate(ref iid, 1, IntPtr.Zero, out meterObj);
        var meter = (IAudioMeterInformation)meterObj;
        float peak;
        meter.GetPeakValue(out peak);
        return peak;
    }
}
'@
Add-Type -TypeDefinition $code -Language CSharp | Out-Null

$samples = @()
for ($i = 0; $i -lt 8; $i++) {
    $samples += [math]::Round([PeakMeter]::Peak(), 4)
    Start-Sleep -Milliseconds 250
}
$max = ($samples | Measure-Object -Maximum).Maximum
"default device peak samples: " + ($samples -join '  ')
if ($max -gt 0.001) {
    "RESULT: audio IS rendering to the default device (peak $max). Problem is downstream: volume / mute / cable / wrong output."
} else {
    "RESULT: nothing is rendering on the default device. Check player paused, Chrome muted, or another app owns the device."
}
