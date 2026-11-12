'use strict';

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'build', 'icon.png');
const png = fs.readFileSync(src);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0);
entry.writeUInt8(0, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), Buffer.concat([header, entry, png]));
console.log('icon.ico written');
