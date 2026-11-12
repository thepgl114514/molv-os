'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { run, powershell } = require('./exec');
const { isAdmin } = require('./platform');
const { Logger } = require('./logger');

const log = new Logger('usb');

function formatBytes(n) {
  if (!Number.isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

class UsbWriter extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.cancelled = false;
    this.running = false;
  }

  async listDisks() {
    if (process.platform !== 'win32') {
      return this.listLinuxDisks();
    }
    const script = `
$disks = Get-Disk -ErrorAction SilentlyContinue | ForEach-Object {
  $d = $_
  $vols = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue | ForEach-Object {
    $v = Get-Volume -Partition $_ -ErrorAction SilentlyContinue
    if ($v -and $v.DriveLetter) { [pscustomobject]@{ letter = "$($v.DriveLetter):"; label = $v.FileSystemLabel; fs = $v.FileSystem; size = $v.Size } }
  })
  [pscustomobject]@{
    number = $d.Number
    name = $d.FriendlyName
    size = $d.Size
    bus = $d.BusType
    system = [bool]$d.IsSystem
    boot = [bool]$d.IsBoot
    status = $d.OperationalStatus
    partitionStyle = $d.PartitionStyle
    volumes = @($vols)
  }
}
$disks | ConvertTo-Json -Depth 5 -Compress
`;
    const r = await powershell(script, { timeout: 25000 });
    if (!r.ok) throw new Error(`读取磁盘失败：${r.error || r.stderr}`);
    let disks = [];
    try {
      const parsed = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
      disks = Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      throw new Error(`磁盘数据解析失败：${err.message}`);
    }
    return disks.map((d) => ({
      ...d,
      sizeText: formatBytes(d.size),
      removable: /USB|SD|MMC/i.test(String(d.bus)),
      safe: !d.system && !d.boot,
      volumes: d.volumes || [],
    }));
  }

  async listLinuxDisks() {
    const r = await run('lsblk', ['-J', '-b', '-o', 'NAME,MODEL,SIZE,TYPE,RM,MOUNTPOINT'], { timeout: 15000 });
    if (!r.ok) throw new Error('读取磁盘失败：需要 util-linux（lsblk）');
    try {
      const data = JSON.parse(r.stdout);
      const out = [];
      for (const d of data.blockdevices || []) {
        if (d.type !== 'disk') continue;
        out.push({
          number: d.name, name: d.model || d.name, size: Number(d.size), sizeText: formatBytes(Number(d.size)),
          bus: d.rm === '1' || d.rm === true ? 'USB' : 'Disk', removable: d.rm === '1' || d.rm === true,
          system: false, boot: false, safe: Boolean(d.rm === '1' || d.rm === true), volumes: [],
        });
      }
      return out;
    } catch (err) {
      throw new Error(`磁盘数据解析失败：${err.message}`);
    }
  }

  async chooseIso() {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      title: '选择墨绿OS / Linux 镜像',
      filters: [{ name: '光盘镜像', extensions: ['iso', 'img'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const file = result.filePaths[0];
    const stat = fs.statSync(file);
    this.store.set('usb.lastImage', file);
    return { path: file, name: path.basename(file), size: stat.size, sizeText: formatBytes(stat.size) };
  }

  verifyTarget(disks, diskNumber, iso) {
    const disk = disks.find((d) => String(d.number) === String(diskNumber));
    if (!disk) throw new Error('找不到目标磁盘');
    if (disk.system || disk.boot) throw new Error('目标磁盘是系统盘，已阻止写入');
    if (!disk.safe) throw new Error('目标磁盘被标记为系统/启动盘，已阻止写入');
    if (!disk.removable) throw new Error('目标不是可移动磁盘。为防止数据丢失，仅允许写入 USB / SD 设备');
    if (!iso || !fs.existsSync(iso)) throw new Error('镜像文件不存在');
    const isoSize = fs.statSync(iso).size;
    if (isoSize < 1024 * 1024) throw new Error('镜像文件异常（小于 1 MB）');
    if (isoSize > disk.size) throw new Error(`镜像 ${formatBytes(isoSize)} 大于目标磁盘 ${formatBytes(disk.size)}`);
    return { disk, isoSize };
  }

  async write(options = {}) {
    if (this.running) throw new Error('已有启动盘写入任务正在进行');
    if (process.platform !== 'win32') throw new Error('启动盘写入目前仅支持 Windows 桌面端；Linux 请使用 dd 命令');
    const admin = await isAdmin();
    if (!admin) throw new Error('制作启动盘需要管理员权限。请点击“以管理员重启”后重试');
    const disks = await this.listDisks();
    const { disk, isoSize } = this.verifyTarget(disks, options.diskNumber, options.isoPath);
    const expected = `ERASE ${disk.number}`;
    if (options.confirm !== expected) throw new Error(`请输入完整的确认短语：${expected}`);
    this.running = true;
    this.cancelled = false;
    try {
      if (options.mode === 'raw') return await this.writeRaw(disk, options.isoPath, isoSize);
      return await this.writeCopy(disk, options.isoPath);
    } finally {
      this.running = false;
    }
  }

  async dismount(diskNumber) {
    const script = `
$parts = Get-Partition -DiskNumber ${Number(diskNumber)} -ErrorAction SilentlyContinue
foreach ($p in $parts) {
  if ($p.DriveLetter) {
    fsutil volume dismount "$($p.DriveLetter):" 2>&1 | Out-Null
  }
}
`;
    return powershell(script, { timeout: 60000 });
  }

  async writeRaw(disk, isoPath, isoSize) {
    await this.dismount(disk.number);
    const device = `\\\\.\\PhysicalDrive${disk.number}`;
    let fd;
    try {
      fd = fs.openSync(device, 'r+');
    } catch (err) {
      throw new Error(`无法打开目标磁盘：${err.message}。请确认已以管理员身份运行，且磁盘未被占用`);
    }
    const source = fs.createReadStream(isoPath, { highWaterMark: 4 * 1024 * 1024 });
    let written = 0;
    let last = 0;
    try {
      for await (const chunk of source) {
        if (this.cancelled) throw new Error('用户已取消写入');
        let offset = 0;
        while (offset < chunk.length) {
          const n = fs.writeSync(fd, chunk, offset, chunk.length - offset, null);
          offset += n;
          written += n;
        }
        const now = Date.now();
        if (now - last > 300) {
          last = now;
          this.emit('progress', { percent: Math.round((written / isoSize) * 100), written, total: isoSize, text: `写入 ${formatBytes(written)} / ${formatBytes(isoSize)}`, mode: 'raw' });
        }
      }
      fs.fsyncSync(fd);
    } finally {
      try { fs.closeSync(fd); } catch (_) {}
    }
    this.store.set('usb.lastImage', isoPath);
    return { ok: true, mode: 'raw', disk: disk.number, bytes: written, message: `镜像已写入磁盘 ${disk.number}。请安全弹出后从 USB 启动。` };
  }

  async writeCopy(disk, isoPath) {
    const admin = await isAdmin();
    if (!admin) throw new Error('需要管理员权限');
    const volume = (disk.volumes || []).find((v) => v.letter);
    if (!volume) throw new Error('目标磁盘没有可用的盘符。请先在磁盘管理中创建 FAT32 分区');
    const letter = volume.letter.replace(':', '');
    const script = `
$ErrorActionPreference = 'Stop'
Format-Volume -DriveLetter ${letter} -FileSystem FAT32 -NewFileSystemLabel 'MOLVOS' -Confirm:$false | Out-Null
$mount = Mount-DiskImage -ImagePath '${isoPath.replace(/'/g, "''")}' -PassThru
try {
  $vol = Get-Volume -DiskImage $mount | Where-Object DriveLetter | Select-Object -First 1
  if (-not $vol) { throw '无法读取镜像卷' }
  $src = "$($vol.DriveLetter):\\"
  $dst = "${letter}:\\"
  Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
} finally {
  Dismount-DiskImage -ImagePath '${isoPath.replace(/'/g, "''")}' | Out-Null
}
`;
    const r = await powershell(script, { timeout: 45 * 60 * 1000 });
    if (!r.ok) throw new Error(`复制模式失败：${(r.stderr || r.error || '').slice(0, 1200)}`);
    return { ok: true, mode: 'copy', disk: disk.number, letter, message: '文件已复制到启动盘。部分 Linux 镜像使用文件复制模式可能无法引导，建议优先使用 RAW 模式。' };
  }

  cancel() {
    if (!this.running) return { ok: true, message: '没有正在进行的写入' };
    this.cancelled = true;
    return { ok: true, message: '已请求取消，将在当前数据块完成后停止' };
  }

  status() {
    return { running: this.running, lastImage: this.store.get('usb.lastImage'), mode: this.store.get('usb.mode', 'copy') };
  }
}

module.exports = { UsbWriter, formatBytes };
