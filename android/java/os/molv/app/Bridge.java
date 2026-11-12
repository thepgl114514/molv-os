package os.molv.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Debug;
import android.os.Environment;
import android.os.SystemClock;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

public class Bridge {
    private final MainActivity activity;
    private final WebView webView;
    private final SharedPreferences prefs;
    private final File rootfs;
    private final File dataDir;
    private Process terminalProcess;
    private OutputStream terminalInput;
    private int terminalSeq = 0;
    private SimpleServer server;
    private long lastCpuTotal = -1;
    private long lastCpuIdle = -1;
    private long lastRootCheck = 0;
    private boolean lastRoot = false;

    private static final String ALPINE_URL = "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/aarch64/alpine-minirootfs-3.20.3-aarch64.tar.gz";

    Bridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.prefs = activity.getSharedPreferences("molv", Context.MODE_PRIVATE);
        this.dataDir = activity.getFilesDir();
        this.rootfs = new File(dataDir, "linux/rootfs");
        if (!prefs.contains("config")) {
            prefs.edit().putString("config", defaultConfig().toString()).apply();
        }
    }

    @JavascriptInterface
    public String arch() {
        return Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : Build.CPU_ABI;
    }

    @JavascriptInterface
    public String invoke(String action, String payload) {
        try {
            JSONObject p = payload == null || payload.isEmpty() ? new JSONObject() : new JSONObject(payload);
            Object data = dispatch(action, p);
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("data", data == null ? JSONObject.NULL : data);
            return out.toString();
        } catch (Throwable err) {
            try {
                JSONObject out = new JSONObject();
                out.put("ok", false);
                out.put("error", err.getMessage() == null ? err.toString() : err.getMessage());
                return out.toString();
            } catch (Throwable ignored) {
                return "{\"ok\":false,\"error\":\"native bridge failure\"}";
            }
        }
    }

    private Object dispatch(String action, JSONObject p) throws Exception {
        switch (action) {
            case "app.info": return appInfo();
            case "app.bootstrap": return bootstrap();
            case "app.completeSetup": {
                JSONObject cfg = config();
                JSONObject setup = cfg.optJSONObject("setup");
                if (setup == null) setup = new JSONObject();
                setup.put("completed", true);
                setup.put("completedAt", now());
                cfg.put("setup", setup);
                saveConfig(cfg);
                return setup;
            }
            case "system.stats": return systemStats();
            case "config.get": return getPath(config(), p.optString("key"));
            case "config.patch": {
                JSONObject cfg = config();
                merge(cfg, p.optJSONObject("patch"));
                saveConfig(cfg);
                return cfg;
            }
            case "config.set": {
                JSONObject cfg = config();
                setPath(cfg, p.optString("key"), p.opt("value"));
                saveConfig(cfg);
                return p.opt("value");
            }
            case "config.export": {
                JSONObject out = new JSONObject();
                out.put("product", "MolvOS");
                out.put("exportedAt", now());
                out.put("config", config());
                return out;
            }
            case "permissions.check": return permissions();
            case "permissions.request": {
                activity.runOnUiThread(activity::requestAppPermissions);
                return json("message", "已打开系统权限设置");
            }
            case "permissions.open": {
                activity.runOnUiThread(activity::requestAppPermissions);
                return json("ok", true);
            }
            case "integrity.verify": return integrity();
            case "virt.check": return virtualization();
            case "linux.status": return linuxStatus();
            case "linux.install": return installLinux(p);
            case "linux.packages": return installPackages(p);
            case "linux.terminal.open": return openTerminal();
            case "linux.terminal.write": {
                if (terminalInput == null) throw new Exception("终端未连接");
                terminalInput.write(p.optString("data", "").getBytes(StandardCharsets.UTF_8));
                terminalInput.flush();
                return json("ok", true);
            }
            case "linux.terminal.close": {
                closeTerminal();
                return json("ok", true);
            }
            case "linux.exec": return execRoot(p.optString("command"));
            case "compilers.list": return compilers();
            case "compilers.setEnabled": {
                JSONObject cfg = config();
                JSONObject comp = cfg.optJSONObject("compilers");
                if (comp == null) comp = new JSONObject();
                JSONObject enabled = comp.optJSONObject("enabled");
                if (enabled == null) enabled = new JSONObject();
                enabled.put(p.optString("id"), p.optBoolean("enabled"));
                comp.put("enabled", enabled);
                cfg.put("compilers", comp);
                saveConfig(cfg);
                return json("ok", true);
            }
            case "compilers.setScope": {
                JSONObject cfg = config();
                JSONObject comp = cfg.optJSONObject("compilers");
                if (comp == null) comp = new JSONObject();
                comp.put("scope", p.optString("scope", "device"));
                cfg.put("compilers", comp);
                saveConfig(cfg);
                return json("ok", true);
            }
            case "compilers.install": return installCompiler(p.optString("id"));
            case "compilers.verify": return json("ok", false, "message", "Android 端请先安装 Linux 环境并启用对应工具链");
            case "android.status": return androidStatus();
            case "android.root": return rootStatus();
            case "android.permissions": {
                activity.runOnUiThread(activity::requestAppPermissions);
                return json("message", "已请求存储/通知权限");
            }
            case "android.winlator": {
                boolean installed = isPackageInstalled("com.winlator");
                return json("installed", installed, "rooted", isRooted(), "message", installed ? "已安装 Winlator" : "未安装 Winlator");
            }
            case "tasks.list": return tasks();
            case "tasks.kill": return killTask(p.optInt("pid"), p.optBoolean("confirmed"));
            case "scan.roots": return scanRoots();
            case "scan.policy": return scanPolicy();
            case "scan.policy.set": {
                JSONObject cfg = config();
                JSONObject scan = cfg.optJSONObject("scan");
                if (scan == null) scan = new JSONObject();
                scan.put("policy", p.optJSONObject("policy"));
                cfg.put("scan", scan);
                saveConfig(cfg);
                return p.optJSONObject("policy");
            }
            case "scan.start": return scanStart(p);
            case "scan.cancel": return json("ok", true);
            case "scan.status": return json("running", false);
            case "scan.quarantine": return quarantine(p);
            case "scan.report": return exportScanReport();
            case "server.status": return serverStatus();
            case "server.start": return startServer(p);
            case "server.stop": return stopServer();
            case "server.map": throw new Exception("Android 端暂不支持自动 UPnP 映射，请在路由器中手动转发");
            case "github.status": return githubStatus();
            case "github.set": return setGithub(p);
            case "github.test": return testGithub();
            case "github.rewrite": return json("url", p.optString("url"), "active", githubStatus().optJSONObject("active"));
            case "usb.disks": return new JSONArray();
            case "usb.status": return json("running", false);
            case "logs.tail": return json("lines", "Android 端日志请使用 logcat：adb logcat -s MolvWeb");
            case "shell.openExternal": {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(p.optString("url")));
                activity.startActivity(intent);
                return json("url", p.optString("url"));
            }
            case "app.openDataDir": return json("path", dataDir.getAbsolutePath());
            case "app.openDocs": throw new Exception("请查看项目仓库中的 docs/MANUAL.md");
            case "window.minimize": return json("ok", true);
            case "window.maximize": return json("ok", true);
            case "window.close": {
                activity.runOnUiThread(activity::finish);
                return json("ok", true);
            }
            default:
                throw new Exception("Android 端暂不支持该操作：" + action);
        }
    }

    private JSONObject appInfo() throws Exception {
        JSONObject out = new JSONObject();
        out.put("version", versionName());
        out.put("name", "墨绿OS");
        out.put("englishName", "MolvOS");
        out.put("platform", "android");
        out.put("arch", arch());
        out.put("packaged", true);
        out.put("admin", isRooted());
        out.put("dataDir", dataDir.getAbsolutePath());
        out.put("config", config());
        out.put("variants", variants());
        out.put("summary", json("platform", "android", "cpuModel", Build.HARDWARE, "cpus", Runtime.getRuntime().availableProcessors(), "totalMemory", totalMem()));
        out.put("node", null);
        out.put("electron", null);
        out.put("license", "MIT");
        return out;
    }

    private JSONObject bootstrap() throws Exception {
        JSONObject out = new JSONObject();
        JSONObject app = new JSONObject();
        app.put("version", versionName());
        app.put("platform", "android");
        app.put("arch", arch());
        app.put("packaged", true);
        app.put("admin", isRooted());
        app.put("dataDir", dataDir.getAbsolutePath());
        out.put("config", config());
        out.put("app", app);
        out.put("integrity", integrity());
        out.put("permissions", permissions());
        out.put("virtualization", virtualization());
        out.put("linux", linuxStatus());
        out.put("android", androidStatus());
        out.put("variants", variants());
        return out;
    }

    private JSONObject versions() throws Exception {
        return new JSONObject();
    }

    private JSONObject variants() throws Exception {
        JSONObject out = new JSONObject();
        JSONObject full = new JSONObject();
        full.put("id", "full");
        full.put("name", "全量安装包");
        full.put("size", "组件最全");
        full.put("desc", "适合开发者，预置完整 Linux 工具链与常用应用。");
        full.put("components", arr("Linux 完整工具链", "八种语言", "Ollama 推荐", "Android 调试工具"));
        JSONObject slim = new JSONObject();
        slim.put("id", "slim");
        slim.put("name", "精简安装包");
        slim.put("size", "约 120 MB");
        slim.put("desc", "核心工作台，按需下载 Linux 与工具链。");
        slim.put("components", arr("墨绿OS 工作台", "Linux 安装器", "任务管理器", "文件服务器"));
        JSONObject minimal = new JSONObject();
        minimal.put("id", "minimal");
        minimal.put("name", "极简安装包");
        minimal.put("size", "约 90 MB");
        minimal.put("desc", "启动器与基础检查，适合低配置设备。");
        minimal.put("components", arr("启动器", "安装向导", "CLI", "按需扩展"));
        out.put("full", full);
        out.put("slim", slim);
        out.put("minimal", minimal);
        return out;
    }

    private JSONObject permissions() {
        boolean storage;
        if (Build.VERSION.SDK_INT >= 30) {
            storage = Environment.isExternalStorageManager();
        } else {
            storage = activity.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == 0;
        }
        boolean notif = true;
        if (Build.VERSION.SDK_INT >= 33) {
            notif = activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == 0;
        }
        boolean root = isRooted();
        try {
            JSONObject out = new JSONObject();
            out.put("platform", "android");
            out.put("admin", root);
            JSONArray items = new JSONArray();
            items.put(item("storage", "存储访问", storage ? "ok" : "missing", storage ? "已获得全部文件访问权限" : "扫描与文件服务器需要存储权限", "grant"));
            items.put(item("notifications", "通知权限", notif ? "ok" : "warn", notif ? "已允许通知" : "可选，用于长时间任务提醒", "grant"));
            items.put(item("root", "root 权限", root ? "ok" : "warn", root ? "已获得 root，可用 chroot 安装 Linux" : "未获得 root；可使用 Termux 兼容路径", "grant"));
            out.put("items", items);
            return out;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private JSONObject item(String id, String label, String level, String detail, String action) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("label", label);
            o.put("level", level);
            o.put("detail", detail);
            o.put("action", action);
            return o;
        } catch (Exception e) { return new JSONObject(); }
    }

    private JSONObject virtualization() {
        boolean root = isRooted();
        try {
            JSONObject o = new JSONObject();
            o.put("platform", "android");
            o.put("supported", true);
            o.put("enabled", root);
            o.put("hypervisor", false);
            o.put("method", root ? "chroot" : "termux");
            o.put("detail", root ? "root 可用：使用 chroot 运行 Alpine" : "未 root：建议使用 Termux + proot-distro");
            return o;
        } catch (Exception e) { return new JSONObject(); }
    }

    private JSONObject integrity() throws Exception {
        JSONObject out = new JSONObject();
        try {
            JSONObject manifest = new JSONObject(readAsset("integrity.json"));
            JSONObject files = manifest.optJSONObject("files");
            int total = files == null ? 0 : files.length();
            int checked = 0;
            JSONArray missing = new JSONArray();
            JSONArray mismatch = new JSONArray();
            if (files != null) {
                java.util.Iterator<String> it = files.keys();
                while (it.hasNext()) {
                    String rel = it.next();
                    try {
                        String actual = sha256(readAsset(rel));
                        checked++;
                        if (!actual.equalsIgnoreCase(files.optString(rel))) mismatch.put(rel);
                    } catch (Exception e) {
                        missing.put(rel);
                    }
                }
            }
            boolean ok = missing.length() == 0 && mismatch.length() == 0;
            out.put("ok", ok);
            out.put("state", ok ? "valid" : "damaged");
            out.put("checked", checked);
            out.put("total", total);
            out.put("missing", missing);
            out.put("mismatch", mismatch);
            out.put("generatedAt", manifest.optString("generatedAt"));
            out.put("message", ok ? "已校验 " + checked + "/" + total + " 个内置文件" : "发现 " + missing.length() + " 个缺失、" + mismatch.length() + " 个不一致");
        } catch (Exception e) {
            out.put("ok", false);
            out.put("state", "missing-manifest");
            out.put("checked", 0);
            out.put("total", 0);
            out.put("message", "未找到 Android 完整性清单：" + e.getMessage());
        }
        return out;
    }

    private JSONObject linuxStatus() throws Exception {
        boolean root = isRooted();
        boolean installed = new File(rootfs, "bin/sh").exists();
        JSONObject out = new JSONObject();
        out.put("platform", "android");
        out.put("distro", "MolvOS / Alpine");
        out.put("method", root ? "chroot" : "termux");
        out.put("installed", installed);
        out.put("ready", installed && root);
        out.put("running", installed && root);
        out.put("rootfs", rootfs.getAbsolutePath());
        out.put("rootfsInstalled", installed);
        out.put("canInstall", root);
        out.put("needsAdmin", !root);
        out.put("version", installed ? "Alpine minirootfs" : null);
        out.put("message", installed ? (root ? "Alpine rootfs 已安装，chroot 可用" : "rootfs 已存在，但需要 root 才能 chroot") : (root ? "尚未安装 Alpine rootfs" : "未 root：建议安装 Termux 后使用 proot-distro"));
        out.put("instructions", arr("root 设备：点击“安装环境”，自动下载 Alpine rootfs 并 chroot", "非 root 设备：安装 Termux 与 proot-distro，在 Termux 中运行 proot-distro install alpine", "Windows 桌面端：使用 WSL2"));
        return out;
    }

    private Object installLinux(JSONObject p) throws Exception {
        if (!isRooted()) {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("code", "NO_ROOT");
            out.put("message", "Android 端安装 Linux 需要 root。未 root 设备请安装 Termux，并在其中执行：pkg install proot-distro && proot-distro install alpine");
            out.put("instructions", arr("安装 Termux（F-Droid 版本）", "pkg update && pkg install proot-distro", "proot-distro install alpine", "proot-distro login alpine"));
            return out;
        }
        if (!new File(rootfs, "bin/sh").exists()) {
            File linuxDir = new File(dataDir, "linux");
            if (!linuxDir.exists()) linuxDir.mkdirs();
            File tar = new File(linuxDir, "alpine-minirootfs.tar.gz");
            emit("linux:install-progress", json("stage", "download", "percent", 5, "text", "连接 Alpine 官方源…"));
            download(ALPINE_URL, tar);
            emit("linux:install-progress", json("stage", "extract", "percent", 65, "text", "解压 rootfs…"));
            if (!rootfs.exists()) rootfs.mkdirs();
            ProcessBuilder pb = new ProcessBuilder("tar", "-xzf", tar.getAbsolutePath(), "-C", rootfs.getAbsolutePath());
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            copy(proc.getInputStream(), new ByteArrayOutputStream());
            if (!proc.waitFor(10, TimeUnit.MINUTES) || proc.exitValue() != 0) {
                throw new Exception("rootfs 解压失败");
            }
            tar.delete();
        }
        emit("linux:install-progress", json("stage", "packages", "percent", 78, "text", "安装 bash / git / curl…"));
        String cmd = "chroot '" + rootfs.getAbsolutePath() + "' /bin/sh -c 'apk update && apk add --no-cache bash git curl ca-certificates'";
        CmdResult r = rootExec(cmd, 15 * 60 * 1000);
        if (r.code != 0) throw new Exception("apk 安装失败：" + tail(r.out));
        JSONObject cfg = config();
        JSONObject linux = cfg.optJSONObject("linux");
        if (linux == null) linux = new JSONObject();
        linux.put("installed", true);
        linux.put("method", "chroot");
        linux.put("installedAt", now());
        cfg.put("linux", linux);
        saveConfig(cfg);
        emit("linux:install-progress", json("stage", "done", "percent", 100, "text", "Linux 环境安装完成"));
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("method", "chroot");
        out.put("message", "Alpine rootfs 已安装，可以在终端中使用");
        return out;
    }

    private Object installPackages(JSONObject p) throws Exception {
        if (!isRooted()) throw new Exception("需要 root 才能安装 Linux 软件包");
        JSONArray list = p.optJSONArray("packages");
        if (list == null) list = new JSONArray();
        StringBuilder pkgs = new StringBuilder();
        for (int i = 0; i < list.length(); i++) {
            String s = list.optString(i);
            if (s.matches("[a-zA-Z0-9][a-zA-Z0-9+_.-]*")) {
                if (pkgs.length() > 0) pkgs.append(' ');
                pkgs.append(s);
            }
        }
        if (pkgs.length() == 0) throw new Exception("没有可安装的软件包");
        CmdResult r = rootExec("chroot '" + rootfs.getAbsolutePath() + "' /bin/sh -c 'apk add --no-cache " + pkgs + "'", 15 * 60 * 1000);
        JSONObject out = new JSONObject();
        out.put("ok", r.code == 0);
        out.put("output", tail(r.out));
        if (r.code != 0) out.put("error", tail(r.out));
        return out;
    }

    private JSONObject openTerminal() throws Exception {
        if (!isRooted()) throw new Exception("需要 root 才能使用内置 chroot 终端；非 root 请使用 Termux");
        if (!new File(rootfs, "bin/sh").exists()) throw new Exception("请先安装 Linux 环境");
        closeTerminal();
        String root = rootfs.getAbsolutePath();
        String cmd = "mkdir -p '" + root + "/proc' '" + root + "/sys' '" + root + "/dev'; " +
                "mount -t proc proc '" + root + "/proc' 2>/dev/null; " +
                "mount -t sysfs sysfs '" + root + "/sys' 2>/dev/null; " +
                "mount -o bind /dev '" + root + "/dev' 2>/dev/null; " +
                "chroot '" + root + "' /bin/sh -i";
        ProcessBuilder pb = new ProcessBuilder("su", "-c", cmd);
        pb.redirectErrorStream(true);
        terminalProcess = pb.start();
        terminalInput = terminalProcess.getOutputStream();
        final String id = "android-term-" + (++terminalSeq);
        final InputStream stream = terminalProcess.getInputStream();
        new Thread(() -> {
            byte[] buf = new byte[4096];
            try {
                int n;
                while ((n = stream.read(buf)) > 0) {
                    String text = new String(buf, 0, n, StandardCharsets.UTF_8);
                    emit("linux:terminal", json("id", id, "type", "data", "data", text));
                }
            } catch (Exception ignored) {}
            emit("linux:terminal", json("id", id, "type", "exit", "data", 0));
        }, "molv-terminal").start();
        JSONObject out = new JSONObject();
        out.put("id", id);
        out.put("label", "Android chroot · Alpine");
        out.put("method", "chroot");
        return out;
    }

    private void closeTerminal() {
        try { if (terminalInput != null) terminalInput.close(); } catch (Exception ignored) {}
        try { if (terminalProcess != null) terminalProcess.destroy(); } catch (Exception ignored) {}
        terminalInput = null;
        terminalProcess = null;
    }

    private Object execRoot(String command) throws Exception {
        CmdResult r = rootExec(command, 120000);
        JSONObject out = new JSONObject();
        out.put("ok", r.code == 0);
        out.put("stdout", r.out);
        out.put("stderr", "");
        out.put("code", r.code);
        return out;
    }

    private JSONObject compilers() throws Exception {
        String[][] defs = {
                {"cpp", "C / C++", "C++", "#6fd3ff", "g++", "build-base"},
                {"python", "Python", "Python", "#ffd166", "python3", "python3"},
                {"java", "Java", "Java", "#ff9b71", "java", "openjdk17-jdk"},
                {"node", "Node.js", "Node", "#8ee78e", "node", "nodejs"},
                {"go", "Go", "Go", "#65d9e8", "go", "go"},
                {"rust", "Rust", "Rust", "#e8a27a", "rustc", "rust"},
                {"php", "PHP", "PHP", "#b79cff", "php", "php"},
                {"ruby", "Ruby", "Ruby", "#ff8fa3", "ruby", "ruby"},
        };
        Set<String> present = new HashSet<>();
        if (isRooted() && new File(rootfs, "bin/sh").exists()) {
            CmdResult r = rootExec("chroot '" + rootfs.getAbsolutePath() + "' /bin/sh -lc 'for c in g++ python3 java node go rustc php ruby; do command -v $c >/dev/null 2>&1 && echo $c; done'", 30000);
            for (String line : r.out.split("\\n")) present.add(line.trim());
        }
        JSONObject cfg = config();
        JSONObject enabled = cfg.optJSONObject("compilers") == null ? new JSONObject() : cfg.optJSONObject("compilers").optJSONObject("enabled");
        JSONArray list = new JSONArray();
        for (String[] d : defs) {
            String cmd = d[4];
            boolean installed = present.contains(cmd);
            JSONObject o = new JSONObject();
            o.put("id", d[0]);
            o.put("name", d[1]);
            o.put("short", d[2]);
            o.put("color", d[3]);
            o.put("desc", "安装到墨绿 Linux 环境（Alpine apk）");
            o.put("commands", arr(cmd));
            o.put("linuxCmd", cmd);
            o.put("apk", d[5]);
            o.put("winget", "");
            o.put("website", "https://alpinelinux.org/");
            o.put("installed", installed);
            o.put("portable", false);
            o.put("version", installed ? "已安装" : null);
            o.put("path", installed ? "/usr/bin/" + cmd : null);
            o.put("enabled", enabled != null && enabled.optBoolean(d[0], false));
            o.put("scope", "linux");
            list.put(o);
        }
        JSONObject out = new JSONObject();
        out.put("scope", "linux");
        out.put("compilers", list);
        return out;
    }

    private Object installCompiler(String id) throws Exception {
        String pkg;
        switch (id) {
            case "cpp": pkg = "build-base"; break;
            case "python": pkg = "python3 py3-pip"; break;
            case "java": pkg = "openjdk17-jdk"; break;
            case "node": pkg = "nodejs npm"; break;
            case "go": pkg = "go"; break;
            case "rust": pkg = "rust cargo"; break;
            case "php": pkg = "php"; break;
            case "ruby": pkg = "ruby"; break;
            default: throw new Exception("未知编译环境：" + id);
        }
        JSONObject p = new JSONObject();
        p.put("packages", new JSONArray(Arrays.asList(pkg.split(" "))));
        Object r = installPackages(p);
        JSONObject out = new JSONObject(r.toString());
        out.put("message", "安装命令已完成");
        return out;
    }

    private JSONObject androidStatus() throws Exception {
        JSONObject out = new JSONObject();
        out.put("platform", "android");
        JSONArray devices = new JSONArray();
        JSONObject dev = new JSONObject();
        dev.put("serial", "android-local");
        dev.put("state", "device");
        dev.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        dev.put("online", true);
        devices.put(dev);
        out.put("devices", devices);
        out.put("online", 1);
        out.put("adb", null);
        out.put("emulator", null);
        out.put("nativeApkSupport", true);
        out.put("message", "Android 本机：" + Build.MANUFACTURER + " " + Build.MODEL);
        return out;
    }

    private JSONObject rootStatus() throws Exception {
        JSONObject out = new JSONObject();
        boolean root = isRooted();
        out.put("rooted", root);
        out.put("detail", root ? "su 可用，uid=0" : "su 不可用或未授权");
        return out;
    }

    private boolean isRooted() {
        long now = System.currentTimeMillis();
        if (now - lastRootCheck < 10000) return lastRoot;
        lastRootCheck = now;
        lastRoot = false;
        try {
            Process p = new ProcessBuilder("su", "-c", "id").redirectErrorStream(true).start();
            String out = readAll(p.getInputStream());
            p.waitFor(3, TimeUnit.SECONDS);
            lastRoot = out.contains("uid=0");
        } catch (Exception ignored) {}
        return lastRoot;
    }

    private JSONObject tasks() throws Exception {
        ActivityManager am = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
        JSONArray list = new JSONArray();
        if (procs != null) {
            for (ActivityManager.RunningAppProcessInfo p : procs) {
                JSONObject o = new JSONObject();
                o.put("pid", p.pid);
                o.put("name", p.processName);
                o.put("cpu", 0);
                int[] pids = new int[]{p.pid};
                Debug.MemoryInfo[] mem = am.getProcessMemoryInfo(pids);
                long rss = mem != null && mem.length > 0 ? mem[0].getTotalPss() * 1024L : 0;
                o.put("memory", rss);
                o.put("protected", p.pid == android.os.Process.myPid() || p.pid <= 1);
                list.put(o);
            }
        }
        JSONObject stats = systemStats();
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("processes", list);
        out.put("stats", stats);
        return out;
    }

    private Object killTask(int pid, boolean confirmed) throws Exception {
        if (!confirmed) throw new Exception("结束进程需要确认");
        if (pid == android.os.Process.myPid()) throw new Exception("不能结束墨绿OS自身");
        if (pid <= 1) throw new Exception("系统关键进程受保护");
        CmdResult r = rootExec("kill -9 " + pid, 10000);
        JSONObject out = new JSONObject();
        out.put("ok", r.code == 0);
        out.put("message", r.code == 0 ? "已发送终止信号" : tail(r.out));
        return out;
    }

    private JSONObject systemStats() throws Exception {
        long total = totalMem();
        long free = freeMem();
        int cpu = cpuPercent();
        JSONObject mem = new JSONObject();
        mem.put("total", total);
        mem.put("free", free);
        mem.put("used", total - free);
        mem.put("percent", total > 0 ? Math.round((total - free) * 100.0 / total) : 0);
        JSONObject out = new JSONObject();
        out.put("cpu", cpu);
        out.put("memory", mem);
        out.put("uptime", SystemClock.elapsedRealtime() / 1000);
        out.put("cores", Runtime.getRuntime().availableProcessors());
        out.put("platform", "android");
        return out;
    }

    private long totalMem() {
        try {
            android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
            ((android.app.ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);
            return mi.totalMem;
        } catch (Exception e) { return Runtime.getRuntime().maxMemory(); }
    }

    private long freeMem() {
        try {
            android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
            ((android.app.ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);
            return mi.availMem;
        } catch (Exception e) { return Runtime.getRuntime().freeMemory(); }
    }

    private int cpuPercent() {
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream("/proc/stat")));
            String line = r.readLine();
            r.close();
            if (line == null) return 0;
            String[] parts = line.trim().split("\\s+");
            long total = 0;
            for (int i = 1; i < parts.length; i++) total += Long.parseLong(parts[i]);
            long idle = Long.parseLong(parts[4]);
            int percent = 0;
            if (lastCpuTotal > 0) {
                long dt = total - lastCpuTotal;
                long di = idle - lastCpuIdle;
                if (dt > 0) percent = (int) Math.max(0, Math.min(100, (dt - di) * 100 / dt));
            }
            lastCpuTotal = total;
            lastCpuIdle = idle;
            return percent;
        } catch (Exception e) { return 0; }
    }

    private JSONArray scanRoots() throws Exception {
        JSONArray out = new JSONArray();
        addRoot(out, Environment.getExternalStorageDirectory(), "内部存储", "drive");
        addRoot(out, Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "下载", "downloads");
        addRoot(out, Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "相册", "desktop");
        return out;
    }

    private void addRoot(JSONArray out, File file, String label, String type) throws Exception {
        if (file == null) return;
        JSONObject o = new JSONObject();
        o.put("path", file.getAbsolutePath());
        o.put("label", label);
        o.put("type", type);
        out.put(o);
    }

    private JSONObject scanPolicy() throws Exception {
        JSONObject cfg = config();
        JSONObject scan = cfg.optJSONObject("scan");
        return scan == null || scan.optJSONObject("policy") == null ? defaultPolicy() : scan.optJSONObject("policy");
    }

    private JSONObject scanStart(JSONObject p) throws Exception {
        JSONArray roots = p.optJSONArray("roots");
        JSONObject policy = p.optJSONObject("policy");
        if (policy == null) policy = scanPolicy();
        JSONArray results = new JSONArray();
        int[] count = new int[]{0, 0, 0};
        if (roots != null) {
            for (int i = 0; i < roots.length(); i++) {
                walkScan(new File(roots.optString(i)), policy, results, count, 0);
            }
        }
        JSONObject out = new JSONObject();
        out.put("id", "android-scan-" + System.currentTimeMillis());
        out.put("files", count[0]);
        out.put("matched", results.length());
        out.put("errors", count[2]);
        out.put("results", results);
        out.put("roots", roots);
        out.put("elapsedMs", 0);
        out.put("cancelled", false);
        return out;
    }

    private void walkScan(File file, JSONObject policy, JSONArray results, int[] count, int depth) {
        if (file == null || depth > 12) return;
        if (file.isDirectory()) {
            String name = file.getName().toLowerCase(Locale.ROOT);
            if (name.equals("node_modules") || name.equals(".git") || name.equals("$recycle.bin")) return;
            File[] kids = file.listFiles();
            if (kids == null) return;
            for (File kid : kids) walkScan(kid, policy, results, count, depth + 1);
            return;
        }
        count[0]++;
        String name = file.getName().toLowerCase(Locale.ROOT);
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot >= 0) ext = name.substring(dot);
        List<String> reasons = new ArrayList<>();
        String level = "low";
        JSONArray exts = policy.optJSONArray("extensions");
        JSONArray sens = policy.optJSONArray("sensitiveExtensions");
        JSONArray names = policy.optJSONArray("names");
        if (contains(sens, ext)) { reasons.add("敏感扩展名 " + ext); level = "high"; }
        if (contains(exts, ext)) { reasons.add("可执行/脚本扩展名 " + ext); if (!level.equals("high")) level = "medium"; }
        if (names != null) {
            for (int i = 0; i < names.length(); i++) {
                String n = names.optString(i).toLowerCase(Locale.ROOT);
                if (!n.isEmpty() && name.contains(n)) { reasons.add("文件名包含“" + n + "”"); level = "high"; }
            }
        }
        long largeMb = policy.optLong("largeFileMB", 512);
        if (largeMb > 0 && file.length() >= largeMb * 1024 * 1024) {
            reasons.add("超大文件 " + human(file.length()));
            if (level.equals("low")) level = "medium";
        }
        if (reasons.isEmpty()) return;
        try {
            JSONObject hit = new JSONObject();
            hit.put("path", file.getAbsolutePath());
            hit.put("name", file.getName());
            hit.put("ext", ext);
            hit.put("size", file.length());
            hit.put("sizeText", human(file.length()));
            hit.put("modified", new Date(file.lastModified()).toString());
            hit.put("reasons", new JSONArray(reasons));
            hit.put("level", level);
            hit.put("hash", null);
            results.put(hit);
        } catch (Exception ignored) {}
    }

    private Object quarantine(JSONObject p) throws Exception {
        JSONArray paths = p.optJSONArray("paths");
        if (paths == null || !p.optBoolean("confirmed")) throw new Exception("隔离需要确认");
        File vault = new File(dataDir, "vault/" + System.currentTimeMillis());
        if (!vault.exists()) vault.mkdirs();
        JSONArray moved = new JSONArray();
        for (int i = 0; i < paths.length(); i++) {
            File src = new File(paths.optString(i));
            if (!src.exists()) continue;
            File dst = new File(vault, src.getName());
            if (src.renameTo(dst)) moved.put(dst.getAbsolutePath());
        }
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("vault", vault.getAbsolutePath());
        out.put("count", moved.length());
        out.put("moved", moved);
        return out;
    }

    private Object exportScanReport() throws Exception {
        throw new Exception("Android 端暂未实现报告导出");
    }

    private JSONObject serverStatus() throws Exception {
        if (server == null || !server.running) return json("running", false);
        return server.status();
    }

    private Object startServer(JSONObject p) throws Exception {
        stopServer();
        File root = new File(p.optString("root", Environment.getExternalStorageDirectory().getAbsolutePath()));
        if (!root.isDirectory()) throw new Exception("目录不存在：" + root);
        int port = p.optInt("port", 8787);
        server = new SimpleServer(root, port);
        server.start();
        return server.status();
    }

    private Object stopServer() throws Exception {
        if (server != null) { server.close(); server = null; }
        return json("ok", true, "running", false);
    }

    private JSONObject githubStatus() throws Exception {
        JSONObject cfg = config();
        JSONObject gh = cfg.optJSONObject("github");
        String mirror = gh == null ? "ghproxy" : gh.optString("mirror", "ghproxy");
        JSONArray mirrors = new JSONArray();
        mirrors.put(mirrorObj("direct", "GitHub 直连", "", "官方源"));
        mirrors.put(mirrorObj("ghproxy", "GHProxy", "https://ghproxy.net/", "社区镜像"));
        mirrors.put(mirrorObj("gh-proxy", "gh-proxy", "https://gh-proxy.com/", "社区镜像"));
        mirrors.put(mirrorObj("ghfast", "ghfast", "https://ghfast.top/", "社区镜像"));
        JSONObject active = new JSONObject();
        for (int i = 0; i < mirrors.length(); i++) {
            JSONObject m = mirrors.optJSONObject(i);
            if (m.optString("id").equals(mirror)) active = m;
        }
        JSONObject out = new JSONObject();
        out.put("mirrors", mirrors);
        out.put("active", active);
        out.put("enabled", true);
        out.put("lastTest", null);
        out.put("git", json("installed", false));
        return out;
    }

    private JSONObject mirrorObj(String id, String name, String prefix, String note) throws Exception {
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("name", name);
        o.put("prefix", prefix);
        o.put("note", note);
        return o;
    }

    private Object setGithub(JSONObject p) throws Exception {
        JSONObject cfg = config();
        JSONObject gh = cfg.optJSONObject("github");
        if (gh == null) gh = new JSONObject();
        gh.put("mirror", p.optString("mirror", "ghproxy"));
        if (p.has("custom")) gh.put("custom", p.optString("custom"));
        cfg.put("github", gh);
        saveConfig(cfg);
        return githubStatus().optJSONObject("active");
    }

    private Object testGithub() throws Exception {
        JSONArray results = new JSONArray();
        JSONObject out = new JSONObject();
        out.put("results", results);
        out.put("fastest", null);
        return out;
    }

    private JSONObject config() throws Exception {
        try {
            return new JSONObject(prefs.getString("config", defaultConfig().toString()));
        } catch (Exception e) {
            return defaultConfig();
        }
    }

    private void saveConfig(JSONObject cfg) {
        prefs.edit().putString("config", cfg.toString()).apply();
    }

    private JSONObject defaultConfig() {
        try {
            JSONObject o = new JSONObject();
            o.put("schema", 1);
            o.put("locale", "zh-CN");
            o.put("theme", "ink");
            o.put("variant", "slim");
            o.put("firstRun", true);
            o.put("lastPage", "dashboard");
            JSONObject setup = new JSONObject();
            setup.put("permissions", "pending");
            setup.put("integrity", "pending");
            setup.put("virtualization", "pending");
            setup.put("linux", "pending");
            setup.put("completed", false);
            o.put("setup", setup);
            JSONObject linux = new JSONObject();
            linux.put("method", "chroot");
            linux.put("installed", false);
            o.put("linux", linux);
            JSONObject comp = new JSONObject();
            comp.put("scope", "linux");
            JSONObject enabled = new JSONObject();
            for (String id : new String[]{"cpp", "python", "java", "node", "go", "rust", "php", "ruby"}) enabled.put(id, false);
            comp.put("enabled", enabled);
            o.put("compilers", comp);
            JSONObject github = new JSONObject();
            github.put("enabled", true);
            github.put("mirror", "ghproxy");
            github.put("custom", "");
            o.put("github", github);
            JSONObject server = new JSONObject();
            server.put("port", 8787);
            server.put("root", "");
            server.put("upnp", false);
            o.put("server", server);
            JSONObject scan = new JSONObject();
            scan.put("roots", new JSONArray());
            scan.put("policy", defaultPolicy());
            o.put("scan", scan);
            o.put("autostart", false);
            o.put("minimizeToTray", true);
            o.put("window", new JSONObject());
            return o;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private JSONObject defaultPolicy() throws Exception {
        JSONObject p = new JSONObject();
        p.put("extensions", arr(".exe", ".dll", ".scr", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jar", ".apk", ".iso", ".torrent"));
        p.put("sensitiveExtensions", arr(".pem", ".key", ".pfx", ".p12", ".kdbx", ".env", ".ovpn"));
        p.put("names", arr("password", "passwd", "secret", "token", "credentials", "id_rsa", "wallet.dat"));
        p.put("contentKeywords", arr());
        p.put("largeFileMB", 512);
        p.put("maxResults", 2000);
        p.put("includeHidden", false);
        p.put("followSymlinks", false);
        return p;
    }

    private Object getPath(JSONObject obj, String key) {
        if (key == null || key.isEmpty()) return obj;
        String[] parts = key.split("\\.");
        Object cur = obj;
        for (String part : parts) {
            if (!(cur instanceof JSONObject)) return null;
            cur = ((JSONObject) cur).opt(part);
        }
        return cur;
    }

    private void setPath(JSONObject obj, String key, Object value) throws Exception {
        String[] parts = key.split("\\.");
        JSONObject cur = obj;
        for (int i = 0; i < parts.length - 1; i++) {
            JSONObject next = cur.optJSONObject(parts[i]);
            if (next == null) next = new JSONObject();
            cur.put(parts[i], next);
            cur = next;
        }
        cur.put(parts[parts.length - 1], value);
    }

    private void merge(JSONObject target, JSONObject patch) throws Exception {
        if (patch == null) return;
        java.util.Iterator<String> keys = patch.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            Object v = patch.opt(k);
            if (v instanceof JSONObject && target.optJSONObject(k) != null) {
                merge(target.optJSONObject(k), (JSONObject) v);
            } else {
                target.put(k, v);
            }
        }
    }

    private void download(String url, File dest) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(120000);
        conn.setRequestProperty("User-Agent", "MolvOS/0.1 Android");
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) throw new Exception("下载失败 HTTP " + code);
        long total = conn.getContentLengthLong();
        InputStream in = conn.getInputStream();
        FileOutputStream out = new FileOutputStream(dest);
        byte[] buf = new byte[65536];
        long got = 0;
        int n;
        int last = -1;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            got += n;
            int pct = total > 0 ? (int) (got * 55 / total) + 5 : 20;
            if (pct != last) {
                last = pct;
                emit("linux:install-progress", json("stage", "download", "percent", pct, "text", "下载 Alpine：" + human(got) + " / " + human(total)));
            }
        }
        out.flush();
        out.close();
        in.close();
        conn.disconnect();
    }

    private CmdResult rootExec(String command, long timeoutMs) throws Exception {
        Process p = new ProcessBuilder("su", "-c", command).redirectErrorStream(true).start();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Thread t = new Thread(() -> {
            try { copy(p.getInputStream(), out); } catch (Exception ignored) {}
        });
        t.start();
        boolean done = p.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
        if (!done) p.destroy();
        t.join(1000);
        return new CmdResult(done ? p.exitValue() : -1, out.toString("UTF-8"));
    }

    private static class CmdResult {
        final int code;
        final String out;
        CmdResult(int code, String out) { this.code = code; this.out = out; }
    }

    private String readAsset(String path) throws Exception {
        InputStream in = activity.getAssets().open(path);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        copy(in, out);
        in.close();
        return out.toString("UTF-8");
    }

    private String sha256(String text) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] hash = md.digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : hash) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private void emit(String type, JSONObject data) {
        try {
            JSONObject msg = new JSONObject();
            msg.put("type", type);
            msg.put("data", data);
            msg.put("at", System.currentTimeMillis());
            String js = "window.MolvNativeEvent && window.MolvNativeEvent(" + JSONObject.quote(msg.toString()) + ");";
            activity.runOnUiThread(() -> webView.evaluateJavascript(js, null));
        } catch (Exception ignored) {}
    }

    private String versionName() {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return info.versionName;
        } catch (Exception e) { return "0.1.0"; }
    }

    private boolean isPackageInstalled(String pkg) {
        try {
            activity.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) { return false; }
    }

    private JSONObject json(Object... pairs) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < pairs.length; i += 2) o.put(String.valueOf(pairs[i]), pairs[i + 1]);
        } catch (Exception ignored) {}
        return o;
    }

    private JSONArray arr(Object... values) {
        JSONArray a = new JSONArray();
        for (Object v : values) a.put(v);
        return a;
    }

    private boolean contains(JSONArray arr, String value) {
        if (arr == null) return false;
        for (int i = 0; i < arr.length(); i++) if (arr.optString(i).equalsIgnoreCase(value)) return true;
        return false;
    }

    private String human(long n) {
        if (n <= 0) return "0 B";
        String[] units = {"B", "KB", "MB", "GB", "TB"};
        double v = n;
        int i = 0;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return String.format(Locale.ROOT, i == 0 ? "%.0f %s" : "%.1f %s", v, units[i]);
    }

    private String now() {
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.ROOT).format(new Date());
    }

    private String tail(String s) {
        if (s == null) return "";
        return s.length() > 1200 ? s.substring(s.length() - 1200) : s;
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        copy(in, out);
        return out.toString("UTF-8");
    }

    private String localIp() {
        try {
            Enumeration<NetworkInterface> ifs = NetworkInterface.getNetworkInterfaces();
            while (ifs.hasMoreElements()) {
                NetworkInterface ni = ifs.nextElement();
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }

    private class SimpleServer implements Runnable {
        final File root;
        final int port;
        ServerSocket socket;
        Thread thread;
        volatile boolean running;

        SimpleServer(File root, int port) { this.root = root; this.port = port; }

        void start() throws Exception {
            socket = new ServerSocket(port);
            running = true;
            thread = new Thread(this, "molv-server");
            thread.start();
        }

        JSONObject status() throws Exception {
            JSONArray urls = new JSONArray();
            urls.put("http://127.0.0.1:" + port + "/");
            urls.put("http://" + localIp() + ":" + port + "/");
            JSONObject o = new JSONObject();
            o.put("running", running);
            o.put("root", root.getAbsolutePath());
            o.put("port", port);
            o.put("urls", urls);
            o.put("requests", new JSONArray());
            o.put("upnp", false);
            return o;
        }

        void close() {
            running = false;
            try { if (socket != null) socket.close(); } catch (Exception ignored) {}
        }

        @Override
        public void run() {
            while (running) {
                try {
                    Socket client = socket.accept();
                    new Thread(() -> handle(client)).start();
                } catch (Exception e) {
                    if (running) continue;
                }
            }
        }

        void handle(Socket client) {
            try {
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                String line = in.readLine();
                if (line == null) { client.close(); return; }
                String[] parts = line.split(" ");
                String method = parts.length > 0 ? parts[0] : "GET";
                String path = parts.length > 1 ? parts[1] : "/";
                int q = path.indexOf('?');
                if (q >= 0) path = path.substring(0, q);
                path = java.net.URLDecoder.decode(path, "UTF-8");
                File target = new File(root, path.replaceFirst("^/", ""));
                if (!target.getCanonicalPath().startsWith(root.getCanonicalPath())) {
                    send(client, 403, "text/plain", "403 Forbidden".getBytes(StandardCharsets.UTF_8));
                    return;
                }
                if (target.isDirectory()) {
                    File index = new File(target, "index.html");
                    if (index.exists()) target = index;
                    else { sendListing(client, target, path); return; }
                }
                if (!target.isFile()) { send(client, 404, "text/plain", "404 Not Found".getBytes(StandardCharsets.UTF_8)); return; }
                byte[] data = new byte[(int) target.length()];
                FileInputStream fis = new FileInputStream(target);
                int off = 0;
                while (off < data.length) {
                    int n = fis.read(data, off, data.length - off);
                    if (n < 0) break;
                    off += n;
                }
                fis.close();
                String type = mime(target.getName());
                if ("HEAD".equals(method)) send(client, 200, type, new byte[0]);
                else send(client, 200, type, data);
            } catch (Exception ignored) {
            } finally {
                try { client.close(); } catch (Exception ignored) {}
            }
        }

        void sendListing(Socket client, File dir, String path) throws IOException {
            File[] files = dir.listFiles();
            StringBuilder html = new StringBuilder("<!doctype html><meta charset=utf-8><title>MolvOS</title><style>body{background:#2A603B;color:#f2fff6;font:15px sans-serif;padding:30px}a{color:#a7f3c9;display:block;padding:6px 0}</style><h2>墨绿OS · " + path + "</h2>");
            if (files != null) {
                Arrays.sort(files, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
                for (File f : files) html.append("<a href=\"").append(Uri.encode(f.getName())).append(f.isDirectory() ? "/" : "").append("\">").append(f.getName()).append(f.isDirectory() ? "/" : "").append("</a>");
            }
            send(client, 200, "text/html; charset=utf-8", html.toString().getBytes(StandardCharsets.UTF_8));
        }

        void send(Socket client, int code, String type, byte[] data) throws IOException {
            OutputStream out = client.getOutputStream();
            String head = "HTTP/1.1 " + code + " OK\r\nContent-Type: " + type + "\r\nContent-Length: " + data.length + "\r\nConnection: close\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.UTF_8));
            out.write(data);
            out.flush();
        }

        String mime(String name) {
            String n = name.toLowerCase(Locale.ROOT);
            if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html; charset=utf-8";
            if (n.endsWith(".css")) return "text/css; charset=utf-8";
            if (n.endsWith(".js")) return "text/javascript; charset=utf-8";
            if (n.endsWith(".json")) return "application/json; charset=utf-8";
            if (n.endsWith(".png")) return "image/png";
            if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
            if (n.endsWith(".svg")) return "image/svg+xml";
            if (n.endsWith(".txt") || n.endsWith(".md")) return "text/plain; charset=utf-8";
            return "application/octet-stream";
        }
    }
}
