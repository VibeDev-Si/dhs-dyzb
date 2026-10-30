(() => {
  const DEFAULTS = { server: 'http://127.0.0.1:8787', enabled: true };
  const $ = (id) => document.getElementById(id);

  function renderStat(s) {
    const el = $('stat');
    if (!s) {
      el.innerHTML = '还没连上过服务。<br><span class="warn">先在直播间页面刷新一下。</span>';
      return;
    }
    el.innerHTML = `
      地址：<b>${s.server}</b><br />
      已上报：<b>${s.caught || 0}</b> 条　已回写：<b>${s.sent || 0}</b> 条<br />
      ${s.lastError ? `<span class="warn">最近错误：${s.lastError}</span>` : '状态正常'}
    `;
  }

  chrome.storage.local.get({ ...DEFAULTS, stats: null }, (v) => {
    $('server').value = v.server;
    $('enabled').checked = v.enabled !== false;
    renderStat(v.stats);
  });

  $('save').onclick = () => {
    const server = $('server').value.trim().replace(/\/+$/, '') || DEFAULTS.server;
    const enabled = $('enabled').checked;
    chrome.storage.local.set({ server, enabled }, () => {
      $('save').textContent = '已保存 ✓';
      setTimeout(() => ($('save').textContent = '保存设置'), 1200);
    });
  };
})();
