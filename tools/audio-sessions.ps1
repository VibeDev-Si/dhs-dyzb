# List default endpoint volume/mute + every audio session (process, volume, mute).
# ASCII only: Windows PowerShell 5.1 reads .ps1 as ANSI unless it has a BOM.
$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class AudioInfo
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

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2
    {
        int NotImpl0();
        int NotImpl1();
        int GetAudioSessionControl(ref Guid g, int f, out IntPtr p);
        int GetSimpleAudioVolume(ref Guid g, int f, out IntPtr p);
        int GetSessionEnumerator(out IAudioSessionEnumerator p);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator
    {
        int GetCount(out int c);
        int GetSession(int i, out IAudioSessionControl2 p);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2
    {
        int NotImpl0();
        int NotImpl1();
        int NotImpl2();
        int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string p);
        int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string p);
        int GetProcessId(out uint p);
        int IsSystemSoundsSession();
        int SetDuckingPreference(bool b);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume
    {
        int SetMasterVolume(float f, ref Guid g);
        int GetMasterVolume(out float f);
        int SetMute(bool b, ref Guid g);
        int GetMute(out bool b);
    }

    static Guid IID_IEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    static Guid IID_ISessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    static Guid IID_ISimpleAudioVolume = new Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8");

    public static string Default()
    {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        en.GetDefaultAudioEndpoint(0, 0, out dev);
        string id;
        dev.GetId(out id);
        var iid = IID_IEndpointVolume;
        object o;
        dev.Activate(ref iid, 1, IntPtr.Zero, out o);
        var vol = (IAudioEndpointVolume)o;
        float s; bool mute;
        vol.GetMasterVolumeLevelScalar(out s);
        vol.GetMute(out mute);
        return id + "|" + s.ToString("0.00") + "|" + (mute ? "muted" : "on");
    }

    public static string[] Sessions()
    {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        en.GetDefaultAudioEndpoint(0, 0, out dev);
        var iid = IID_ISessionManager2;
        object o;
        dev.Activate(ref iid, 1, IntPtr.Zero, out o);
        var mgr = (IAudioSessionManager2)o;
        IAudioSessionEnumerator list;
        mgr.GetSessionEnumerator(out list);
        int n;
        list.GetCount(out n);
        var result = new string[n];
        var g = Guid.Empty;
        for (int i = 0; i < n; i++)
        {
            IAudioSessionControl2 c2;
            list.GetSession(i, out c2);
            uint pid; c2.GetProcessId(out pid);
            // simple volume comes from the session manager, keyed by the same instance id
            string inst;
            c2.GetSessionInstanceIdentifier(out inst);
            string name = "";
            try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { name = "?"; }
            result[i] = pid + "|" + name + "|" + inst;
        }
        return result;
    }

    public static string SessionVolume(string instanceId)
    {
        var en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        en.GetDefaultAudioEndpoint(0, 0, out dev);
        var iid = IID_ISessionManager2;
        object o;
        dev.Activate(ref iid, 1, IntPtr.Zero, out o);
        var mgr = (IAudioSessionManager2)o;
        
        IAudioSessionEnumerator list;
        mgr.GetSessionEnumerator(out list);
        int n;
        list.GetCount(out n);
        for (int i = 0; i < n; i++)
        {
            IAudioSessionControl2 c2;
            list.GetSession(i, out c2);
            string inst;
            c2.GetSessionInstanceIdentifier(out inst);
            if (inst != instanceId) continue;
            var sv = (ISimpleAudioVolume)c2;
            float v; bool m;
            sv.GetMasterVolume(out v);
            sv.GetMute(out m);
            return v.ToString("0.00") + "|" + (m ? "muted" : "on");
        }
        return "?";
    }
}
'@
Add-Type -TypeDefinition $code -Language CSharp | Out-Null

$d = [AudioInfo]::Default() -split '\|'
"default endpoint id : $($d[0])"
"default endpoint vol: $($d[1])  state: $($d[2])"
""
"pid    process            vol    state   session"
foreach ($row in [AudioInfo]::Sessions()) {
    $p = $row -split '\|'
    $v = [AudioInfo]::SessionVolume($p[2]) -split '\|'
    "{0,-6} {1,-18} {2,-6} {3,-7} {4}" -f $p[0], $p[1], $v[0], $v[1], $p[2].Substring([Math]::Max(0, $p[2].Length - 40))
}
