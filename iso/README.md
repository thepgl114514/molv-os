# 墨绿OS Live（基于 Alpine）

本目录用于构建可启动的墨绿OS Live 介质。当前仓库**不包含预构建 ISO**；请使用 Linux 主机或 GitHub Actions 生成后，再由桌面端「启动盘制作」写入 USB。

## 设计

- 基础：Alpine Linux `latest-stable`（x86_64）
- 启动：BIOS + UEFI（由 Alpine 官方 ISO 的 El Torito / GRUB 配置提供）
- 覆盖层：`overlay/` 中的 `/etc/motd`、`/etc/profile.d/molv.sh`、桌面快捷脚本
- 默认不自动安装到硬盘；`setup-alpine` 由用户手动执行
- 不包含闭源驱动、Wine、Android 模拟器或模型文件

## 在 Linux 上构建

依赖：`xorriso`、`curl`、`tar`、`gzip`、`squashfs-tools`。

```bash
sudo apt-get install -y xorriso squashfs-tools curl
./build-live.sh
```

脚本会：

1. 下载 Alpine 标准 ISO；
2. 解包；
3. 把 `overlay/` 写入 `apkovl` 或 `initramfs` 可读取的位置（按 Alpine 版本调整）；
4. 重新生成 ISO，输出 `dist/MolvOS-Live-0.1.0-x86_64.iso`；
5. 生成 SHA-256。

> 这是一个“品牌化 Live 环境”，不是自研发行版。内核、initramfs、apk 仓库均来自 Alpine。

## 在 GitHub Actions 中构建

在 `.github/workflows/` 中添加一个 `ubuntu-latest` job，安装 `xorriso` 后运行 `iso/build-live.sh`，上传 artifact。发布前请在至少一台真机上验证 BIOS 与 UEFI 启动。

## 写入 USB

Windows：打开墨绿OS →「启动盘制作」→ 选择 ISO → RAW → 输入 `ERASE <磁盘号>`。

Linux：

```bash
sudo dd if=dist/MolvOS-Live-0.1.0-x86_64.iso of=/dev/sdX bs=4M status=progress oflag=sync
```

> 确认 `/dev/sdX` 是 U 盘，不要写错磁盘。
