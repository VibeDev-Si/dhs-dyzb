# Make the DEFAULT playback device loud enough, using real volume key events.
#
# Why keys instead of SetMasterVolumeLevelScalar: on this machine the endpoint
# write reported 0.60 but snapped back to 0.06 within seconds (device/APO
# reloading its stored value). Volume-up keys go through the audio policy and
# stick.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\audio-loud.ps1 [target]
#   target = 0.0 .. 1.0, default 0.55
param([double]$Target = 0.55)

$code = @'
using System;
using System.Runtime.InteropServices;

public static class VolCtl
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        int NotImpl1();
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
        int GetDevice(string pwstrId, out IMMDevice ppDevice);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int GetState(out int pdwState);
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

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    static Guid IID_IEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    static IAudioEndpointVolume Vol()
    {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        en.GetDefaultAudioEndpoint(0, 0, out dev);
        var iid = IID_IEndpointVolume;
        object o;
        dev.Activate(ref iid, 1, IntPtr.Zero, out o);
        return (IAudioEndpointVolume)o;
    }

    public static float GetScalar()
    {
        float s;
        Vol().GetMasterVolumeLevelScalar(out s);
        return s;
    }

    public static bool GetMute()
    {
        bool m;
        Vol().GetMute(out m);
        return m;
    }

    public static void Unmute()
    {
        var g = Guid.Empty;
        Vol().SetMute(false, ref g);
    }

    static void Tap(byte vk)
    {
        keybd_event(vk, 0, 1, UIntPtr.Zero);
        keybd_event(vk, 0, 3, UIntPtr.Zero);
        System.Threading.Thread.Sleep(25);
    }

    public static void Up(int n)
    {
        for (int i = 0; i < n; i++) Tap(0xAF);
    }

    public static void Down(int n)
    {
        for (int i = 0; i < n; i++) Tap(0xAE);
    }
}
'@
Add-Type -TypeDefinition $code -Language CSharp | Out-Null

if ($Target -lt 0) { $Target = 0 }
if ($Target -gt 1) { $Target = 1 }

$before = [VolCtl]::GetScalar()
$mute = [VolCtl]::GetMute()
if ($mute) { [VolCtl]::Unmute(); Start-Sleep -Milliseconds 200 }

for ($i = 0; $i -lt 80; $i++) {
    $cur = [VolCtl]::GetScalar()
    if ([Math]::Abs($cur - $Target) -le 0.03) { break }
    if ($cur -lt $Target) { [VolCtl]::Up(1) } else { [VolCtl]::Down(1) }
}

Start-Sleep -Milliseconds 300
$after = [VolCtl]::GetScalar()
$mute2 = [VolCtl]::GetMute()

"system volume: {0:0.00} -> {1:0.00}   target {2:0.00}   mute: {3}" -f $before, $after, $Target, ($(if ($mute2) { "ON" } else { "off" }))
if ([Math]::Abs($after - $Target) -gt 0.06) {
    "warn: could not reach target, the device may clamp or reset it"
}
