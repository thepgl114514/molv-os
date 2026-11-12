# 交付清单与验证状态

版本：0.1.0 青岚
主色：#2A603B
交付日期：2026-11-12

## 已生成的文件

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `安装包/MolvOS-0.1.0-Portable.exe` | 约 94 MB | Windows 单文件便携版（7z SFX） |
| `安装包/MolvOS-0.1.0-win-x64.zip` | 约 139 MB | Windows 免安装目录，解压运行 |
| `安装包/MolvOS-0.1.0-android.apk` | 约 0.6 MB | Android 8.0+，调试签名 |
| `安装包/MolvOS-0.1.0-linux-x64.tar.gz` | 约 116 MB | Linux x86_64，可执行权限已修正 |
| `安装包/molv-os_0.1.0_amd64.deb` | 约 116 MB | Debian / Ubuntu 包 |
| `源码/MolvOS-0.1.0-source.zip` | 约 13 MB | 源码、文档、Git 历史、构建脚本 |
| `程序/win-unpacked/` | 约 350 MB | 已解压的 Windows 应用，推荐直接运行 |
| `SHA256SUMS.txt` | — | 上述产物的 SHA-256 |

Windows 推荐启动方式：双击 `启动墨绿OS.cmd`，或运行 `程序/win-unpacked/MolvOS.exe`。

## 已验证

- Windows 打包应用可启动，界面正常渲染。
- 打包后的完整性校验 31/31 通过（`app.asar` 内文件，package.json 因打包器改写而排除）。
- 安装向导、总览、Linux、编译环境、任务管理器、合规扫描、文件服务器、GitHub 加速、启动盘、设置、关于页面均有截图。
- 合规扫描在临时目录命中 `.pem` 与 `secret-token.txt`，结果正确。
- 只读文件服务器在 127.0.0.1:8799 返回 200，目录索引正常，可停止。
- 任务管理器可读取 300+ 进程；首次采样约 1.5 秒。
- USB 磁盘枚举可读取系统磁盘并标记为禁止。
- Android APK 通过 `apksigner` 校验（v3），`aapt2 dump badging` 显示包名 `os.molv.app`、标签“墨绿OS”、minSdk 26、targetSdk 35。
- Android APK 的 assets 路径已规范为 `/`，包含 `classes.dex`、`integrity.json` 与 Web UI。
- Linux tar.gz 中 `molv-os` 权限为 755、`chrome-sandbox` 为 4755；deb 的 `data.tar.gz` 结构与权限正确。
- 配置持久化写入 `%LOCALAPPDATA%\MolvOS`，包含 `config.json` 与 `.bak`。

## 未验证 / 未完成

| 项目 | 原因 | 你需要做什么 |
| --- | --- | --- |
| Windows 上安装并运行 Linux 环境 | 本机未启用 WSL2，且当前会话无管理员权限 | 以管理员运行，启用 WSL2 并重启；或在有 WSL2 的机器上测试 |
| Android 真机安装与 root/chroot | 没有连接 Android 设备，也没有模拟器 | 侧载 APK，授予存储/通知；root 设备测试 Linux 安装 |
| Android 内置 Linux 下载 | 需要 root 与网络；未在真机验证 | 先确认 `su` 可用，再点击“安装环境” |
| 编译环境一键安装 | winget/apk 需要网络与管理员授权，未逐项安装 | 在目标机器上按需点击安装并查看输出 |
| Windows 单文件 Portable.exe | 在当前受控环境下启动异常/挂起（临时目录与 AppData 限制） | 优先使用 `程序/win-unpacked` 或 ZIP；普通 Windows 用户可尝试 Portable |
| 墨绿OS Live ISO | 本机没有 xorriso/mkisofs，未生成预构建 ISO | 在 Linux 运行 `iso/build-live.sh`，或使用 GitHub Actions 构建 |
| GitHub 推送 | 当前环境没有 GitHub 账号凭据，也没有 git/gh CLI 登录 | 创建空仓库，安装 Git 后 `git remote add origin <仓库>` 并 push；或把源码 ZIP 上传 |
| 商业代码签名 | 没有证书 | 自行购买证书并配置 electron-builder |

## GitHub 发布建议

本地 `.git` 已有提交（`main` 分支），源码 ZIP 也包含它。推荐：

```bash
cd molv-os
git remote add origin https://github.com/<你的账号>/molv-os.git
git push -u origin main
```

如果使用 GitHub CLI：

```bash
gh repo create molv-os --public --source=. --remote=origin --push
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

> 我没有你的 GitHub 凭据，因此没有执行 push，也没有声称已经上线。

## 重新构建

```powershell
npm install
node scripts/make-integrity.js
npx electron-builder --config electron-builder-win.yml --win portable --x64
npx electron-builder --config electron-builder-linux.yml --linux dir tar.gz --x64
node scripts/build-linux-tar.js
node scripts/build-deb.js
powershell -File android/build-apk.ps1
```

Android 构建需要 `.sdk/build-tools/35.0.0`、`.sdk/platforms/android-35/android.jar` 与 JDK。
