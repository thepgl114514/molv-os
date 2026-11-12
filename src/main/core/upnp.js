'use strict';

const dgram = require('dgram');
const os = require('os');
const { Logger } = require('./logger');

const log = new Logger('upnp');

function localAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue;
      let score = 1;
      if (net.address.startsWith('192.168.')) score = 4;
      else if (net.address.startsWith('10.')) score = 3;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(net.address)) score = 3;
      candidates.push({ address: net.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? candidates[0].address : null;
}

function parseHeaders(text) {
  const headers = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

async function discover(timeoutMs = 2600) {
  const locations = new Map();
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const query = [
    'M-SEARCH * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    'MAN: "ssdp:discover"',
    'MX: 2',
    'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1',
    '', '',
  ].join('\r\n');

  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; try { socket.close(); } catch (_) {} resolve(); } };
    socket.on('message', (msg) => {
      const text = msg.toString('utf8');
      const headers = parseHeaders(text);
      if (headers.location) locations.set(headers.location, headers);
    });
    socket.on('error', (err) => { log.warn('SSDP error', err); finish(); });
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.send(query, 1900, '239.255.255.250');
      } catch (err) {
        log.warn('SSDP send failed', err);
        finish();
      }
      setTimeout(finish, timeoutMs);
    });
  });

  for (const location of locations.keys()) {
    try {
      const res = await fetch(location, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const xml = await res.text();
      const base = new URL(location);
      const serviceBlocks = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
      for (const block of serviceBlocks) {
        const type = (block.match(/<serviceType>([^<]+)<\/serviceType>/i) || [])[1] || '';
        if (!/WAN(IP|PPP)Connection:\d/.test(type)) continue;
        const control = (block.match(/<controlURL>([^<]+)<\/controlURL>/i) || [])[1] || '';
        if (!control) continue;
        const controlUrl = new URL(control, base).toString();
        return {
          ok: true,
          location,
          serviceType: type,
          controlUrl,
          friendlyName: (xml.match(/<friendlyName>([^<]+)<\/friendlyName>/i) || [])[1] || '路由器',
          modelName: (xml.match(/<modelName>([^<]+)<\/modelName>/i) || [])[1] || '',
        };
      }
    } catch (err) {
      log.debug('gateway parse failed', location, err.message);
    }
  }
  return { ok: false, error: '未发现支持 UPnP 的路由器（可能未开启 UPnP 或网络被隔离）' };
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

async function soap(controlUrl, serviceType, action, body) {
  const res = await fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPAction: `"${serviceType}#${action}"`,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>${body}</s:Body>
</s:Envelope>`,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) {
    const code = (text.match(/<errorCode>([^<]+)<\/errorCode>/i) || [])[1];
    const desc = (text.match(/<errorDescription>([^<]+)<\/errorDescription>/i) || [])[1];
    throw new Error(`UPnP ${action} 失败 ${res.status}${code ? ` (${code} ${desc || ''})` : ''}`);
  }
  return text;
}

async function addMapping({ port, protocol = 'TCP', description = 'MolvOS Server', lease = 0 }) {
  const gateway = await discover();
  if (!gateway.ok) throw new Error(gateway.error);
  const client = localAddress();
  if (!client) throw new Error('没有可用的局域网 IPv4 地址');
  const body = `<u:AddPortMapping xmlns:u="${gateway.serviceType}">
    <NewRemoteHost></NewRemoteHost>
    <NewExternalPort>${Number(port)}</NewExternalPort>
    <NewProtocol>${protocol}</NewProtocol>
    <NewInternalPort>${Number(port)}</NewInternalPort>
    <NewInternalClient>${xmlEscape(client)}</NewInternalClient>
    <NewEnabled>1</NewEnabled>
    <NewPortMappingDescription>${xmlEscape(description)}</NewPortMappingDescription>
    <NewLeaseDuration>${Number(lease) || 0}</NewLeaseDuration>
  </u:AddPortMapping>`;
  await soap(gateway.controlUrl, gateway.serviceType, 'AddPortMapping', body);
  return { ok: true, gateway: gateway.friendlyName, externalPort: port, internalClient: client, protocol };
}

async function removeMapping({ port, protocol = 'TCP' }) {
  const gateway = await discover();
  if (!gateway.ok) throw new Error(gateway.error);
  const body = `<u:DeletePortMapping xmlns:u="${gateway.serviceType}">
    <NewRemoteHost></NewRemoteHost>
    <NewExternalPort>${Number(port)}</NewExternalPort>
    <NewProtocol>${protocol}</NewProtocol>
  </u:DeletePortMapping>`;
  await soap(gateway.controlUrl, gateway.serviceType, 'DeletePortMapping', body);
  return { ok: true };
}

module.exports = { discover, addMapping, removeMapping, localAddress };
