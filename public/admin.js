(() => {
  const $ = (id) => document.getElementById(id);
  const money = (n) => '¥' + Number(n || 0).toFixed(2);
  const int = (n) => Number(n || 0).toLocaleString('zh-CN');

  let gifts = [];
  let cfg = null;

  async function api(path, body, method = 'POST') {
    const res = await fetch(path, {
      method: method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function setConn(ok, text) {
    const el = $('conn');
    el.className = 'pill ' + (ok ? 'ok' : 'bad');
    el.textContent = text;
  }

  function render(cfgData, stats) {
    $('stats').innerHTML = [
      ['今日收', money(stats.income)],
      ['今日 token 花费', money(stats.spent)],
      ['今日 token', `${int(stats.tokensToday)}`],
      ['累计 token', `${int(stats.tokensLifetime)}`],
      ['账户余额', cfgData.ai.hasKey ? (stats.__balance || '—') : '未绑定 Key'],
      ['回复数', `${stats.replies} 条`],
      ['进房', `${stats.entries} 人`],
      ['白饭余额', `${Number(stats.rice).toFixed(2)} 碗`],
    ]
      .map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`)
      .join('');
  }

  function renderOutbox(items) {
    const ul = $('outbox');
    if (!items.length) {
      ul.innerHTML = '<li>还没有要发的消息</li>';
      return;
    }
    ul.innerHTML = items
      .map(
        (it) =>
          `<li><span class="tag ${it.status}">${it.status}</span><span>${escapeHtml(it.text)}</span><span class="time">${new Date(it.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}</span></li>`,
      )
      .join('');
  }

  function renderLog(events) {
    const ul = $('log');
    ul.innerHTML = (events || [])
      .slice(-40)
      .reverse()
      .map((e) => {
        const tag = e.kind;
        const body =
          e.kind === 'gift'
            ? `送出 ${e.gift?.name || ''} ×${e.gift?.count || 1}`
            : e.kind === 'enter'
              ? '来了'
              : escapeHtml(e.text || '');
        return `<li><span class="tag ${tag}">${tag}</span><span><b>${escapeHtml(e.username)}</b> ${body}</span><span class="time">${new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span></li>`;
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fillConfig(c) {
    cfg = c;
    if (document.activeElement !== $('apiKey')) {
      $('apiKey').value = '';
      $('apiKey').placeholder = c.ai.hasKey ? '已保存（留空则不改）' : 'sk-...';
    }
    $('model').value = c.ai.model;
    if (document.activeElement !== $('fallbackModel')) $('fallbackModel').value = c.ai.fallbackModel || '';
    if (document.activeElement !== $('backupBase')) $('backupBase').value = c.ai.backup?.baseUrl || '';
    if (document.activeElement !== $('backupModel')) $('backupModel').value = c.ai.backup?.model || '';
    if (document.activeElement !== $('backupKey')) {
      $('backupKey').value = '';
      $('backupKey').placeholder = c.ai.backup?.hasKey ? '已保存（留空则不改）' : '备用 Key';
    }
    if (document.activeElement !== $('voMinimaxKey')) {
      $('voMinimaxKey').value = '';
      $('voMinimaxKey').placeholder = c.voice?.minimaxHasKey ? '已保存（留空则不改）' : '粘贴 MiniMax API Key';
    }
    paintMinimaxKeyState(c.voice?.minimaxHasKey);
    $('autoReply').checked = Boolean(c.reply?.auto);
    gifts = c.gifts || [];
    const sel = $('tGift');
    if (sel.options.length === 0) {
      sel.innerHTML = gifts.map((g) => `<option value="${g.name}">${g.emoji || '🎁'} ${g.name}（${g.price} 元）</option>`).join('');
    }
    $('srvAddr').textContent = location.origin;
  }

  async function refresh() {
    try {
      const d = await api('/api/state', null, 'GET');
      setConn(true, '服务已连接');
      fillConfig(d.config);
      fillNovel(d.config, d.story);
      const st = { ...d.stats };
      st.__balance = d.balance && typeof d.balance.total === 'number' ? money(d.balance.total) : '—';
      render(d.config, st);
      renderBoard(d);
      renderLog(d.events);
      if (d.aiError) {
        $('aiHealth').className = 'result show warn';
        $('aiHealth').textContent = `上次 AI 没接上：${d.aiError}`;
      } else if ($('aiHealth').classList.contains('warn')) {
        $('aiHealth').className = 'result show';
        $('aiHealth').textContent = 'AI 接口正常。';
      }
      const ob = await api('/api/outbox', null, 'GET');
      renderOutbox(ob.all || []);
    } catch (err) {
      setConn(false, '连不上服务');
    }
  }

  // ---- 小说朗读 ----
  let nvState = null;
  let nvFiles = [];

  async function loadNovels() {
    const d = await api('/api/novel/list', null, 'GET');
    nvFiles = d.novels || [];
    const sel = $('nvFile');
    const keep = sel.value;
    sel.innerHTML = '';
    for (const n of nvFiles) {
      const opt = document.createElement('option');
      opt.value = n.name;
      opt.textContent = `${n.title} · ${n.chapters} 章 · ${n.chars} 字${n.day ? ' · 今天' : ''}`;
      sel.appendChild(opt);
    }
    if (keep && nvFiles.some((n) => n.name === keep)) sel.value = keep;
    if (!nvFiles.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '短篇目录里还没有小说';
      sel.appendChild(opt);
    }
    return nvFiles;
  }

  function renderArchiveBox(a) {
    const box = $('nvArchive');
    if (!a) {
      box.textContent = '还没读完。整本念完会自动生成世界观、人物、优点、短板和想问观众的问题。';
      return;
    }
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const part = (title, body) => (body ? `<h4>${esc(title)}</h4>${body}` : '');
    const chars = (a.characters || [])
      .map((c) => `<p><b>${esc(c.name)}</b>${c.role ? ` · ${esc(c.role)}` : ''}${c.note ? `：${esc(c.note)}` : ''}</p>`)
      .join('');
    const list = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
    box.innerHTML = [
      part('世界观', a.world ? `<p>${esc(a.world)}</p>` : ''),
      part('人物', chars),
      part('主题', a.themes?.length ? `<ul>${list(a.themes)}</ul>` : ''),
      part('写得好的地方', a.highlights?.length ? `<ul>${list(a.highlights)}</ul>` : ''),
      part('可以更好的地方', a.flaws?.length ? `<ul>${list(a.flaws)}</ul>` : ''),
      part('想问问你们', a.questions?.length ? `<ul>${list(a.questions)}</ul>` : ''),
    ].join('');
  }

  function renderTopics(topics) {
    const ol = $('nvTopics');
    ol.innerHTML = '';
    if (!topics?.length) {
      ol.innerHTML = '<li class="hint">还没有人选。弹幕里发「选题 XXX」就会出现在这里。</li>';
      return;
    }
    for (const t of topics) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${t.count}</b> 票 · ${String(t.text || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}${
        t.users?.length ? ` <span class="hint">（${t.users.slice(0, 4).join('、')}）</span>` : ''
      }`;
      ol.appendChild(li);
    }
  }

  function fillNovel(c, s) {
    if (c?.novel) {
      if (document.activeElement !== $('nvDir')) $('nvDir').value = c.novel.dir || '短篇';
      if (document.activeElement !== $('nvBreakSec')) $('nvBreakSec').value = c.novel.breakSec ?? 300;
      if (document.activeElement !== $('nvStartAt')) $('nvStartAt').value = c.novel.startAt || '';
      $('nvAutoStart').checked = c.novel.autoStart !== false;
      $('nvEnabled').checked = c.novel.enabled !== false;
      $('nvAuto').checked = Boolean(s?.auto);
    }
    nvState = s || null;
    if (!s) return;
    const lines = [
      `阶段：${s.phaseLabel || s.phase}${s.startAt ? ` · ${s.startAt} 开讲${s.autoStart ? '（自动）' : '（手动）'}` : ''}`,
      `${s.title ? `《${s.title}》` : '（还没选小说）'}${
        s.chapterCount ? ` · 第 ${Math.min((s.chapterIndex || 0) + 1, s.chapterCount)} / ${s.chapterCount} 章` : ''
      }${s.chapter && s.chapter !== s.title ? ` · ${s.chapter}` : ''}`,
      s.phase === 'break' && s.countdown ? `休息还剩 ${s.countdown}` : '',
      s.phase === 'reading' ? `正在念：${(s.chars || 0)} 字${s.audioUrl ? ' · 音频已合成' : ' · 还没合成音频'}` : '',
      s.phase === 'idle' && s.nextStartAt
        ? `距离开讲还有 ${Math.max(0, Math.round((s.nextStartAt - Date.now()) / 60000))} 分钟`
        : '',
      s.charTotal ? `全书 ${s.charTotal} 字` : '',
      s.audioError ? `音频出错：${s.audioError}` : '',
    ];
    $('nvState').className = 'result show';
    $('nvState').textContent = lines.filter(Boolean).join('\n');
    renderArchiveBox(s.archive);
    renderTopics(s.topics);
  }

  $('nvSaveStart').onclick = async () => {
    try {
      const startAt = ($('nvStartAt').value || '').trim();
      await api('/api/novel/config', { startAt, autoStart: $('nvAutoStart').checked });
      $('nvResult').className = 'result show';
      $('nvResult').textContent = startAt
        ? `已设为 ${startAt} 开讲${$('nvAutoStart').checked ? '（到点自动开始）' : '（到点只提醒，需要手动开始）'}，开讲前 5 分钟会提醒观众。`
        : '已取消定时，现在打开就会开始念。';
      await refresh();
    } catch (err) {
      $('nvResult').className = 'result show warn';
      $('nvResult').textContent = '保存失败：' + err.message;
    }
  };

  $('nvSaveCfg').onclick = async () => {
    try {
      await api('/api/config', {
        novel: {
          dir: $('nvDir').value.trim() || '短篇',
          breakSec: Number($('nvBreakSec').value) || 300,
          enabled: $('nvEnabled').checked,
        },
      });
      await api('/api/novel/config', {
        dir: $('nvDir').value.trim() || '短篇',
        breakSec: Number($('nvBreakSec').value) || 300,
        enabled: $('nvEnabled').checked,
      });
      $('nvResult').className = 'result show';
      $('nvResult').textContent = '设置已保存。';
      await refresh();
    } catch (err) {
      $('nvResult').className = 'result show warn';
      $('nvResult').textContent = '保存失败：' + err.message;
    }
  };

  $('nvRefresh').onclick = async () => {
    try {
      const list = await loadNovels();
      $('nvResult').className = 'result show';
      $('nvResult').textContent = list.length ? `找到 ${list.length} 本。` : '短篇目录里还没有小说。';
    } catch (err) {
      $('nvResult').className = 'result show warn';
      $('nvResult').textContent = '读取失败：' + err.message;
    }
  };

  $('nvStart').onclick = async () => {
    const file = $('nvFile').value;
    if (!file) return alert('先挑一本小说');
    $('nvResult').className = 'result show';
    $('nvResult').textContent = '正在开始…';
    try {
      const d = await api('/api/novel/start', { file });
      $('nvResult').textContent = d.ok ? `开始念《${d.story?.title || file}》。` : `没开始：${d.error || '未知原因'}`;
      await refresh();
    } catch (err) {
      $('nvResult').textContent = '没开始：' + err.message;
    }
  };

  $('nvNext').onclick = async () => {
    try {
      const d = await api('/api/novel/next', {});
      $('nvResult').className = 'result show';
      $('nvResult').textContent = d.phase === 'afterword' ? '整本念完了，正在生成作品档案。' : '跳到下一章。';
      await refresh();
    } catch (err) {
      $('nvResult').textContent = '跳章失败：' + err.message;
    }
  };

  $('nvAdvance').onclick = async () => {
    try {
      await api('/api/novel/advance', {});
      $('nvResult').className = 'result show';
      $('nvResult').textContent = '这一章算念完了，开始休息。';
      await refresh();
    } catch (err) {
      $('nvResult').textContent = '推进失败：' + err.message;
    }
  };

  $('nvStop').onclick = async () => {
    await api('/api/novel/stop', {});
    await refresh();
  };

  $('nvReset').onclick = async () => {
    const file = $('nvFile').value;
    if (!file) return alert('先挑一本小说');
    if (!confirm(`从头念《${file}》？已经念完的章节会重来。`)) return;
    await api('/api/novel/reset', { file });
    await refresh();
  };

  $('nvEnabled').onchange = () => $('nvSaveCfg').click();
  $('nvAuto').onchange = async () => {
    await api('/api/novel/auto', { auto: $('nvAuto').checked });
    await refresh();
  };

  $('nvTopicAdd').onclick = async () => {
    const text = $('nvTopic').value.trim();
    if (!text) return;
    await api('/api/novel/topics', { text, user: '操作台' });
    $('nvTopic').value = '';
    await refresh();
  };

  // ---- 事件绑定 ----
  $('saveKey').onclick = async () => {
    const key = $('apiKey').value.trim();
    const patch = { ai: { model: $('model').value } };
    if (key) patch.ai.apiKey = key;
    try {
      const d = await api('/api/config', patch);
      fillConfig(d.config);
      $('aiResult').className = 'result show';
      $('aiResult').textContent = key ? '已保存 Key，正在查余额…' : '模型已更新';
      await refresh();
      $('refreshBalance').click();
    } catch (err) {
      $('aiResult').className = 'result show';
      $('aiResult').textContent = '保存失败：' + err.message;
    }
  };

  $('autoReply').onchange = async () => {
    await api('/api/config', { reply: { auto: $('autoReply').checked } });
  };

  // 备用模型 / 备用接口：主模型 503 时自动顶上
  $('saveFallback').onclick = async () => {
    try {
      const d = await api('/api/config', { ai: { fallbackModel: $('fallbackModel').value.trim() } });
      fillConfig(d.config);
      $('aiHealth').className = 'result show';
      $('aiHealth').textContent = $('fallbackModel').value.trim()
        ? `备用模型已设为 ${$('fallbackModel').value.trim()}`
        : '备用模型已清空（只重试主模型）';
    } catch (err) {
      $('aiHealth').className = 'result show';
      $('aiHealth').textContent = '保存失败：' + err.message;
    }
  };

  $('saveBackup').onclick = async () => {
    const patch = {
      ai: {
        backup: {
          baseUrl: $('backupBase').value.trim(),
          model: $('backupModel').value.trim(),
        },
      },
    };
    const key = $('backupKey').value.trim();
    if (key) patch.ai.backup.apiKey = key;
    try {
      const d = await api('/api/config', patch);
      fillConfig(d.config);
      $('aiHealth').className = 'result show';
      $('aiHealth').textContent = patch.ai.backup.baseUrl && (d.config.ai.backup?.hasKey || key)
        ? '备用接口已保存'
        : '备用接口已清空';
    } catch (err) {
      $('aiHealth').className = 'result show';
      $('aiHealth').textContent = '保存失败：' + err.message;
    }
  };

  $('testAi').onclick = async () => {
    $('aiResult').className = 'result show';
    $('aiResult').textContent = '请求中…';
    try {
      const d = await api('/api/ai/test', {});
      $('aiResult').textContent = `回复：${d.text}\n${d.prompt || ''}token 输入 ${d.usage?.prompt_tokens || 0} / 输出 ${d.usage?.completion_tokens || 0}，这次花了 ${money(d.cost)}（${d.peak ? '高峰价' : '空闲价'}），${d.ms}ms`;
    } catch (err) {
      $('aiResult').textContent = '失败：' + err.message;
    }
  };

  // ---- 弹幕直连 ----
  const dmState = {
    off: '没连接',
    connecting: '正在连…',
    live: '已连上，正在收弹幕',
    waiting: '还没开播，等开播自动连',
    reconnecting: '断线重连中…',
    error: '连不上',
  };

  function paintDanmaku(d) {
    if (!d) return;
    const line = dmState[d.state] || d.state;
    const bits = [`状态：${line}`];
    if (d.webRid) bits.push(`房间 ${d.webRid}`);
    if (d.roomId && d.roomId !== d.webRid) bits.push(`会话 ${d.roomId.slice(-6)}`);
    if (d.title) bits.push(d.title.slice(0, 18));
    if (d.messages) bits.push(`已收 ${d.messages} 条`);
    if (d.hasCookie) bits.push('带登录态');
    if (d.lastError) bits.push(d.lastError);
    const box = $('dmResult');
    if (!box) return;
    box.className = 'result show';
    box.textContent = bits.join(' · ');
    if (document.activeElement !== $('dmRoom') && d.savedRoomId) $('dmRoom').value = d.savedRoomId;
  }

  if ($('dmConnect')) {
    $('dmCookieSave').onclick = async () => {
      const cookie = $('dmCookie').value.trim();
      if (!cookie) return alert('先把浏览器里那一整行 Cookie 粘进来');
      try {
        await api('/api/config', { patch: { danmaku: { cookie } } });
        $('dmCookie').value = '';
        $('dmResult').className = 'result show';
        $('dmResult').textContent = 'Cookie 已保存（会重连一次弹幕通道），礼物消息需要它。';
        setTimeout(loadDanmaku, 1200);
      } catch (err) {
        $('dmResult').textContent = '保存失败：' + err.message;
      }
    };
    $('dmCookieClear').onclick = async () => {
      try {
        await api('/api/config', { patch: { danmaku: { cookie: '' } } });
        $('dmResult').className = 'result show';
        $('dmResult').textContent = 'Cookie 已清除。';
        setTimeout(loadDanmaku, 800);
      } catch (err) {
        $('dmResult').textContent = '清除失败：' + err.message;
      }
    };

    $('dmConnect').onclick = async () => {
      const rid = $('dmRoom').value.trim();
      if (!rid) return alert('先填直播间号');
      $('dmResult').className = 'result show';
      $('dmResult').textContent = '正在连接…';
      try {
        const d = await api('/api/danmaku/connect', { roomId: rid });
        paintDanmaku(d.danmaku);
      } catch (err) {
        $('dmResult').textContent = '连接失败：' + err.message;
      }
    };
    $('dmDisconnect').onclick = async () => {
      try {
        const d = await api('/api/danmaku/disconnect', {});
        paintDanmaku(d.danmaku);
      } catch (err) {
        $('dmResult').textContent = '断开失败：' + err.message;
      }
    };
  }

  $('sendChat').onclick = async () => {
    const username = $('tName').value.trim() || '测试观众';
    const text = $('tText').value.trim();
    if (!text) return;
    try {
      await api('/api/event', { kind: 'chat', username, text, source: 'admin' });
      $('tText').value = '';
    } catch (err) {
      alert(err.message);
    }
  };

  $('sendGift').onclick = async () => {
    try {
      await api('/api/event', {
        kind: 'gift',
        username: $('tName').value.trim() || '测试观众',
        giftName: $('tGift').value,
        count: Number($('tCount').value) || 1,
        source: 'admin',
      });
    } catch (err) {
      alert(err.message);
    }
  };

  $('sendEnter').onclick = async () => {
    await api('/api/event', { kind: 'enter', username: $('tName').value.trim() || '测试观众', source: 'admin' });
  };

  $('resetLive').onclick = async () => {
    if (!confirm('清空直播画面上的所有弹幕和点歌队列？（小说进度、礼物收益、token 统计都保留）')) return;
    $('resetLiveHint').textContent = '正在清场…';
    try {
      const d = await api('/api/session/boot', {});
      const c = d.cleared || {};
      $('resetLiveHint').textContent = `已重置：清掉 ${c.song || 0} 首在播/排队、${c.events || 0} 条弹幕、${c.outbox || 0} 条发送箱、${c.replies || 0} 条待回复。`;
      await refresh();
    } catch (err) {
      $('resetLiveHint').textContent = '重置失败：' + err.message;
    }
  };

  $('sendSay').onclick = async () => {
    const text = $('sayText').value.trim();
    if (!text) return;
    await api('/api/say', { text });
    $('sayText').value = '';
  };

  $('refreshBalance').onclick = async () => {
    const d = await api('/api/balance?force=1', null, 'GET');
    if (d.balance) alert(`余额：${money(d.balance.total)} ${d.balance.currency}` + (d.balance.error ? `\n错误：${d.balance.error}` : ''));
    else alert('还没填 Key，查不了余额');
  };

  $('nextSong').onclick = async () => {
    const d = await api('/api/song/next', {});
    alert(d.song ? `切到《${d.song.title}》` : '队列空了');
  };

  $('resetDay').onclick = async () => {
    if (!confirm('清空今天的统计（礼物图鉴和累计 token 保留）？')) return;
    await api('/api/reset', {});
  };

  /* ---------- 三个分区 ---------- */
  const TABS = ['basic', 'story', 'board'];
  function switchTab(name) {
    if (!TABS.includes(name)) name = 'basic';
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.pane === name));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));
    try {
      localStorage.setItem('dfy.admin.tab', name);
    } catch {
      /* 隐私模式无所谓 */
    }
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.pane);
  });

  /* ---------- 声音：音乐音量 + 大肥鱼音量 ---------- */
  const pct = (v) => `${Math.round(Number(v) * 100)}%`;
  const VOICE_ENGINES = {
    'sapi:sapi': { engine: 'sapi', preset: '' },
    'minimax:cuteGirl': { engine: 'minimax', preset: 'cuteGirl' },
    'minimax:lyrical': { engine: 'minimax', preset: 'lyrical' },
    'edge:natural': { engine: 'edge', preset: 'natural' },
    'edge:warm': { engine: 'edge', preset: 'warm' },
    'edge:leng': { engine: 'edge', preset: 'leng' },
    'edge:diyin': { engine: 'edge', preset: 'diyin' },
    'edge:xiaoxiao': { engine: 'edge', preset: 'xiaoxiao' },
    'kokoro:xiaobei': { engine: 'kokoro', preset: 'xiaobei' },
    'kokoro:xiaoni': { engine: 'kokoro', preset: 'xiaoni' },
    'kokoro:xiaoxiao': { engine: 'kokoro', preset: 'xiaoxiao' },
    'kokoro:xiaoyi': { engine: 'kokoro', preset: 'xiaoyi' },
  };

  function paintVoice(v) {
    if (!v) return;
    $('voEnabled').checked = v.enabled !== false;
    $('voVolume').value = v.volume ?? 0.9;
    $('voVolumeVal').textContent = pct(v.volume ?? 0.9);
    $('voRate').value = String(v.rate ?? 1);
    const key = `${v.engine || 'edge'}:${v.engine === 'sapi' ? 'sapi' : v.preset || 'natural'}`;
    if (VOICE_ENGINES[key]) $('voEngine').value = key;
    const preset = v.engine === 'kokoro'
      ? (v.kokoro || {})[v.preset]
      : v.engine === 'minimax'
        ? (v.minimax || {})[v.preset]
        : (v.presets || {})[v.preset];
    const label =
      v.engine === 'sapi'
        ? `系统语音 · ${v.name || 'Huihui'}`
        : `${preset?.label || v.preset || ''} · ${preset?.voiceId || preset?.voice || v.name || ''}${preset?.note ? ` · ${preset.note}` : ''}${v.engine === 'minimax' && v.minimaxHasKey === false ? ' · 未配置 API Key' : ''}`;
    $('voName').textContent = label;
    paintMinimaxKeyState(v.minimaxHasKey);
    if (v.lastError) $('voResult').textContent = `上次出错：${v.lastError}`;
  }

  function paintMinimaxKeyState(hasKey) {
    const el = $('voMinimaxKeyState');
    if (!el) return;
    el.textContent = hasKey ? '已配置（输入框不会回显）' : '未配置';
    el.classList.toggle('warn', !hasKey);
  }

  async function loadVoice() {
    try {
      const d = await api('/api/voice', null, 'GET');
      paintVoice(d.voice);
    } catch {
      /* 忽略 */
    }
  }

  $('voVolume').oninput = () => {
    $('voVolumeVal').textContent = pct($('voVolume').value);
  };
  $('voVolume').onchange = () => saveVoice();
  $('voEnabled').onchange = () => saveVoice();
  $('voRate').onchange = () => saveVoice();
  $('voEngine').onchange = () => saveVoice();
  $('voList').onclick = () => loadVoice();

  $('saveMinimaxKey').onclick = async () => {
    const key = $('voMinimaxKey').value.trim();
    if (!key) {
      $('voMinimaxKeyState').textContent = '请输入 Key；留空不会覆盖已有配置';
      $('voMinimaxKeyState').classList.add('warn');
      return;
    }
    const button = $('saveMinimaxKey');
    button.disabled = true;
    $('voMinimaxKeyState').textContent = '正在保存…';
    try {
      const d = await api('/api/config', { patch: { voice: { minimaxApiKey: key } } });
      $('voMinimaxKey').value = '';
      fillConfig(d.config);
      await loadVoice();
      $('voMinimaxKeyState').textContent = '已保存（输入框不会回显）';
      $('voMinimaxKeyState').classList.remove('warn');
    } catch (e) {
      $('voMinimaxKeyState').textContent = `保存失败：${e.message}`;
      $('voMinimaxKeyState').classList.add('warn');
    } finally {
      button.disabled = false;
    }
  };

  let voiceTimer = null;
  function saveVoice() {
    const eng = VOICE_ENGINES[$('voEngine').value] || VOICE_ENGINES['edge:natural'];
    clearTimeout(voiceTimer);
    voiceTimer = setTimeout(async () => {
      await api('/api/config', {
        patch: {
          voice: {
            enabled: $('voEnabled').checked,
            volume: Number($('voVolume').value),
            rate: Number($('voRate').value),
            engine: eng.engine,
            ...(eng.preset ? { preset: eng.preset } : {}),
          },
        },
      });
      await loadVoice();
    }, 260);
  }

  $('voTest').onclick = async () => {
    $('voResult').textContent = '正在合成试听…';
    try {
      const d = await api('/api/voice/test', {});
      const a = new Audio(d.url);
      a.volume = Number($('voVolume').value);
      await a.play().catch(() => {});
      if (d.engine === 'minimax') {
        const detail = `${d.model || 'speech-2.8-hd'} · ${d.voice || 'MiniMax'}`;
        $('voResult').textContent = d.cached
          ? `试听中（${detail} · 缓存命中）`
          : `试听中（${detail} · 合成 ${d.ms}ms）`;
      } else {
        $('voResult').textContent = d.cached
          ? `试听中（缓存命中：${d.url}）`
          : `试听中（${d.engine} 合成 ${d.ms}ms）`;
      }
    } catch (e) {
      $('voResult').textContent = `试听失败：${e.message}`;
    }
  };

  /* ---------- 音乐：试听 / 测音 ---------- */
  const preview = $('muPreview');
  function previewState(text, warn) {
    const el = $('muPreviewState');
    el.textContent = text;
    el.classList.toggle('warn', Boolean(warn));
  }

  function previewUrl(url) {
    preview.pause();
    preview.src = url;
    preview.volume = Number($('muVolume').value) || 0.75;
    $('muPreviewBtn').classList.add('playing');
    $('muPreviewBtn').textContent = '❚❚ 播放中';
    preview.play().catch((e) => {
      previewState(`浏览器不让播（${e.name}）：先点一下页面任意位置再试`, true);
      $('muPreviewBtn').classList.remove('playing');
      $('muPreviewBtn').textContent = '▶ 试听当前这首歌';
    });
  }

  preview.onended = () => {
    $('muPreviewBtn').classList.remove('playing');
    $('muPreviewBtn').textContent = '▶ 试听当前这首歌';
    previewState('放完了');
  };
  preview.onerror = () => {
    previewState('这个地址放不出来（外链可能过期），点「解析当前歌」再试', true);
    $('muPreviewBtn').classList.remove('playing');
  };

  $('muPreviewBtn').onclick = async () => {
    if (!preview.paused) {
      preview.pause();
      $('muPreviewBtn').classList.remove('playing');
      $('muPreviewBtn').textContent = '▶ 试听当前这首歌';
      previewState('暂停');
      return;
    }
    try {
      const d = await api('/api/state', null, 'GET');
      let song = d.song?.currentSong;
      if (!song) {
        previewState('队列里还没有歌，先用「搜一下 → 试听」找一首', true);
        return;
      }
      if (!song.url) {
        const r = await api('/api/music/resolve', {});
        song = r.song?.currentSong;
      }
      if (!song?.url) {
        previewState(`这首歌没解析到音源${song?.lastError ? '：' + song.lastError : ''}`, true);
        return;
      }
      previewUrl(song.url);
      previewState(`正在放：${song.title}${song.by ? ' · ' + song.by : ''}`);
    } catch (e) {
      previewState(`试听失败：${e.message}`, true);
    }
  };

  $('muPreviewStop').onclick = () => {
    preview.pause();
    preview.currentTime = 0;
    $('muPreviewBtn').classList.remove('playing');
    $('muPreviewBtn').textContent = '▶ 试听当前这首歌';
    previewState('已停止');
  };

  /* 直播窗有进度条却没声音，多半是系统音量太低：一键改默认播放设备的音量 */
  $('muSysVol').onclick = async () => {
    $('muSysVol').disabled = true;
    previewState('正在调系统音量…');
    try {
      const d = await api('/api/audio/volume', { target: 0.6 });
      const line = (d.out || []).slice(-1)[0] || '';
      previewState(`系统音量已调整：${line}`, false);
    } catch (e) {
      previewState('调整失败：' + e.message, true);
    } finally {
      $('muSysVol').disabled = false;
    }
  };

  // 一声 880Hz 的短提示音：不依赖任何文件，用来判断「浏览器/系统到底有没有出声」
  $('muBeep').onclick = async () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
      osc.onended = () => ctx.close();
      const stateAt = ctx.state;
      previewState(stateAt === 'running' ? '应该「叮」了一声——没听到就看系统音量/输出设备' : `音频上下文是 ${stateAt}，浏览器拦了自动播放`, stateAt !== 'running');
    } catch (e) {
      previewState(`浏览器不支持 WebAudio：${e.message}`, true);
    }
  };

  function paintMusic(m) {
    if (!m) return;
    if (m.provider) $('muProvider').value = m.provider;
    if (m.dir != null) $('muDir').value = m.dir;
    if (m.volume != null) {
      $('muVolume').value = m.volume;
      $('muVolumeVal').textContent = pct(m.volume);
    }
    if (m.apiBase != null) $('muApiBase').value = m.apiBase;
    $('muStatus').textContent = `本地曲库 ${m.tracks ?? 0} 首 · 音源 ${m.provider || 'auto'}`;
    paintMember(m);
  }

  /* 会员登录态：cookie 永远不回显，只显示「有没有 / 登录成了谁」 */
  function paintMember(m) {
    const box = $('muMember');
    if (!box) return;
    const mem = m?.member || {};
    const hasCookie = Boolean(m?.hasCookie || mem.hasCookie);
    $('muCookie').value = '';
    $('muCookie').placeholder = hasCookie
      ? '已保存会员 cookie（要换就重新粘贴一次）'
      : '粘贴 MUSIC_U=...（浏览器登录 music.163.com 后从 Cookie 里复制）';
    if (mem.loggedIn) {
      const vip = mem.vip ? '会员' : '非会员';
      box.textContent = `已登录：${mem.nickname || mem.userId || '网易云账号'}（${vip}）· 会员歌可以直接放`;
      box.classList.remove('warn');
    } else if (hasCookie) {
      box.textContent = '存了 cookie，但没验证通过（可能过期了）——重新登录再复制一次';
      box.classList.add('warn');
    } else {
      box.textContent = '未绑定会员 · 免费歌直接放，会员歌会退回翻唱或记下歌名';
      box.classList.remove('warn');
    }
  }

  async function loadMusic() {
    try {
      const d = await api('/api/music', null, 'GET');
      paintMusic(d.music);
      const cfg = await api('/api/config', null, 'GET').catch(() => null);
      if (cfg?.config?.audio && $('muAutoVol')) $('muAutoVol').checked = Boolean(cfg.config.audio.autoVolume);
    } catch {
      /* 忽略 */
    }
  }

  if ($('muAutoVol')) {
    $('muAutoVol').onchange = async () => {
      const on = $('muAutoVol').checked;
      await api('/api/config', { patch: { audio: { autoVolume: on, target: 0.6 } } });
      previewState(on ? '已开启：放歌/念新章时会自动把系统音量抬到 60%' : '已关闭：不再自动改系统音量');
    };
  }

  $('muSave').onclick = async () => {
    await api('/api/config', {
      patch: {
        music: {
          provider: $('muProvider').value,
          dir: $('muDir').value.trim() || 'music',
          volume: Number($('muVolume').value) || 0.2,
          apiBase: $('muApiBase').value.trim(),
        },
      },
    });
    await loadMusic();
    alert('声音设置已保存');
  };

  /* 会员 cookie：只写不读——保存后立刻验一次登录态 */
  $('muCookieSave').onclick = async () => {
    const raw = $('muCookie').value.trim();
    if (!raw) {
      alert('先把 MUSIC_U 粘进来；想清掉会员登录就点「检查」旁边的清空');
      return;
    }
    await api('/api/config', { patch: { music: { neteaseCookie: raw } } });
    $('muCookie').value = '';
    await loadMusic();
  };

  $('muCookieTest').onclick = async () => {
    $('muMember').textContent = '正在问网易云…';
    try {
      const d = await api('/api/music/member?force=1', null, 'GET');
      paintMember(d.music);
      if (!d.member?.loggedIn) $('muMember').classList.add('warn');
    } catch (e) {
      $('muMember').textContent = `检查失败：${e.message}`;
      $('muMember').classList.add('warn');
    }
  };

  $('muVolume').oninput = () => {
    $('muVolumeVal').textContent = pct($('muVolume').value);
    if (!preview.paused) preview.volume = Number($('muVolume').value) || 0.75;
  };
  $('muVolume').onchange = async () => {
    await api('/api/config', { patch: { music: { volume: Number($('muVolume').value) } } });
  };

  $('muReindex').onclick = async () => {
    const d = await api('/api/music/reindex', {});
    paintMusic(d.music);
    alert(`重新扫描完：本地 ${d.music?.tracks ?? 0} 首`);
  };

  $('muResolve').onclick = async () => {
    const d = await api('/api/music/resolve', {});
    const cur = d.song?.currentSong;
    $('muStatus').textContent = cur?.url
      ? `已解析：${cur.title}（${cur.kind}）`
      : `没找到音源${cur?.lastError ? '：' + cur.lastError : ''}`;
  };

  $('muSearch').onclick = async () => {
    const q = $('muQuery').value.trim();
    if (!q) return;
    const box = $('muResults');
    box.innerHTML = '<div class="pending">搜索中…</div>';
    const d = await api(`/api/music/search?q=${encodeURIComponent(q)}`, null, 'GET');
    box.innerHTML = '';
    const list = d.list || d.results || [];
    if (!list.length) {
      box.innerHTML = '<div class="pending">没搜到，换个写法试试（比如加上歌手名）</div>';
      return;
    }
    list.slice(0, 8).forEach((r) => {
      const row = document.createElement('div');
      row.className = 'pending';
      const label = document.createElement('span');
      label.textContent = `${r.title} · ${r.by || '未知'}（${r.kind}${r.durationSec ? ' · ' + Math.round(r.durationSec) + 's' : ''}）`;
      const tryBtn = document.createElement('button');
      tryBtn.textContent = '试听';
      tryBtn.onclick = () => {
        if (!r.url) {
          previewState('这条没有直接可播地址，换个结果试试', true);
          return;
        }
        previewUrl(r.url);
        previewState(`正在试听：${r.title}`);
      };
      const useBtn = document.createElement('button');
      useBtn.className = 'primary';
      useBtn.textContent = '用这首';
      useBtn.onclick = async () => {
        await api('/api/music/play', { title: r.title, by: r.by || '' });
        $('muStatus').textContent = `已切到：${r.title}`;
      };
      row.append(label, tryBtn, useBtn);
      box.appendChild(row);
    });
  };

  /* ---------- 数据看板：礼物 / 队列 ---------- */
  function renderBoard(state) {
    const giftMap = state.stats?.gifts || {};
    const gl = $('boardGifts');
    const entries = Object.entries(giftMap).sort((a, b) => b[1] - a[1]);
    gl.innerHTML = entries.length
      ? entries
          .map(([name, n]) => {
            const g = gifts.find((x) => x.name === name) || {};
            const yuan = (g.price || 0) * n;
            return `<li><span class="tag gift">${g.emoji || '🎁'}</span><span><b>${escapeHtml(name)}</b> ×${n}</span><span class="time">${money(yuan)}</span></li>`;
          })
          .join('')
      : '<li>今天还没收到礼物</li>';

    const song = state.song || {};
    const ql = $('boardQueue');
    const rows = [];
    if (song.currentSong) {
      rows.push(
        `<li><span class="tag ai">在播</span><span><b>${escapeHtml(song.currentSong.title)}</b>${song.currentSong.by ? ' · ' + escapeHtml(song.currentSong.by) : ''}</span><span class="time">${song.currentSong.kind === 'local' ? '本地' : song.currentSong.url ? '外链' : '无源'}</span></li>`,
      );
    }
    (song.playlist || []).forEach((s) => {
      rows.push(`<li><span class="tag">排队</span><span>${escapeHtml(s.title)}${s.by ? ' · ' + escapeHtml(s.by) : ''}</span></li>`);
    });
    ql.innerHTML = rows.length ? rows.join('') : '<li>队列空着</li>';
  }

  async function loadDanmaku() {
    try {
      const d = await api('/api/danmaku', null, 'GET');
      paintDanmaku(d.danmaku);
    } catch {
      /* 忽略 */
    }
  }

  setInterval(loadDanmaku, 5000);

  try {
    switchTab(localStorage.getItem('dfy.admin.tab') || 'basic');
  } catch {
    switchTab('basic');
  }
  loadMusic();
  loadVoice();
  loadNovels().catch(() => {});

  $('sendChat').disabled = false;
  refresh();
  setInterval(refresh, 4000);
})();
