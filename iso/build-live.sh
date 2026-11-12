#!/usr/bin/env bash
# 构建墨绿OS Live ISO（基于 Alpine 官方 ISO 的轻量品牌化）
# 该脚本需要在 Linux 上运行，并安装 xorriso、squashfs-tools、curl。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ISO_DIR="$ROOT/iso"
OUT="$ROOT/dist/MolvOS-Live-0.1.0-x86_64.iso"
WORK="$ISO_DIR/work"
ALPINE_BRANCH="${ALPINE_BRANCH:-v3.20}"
ALPINE_VER="${ALPINE_VER:-3.20.3}"
BASE="https://dl-cdn.alpinelinux.org/alpine/$ALPINE_BRANCH/releases/x86_64/alpine-standard-$ALPINE_VER-x86_64.iso"

mkdir -p "$ROOT/dist"
rm -rf "$WORK"
mkdir -p "$WORK/iso"

echo "== download $BASE =="
curl -fL "$BASE" -o "$WORK/alpine.iso"
xorriso -osirrox on -indev "$WORK/alpine.iso" -extract / "$WORK/iso"

# 写入品牌覆盖层。Alpine 的 apkovl 机制会在启动时解包 .apkovl.tar.gz。
# 这里使用最保守的方式：直接放入 ISO 根目录，供用户手动挂载/复制。
mkdir -p "$WORK/iso/molvos"
cp -a "$ISO_DIR/overlay/." "$WORK/iso/molvos/"
cat > "$WORK/iso/molvos/README.txt" <<'EOF'
墨绿OS Live（Alpine 基础）
1. 启动后以 root 登录（默认无密码，仅 Live 环境）。
2. 运行 setup-alpine 安装到硬盘，或直接使用 /molvos/overlay 中的脚本。
3. 本项目不修改 Alpine 内核；品牌化仅涉及启动菜单与覆盖文件。
EOF

# 修改启动菜单标题（若存在）
if [ -f "$WORK/iso/boot/grub/grub.cfg" ]; then
  sed -i 's/Alpine Linux/墨绿OS Live (Alpine)/g' "$WORK/iso/boot/grub/grub.cfg"
fi
if [ -f "$WORK/iso/boot/syslinux/syslinux.cfg" ]; then
  sed -i 's/Alpine Linux/墨绿OS Live (Alpine)/g' "$WORK/iso/boot/syslinux/syslinux.cfg"
fi

xorriso -as mkisofs \
  -o "$OUT" \
  -isohybrid-mbr "$WORK/iso/boot/syslinux/isohdpfx.bin" \
  -c "$WORK/iso/boot/syslinux/boot.cat" \
  -b "$WORK/iso/boot/syslinux/isolinux.bin" \
  -no-emul-boot -boot-load-size 4 -boot-info-table \
  -eltorito-alt-boot -e "$WORK/iso/boot/grub/efi.img" -no-emul-boot \
  -isohybrid-gpt-basdat \
  "$WORK/iso"

sha256sum "$OUT" | tee "$OUT.sha256"
echo "Live ISO: $OUT"
