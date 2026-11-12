# 墨绿OS 使用说明书

版本：0.1.0（青岚）
适用：Windows 10/11、Android 8.0+、主流 x86_64 Linux
主色：#2A603B

---

## 1. 这是什么

墨绿OS 是一个跨平台工作台。它不替换你的操作系统，也不在后台悄悄安装组件；它把 Linux 运行时、编译环境、进程管理、文件扫描、文件服务器、GitHub 下载与启动盘制作整合到一个界面里。

它由三部分组成：

1. **桌面工作台**（Windows / Linux）：Electron 界面 + Node.js 本地服务。
2. **Android 应用**：WebView 界面 + 原生 Java 桥接，可检测 root、安装 Alpine、打开 chroot 终端。
3. **可选 Live 环境**：基于 Alpine Linux 的启动盘镜像（发布流程见 GitHub Releases）。

> “墨绿OS Live”是定制 Linux Live 环境，不是自研内核。桌面应用和 Android 应用也不包含完整的 Android 模拟器或 Wine 运行时，它们负责检测、安装和编排。

---

## 2. 安装

### 2.1 Windows

**便携版**：双击 `MolvOS-0.1.0-Portable.exe`。首次启动会在以下位置之一创建数据目录：

1. `%LOCALAPPDATA%\MolvOS`
2. `%APPDATA%\MolvOS`
3. 程序同级的 `MolvOS-Data`
4. 当前工作目录的 `.molv-data`

如果系统禁止写入 AppData（某些受控文件夹策略），程序会自动退回到第 3 或第 4 个位置。

**ZIP 版**：解压 `MolvOS-0.1.0-win-x64.zip`，运行 `MolvOS.exe`。

**安装版（NSIS）**：如果发布包中提供 `MolvOS-0.1.0-Setup.exe`，双击后选择安装目录。当前构建环境未生成可用的 NSIS 安装器时，以 Portable 版为准。

### 2.2 Linux

```bash
tar -xzf MolvOS-0.1.0-linux-x64.tar.gz
cd MolvOS-0.1.0-linux-x64
./molv-os
```

Debian / Ubuntu 可安装 `.deb`：

```bash
sudo dpkg -i molv-os_0.1.0_amd64.deb
sudo apt-get -f install
molv-os
```

如果提示缺少 FUSE 或沙箱权限，可尝试：

```bash
./molv-os --no-sandbox
```

### 2.3 Android

1. 传输 `MolvOS-0.1.0-android.apk` 到手机。
2. 允许“安装未知来源应用”。
3. 安装后打开墨绿OS。
4. 首次启动按提示授予存储 / 通知权限。要使用内置 chroot 终端，设备必须已 root 并授权 su。

> APK 使用调试签名，适合内测与侧载，不适合直接上架应用商店。

---

## 3. 首次运行向导

启动后进入「安装向导」，共四步：

### 3.1 权限检查

- **Windows**：管理员权限（制作启动盘、安装 WSL2 时需要）、WSL2、长路径、开发者模式、磁盘空间。
- **Linux**：root/sudo、`/dev/kvm`、完整性、磁盘空间。
- **Android**：存储、通知、root。

点击「查看」会展示每一项的说明。墨绿OS 只打开系统设置页，不会替你修改系统策略。

### 3.2 文件完整性

启动时自动校验 `integrity.json` 中列出的核心文件（SHA-256）。如果文件缺失或损坏，侧边栏会显示「安装文件异常」。

校验结果的含义：

- **通过**：文件与构建时一致。
- **开发模式**：没有清单（源码运行或未执行 `npm run make:integrity`）。
- **异常**：文件缺失或被修改，建议重新下载发布包。

完整性清单不是代码签名，不能证明发布者身份；公开发布应同时提供 `SHA256SUMS.txt`。

### 3.3 虚拟化与 Linux 运行时

- **Windows**：检测 Hyper-V / WSL2。WSL2 未启用时，安装 Linux 会请求管理员权限，并可能要求重启。
- **Linux**：检测 `/dev/kvm`；没有 KVM 时使用 chroot/proot。
- **Android**：root 可用时使用 chroot；否则建议 Termux + proot-distro。

### 3.4 安装 Linux 环境

点击「安装 Linux 环境」后：

1. 从 Alpine 官方源获取 `latest-stable` 的 minirootfs。
2. 校验 SHA-256（桌面端）。
3. Windows 导入名为 `MolvOS` 的 WSL2 发行版；Linux 解压到数据目录；Android root 解压后 chroot。
4. 安装基础包：`bash`、`git`、`curl`、`ca-certificates`（按安装规格追加）。

安装过程会显示进度。安装完成后进入「Linux 环境」即可打开终端。

---

## 4. Linux 环境

### 4.1 终端

- 支持中文、颜色、常见 ANSI 控制序列。
- 当前实现通过管道连接 shell，不是完整 PTY；方向键行编辑不可用，输入采用本地回显。
- `Ctrl+C` 发送中断；`Enter` 执行；`Ctrl+L` 清屏。
- 终端以 root 运行在隔离环境中，请勿执行不可信脚本。

### 4.2 快捷命令

终端下方提供 `uname`、`apk update`、`python`、`g++`、`df`、`top` 等按钮。

### 4.3 按需扩展

点击 Python / C++ / Java / Go / Node.js / Rust / Git 等按钮，会执行 `apk add` 安装到 Linux 环境，不影响 Windows 侧。

### 4.4 手动安装

Windows：

```powershell
wsl --install --no-distribution
# 重启
wsl --import MolvOS "$env:LOCALAPPDATA\MolvOS\linux\wsl" "alpine-minirootfs.tar.gz" --version 2
wsl -d MolvOS -u root
```

Linux：

```bash
mkdir -p ~/.local/share/molv-os/linux/rootfs
tar -xzf alpine-minirootfs-*.tar.gz -C ~/.local/share/molv-os/linux/rootfs
sudo chroot ~/.local/share/molv-os/linux/rootfs /bin/sh
```

Android（root）：

```bash
su
mkdir -p /data/local/molv/linux
tar -xzf alpine-minirootfs-aarch64.tar.gz -C /data/local/molv/linux/rootfs
chroot /data/local/molv/linux/rootfs /bin/sh
```

未 root 的 Android 设备请使用 Termux：

```bash
pkg update
pkg install proot-distro
proot-distro install alpine
proot-distro login alpine
```

---

## 5. 编译环境

支持：

| 语言 | 整机（Windows/Linux） | Linux 环境 |
| --- | --- | --- |
| C / C++ | winget MSYS2 / 系统包 | `build-base` |
| Python | winget Python 3.12 / 系统包 | `python3` |
| Java | Temurin 21 / 系统包 | `openjdk17-jdk` |
| Node.js | winget LTS / 系统包 | `nodejs npm` |
| Go | winget Go / 系统包 | `go` |
| Rust | rustup / 系统包 | `rust cargo` |
| PHP | winget PHP / 系统包 | `php` |
| Ruby | RubyInstaller / 系统包 | `ruby` |

### 作用域

- **整机**：使用宿主机 PATH；安装会调用 winget（Windows）或给出系统包命令（Linux）。
- **Linux 内**：只安装到 Alpine/WSL，不污染宿主机。

### 开启与检测

1. 选择作用域。
2. 点击语言卡片上的开关启用。
3. 已安装的显示版本；未安装的点击「安装」。
4. 「验证」会重新执行版本命令。

Linux 作用域需要先安装 Linux 环境。安装第三方工具可能需要管理员授权，且会改变系统状态，请自行确认。

---

## 6. 应用兼容

### 6.1 Windows 运行 APK

Windows 不能原生执行 APK。墨绿OS 提供：

- 检测 `adb` 与在线 Android 设备。
- 选择 APK，显示包名、版本、大小。
- 通过 `adb install -r` 安装到真机或模拟器。
- 启动 Android 模拟器、安装 Android Studio。

准备条件：

1. 手机开启「开发者选项 → USB 调试」，连接电脑并授权。
2. 或安装 Android Studio，在 Device Manager 创建 AVD。
3. 在墨绿OS「应用兼容」中选择 APK。

> 微软已停止 Windows Subsystem for Android（WSA）。本项目不捆绑 Android 系统镜像，也不提供破解或绕过授权的能力。

### 6.2 Android 运行 Windows 程序

Android 内核不能直接执行 Windows PE。推荐使用开源的 **Winlator**（Wine + Box64/Box86）：

1. 在 Android 安装 Winlator。
2. 在墨绿OS「应用兼容 → Windows 应用」点击「打开 / 获取 Winlator」。
3. 在 Winlator 中创建容器并安装 `.exe`。
4. 墨绿OS 负责检测安装与跳转，不参与 Wine 的 API 兼容。

需要 100% 兼容时，远程桌面到一台 Windows 主机通常更可靠。

---

## 7. 任务管理器

- 显示 PID、进程名、CPU、内存、保护状态。
- CPU 为两次采样之间的增量，首次打开可能为 0%。
- 结束进程需要二次确认；系统关键进程（System、csrss、wininit、services、lsass 等）被阻止。
- 「系统监视器」打开 Windows 资源监视器或 Linux 的 gnome-system-monitor / htop。

Android 端受系统限制，通常只能看到本应用与部分进程；root 后可结束更多进程。

---

## 8. 合规扫描

### 8.1 定位

“违规文件”不能由扩展名或关键词可靠判断。本功能是**本地规则匹配**，用于隐私自查、清理与合规准备，不构成法律意见或违法性认定。

### 8.2 默认策略

- 可执行/脚本扩展名：`.exe`、`.dll`、`.bat`、`.cmd`、`.ps1`、`.vbs`、`.js`、`.jar`、`.apk`、`.iso`、`.torrent`。
- 敏感凭据扩展名：`.pem`、`.key`、`.pfx`、`.p12`、`.kdbx`、`.env`、`.ovpn`。
- 文件名关键词：`password`、`token`、`credentials`、`id_rsa` 等。
- 文本内容关键词：私钥头、`api_key`、`access_token`。
- 超大文件阈值：512 MB。

### 8.3 操作

1. 选择磁盘/目录（可多选）。
2. 调整策略，点击「保存策略」。
3. 点击「开始扫描」；可随时停止。
4. 勾选结果，点击「隔离所选」。
5. 点击「导出报告」生成 JSON。

### 8.4 隔离区

文件被移动到数据目录的 `vault/<时间戳>/`，并写入 `manifest.json`。墨绿OS 不直接删除文件；确认无误后可手动清理。

### 8.5 性能与隐私

- 跳过回收站、系统卷信息、`node_modules`、`.git` 等目录。
- 不跟随符号链接。
- 文本内容只读取 ≤ 2 MB 的文本文件。
- 不上传文件、路径或结果。

---

## 9. 文件服务器

### 9.1 启动

1. 选择共享文件夹。
2. 设置端口（1024–65535）。
3. 选择监听地址（所有网卡 / 仅本机）。
4. 可选开启 UPnP 端口映射。
5. 点击「启动服务器」。

启动后显示本机与局域网地址，可复制到浏览器。

### 9.2 特性

- 只读：仅 GET/HEAD。
- 目录索引、常见 MIME、Range 请求。
- 路径穿越防护。
- 请求日志（最近 60 条）。
- 不提供上传、删除、执行接口。

### 9.3 UPnP

点击「申请端口映射」会通过 SSDP 发现网关并调用 `AddPortMapping`。失败原因可能是：

- 路由器未开启 UPnP。
- 运营商/企业网络隔离。
- 双重 NAT。

失败不影响局域网访问；可在路由器中手动转发端口。

> 不要把包含密钥、身份证件、私人照片的目录长期暴露在公网。服务器没有登录认证。

---

## 10. GitHub 加速

### 10.1 支持的镜像

- GitHub 直连
- GHProxy (`https://ghproxy.net/`)
- gh-proxy (`https://gh-proxy.com/`)
- ghfast (`https://ghfast.top/`)
- Moeyy (`https://github.moeyy.xyz/`)
- 自定义前缀

### 10.2 使用

1. 在「GitHub 加速」选择镜像，或点击「测速」选择最快线路。
2. 在「链接改写测试」粘贴公开 GitHub 下载链接，生成加速链接。
3. 可选「写入全局 git insteadOf 配置」，让 `git clone https://github.com/...` 走镜像。

### 10.3 边界

- 只处理 `github.com` / `raw.githubusercontent.com` 等公开链接。
- 不代理登录、GitHub API、私有仓库凭据。
- 第三方镜像可能记录访问、失效或返回错误内容；请自行评估。
- 私有仓库、涉及凭据的操作请使用直连。

---

## 11. 启动盘制作

### 11.1 准备

- 一个 USB/SD 卡（数据会被清空）。
- 墨绿OS Live 或任意 Linux ISO/IMG。
- Windows 管理员权限（当前版本）。

### 11.2 步骤

1. 插入 U 盘，点击「重新检测」。
2. 选择目标磁盘（系统盘、非可移动磁盘会被拒绝）。
3. 选择 ISO/IMG。
4. 选择模式：
   - **文件复制（FAT32）**：格式化后复制文件；部分 ISO 可能无法引导。
   - **RAW 直写**：逐字节写入，兼容性最好；会完全覆盖分区表。
5. 输入确认短语 `ERASE <磁盘号>`。
6. 点击「擦除并写入」，再次确认。
7. 完成后安全弹出，重启进入固件启动菜单选择 USB。

### 11.3 安全设计

- 拒绝系统盘 / 启动盘。
- 仅允许 USB/SD 等可移动磁盘。
- 需要管理员权限。
- 需要输入确认短语 + 二次确认。
- 写入过程显示进度，可请求取消（当前数据块完成后停止）。

> 不要对移动硬盘、唯一备份盘或不确定的磁盘执行 RAW 写入。

---

## 12. 设置与持久化

- **安装包规格**：全量 / 精简 / 极简，影响 Linux 软件包集合。
- **主题**：墨绿 / 松针 / 深海强调色；主色保持 #2A603B。
- **开机自启**：Windows 登录后启动。
- **关闭窗口最小化到托盘**：保留后台服务器与终端。
- **配置导出/导入**：JSON。
- **重置配置**：不会删除 Linux rootfs、隔离区或日志。
- **日志**：数据目录 `logs/`，自动轮转，保留 3 份。

配置写入采用“临时文件 + 原子替换”，并保留 `config.json.bak`。

---

## 13. 命令行

源码目录：

```bash
node cli/main.js status
node cli/main.js doctor
node cli/main.js scan D:\Projects
node cli/main.js serve D:\Share --port 8787
node cli/main.js usb
node cli/main.js github test
node cli/main.js linux
```

安装目录（Windows）：

```bat
resources\cli\molv.cmd status
```

安装目录（Linux）：

```bash
resources/cli/molv status
```

命令：

| 命令 | 作用 |
| --- | --- |
| `status` | 平台、数据目录、Linux、安装规格 |
| `doctor` | 权限、虚拟化、完整性 |
| `scan [目录]` | 本地规则扫描 |
| `serve [目录] --port 8787` | 只读文件服务器 |
| `usb` | 列出磁盘（Windows） |
| `github [test]` | 镜像状态 / 测速 |
| `linux [install]` | Linux 状态 / 安装 |

---

## 14. 故障排查

### 启动后立即退出

- 检查是否有另一个墨绿OS 实例在运行。
- 检查数据目录是否可写；程序会自动尝试备用目录。
- 查看 `%LOCALAPPDATA%\MolvOS\logs\main.log` 或程序目录 `MolvOS-Data\logs`。

### 安装 Linux 失败

- Windows：确认 WSL2 已启用；执行 `wsl --status`；必要时重启。
- 检查网络能否访问 `dl-cdn.alpinelinux.org`。
- 查看日志中的 `apk` 错误。
- 删除数据目录的 `linux/` 后重试（会丢失已安装环境）。

### 终端没有输出

- 确认 Linux 环境已安装。
- Windows 检查 `wsl -d MolvOS -u root` 是否可用。
- Android 检查 root 授权。
- 当前终端不是完整 PTY；某些交互式程序（vim、top 全屏）可能显示异常。

### 端口被占用

更换 1024–65535 之间的其他端口，或停止占用端口的程序。

### UPnP 失败

在路由器中手动转发端口；服务器仍可在局域网使用。

### 启动盘写入失败

- 确认以管理员身份运行。
- 确认 U 盘未被其他程序占用。
- 尝试 RAW 模式；文件复制模式对部分 ISO 不适用。
- 不要在虚拟机/远程桌面中制作启动盘。

### Android 无法安装 Linux

- 需要 root 与 su 授权。
- 未 root 请使用 Termux + proot-distro。
- 检查存储空间与网络。
- Alpine rootfs 下载地址：`https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/aarch64/`。

---

## 15. 卸载

### Windows Portable

删除程序文件与数据目录（默认 `%LOCALAPPDATA%\MolvOS` 或程序旁 `MolvOS-Data`）。

### Windows 安装版

使用“应用和功能”卸载，或运行安装目录的 `Uninstall MolvOS.exe`。

### Linux

```bash
sudo apt remove molv-os
rm -rf ~/.config/molv-os ~/.local/share/molv-os
```

### Android

卸载应用；chroot 环境随应用数据一起删除。

> 卸载不会自动删除你通过文件服务器共享的外部文件，也不会删除启动盘。

---

## 16. 许可与声明

MIT License。Windows、Android、Linux 是其各自权利人的商标；墨绿OS 与 Microsoft、Google、Linux 基金会无隶属关系。

本项目按“现状”提供，不承诺适销性或特定用途适用性。安装第三方软件、启用 root、制作启动盘、向公网暴露文件服务器均可能造成数据丢失或安全风险，请自行评估并备份。
