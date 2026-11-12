'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const UI = window.MolvUI;
  if (!UI) {
    document.body.innerHTML = '<div style="padding:40px;color:#ffb4ae;font-family:sans-serif">界面初始化失败：ui.js 未加载。</div>';
    return;
  }
  UI.bind();
  UI.start();
});
