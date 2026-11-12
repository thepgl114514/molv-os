# Changelog

## 0.1.0 — 青岚

首个可运行版本，主色 #2A603B。

### Added

- Windows / Linux Electron 工作台
- Android WebView 应用与原生 Java 桥接
- WSL2 / Alpine rootfs / chroot / Termux 引导
- 八种编译环境检测与按需安装
- 首次运行向导：权限、完整性、虚拟化、Linux
- Windows adb 安装 APK、模拟器与 Android Studio 入口
- Android root 检测、Winlator 跳转
- 任务管理器与关键进程保护
- 本地合规扫描、隔离区、JSON 报告
- 只读文件服务器、目录索引、UPnP 端口映射
- GitHub 镜像测速、链接改写、git 配置
- USB 启动盘 RAW / FAT32 写入
- 中文 GUI、`molv` CLI
- 配置原子写入、备份、日志轮转
- 完整性清单与 SHA-256 校验

### Known limitations

- 不是自研内核或 Linux 发行版
- 未捆绑 Android 模拟器、Wine、Winlator 或模型
- 终端不是完整 PTY
- UPnP 依赖路由器
- 未做商业代码签名
- 部分受控 Windows 环境无法构建 NSIS 安装器，提供 Portable
