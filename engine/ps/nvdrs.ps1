# NvAPI DRS bridge (ASCII only; JSON output). Used by engine/gpu.js
# System32\nvapi64.dll is a loader stub exporting only nvapi_QueryInterface;
# real functions are resolved via NVAPI interface IDs (same approach as NvAPIWrapper).
param(
    [Parameter(Mandatory = $true)][ValidateSet('probe', 'list', 'get', 'set', 'reset', 'setMany', 'check', 'resolve', 'enumids', 'meta', 'apps', 'installed', 'addApp', 'delProfile', 'icons', 'settings')][string]$Action,
    [string]$Profile = 'global',
    [string]$ProfileName = '',
    [string]$Ids = '',
    [string]$Id = '',
    [string]$Value = '',
    [string]$Pairs = '',
    [string]$Name = '',
    [string]$ExePath = '',
    [string]$Paths = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing

$src = @'
using System;
using System.Collections;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class NvDrs
{
    const int OK = 0;
    const int END_ENUMERATION = -7;
    const int SETTING_NOT_FOUND = -160;
    const int API_MISSING = -999;
    const int BUF = 4100;

    [StructLayout(LayoutKind.Sequential, Pack = 8, CharSet = CharSet.Unicode)]
    public struct SettingInfo
    {
        public uint Version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 2048)] public string Name;
        public uint Id;
        public uint Type;
        public uint Location;
        public uint IsCurrentPredefined;
        public uint IsPredefinedValid;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = BUF)] public byte[] PredefinedValue;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = BUF)] public byte[] CurrentValue;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 8, CharSet = CharSet.Unicode)]
    public struct ProfileInfo
    {
        public uint Version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 2048)] public string Name;
        public uint GpuSupport;
        public uint IsPredefined;
        public uint NumApps;
        public uint NumSettings;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct UniStr
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 2048)] public string Value;
    }

    [DllImport("nvapi64.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr nvapi_QueryInterface(uint id);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int InitDel();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int SessionCreateDel(out ulong session);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int SessionDel(ulong session);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int EnumProfilesDel(ulong session, uint index, out ulong profile);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int GetProfileInfoDel(ulong session, ulong profile, ref ProfileInfo info);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int GlobalProfileDel(ulong session, out ulong profile);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int GetSettingDel(ulong session, ulong profile, uint id, ref SettingInfo setting);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int SetSettingDel(ulong session, ulong profile, ref SettingInfo setting);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int RestoreSettingDel(ulong session, ulong profile, uint id);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int NameFromIdDel(uint id, out UniStr name);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int IdFromNameDel([MarshalAs(UnmanagedType.LPWStr)] string name, out uint id);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int EnumSettingIdsDel(IntPtr ids, ref uint count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int EnumSettingValuesDel(uint settingId, ref uint count, IntPtr values);

    static InitDel _init;
    static SessionCreateDel _createSession;
    static SessionDel _destroySession;
    static SessionDel _loadSettings;
    static SessionDel _saveSettings;
    static EnumProfilesDel _enumProfiles;
    static GetProfileInfoDel _getProfileInfo;
    static GlobalProfileDel _getGlobalProfile;
    static GetSettingDel _getSetting;
    static SetSettingDel _setSetting;
    static RestoreSettingDel _restoreSetting;
    static NameFromIdDel _nameFromId;
    static IdFromNameDel _idFromName;
    static EnumSettingIdsDel _enumSettingIds;
    static EnumSettingValuesDel _enumSettingValues;
    static bool _apisReady;

    [StructLayout(LayoutKind.Sequential, Pack = 8, CharSet = CharSet.Unicode)]
    public struct AppInfo
    {
        public uint Version;
        public uint IsPredefined;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 2048)] public string AppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 2048)] public string FriendlyName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 2048)] public string Launcher;
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int FindProfileByNameDel(ulong session, [MarshalAs(UnmanagedType.LPWStr)] string name, out ulong profile);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int FindAppByNameDel(ulong session, [MarshalAs(UnmanagedType.LPWStr)] string appName, out ulong profile, IntPtr app);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int EnumAppsDel(ulong session, ulong profile, uint startIndex, ref uint count, IntPtr apps);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int CreateProfileDel(ulong session, IntPtr profile, out ulong profileHandle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int CreateApplicationDel(ulong session, ulong profile, IntPtr app);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int DeleteProfileDel(ulong session, ulong profile);

    static FindProfileByNameDel _findProfileByName;
    static FindAppByNameDel _findApp;
    static EnumAppsDel _enumApps;
    static CreateProfileDel _createProfile;
    static CreateApplicationDel _createApp;
    static DeleteProfileDel _deleteProfile;

    static T Bind<T>(uint id) where T : class
    {
        IntPtr p = nvapi_QueryInterface(id);
        if (p == IntPtr.Zero) return null;
        return Marshal.GetDelegateForFunctionPointer<T>(p);
    }

    static int EnsureApis()
    {
        if (_apisReady) return OK;
        _init = Bind<InitDel>(0x0150E828);
        _createSession = Bind<SessionCreateDel>(0x0694D52E);
        _destroySession = Bind<SessionDel>(0xDAD9CFF8);
        _loadSettings = Bind<SessionDel>(0x375DBD6B);
        _saveSettings = Bind<SessionDel>(0xFCBC7E14);
        _enumProfiles = Bind<EnumProfilesDel>(0xBC371EE0);
        _getProfileInfo = Bind<GetProfileInfoDel>(0x61CD6FD6);
        _getGlobalProfile = Bind<GlobalProfileDel>(0x617BFF9F);
        _getSetting = Bind<GetSettingDel>(0x73BF8338);
        _setSetting = Bind<SetSettingDel>(0x577DD202);
        _restoreSetting = Bind<RestoreSettingDel>(0x53F0381E);
        _nameFromId = Bind<NameFromIdDel>(0xD61CBE6E);
        _idFromName = Bind<IdFromNameDel>(0xCB7309CD);
        _enumSettingIds = Bind<EnumSettingIdsDel>(0xF020614A);
        _enumSettingValues = Bind<EnumSettingValuesDel>(0x2EC39F90);
        _findProfileByName = Bind<FindProfileByNameDel>(0x7E4A9A0B);
        _findApp = Bind<FindAppByNameDel>(0xEEE566B2);
        _enumApps = Bind<EnumAppsDel>(0x7FA2173A);
        _createProfile = Bind<CreateProfileDel>(0xCC176068);
        _createApp = Bind<CreateApplicationDel>(0x4347A9DE);
        _deleteProfile = Bind<DeleteProfileDel>(0x17093206);
        if (_init == null || _createSession == null || _destroySession == null || _loadSettings == null ||
            _saveSettings == null || _enumProfiles == null || _getProfileInfo == null || _getGlobalProfile == null ||
            _getSetting == null || _setSetting == null || _nameFromId == null) return API_MISSING;
        _apisReady = true;
        return OK;
    }

    static SettingInfo NewSetting()
    {
        SettingInfo s = new SettingInfo();
        s.PredefinedValue = new byte[BUF];
        s.CurrentValue = new byte[BUF];
        s.Version = (uint)((1 << 16) | Marshal.SizeOf(typeof(SettingInfo)));
        return s;
    }

    static ProfileInfo NewProfile()
    {
        ProfileInfo p = new ProfileInfo();
        p.Version = (uint)((1 << 16) | Marshal.SizeOf(typeof(ProfileInfo)));
        return p;
    }

    static int OpenSession(out ulong session)
    {
        session = 0;
        int st = EnsureApis();
        if (st != OK) return st;
        st = _init();
        if (st != OK) return st;
        st = _createSession(out session);
        if (st != OK) return st;
        st = _loadSettings(session);
        return st;
    }

    static Dictionary<string, object> Fail(int status)
    {
        Dictionary<string, object> r = new Dictionary<string, object>();
        r["ok"] = false;
        r["status"] = status;
        return r;
    }

    public static Dictionary<string, object> Probe()
    {
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        _destroySession(session);
        Dictionary<string, object> r = new Dictionary<string, object>();
        r["ok"] = true;
        r["available"] = true;
        r["status"] = 0;
        return r;
    }

    static Dictionary<string, object> ProfileEntry(ulong session, ulong handle, bool isGlobal, long index)
    {
        ProfileInfo info = NewProfile();
        int st = _getProfileInfo(session, handle, ref info);
        Dictionary<string, object> e = new Dictionary<string, object>();
        e["index"] = index;
        e["isGlobal"] = isGlobal;
        if (st != OK) { e["error"] = st; return e; }
        e["name"] = info.Name;
        e["isPredefined"] = info.IsPredefined != 0;
        e["numApps"] = info.NumApps;
        e["numSettings"] = info.NumSettings;
        return e;
    }

    public static Dictionary<string, object> List()
    {
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        try
        {
            ulong global = 0;
            bool hasGlobal = _getGlobalProfile(session, out global) == OK;
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            if (hasGlobal) list.Add(ProfileEntry(session, global, true, -1));
            for (uint i = 0; i < 20000; i++)
            {
                ulong p;
                int s = _enumProfiles(session, i, out p);
                if (s != OK) break;
                if (hasGlobal && p == global) continue;
                list.Add(ProfileEntry(session, p, false, (long)i));
            }
            Dictionary<string, object> r = new Dictionary<string, object>();
            r["ok"] = true;
            r["status"] = 0;
            r["profiles"] = list;
            return r;
        }
        finally { _destroySession(session); }
    }

    static ulong ResolveProfile(ulong session, string spec)
    {
        if (spec == "global")
        {
            ulong g;
            if (_getGlobalProfile(session, out g) == OK) return g;
            return 0;
        }
        if (spec.StartsWith("n:"))
        {
            string decoded = Uri.UnescapeDataString(spec.Substring(2));
            ulong byName;
            if (_findProfileByName != null && _findProfileByName(session, decoded, out byName) == OK) return byName;
            return 0;
        }
        if (spec.StartsWith("idx:"))
        {
            uint n = uint.Parse(spec.Substring(4));
            ulong p;
            if (_enumProfiles(session, n, out p) == OK) return p;
            return 0;
        }
        return 0;
    }

    const int NAME_MISMATCH = -998;

    // Handles/indices are session-local; verify the caller's expected profile name before touching settings.
    static int CheckProfileName(ulong session, ulong profile, string expected)
    {
        if (expected == null || expected.Length == 0) return OK;
        ProfileInfo pi = NewProfile();
        if (_getProfileInfo(session, profile, ref pi) != OK) return NAME_MISMATCH;
        return string.Equals(pi.Name, expected, StringComparison.Ordinal) ? OK : NAME_MISMATCH;
    }

    static string U16(byte[] raw, int offset)
    {
        StringBuilder sb = new StringBuilder();
        for (int o = offset; o + 1 < raw.Length; o += 2)
        {
            ushort ch = (ushort)(raw[o] | (raw[o + 1] << 8));
            if (ch == 0) break;
            sb.Append((char)ch);
            if (sb.Length > 500) break;
        }
        return sb.ToString();
    }

    static void PrepareAppBuffer(IntPtr buf, int size, int slots)
    {
        for (int i = 0; i < slots; i++)
        {
            IntPtr slot = IntPtr.Add(buf, i * size);
            Marshal.WriteInt32(slot, (int)(((uint)1 << 16) | (uint)size));
            for (int b = 4; b < size; b += 4) Marshal.WriteInt32(IntPtr.Add(slot, b), 0);
        }
    }

    static Dictionary<string, object> ReadAppSlot(IntPtr buf, int size, int slot)
    {
        IntPtr ptr = IntPtr.Add(buf, slot * size);
        byte[] raw = new byte[size];
        Marshal.Copy(ptr, raw, 0, size);
        Dictionary<string, object> e = new Dictionary<string, object>();
        e["predefined"] = (raw[4] | (raw[5] << 8) | (raw[6] << 16) | (raw[7] << 24)) != 0;
        e["appName"] = U16(raw, 8);
        e["friendly"] = U16(raw, 8 + 2048 * 2);
        e["launcher"] = U16(raw, 8 + 2048 * 4);
        return e;
    }

    static List<Dictionary<string, object>> AppsOf(ulong session, ulong profile, uint cap)
    {
        List<Dictionary<string, object>> found = new List<Dictionary<string, object>>();
        int size = Marshal.SizeOf(typeof(AppInfo));
        IntPtr buf = Marshal.AllocHGlobal(size * 8);
        try
        {
            uint start = 0;
            for (int round = 0; round < 16; round++)
            {
                PrepareAppBuffer(buf, size, 8);
                uint count = 8;
                int st = _enumApps(session, profile, start, ref count, buf);
                if (count == 0 || (st != OK && st != END_ENUMERATION)) break;
                for (int i = 0; i < count && i < 8; i++)
                {
                    Dictionary<string, object> e = ReadAppSlot(buf, size, i);
                    if (((string)e["appName"]).Length > 0) found.Add(e);
                }
                if (st == END_ENUMERATION || (uint)found.Count >= cap) break;
                start += count;
            }
        }
        finally { Marshal.FreeHGlobal(buf); }
        return found;
    }

    static string NormPath(string p)
    {
        return (p ?? string.Empty).ToLowerInvariant().Replace('\\', '/').TrimStart('/');
    }

    static Dictionary<string, object> MatchOne(Dictionary<string, object> appEntry, Hashtable index)
    {
        string app = (string)appEntry["appName"];
        string norm = NormPath(app);
        if (norm.Length == 0) return null;
        bool hasDir = norm.IndexOf('/') >= 0;
        string baseName = hasDir ? norm.Substring(norm.LastIndexOf('/') + 1) : norm;
        if (!index.ContainsKey(baseName)) return null;
        string exe = index[baseName] == null ? null : Convert.ToString(index[baseName]);
        if (hasDir)
        {
            // entry stores a (relative) path: the on-disk file must end the same way
            if (string.IsNullOrEmpty(exe)) return null;
            string full = NormPath(exe);
            if (!full.EndsWith("/" + norm) && full != norm) return null;
        }
        Dictionary<string, object> m = new Dictionary<string, object>();
        m["app"] = app;
        m["exe"] = exe;
        return m;
    }

    public static Dictionary<string, object> MatchInstalled(Hashtable index)
    {
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        try
        {
            ulong globalHandle;
            bool hasGlobal = _getGlobalProfile(session, out globalHandle) == OK;
            List<Dictionary<string, object>> hits = new List<Dictionary<string, object>>();
            int walked = 0;
            int predefinedWalked = 0;
            for (uint i = 0; i < 20000; i++)
            {
                ulong h;
                if (_enumProfiles(session, i, out h) != OK) break;
                if (hasGlobal && h == globalHandle) continue;
                walked++;
                ProfileInfo pi = NewProfile();
                if (_getProfileInfo(session, h, ref pi) != OK) continue;
                bool predefined = pi.IsPredefined != 0;
                if (predefined) predefinedWalked++;
                if (pi.NumApps == 0 && predefined) continue;
                List<Dictionary<string, object>> apps = pi.NumApps == 0
                    ? new List<Dictionary<string, object>>()
                    : AppsOf(session, h, 16);
                List<Dictionary<string, object>> matched = new List<Dictionary<string, object>>();
                foreach (Dictionary<string, object> a in apps)
                {
                    Dictionary<string, object> m = MatchOne(a, index);
                    if (m != null) matched.Add(m);
                }
                if (matched.Count == 0 && !predefined)
                {
                    foreach (Dictionary<string, object> a in apps)
                    {
                        Dictionary<string, object> m = new Dictionary<string, object>();
                        m["app"] = a["appName"];
                        m["exe"] = a["appName"];
                        matched.Add(m);
                    }
                }
                if (matched.Count == 0) continue;
                Dictionary<string, object> e = new Dictionary<string, object>();
                e["index"] = (long)i;
                e["name"] = pi.Name;
                e["isPredefined"] = predefined;
                e["numSettings"] = (int)pi.NumSettings;
                e["matched"] = matched;
                hits.Add(e);
            }
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["status"] = 0;
            res["walked"] = walked;
            res["predefinedWalked"] = predefinedWalked;
            res["indexSize"] = index.Count;
            res["hits"] = hits;
            return res;
        }
        finally { _destroySession(session); }
    }

    public static Dictionary<string, object> ProfileApps(string spec)
    {
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        try
        {
            ulong profile = ResolveProfile(session, spec);
            if (profile == 0) return Fail(-2);
            ProfileInfo pi = NewProfile();
            _getProfileInfo(session, profile, ref pi);
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["status"] = 0;
            res["profileName"] = pi.Name;
            res["isPredefined"] = pi.IsPredefined != 0;
            res["numApps"] = (int)pi.NumApps;
            res["apps"] = AppsOf(session, profile, 32);
            return res;
        }
        finally { _destroySession(session); }
    }

    static void WriteUni(IntPtr ptr, int offsetBytes, string value)
    {
        byte[] raw = new byte[2048 * 2];
        int n = value == null ? 0 : value.Length;
        if (n > 2047) n = 2047;
        for (int i = 0; i < n; i++)
        {
            ushort ch = value[i];
            raw[i * 2] = (byte)(ch & 0xff);
            raw[i * 2 + 1] = (byte)(ch >> 8);
        }
        Marshal.Copy(raw, 0, IntPtr.Add(ptr, offsetBytes), raw.Length);
    }

    public static Dictionary<string, object> AddApplicationProfile(string exePath)
    {
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        try
        {
            if (_createProfile == null || _createApp == null) return Fail(API_MISSING);
            string name = exePath.ToLowerInvariant();
            ulong profile;
            if (_findProfileByName != null && _findProfileByName(session, name, out profile) == OK)
            {
                Dictionary<string, object> dup = new Dictionary<string, object>();
                dup["ok"] = true;
                dup["status"] = 0;
                dup["existed"] = true;
                dup["profileName"] = name;
                return dup;
            }

            ProfileInfo pi = NewProfile();
            pi.Name = name;
            pi.GpuSupport = 0xffffffff;
            pi.IsPredefined = 0;
            pi.NumApps = 0;
            pi.NumSettings = 0;
            IntPtr pBuf = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ProfileInfo)));
            int r;
            try
            {
                Marshal.StructureToPtr(pi, pBuf, false);
                r = _createProfile(session, pBuf, out profile);
            }
            finally { Marshal.DestroyStructure(pBuf, typeof(ProfileInfo)); Marshal.FreeHGlobal(pBuf); }
            if (r != OK) return Fail(r);

            int size = Marshal.SizeOf(typeof(AppInfo));
            IntPtr aBuf = Marshal.AllocHGlobal(size);
            try
            {
                PrepareAppBuffer(aBuf, size, 1);
                WriteUni(aBuf, 8, exePath);
                WriteUni(aBuf, 8 + 2048 * 2, exePath);
                WriteUni(aBuf, 8 + 2048 * 4, "");
                r = _createApp(session, profile, aBuf);
            }
            finally { Marshal.FreeHGlobal(aBuf); }
            if (r != OK) { if (_deleteProfile != null) _deleteProfile(session, profile); return Fail(r); }

            r = _saveSettings(session);
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = r == OK;
            res["status"] = r;
            res["profileName"] = name;
            res["existed"] = false;
            return res;
        }
        finally { _destroySession(session); }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern uint ExtractIconExW(string file, int index, IntPtr[] big, IntPtr[] small, uint count);

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr h);

    static string IconPng(string path, int px)
    {
        IntPtr[] big = new IntPtr[1];
        IntPtr[] small = new IntPtr[1];
        uint n;
        try { n = ExtractIconExW(path, 0, big, small, 1); }
        catch { return null; }
        IntPtr h = big[0] != IntPtr.Zero ? big[0] : small[0];
        if (n == 0 || h == IntPtr.Zero)
        {
            if (big[0] != IntPtr.Zero) DestroyIcon(big[0]);
            if (small[0] != IntPtr.Zero) DestroyIcon(small[0]);
            return null;
        }
        try
        {
            using (Icon ic = Icon.FromHandle(h))
            using (Bitmap bmp = new Bitmap(px, px, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.DrawImage(ic.ToBitmap(), new Rectangle(0, 0, px, px));
                }
                using (MemoryStream ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
        }
        catch { return null; }
        finally
        {
            if (big[0] != IntPtr.Zero) DestroyIcon(big[0]);
            if (small[0] != IntPtr.Zero) DestroyIcon(small[0]);
        }
    }

    public static Dictionary<string, object> Icons(string raw)
    {
        List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
        foreach (string pth in raw.Split('|'))
        {
            string t = pth.Trim();
            if (t.Length == 0) continue;
            Dictionary<string, object> e = new Dictionary<string, object>();
            e["path"] = t;
            string b = null;
            try { if (System.IO.File.Exists(t)) b = IconPng(t, 32); }
            catch { }
            e["png"] = b;
            items.Add(e);
        }
        Dictionary<string, object> res = new Dictionary<string, object>();
        res["ok"] = true;
        res["status"] = 0;
        res["icons"] = items;
        return res;
    }

    const int IS_PREDEFINED = -997;
    const int IS_GLOBAL = -996;

    public static Dictionary<string, object> DelProfile(string profileSpec, string expectedName)
    {
        if (profileSpec == "global") return Fail(IS_GLOBAL);
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        try
        {
            ulong profile = ResolveProfile(session, profileSpec);
            if (profile == 0) return Fail(-2);
            if (_deleteProfile == null) return Fail(API_MISSING);
            int nm = CheckProfileName(session, profile, expectedName);
            if (nm != OK) return Fail(nm);
            ProfileInfo pi = NewProfile();
            if (_getProfileInfo(session, profile, ref pi) != OK) return Fail(-3);
            if (pi.IsPredefined != 0) return Fail(IS_PREDEFINED);
            int r = _deleteProfile(session, profile);
            if (r != OK) return Fail(r);
            r = _saveSettings(session);
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = r == OK;
            res["status"] = r;
            res["profileName"] = pi.Name;
            return res;
        }
        finally { _destroySession(session); }
    }

    public static Dictionary<string, object> Get(string profileSpec, string expectedName, uint[] ids)
    {
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        try
        {
            ulong profile = ResolveProfile(session, profileSpec);
            int nm = CheckProfileName(session, profile, expectedName);
            if (nm != OK) return Fail(nm);
            ProfileInfo pi = NewProfile();
            string profileName = null;
            if (_getProfileInfo(session, profile, ref pi) == OK) profileName = pi.Name;

            List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
            foreach (uint id in ids)
            {
                Dictionary<string, object> e = new Dictionary<string, object>();
                e["id"] = "0x" + id.ToString("X8");
                SettingInfo s = NewSetting();
                int r = _getSetting(session, profile, id, ref s);
                if (r == OK)
                {
                    e["present"] = true;
                    e["key"] = s.Name;
                    e["type"] = s.Type;
                    e["predefined"] = s.IsCurrentPredefined != 0;
                    if (s.Type == 0) e["value"] = BitConverter.ToUInt32(s.CurrentValue, 0);
                    else e["text"] = Encoding.Unicode.GetString(s.CurrentValue).TrimEnd('\0');
                }
                else if (r == SETTING_NOT_FOUND)
                {
                    e["present"] = false;
                    UniStr un;
                    if (_nameFromId(id, out un) == OK) e["key"] = un.Value;
                }
                else { e["error"] = r; e["present"] = false; }
                items.Add(e);
            }
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["status"] = 0;
            res["profileSpec"] = profileSpec;
            res["profileName"] = profileName;
            res["items"] = items;
            return res;
        }
        finally { _destroySession(session); }
    }

    public static Dictionary<string, object> Set(string profileSpec, string expectedName, uint id, uint value)
    {
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        try
        {
            ulong profile = ResolveProfile(session, profileSpec);
            int nm = CheckProfileName(session, profile, expectedName);
            if (nm != OK) return Fail(nm);
            SettingInfo s = NewSetting();
            int r = _getSetting(session, profile, id, ref s);
            if (r == SETTING_NOT_FOUND)
            {
                UniStr un;
                int nr = _nameFromId(id, out un);
                if (nr != OK) return Fail(nr);
                s = NewSetting();
                s.Id = id;
                s.Name = un.Value;
                s.Type = 0;
            }
            else if (r != OK) return Fail(r);

            s.CurrentValue = new byte[BUF];
            BitConverter.GetBytes(value).CopyTo(s.CurrentValue, 0);
            s.IsCurrentPredefined = 0;
            r = _setSetting(session, profile, ref s);
            if (r != OK) return Fail(r);
            r = _saveSettings(session);
            if (r != OK) return Fail(r);
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["status"] = 0;
            res["key"] = s.Name;
            res["value"] = value;
            return res;
        }
        finally { _destroySession(session); }
    }

    public static Dictionary<string, object> Reset(string profileSpec, string expectedName, uint id)
    {
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        try
        {
            ulong profile = ResolveProfile(session, profileSpec);
            int nm = CheckProfileName(session, profile, expectedName);
            if (nm != OK) return Fail(nm);
            int r = _restoreSetting(session, profile, id);
            if (r != OK) return Fail(r);
            r = _saveSettings(session);
            if (r != OK) return Fail(r);
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["status"] = 0;
            return res;
        }
        finally { _destroySession(session); }
    }

    // Batch write in one session with a single save. pairs = "0xID=0xVAL|0xID2=-" ("-" restores the default)
    public static Dictionary<string, object> SetMany(string profileSpec, string expectedName, string pairs)
    {
        ulong session;
        int st = OpenSession(out session);
        if (st != OK) return Fail(st);
        try
        {
            ulong profile = ResolveProfile(session, profileSpec);
            int nm = CheckProfileName(session, profile, expectedName);
            if (nm != OK) return Fail(nm);
            List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
            bool dirty = false;
            string[] parts = (pairs == null ? "" : pairs).Split('|');
            foreach (string raw in parts)
            {
                string part = raw.Trim();
                if (part.Length == 0) continue;
                int eq = part.IndexOf('=');
                if (eq <= 0) continue;
                uint id;
                try { id = Convert.ToUInt32(part.Substring(0, eq).Trim().Replace("0x", "").Replace("0X", ""), 16); }
                catch (Exception) { continue; }
                string vs = part.Substring(eq + 1).Trim();
                Dictionary<string, object> e = new Dictionary<string, object>();
                e["id"] = "0x" + id.ToString("X8");
                int r;
                if (vs == "-")
                {
                    e["reset"] = true;
                    r = _restoreSetting(session, profile, id);
                }
                else
                {
                    uint value;
                    try { value = Convert.ToUInt32(vs.Replace("0x", "").Replace("0X", ""), 16); }
                    catch (Exception) { e["ok"] = false; e["status"] = -5; items.Add(e); continue; }
                    SettingInfo s = NewSetting();
                    r = _getSetting(session, profile, id, ref s);
                    if (r == SETTING_NOT_FOUND)
                    {
                        UniStr un;
                        int nr = _nameFromId(id, out un);
                        if (nr != OK) { e["ok"] = false; e["status"] = nr; items.Add(e); continue; }
                        s = NewSetting();
                        s.Id = id;
                        s.Name = un.Value;
                        s.Type = 0;
                    }
                    else if (r != OK) { e["ok"] = false; e["status"] = r; items.Add(e); continue; }
                    s.CurrentValue = new byte[BUF];
                    BitConverter.GetBytes(value).CopyTo(s.CurrentValue, 0);
                    s.IsCurrentPredefined = 0;
                    r = _setSetting(session, profile, ref s);
                    e["value"] = value;
                }
                e["ok"] = r == OK;
                e["status"] = r;
                if (r == OK) dirty = true;
                items.Add(e);
            }
            int sv = OK;
            if (dirty) sv = _saveSettings(session);
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = sv == OK;
            res["status"] = sv;
            res["items"] = items;
            return res;
        }
        finally { _destroySession(session); }
    }

    public static Dictionary<string, object> Check(uint id)
    {
        int st = EnsureApis();
        if (st != OK) return Fail(st);
        UniStr un;
        int r = _nameFromId(id, out un);
        Dictionary<string, object> res = new Dictionary<string, object>();
        res["ok"] = r == OK;
        res["status"] = r;
        res["id"] = "0x" + id.ToString("X8");
        if (r == OK) res["name"] = un.Value;
        return res;
    }

    const uint VALUES_TAG = 0x000751A0;   // 本驱动唯一接受的 NVDRS_SETTING_VALUES 版本标记
    const int VALUE_STRIDE = 4100;        // 每个取值条目 4100 字节，取值位于条目偏移 4

    public static Dictionary<string, object> Settings()
    {
        int st = EnsureApis();
        if (st != OK) return Fail(st);
        if (_enumSettingValues == null) return Fail(API_MISSING);
        uint count = 0;
        _enumSettingIds(IntPtr.Zero, ref count);
        if (count == 0 || count > 4000) return Fail(-1);
        IntPtr idBuf = Marshal.AllocHGlobal((int)count * 4);
        uint c2 = count;
        int er = _enumSettingIds(idBuf, ref c2);
        if (er != OK) { Marshal.FreeHGlobal(idBuf); return Fail(er); }
        ulong session;
        st = OpenSession(out session);
        if (st != OK) { Marshal.FreeHGlobal(idBuf); return Fail(st); }
        int vb = 8 + VALUE_STRIDE * 70;
        IntPtr vbuf = Marshal.AllocHGlobal(vb);
        List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
        try
        {
            byte[] zero = new byte[vb];
            for (uint i = 0; i < c2; i++)
            {
                uint id = (uint)Marshal.ReadInt32(idBuf, (int)i * 4);
                Dictionary<string, object> e = new Dictionary<string, object>();
                e["id"] = "0x" + id.ToString("X8");
                UniStr un = new UniStr();
                if (_nameFromId(id, out un) == OK) e["name"] = un.Value;
                Marshal.Copy(zero, 0, vbuf, vb);
                Marshal.WriteInt32(vbuf, 0, (int)VALUES_TAG);
                uint vc = 64;
                int r = _enumSettingValues(id, ref vc, vbuf);
                if (r != OK) { e["error"] = r; items.Add(e); continue; }
                if (vc > 64) vc = 64;
                e["def"] = "0x" + ((uint)Marshal.ReadInt32(vbuf, 12)).ToString("X8");
                List<string> opts = new List<string>();
                for (uint k = 1; k <= vc; k++)
                {
                    uint v = (uint)Marshal.ReadInt32(vbuf, 8 + (int)k * VALUE_STRIDE + 4);
                    string hx = "0x" + v.ToString("X8");
                    if (!opts.Contains(hx)) opts.Add(hx);
                }
                e["opts"] = opts;
                items.Add(e);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(vbuf);
            Marshal.FreeHGlobal(idBuf);
            _destroySession(session);
        }
        Dictionary<string, object> res = new Dictionary<string, object>();
        res["ok"] = true;
        res["status"] = 0;
        res["count"] = c2;
        res["items"] = items;
        return res;
    }

    public static Dictionary<string, object> EnumIds(string filter)
    {
        int st = EnsureApis();
        if (st != OK) return Fail(st);
        uint count = 0;
        _enumSettingIds(IntPtr.Zero, ref count);
        if (count == 0) return Fail(-1);
        IntPtr buf = Marshal.AllocHGlobal((int)count * 4);
        try
        {
            uint c2 = count;
            int r = _enumSettingIds(buf, ref c2);
            if (r != OK) return Fail(r);
            List<string> names = new List<string>();
            int resolved = 0;
            int firstErr = 0;
            for (uint i = 0; i < c2; i++)
            {
                uint id = (uint)Marshal.ReadInt32(buf, (int)i * 4);
                UniStr un;
                int nr = _nameFromId(id, out un);
                if (nr == OK)
                {
                    resolved++;
                    if (filter == null || filter.Length == 0 || un.Value.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0)
                        names.Add("0x" + id.ToString("X8") + "  " + un.Value);
                }
                else if (firstErr == 0) firstErr = nr;
            }
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["total"] = c2;
            res["resolved"] = resolved;
            res["firstErr"] = firstErr;
            res["names"] = names;
            return res;
        }
        finally { Marshal.FreeHGlobal(buf); }
    }

    public static Dictionary<string, object> Resolve(string name)
    {
        int st = EnsureApis();
        if (st != OK) return Fail(st);
        uint id;
        int r = _idFromName(name, out id);
        Dictionary<string, object> res = new Dictionary<string, object>();
        res["ok"] = r == OK;
        res["status"] = r;
        res["name"] = name;
        if (r == OK) res["id"] = "0x" + id.ToString("X8");
        return res;
    }
}
'@

try {
    Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing
} catch {
    ConvertTo-Json -Compress -InputObject @{ ok = $false; available = $false; status = 'compile-error'; error = $_.Exception.Message }
    exit 0
}

# --- read-only local program probe: exe file name -> full path index ---
$script:NoiseNames = @('unins000.exe', 'unins001.exe', 'vcredist_x64.exe', 'vc_redist.x64.exe', 'vc_redist.x86.exe',
    'dxsetup.exe', 'setup.exe', 'install.exe', 'installer.exe', 'uninstall.exe', 'setupdata.exe',
    'crashreporter.exe', 'steamapprestarter.exe', 'redistsetup.exe', 'patcher.exe')
$script:GenericBases = @('launcher', 'launch', 'update', 'updater', 'autoupdate', 'setup', 'installer',
    'start', 'main', 'app', 'game', 'client', 'server', 'run', 'loader', 'patch', 'repair', 'config',
    'helper', 'service', 'agent', 'crashreporter', 'webview', 'browser', 'tool', 'tools', 'test', 'sample',
    'application', 'program', 'engine', 'core', 'bin', 'data', 'win')
$script:SkipLeaves = @('$recycle.bin', 'node_modules', 'temp', 'tmp', 'logs', 'redist', 'redistributables',
    '_installer', 'installers', 'directx', 'vc_redist', 'commonredist', 'crashes', 'screenshots', 'dotnet',
    'windows defender', 'microsoft update health services', 'reference assemblies')

function Get-Norm([string]$text) {
    if (-not $text) { return '' }
    return ($text.ToLowerInvariant() -replace '[^a-z0-9]', '')
}

$script:HelperSubs = @('crashpad', 'crashreport', 'crash_handler', 'webhelper', 'webengine', 'container',
    'redist', 'vcruntime', 'unins', 'elevation', 'updater', 'installer', 'agent', 'daemon', 'watchdog')

function Test-ProgramEntry([string]$file, [string]$rootLabel, [string]$source, [int]$level) {
    $baseRaw = [IO.Path]::GetFileNameWithoutExtension($file).ToLowerInvariant()
    $letters = ($baseRaw -replace '[^a-z]', '')
    if ($script:GenericBases -contains $letters) { return $false }
    if ($script:GenericBases -contains $baseRaw) { return $false }
    foreach ($h in $script:HelperSubs) { if ($baseRaw.Contains($h)) { return $false } }
    if ($source -eq 'proc') { return $true }
    if ($source -in @('steam', 'epic', 'gog')) { return ($level -le 2) }
    $nb = Get-Norm $baseRaw
    if ($nb.Length -lt 4) { return $false }
    $labels = New-Object System.Collections.ArrayList
    if ($rootLabel) { [void]$labels.Add($rootLabel) }
    $dir = [IO.Path]::GetDirectoryName($file)
    for ($i = 0; $i -lt 2 -and $dir; $i++) {
        $leaf = [IO.Path]::GetFileName($dir)
        if (-not $leaf) { break }
        [void]$labels.Add($leaf)
        $dir = [IO.Path]::GetDirectoryName($dir)
    }
    foreach ($l in $labels) {
        $nl = Get-Norm $l
        if ($nl.Length -lt 4) { continue }
        if ($nl -eq $nb) { return $true }
        if ($nb.StartsWith($nl) -or $nl.StartsWith($nb)) { return $true }
    }
    return $false
}

function Add-IndexEntry([string]$file, [string]$source, [string]$rootLabel, [int]$level, $index) {
    $name = [IO.Path]::GetFileName($file).ToLowerInvariant()
    if ($script:NoiseNames -contains $name) { return }
    if (-not (Test-ProgramEntry $file $rootLabel $source $level)) { return }
    if (-not $index.ContainsKey($name)) { $index[$name] = $file }
}

function Scan-ExeDir([string]$dir, [int]$depth, [string]$source, [string]$rootLabel, $index, $state) {
    if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { return }
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($dir, 0))
    while ($queue.Count -gt 0) {
        if ($index.Count -ge 20000 -or $state.dirs -ge 80000) { return }
        $item = $queue.Dequeue()
        $cur = [string]$item[0]
        $lvl = [int]$item[1]
        $state.dirs = $state.dirs + 1
        try {
            foreach ($f in [System.IO.Directory]::GetFiles($cur, '*.exe')) {
                if ($f.StartsWith($state.winRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
                Add-IndexEntry $f $source $rootLabel $lvl $index
            }
        } catch { }
        if ($lvl -lt $depth) {
            try {
                foreach ($sd in [System.IO.Directory]::GetDirectories($cur)) {
                    $leaf = [IO.Path]::GetFileName($sd).ToLowerInvariant()
                    if ($leaf.StartsWith('.')) { continue }
                    if ($script:SkipLeaves -contains $leaf) { continue }
                    $queue.Enqueue(@($sd, $lvl + 1))
                }
            } catch { }
        }
    }
}

function Get-SteamGameDirs {
    $roots = @()
    try {
        $sp = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath
        if ($sp) {
            $roots += $sp
            $vdf = Join-Path (Join-Path $sp 'config') 'libraryfolders.vdf'
            if (Test-Path -LiteralPath $vdf) {
                foreach ($line in [IO.File]::ReadAllLines($vdf)) {
                    if ($line -match '"path"\s+"(.+)"') { $roots += ($matches[1] -replace '\\\\', '\') }
                }
            }
        }
    } catch { }
    $dirs = @()
    foreach ($root in ($roots | Select-Object -Unique)) {
        $common = Join-Path (Join-Path $root 'steamapps') 'common'
        if (Test-Path -LiteralPath $common) {
            try { $dirs += [IO.Directory]::GetDirectories($common) } catch { }
        }
    }
    return @($dirs | Where-Object { $_ } | Select-Object -Unique)
}

function Get-EpicGameDirs {
    $dirs = @()
    foreach ($f in @("$env:ALLUSERSPROFILE\Epic\UnrealEngineLauncher\LauncherInstalled.dat",
            "$env:ALLUSERSPROFILE\Epic\EpicInstaller-DATA\LauncherInstalled.dat")) {
        if (Test-Path -LiteralPath $f) {
            try {
                $j = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json
                foreach ($i in $j.InstallationList) { if ($i.InstallLocation) { $dirs += $i.InstallLocation } }
            } catch { }
        }
    }
    $mfDir = "$env:ALLUSERSPROFILE\Epic\EpicInstaller-DATA\Manifests"
    if (Test-Path -LiteralPath $mfDir) {
        try {
            foreach ($m in (Get-ChildItem -LiteralPath $mfDir -Filter *.json -File | Select-Object -First 500)) {
                try {
                    $t = Get-Content -LiteralPath $m.FullName -Raw -Encoding UTF8
                    if ($t -match '"InstallLocation"\s*:\s*"([^"]+)"') { $dirs += ($matches[1] -replace '\\\\', '\') }
                } catch { }
            }
        } catch { }
    }
    return @($dirs | Where-Object { $_ } | Select-Object -Unique)
}

function Get-GogGameDirs {
    $dirs = @()
    foreach ($hk in @('HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games', 'HKLM:\SOFTWARE\GOG.com\Games')) {
        if (Test-Path $hk) {
            try {
                foreach ($k in (Get-ChildItem $hk)) {
                    $v = (Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue).PATH
                    if ($v) { $dirs += $v }
                }
            } catch { }
        }
    }
    return @($dirs | Where-Object { $_ } | Select-Object -Unique)
}

function Get-InstalledProgramInfo {
    $dirs = @()
    $icons = @()
    foreach ($hk in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
            'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
        if (-not (Test-Path $hk)) { continue }
        try {
            foreach ($k in (Get-ChildItem $hk -ErrorAction SilentlyContinue)) {
                $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
                if (-not $p) { continue }
                if ($p.InstallLocation) {
                    foreach ($il in (@($p.InstallLocation) | Where-Object { $_ })) { $dirs += $il.Trim('"') }
                }
                if ($p.DisplayIcon) {
                    $di = (@($p.DisplayIcon) | Select-Object -First 1) -replace ',\d+\s*$', ''
                    if ($di -and $di.EndsWith('.exe') -and $di -notmatch '^%' -and (Test-Path -LiteralPath $di)) { $icons += $di }
                }
            }
        } catch { }
    }
    return @{ dirs = $dirs; icons = $icons }
}

function Get-LocalExeIndex {
    $index = @{}
    $state = @{ dirs = 0; winRoot = $env:SystemRoot }

    foreach ($p in Get-Process) {
        try {
            if ($p.MainWindowTitle -and $p.Path -and
                -not $p.Path.StartsWith($state.winRoot, [StringComparison]::OrdinalIgnoreCase)) {
                Add-IndexEntry $p.Path 'proc' '' 0 $index
            }
        } catch { }
    }

    foreach ($g in Get-SteamGameDirs) { Scan-ExeDir $g 2 'steam' ([IO.Path]::GetFileName($g)) $index $state }
    foreach ($g in Get-EpicGameDirs) { Scan-ExeDir $g 2 'epic' ([IO.Path]::GetFileName($g)) $index $state }
    foreach ($g in Get-GogGameDirs) { Scan-ExeDir $g 2 'gog' ([IO.Path]::GetFileName($g)) $index $state }

    $ip = Get-InstalledProgramInfo
    foreach ($e in ($ip.icons | Select-Object -Unique)) {
        if (-not $e.StartsWith($state.winRoot, [StringComparison]::OrdinalIgnoreCase)) { Add-IndexEntry $e 'app' '' 0 $index }
    }
    $valid = @($ip.dirs | Where-Object { $_ -and -not $_.StartsWith($state.winRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)
    foreach ($d in $valid) { Scan-ExeDir $d 1 'app' ([IO.Path]::GetFileName($d.TrimEnd('\'))) $index $state }

    $pfRoots = @()
    foreach ($r in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($r -and (Test-Path -LiteralPath $r)) {
            try { $pfRoots += [IO.Directory]::GetDirectories($r) } catch { }
        }
    }
    foreach ($d in ($pfRoots | Where-Object { $script:SkipLeaves -notcontains [IO.Path]::GetFileName($_).ToLowerInvariant() })) {
        Scan-ExeDir $d 1 'pf' ([IO.Path]::GetFileName($d)) $index $state
    }

    return @{ index = $index; dirsVisited = $state.dirs }
}

$settingIds = @('0x1057EB71', '0x1083EFFE', '0x00A879CF', '0x007BA09E', '0x00CE2691')

try {
    switch ($Action) {
        'probe' { $out = [NvDrs]::Probe() }
        'list'  { $out = [NvDrs]::List() }
        'get' {
            if ($Ids) {
                $parsed = @($Ids.Split(',') | ForEach-Object { [Convert]::ToUInt32($_.Trim().Replace('0x', '').Replace('0X', ''), 16) })
            } else {
                $parsed = @($settingIds | ForEach-Object { [Convert]::ToUInt32($_.Substring(2), 16) })
            }
            $out = [NvDrs]::Get($Profile, $ProfileName, $parsed)
        }
        'set' {
            $sid = [Convert]::ToUInt32($Id.Replace('0x', '').Replace('0X', ''), 16)
            $val = [Convert]::ToUInt32($Value.Replace('0x', '').Replace('0X', ''), 16)
            $out = [NvDrs]::Set($Profile, $ProfileName, $sid, $val)
        }
        'reset' {
            $sid = [Convert]::ToUInt32($Id.Replace('0x', '').Replace('0X', ''), 16)
            $out = [NvDrs]::Reset($Profile, $ProfileName, $sid)
        }
        'setMany' { $out = [NvDrs]::SetMany($Profile, $ProfileName, $Pairs) }
        'check' {
            $sid = [Convert]::ToUInt32($Id.Replace('0x', '').Replace('0X', ''), 16)
            $out = [NvDrs]::Check($sid)
        }
        'apps' { $out = [NvDrs]::ProfileApps($Profile) }
        'delProfile' { $out = [NvDrs]::DelProfile($Profile, $ProfileName) }
        'icons' { $out = [NvDrs]::Icons($Paths) }
        'addApp' {
            if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) { $out = @{ ok = $false; status = 'missing-file'; error = $ExePath } }
            elseif ($ExePath -notmatch '\.exe$') { $out = @{ ok = $false; status = 'not-exe'; error = $ExePath } }
            else { $out = [NvDrs]::AddApplicationProfile($ExePath) }
        }
        'installed' {
            $probe = Get-LocalExeIndex
            $out = [NvDrs]::MatchInstalled($probe.index)
            $out["dirsVisited"] = $probe.dirsVisited
        }
        'resolve' { $out = [NvDrs]::Resolve($Name) }
        'enumids' { $out = [NvDrs]::EnumIds($Name) }
        'settings' { $out = [NvDrs]::Settings() }
        'meta' {
            $arr = @($settingIds | ForEach-Object { [NvDrs]::Check([Convert]::ToUInt32($_.Substring(2), 16)) })
            $out = @{ ok = $true; status = 0; items = $arr }
        }
    }
} catch {
    $out = @{ ok = $false; status = 'exception'; error = $_.Exception.Message }
}

ConvertTo-Json -Compress -Depth 6 -InputObject $out
