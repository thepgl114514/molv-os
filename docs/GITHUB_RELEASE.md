# GitHub Release 说明（v0.1.0 青岚）

## 墨绿OS 0.1.0

第一个可运行版本。主色 #2A603B。

### 包含

- Windows 便携版 / ZIP
- Android APK（调试签名，Android 8.0+）
- Linux tar.gz / deb
- 使用说明书、架构、安全与宣传文档
- SHA-256 校验文件

### 功能

- Linux 环境：WSL2 / chroot / proot / 原生
- 八种编译环境：C/C++、Python、Java、Node.js、Go、Rust、PHP、Ruby
- 首次运行权限 / 完整性 / 虚拟化 / Linux 安装向导
- Windows 通过 adb 安装 APK；Android 检测 root 与 Winlator
- 任务管理器、合规扫描、只读文件服务器、UPnP
- GitHub 镜像测速与链接改写
- 启动盘制作（RAW / FAT32）
- 中文 GUI + CLI
- 配置原子写入与备份

### 已知限制

- 不是自研内核或发行版；Live 环境基于 Alpine。
- 不捆绑 Android 模拟器、Wine、Winlator、模型文件。
- 终端不是完整 PTY。
- UPnP 取决于路由器。
- 未做商业代码签名；SmartScreen 可能提示。
- NSIS 安装器在部分受控 Windows 环境构建失败，发布以 Portable 为准。

### 校验

```powershell
Get-FileHash .\MolvOS-0.1.0-Portable.exe -Algorithm SHA256
```

或：

```bash
sha256sum -c SHA256SUMS.txt
```

### 安装

- Windows：运行 Portable，或解压 ZIP。
- Android：侧载 APK，允许未知来源；root 可选。
- Linux：解压后运行 `./MolvOS`，或安装 deb。

### 反馈

请附上平台、版本、日志（`logs/main.log`）与复现步骤。安全漏洞请走私密渠道。

---

## 发布命令（维护者）

```bash
npm run make:integrity
npx electron-builder --win portable --x64
npx electron-builder --linux dir tar.gz --x64
powershell -File android/build-apk.ps1
# 生成 deb（脚本见 scripts/build-deb.ps1）
# 生成 SHA256SUMS.txt
```

使用 GitHub CLI：

```bash
gh release create v0.1.0 \
  dist/MolvOS-0.1.0-Portable.exe \
  dist/MolvOS-0.1.0-win-x64.zip \
  dist/MolvOS-0.1.0-android.apk \
  dist/MolvOS-0.1.0-linux-x64.tar.gz \
  dist/molv-os_0.1.0_amd64.deb \
  dist/SHA256SUMS.txt \
  --title "墨绿OS 0.1.0 · 青岚" \
  --notes-file docs/GITHUB_RELEASE.md
```

> 发布前请确认没有把 `.sdk/`、`node_modules/`、`dist/win-unpacked/`、个人数据目录或调试密钥提交到仓库。
