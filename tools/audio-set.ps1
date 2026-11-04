# Set the DEFAULT playback device volume (0..1) and read it back.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\audio-set.ps1 0.65
param([double]$Level = 0.65)

$code = @'
using System;
using System.Runtime.InteropServices;

public static class VolSet
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

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr p);
        int UnregisterControlChangeNotify(IntPtr p);
        int GetChannelCount(out int c);
        int SetMasterVolumeLevel(float f, ref Guid g);
        int SetMasterVolumeLevelScalar(float f, ref Guid g);
        int GetMasterVolumeLevel(out float f);
        int GetMasterVolumeLevelScalar(out float f);
        int SetChannelVolumeLevel(uint ch, float f, ref Guid g);
        int SetChannelVolumeLevelScalar(uint ch, float f, ref Guid g);
        int GetChannelVolumeLevel(uint ch, out float f);
        int GetChannelVolumeLevelScalar(uint ch, out float f);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid g);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    static Guid IID = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    static IAudioEndpointVolume Vol()
    {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        en.GetDefaultAudioEndpoint(0, 0, out dev);
        var iid = IID;
        object o;
        dev.Activate(ref iid, 1, IntPtr.Zero, out o);
        return (IAudioEndpointVolume)o;
    }

    public static float Get()
    {
        float f;
        Vol().GetMasterVolumeLevelScalar(out f);
        return f;
    }

    public static void Set(float f)
    {
        var g = Guid.Empty;
        Vol().SetMasterVolumeLevelScalar(f, ref g);
    }
}
'@
Add-Type -TypeDefinition $code -Language CSharp | Out-Null

$before = [VolSet]::Get()
[VolSet]::Set([float]$Level)
Start-Sleep -Milliseconds 300
$after = [VolSet]::Get()
"system volume: {0:0.00} -> {1:0.00}" -f $before, $after
