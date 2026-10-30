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
      fillStory(d.config, d.story);
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

  // ---- 故事电台 ----
  let storyState = null;

  const lines = (v) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const pipes = (v) => String(v || '').split('|').map((s) => s.trim()).filter(Boolean);

  function addRound(round = {}) {
    const node = $('roundTpl').content.firstElementChild.cloneNode(true);
    node.querySelector('[data-f="chapter"]').value = round.chapter || '';
    node.querySelector('[data-f="beats"]').value = (round.beats || []).join('\n');
    node.querySelector('[data-f="defaultNext"]').value = round.defaultNext || '';
    node.querySelector('[data-f="choices"]').value = (round.choices || []).join(' | ');
    node.querySelector('[data-act="del"]').onclick = () => {
      node.remove();
      renumber();
    };
    $('stRounds').appendChild(node);
    renumber();
    return node;
  }

  function renumber() {
    [...$('stRounds').children].forEach((n, i) => {
      n.querySelector('[data-n]').textContent = String(i + 1);
    });
  }

  function collectStory() {
    const rounds = [...$('stRounds').children].map((n, i) => ({
      chapter: n.querySelector('[data-f="chapter"]').value.trim() || `第 ${i + 1} 段`,
      beats: lines(n.querySelector('[data-f="beats"]').value),
      defaultNext: n.querySelector('[data-f="defaultNext"]').value.trim(),
      choices: pipes(n.querySelector('[data-f="choices"]').value),
    }));
    return {
      title: $('stTitle').value.trim(),
      genre: $('stGenre').value.trim(),
      world: $('stWorld').value.trim(),
      hero: $('stHero').value.trim(),
      cast: $('stCast').value.trim(),
      conflict: $('stConflict').value.trim(),
      mystery: $('stMystery').value.trim(),
      ending: $('stEnding').value.trim(),
      immutable: lines($('stImmutable').value),
      changeable: lines($('stChangeable').value),
      openerMin: Number($('stOpenerMin').value) || 10,
      storyMin: Number($('stStoryMin').value) || 6,
      interactMin: Number($('stInteractMin').value) || 4,
      totalMin: Number($('stTotalMin').value) || 60,
      opener: lines($('stOpener').value),
      rounds,
    };
  }

  function fillStory(c, s) {
    if (!c || !c.story) return;
    const st = c.story;
    storyState = s || null;
    if (document.activeElement !== $('stTitle')) $('stTitle').value = st.title || '';
    if (document.activeElement !== $('stGenre')) $('stGenre').value = st.genre || '';
    if (document.activeElement !== $('stWorld')) $('stWorld').value = st.world || '';
    if (document.activeElement !== $('stHero')) $('stHero').value = st.hero || '';
    if (document.activeElement !== $('stCast')) $('stCast').value = st.cast || '';
    if (document.activeElement !== $('stConflict')) $('stConflict').value = st.conflict || '';
    if (document.activeElement !== $('stMystery')) $('stMystery').value = st.mystery || '';
    if (document.activeElement !== $('stEnding')) $('stEnding').value = st.ending || '';
    if (document.activeElement !== $('stImmutable')) $('stImmutable').value = (st.immutable || []).join('\n');
    if (document.activeElement !== $('stChangeable')) $('stChangeable').value = (st.changeable || []).join('\n');
    if (document.activeElement !== $('stOpenerMin')) $('stOpenerMin').value = st.openerMin || 10;
    if (document.activeElement !== $('stStoryMin')) $('stStoryMin').value = st.storyMin || 6;
    if (document.activeElement !== $('stInteractMin')) $('stInteractMin').value = st.interactMin || 4;
    if (document.activeElement !== $('stTotalMin')) $('stTotalMin').value = st.totalMin || 60;
    if (document.activeElement !== $('stOpener')) $('stOpener').value = (st.opener || []).join('\n');

    if (!document.activeElement.closest?.('#stRounds')) {
      $('stRounds').innerHTML = '';
      for (const r of st.rounds || []) addRound(r);
      if (!$('stRounds').children.length) addRound();
    }

    $('storyAuto').checked = Boolean(s?.auto);
    if (s) {
      const next = s.next ? `下一条：${s.next.type}（${Math.round(s.next.inSec / 60)} 分钟后）` : '';
      $('storyResult').className = 'result show';
      $('storyResult').textContent = [
        `阶段：${s.phaseLabel}${s.chapter ? ` · ${s.chapter}` : ''}`,
        `进度：第 ${s.round + 1} / ${s.roundCount} 段 · 已过 ${Math.floor(s.elapsedSec / 60)} 分钟 · 剩 ${s.countdown}`,
        s.text ? `刚讲的：${s.text.slice(0, 70)}${s.text.length > 70 ? '…' : ''}` : '',
        s.summary ? `本段总结：${s.summary}` : '',
        s.suggestions?.length ? `观众建议：${s.suggestions.map((x) => `「${x.text}」×${x.count}`).join(' ')}` : '',
        next,
      ]
        .filter(Boolean)
        .join('\n');
    }
  }

  $('stAddRound').onclick = () => addRound();

  $('storySave').onclick = async () => {
    const payload = collectStory();
    if (!payload.opener.length) return alert('开场还是空的');
    if (!payload.rounds.length || !payload.rounds.some((r) => r.beats.length)) return alert('每段至少要有一拍');
    if (!confirm(`保存后从这一场开头重讲：开场 ${payload.opener.length} 拍 + ${payload.rounds.length} 段，继续吗？`)) return;
    try {
      await api('/api/story/config', payload);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  $('storyStart').onclick = async () => {
    await api('/api/story/start', {});
    await refresh();
  };

  $('storyNext').onclick = async () => {
    $('storyResult').className = 'result show';
    $('storyResult').textContent = '本鲸正在讲…';
    try {
      const d = await api('/api/story/next', {});
      $('storyResult').textContent = d.story?.text || '（这一条是空场）';
      await refresh();
    } catch (err) {
      $('storyResult').textContent = '没讲成：' + err.message;
    }
  };

  $('storyStop').onclick = async () => {
    await api('/api/story/stop', {});
    await refresh();
  };

  $('storyAuto').onchange = async () => {
    await api('/api/story/auto', { auto: $('storyAuto').checked });
    await refresh();
  };

  $('storyReset').onclick = async () => {
    if (!confirm('从这一场开头重来？已经讲过的会丢掉。')) return;
    await api('/api/story/reset', {});
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
    if (d.lastError) bits.push(d.lastError);
    const box = $('dmResult');
    if (!box) return;
    box.className = 'result show';
    box.textContent = bits.join(' · ');
    if (document.activeElement !== $('dmRoom') && d.savedRoomId) $('dmRoom').value = d.savedRoomId;
  }

  if ($('dmConnect')) {
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
    const preset = v.engine === 'kokoro' ? (v.kokoro || {})[v.preset] : (v.presets || {})[v.preset];
    const label =
      v.engine === 'sapi'
        ? `系统语音 · ${v.name || 'Huihui'}`
        : `${preset?.label || v.preset || ''} · ${preset?.voice || v.name || ''}${preset?.note ? ` · ${preset.note}` : ''}`;
    $('voName').textContent = label;
    if (v.lastError) $('voResult').textContent = `上次出错：${v.lastError}`;
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
      $('voResult').textContent = d.cached
        ? `试听中（缓存命中：${d.url}）`
        : `试听中（合成 ${d.ms}ms${d.engine === 'edge' ? '，在线御姐音' : ''}）`;
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
  }

  async function loadMusic() {
    try {
      const d = await api('/api/music', null, 'GET');
      paintMusic(d.music);
    } catch {
      /* 忽略 */
    }
  }

  $('muSave').onclick = async () => {
    await api('/api/config', {
      patch: {
        music: {
          provider: $('muProvider').value,
          dir: $('muDir').value.trim() || 'music',
          volume: Number($('muVolume').value) || 0.75,
          apiBase: $('muApiBase').value.trim(),
        },
      },
    });
    await loadMusic();
    alert('声音设置已保存');
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

  setInterval(async () => {
    try {
      const d = await api('/api/danmaku', null, 'GET');
      paintDanmaku(d.danmaku);
    } catch {
      /* 忽略 */
    }
  }, 5000);

  try {
    switchTab(localStorage.getItem('dfy.admin.tab') || 'basic');
  } catch {
    switchTab('basic');
  }
  loadMusic();
  loadVoice();

  $('sendChat').disabled = false;
  refresh();
  setInterval(refresh, 4000);
})();
