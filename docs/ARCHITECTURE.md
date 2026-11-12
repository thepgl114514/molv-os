# 墨绿OS 技术架构

## 总览

```
┌─────────────────────────────────────────────────────────────┐
│                      共享 Web 界面                           │
│  ui.js / pages-*.js / actions.js / styles.css / xterm.js    │
└───────────────┬───────────────────────────────┬─────────────┘
                │ window.molvDesktop            │ window.MolvAndroid
┌───────────────▼───────────────────┐   ┌───────▼─────────────┐
│ Electron 主进程 (Node.js)          │   │ Android WebView      │
│ IPC → 本地能力模块                 │   │ @JavascriptInterface │
│ WSL2 / winget / adb / UPnP / USB   │   │ chroot / su / Java   │
└───────────────┬───────────────────┘   └───────┬─────────────┘
                │                               │
        Windows / Linux 系统服务           Android 系统服务
```

## 桌面端

### 主进程

`src/main/main.js`

- 单实例锁；在受限环境中自动退回到可写的用户数据目录。
- 窗口状态持久化、托盘、菜单、外链拦截、权限拒绝。
- 启动时创建服务容器并注册 IPC。

`src/main/ipc.js`

- 单一 `molv:invoke` 通道，统一 `{ok,data|error}` 返回。
- 校验调用来源（file:// 或 localhost）。
- 将扫描、终端、服务器、USB 进度转发到渲染进程。

### 核心模块

| 模块 | 职责 |
| --- | --- |
| `store.js` | 配置读取、深合并、原子写入、备份、导入导出 |
| `integrity.js` | SHA-256 清单生成与校验 |
| `platform.js` | 平台信息、权限、虚拟化、提权 |
| `linux.js` | WSL2 导入、Alpine rootfs、APK 包、终端会话 |
| `compilers.js` | 八种语言检测、安装、作用域 |
| `android.js` | adb、APK 安装、模拟器、Android Studio |
| `tasks.js` | 进程列表、CPU 采样、结束进程 |
| `scanner.js` | 文件遍历、规则匹配、隔离、报告 |
| `server.js` | 只读 HTTP、目录索引、Range、请求日志 |
| `upnp.js` | SSDP 发现、SOAP AddPortMapping |
| `github.js` | 镜像、测速、下载、git 配置 |
| `usb.js` | 磁盘枚举、RAW 写入、FAT32 复制 |

### 渲染进程

- 无 Node 集成，`contextIsolation: true`，CSP 限制脚本与连接。
- `bridge.js` 统一桌面 / Android / 浏览器预览三种后端。
- `ui.js` 提供状态、路由、toast、modal、事件总线。
- 页面按系统 / 工具 / 设置拆分，动作集中在 `actions.js`。

## Android 端

- 原生 `MainActivity` + WebView 加载 `assets/www`。
- `Bridge` 通过 `@JavascriptInterface` 暴露同步调用；长任务在 JavaScript 调用线程执行，进度通过 `evaluateJavascript` 回传。
- 能力：
  - root 检测、存储/通知权限
  - Alpine rootfs 下载、tar 解压、chroot
  - 终端进程与输出流
  - `/proc` CPU、ActivityManager 内存、进程
  - 规则扫描与隔离
  - 内置 `ServerSocket` 只读文件服务器
- 不使用第三方 Android 依赖，APK 体积小。

## 数据模型

```json
{
  "schema": 1,
  "variant": "slim",
  "setup": { "permissions": "...", "integrity": "...", "linux": "..." },
  "linux": { "method": "wsl", "installed": true },
  "compilers": { "scope": "device", "enabled": { "cpp": true } },
  "github": { "mirror": "ghproxy", "enabled": true },
  "server": { "port": 8787, "root": "...", "upnp": false },
  "scan": { "policy": { "extensions": ["..."] } }
}
```

Windows 数据目录优先级：

1. `MOLV_USERDATA`
2. `%LOCALAPPDATA%\MolvOS`
3. `%APPDATA%\MolvOS`
4. 程序目录 `MolvOS-Data`
5. 当前目录 `.molv-data`

## 构建管线

```
npm install
  → make:integrity（src + package.json + icon）
  → electron-builder（asar + extraResources）
  → NSIS / Portable / tar.gz
android/build-apk.ps1
  → aapt2 compile/link
  → javac (source 11)
  → d8
  → jar 加入 classes.dex
  → zipalign
  → apksigner
```

Android 不依赖 Gradle/Android Studio，使用 SDK 命令行工具直接构建，便于在 CI 中复现。

## 安全边界

- 渲染进程不能直接访问文件系统；所有能力经 IPC 白名单。
- USB 写入拒绝系统盘，要求可移动磁盘、管理员、确认短语。
- 扫描隔离而非删除。
- 文件服务器只读、路径穿越防护、无认证（明确告知）。
- GitHub 镜像只接受 GitHub 域名。
- 完整性清单不替代代码签名。

## 已知限制

- 终端不是完整 PTY，交互式全屏程序可能异常。
- Windows 无 WSL2 时无法运行 Linux 环境。
- Android 非 root 无法使用内置 chroot。
- UPnP 依赖路由器。
- 未捆绑 Android 模拟器、Wine、Winlator、Ollama 模型。
- 当前 CI 产物未做商业代码签名，Windows SmartScreen 可能提示。
