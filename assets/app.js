(() => {
  'use strict';

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    document.documentElement.classList.add('js-motion');
  }

  const modes = {
    design: {
      label: '声音描述',
      tag: '纯文本驱动 · 无需参考音',
      text: '温暖、自然的女声，语速舒缓，\n像在安静的午后，讲述一个故事。',
      meta: ['模式：声音设计', '提示：(描述)文本', '输出：48 kHz WAV'],
      durationSec: 12,
      seed: 0.85,
      tempo: 1.0,
    },
    clone: {
      label: '参考音色 + 表达指令',
      tag: '保留音色 · 可调情绪与语速',
      text: '保留参考音色，自然地讲述。\n让这一句更轻快，带一点期待。',
      meta: ['模式：可控克隆', '输入：参考音频 + 风格指令', '特征缓存：自动复用'],
      durationSec: 9,
      seed: 1.95,
      tempo: 1.35,
    },
    ultimate: {
      label: '参考音频 + 对应文本',
      tag: '音频续写 · 细节高度还原',
      text: '每一种声音，都有自己的故事。\n让新的文字，延续熟悉的音色。',
      meta: ['模式：极致克隆', '输入：参考音频 + SenseVoice 转写', '降噪编码：按需缓存'],
      durationSec: 14,
      seed: 3.25,
      tempo: 0.88,
    },
  };

  function formatTime(sec) {
    const clamped = Math.max(0, Math.floor(sec));
    const m = String(Math.floor(clamped / 60)).padStart(2, '0');
    const s = String(clamped % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  const BAR_COUNT = 92;
  const WAVE_W = 520;
  const WAVE_H = 112;
  const BAR_W = 2.8;

  const waveEl = document.querySelector('#hero-wave');
  const waveStage = document.querySelector('#wave-stage');
  const playheadEl = document.querySelector('#wave-playhead');
  const currentEl = document.querySelector('#wave-current');
  const durationEl = document.querySelector('#wave-duration');
  const toggleBtn = document.querySelector('#wave-toggle');
  const toggleLabel = document.querySelector('#wave-toggle-label');
  const studioWindow = document.querySelector('.studio-window');

  let currentMode = modes.design;
  let baseAmps = new Float32Array(BAR_COUNT);
  let targetAmps = new Float32Array(BAR_COUNT);
  let barRects = [];
  let isPlaying = !reduceMotion;
  let progress = 0; // 0..1
  let hoverRatio = null;
  let lastTs = 0;
  let rafId = 0;

  function computeTargetAmps(seed) {
    const out = new Float32Array(BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      const pos = i / (BAR_COUNT - 1);
      const env = Math.pow(Math.sin(Math.PI * pos), 0.62);
      const harmonic =
        Math.abs(Math.sin(i * 1.47 + seed) * Math.cos(i * 0.31 + seed * 0.7)) * 0.72 +
        Math.abs(Math.sin(i * 0.63 + seed * 1.4)) * 0.28;
      out[i] = (0.14 + 0.86 * harmonic) * env;
    }
    return out;
  }

  function initWave() {
    if (!waveEl) return;
    targetAmps = computeTargetAmps(currentMode.seed);
    baseAmps.set(targetAmps);

    const defs =
      `<defs><linearGradient id="wave-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${WAVE_W}" y2="0">` +
      '<stop offset="0%" stop-color="#75c768"/>' +
      '<stop offset="50%" stop-color="#c8f16b"/>' +
      '<stop offset="100%" stop-color="#7eb6ec"/>' +
      '</linearGradient></defs>';
    const parts = [defs];
    for (let i = 0; i < BAR_COUNT; i++) {
      const pos = i / (BAR_COUNT - 1);
      const x = 4 + pos * (WAVE_W - 8 - BAR_W);
      const h = 6 + baseAmps[i] * (WAVE_H - 16);
      const y = (WAVE_H - h) / 2;
      parts.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${BAR_W}" height="${h.toFixed(2)}" rx="1.4" fill="url(#wave-grad)" opacity="0.82"/>`
      );
    }
    waveEl.innerHTML = parts.join('');
    barRects = [...waveEl.querySelectorAll('rect')];
  }

  function renderFrame(ts) {
    if (!barRects.length) return;
    const dt = lastTs ? Math.min(0.25, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    if (isPlaying) {
      progress = (progress + dt / currentMode.durationSec) % 1;
    }

    const activeCursor = hoverRatio !== null ? hoverRatio : progress;
    const t = ts * 0.001 * currentMode.tempo;

    for (let i = 0; i < BAR_COUNT; i++) {
      // 平滑过渡模式切换后的目标振幅
      baseAmps[i] += (targetAmps[i] - baseAmps[i]) * Math.min(1, dt * 8.5);
      const pos = i / (BAR_COUNT - 1);
      const dist = Math.abs(pos - activeCursor);

      let pulse = 1;
      if (isPlaying) {
        const voiceBreath = 0.88 + 0.16 * Math.sin(t * 4.2 + i * 0.45) * Math.cos(t * 1.9 - i * 0.18);
        const focusBoost = dist < 0.09 ? 1 + (1 - dist / 0.09) * 0.24 : 1;
        pulse = voiceBreath * focusBoost;
      } else if (hoverRatio !== null && dist < 0.08) {
        pulse = 1 + (1 - dist / 0.08) * 0.28;
      }

      const h = Math.min(WAVE_H - 8, Math.max(5, 6 + baseAmps[i] * pulse * (WAVE_H - 16)));
      const y = (WAVE_H - h) / 2;
      const rect = barRects[i];
      rect.setAttribute('y', y.toFixed(1));
      rect.setAttribute('height', h.toFixed(1));

      // 播放头扫过的区域高亮，未到达区域略微沉稳
      let opacity = 0.42;
      if (isPlaying || hoverRatio !== null) {
        if (pos <= activeCursor) {
          opacity = 0.96;
        } else if (dist < 0.06) {
          opacity = 0.78;
        } else {
          opacity = 0.38;
        }
      } else {
        opacity = 0.55 + 0.4 * Math.sin(Math.PI * pos);
      }
      rect.setAttribute('opacity', opacity.toFixed(2));
    }

    if (playheadEl && waveStage) {
      const w = waveStage.clientWidth || WAVE_W;
      playheadEl.style.transform = `translate3d(${(activeCursor * (w - 2)).toFixed(1)}px, 0, 0)`;
    }
    if (currentEl) {
      currentEl.textContent = formatTime(activeCursor * currentMode.durationSec);
    }

    if (isPlaying || hoverRatio !== null) {
      rafId = requestAnimationFrame(renderFrame);
    } else {
      rafId = 0;
    }
  }

  function syncPlayState() {
    if (waveStage) waveStage.classList.toggle('is-live', isPlaying || hoverRatio !== null);
    if (studioWindow) studioWindow.classList.toggle('is-paused', !isPlaying);
    if (toggleBtn) toggleBtn.setAttribute('aria-pressed', String(isPlaying));
    if (toggleLabel) toggleLabel.textContent = isPlaying ? '动态示意' : '已暂停';
    if ((isPlaying || hoverRatio !== null) && !rafId) {
      lastTs = 0;
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  initWave();
  if (durationEl) durationEl.textContent = formatTime(currentMode.durationSec);
  syncPlayState();

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      syncPlayState();
      if (!isPlaying && barRects.length) {
        renderFrame(performance.now());
      }
    });
  }

  if (waveStage) {
    waveStage.addEventListener('pointermove', event => {
      const rect = waveStage.getBoundingClientRect();
      if (rect.width <= 0) return;
      hoverRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      syncPlayState();
    });
    waveStage.addEventListener('pointerleave', () => {
      hoverRatio = null;
      syncPlayState();
    });
    waveStage.addEventListener('click', event => {
      const rect = waveStage.getBoundingClientRect();
      if (rect.width <= 0) return;
      progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      if (!isPlaying) renderFrame(performance.now());
    });
  }

  // 页面不可见时暂停 rAF，节能不耗 CPU
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!document.hidden && isPlaying && !rafId) {
      lastTs = 0;
      rafId = requestAnimationFrame(renderFrame);
    }
  });

  // 模式切换与键盘导航
  const tabs = [...document.querySelectorAll('[data-mode]')];
  const modePanel = document.querySelector('#mode-panel');
  function selectMode(tab) {
    const mode = modes[tab.dataset.mode];
    if (!mode) return;
    currentMode = mode;
    targetAmps = computeTargetAmps(mode.seed);
    progress = 0;

    tabs.forEach(button => {
      const active = button === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    if (modePanel) {
      modePanel.setAttribute('aria-labelledby', tab.id);
      modePanel.classList.remove('mode-switching');
      void modePanel.offsetWidth;
      modePanel.classList.add('mode-switching');
    }
    const labelEl = document.querySelector('#editor-label');
    if (labelEl) labelEl.textContent = mode.label;
    const tagEl = document.querySelector('#mode-tag');
    if (tagEl) tagEl.textContent = mode.tag;
    const textEl = document.querySelector('#editor-text');
    if (textEl) textEl.textContent = mode.text;
    const metaEl = document.querySelector('#editor-meta');
    if (metaEl) {
      metaEl.textContent = '';
      mode.meta.forEach(item => {
        const span = document.createElement('span');
        span.textContent = item;
        metaEl.appendChild(span);
      });
    }
    if (durationEl) durationEl.textContent = formatTime(mode.durationSec);
    if (currentEl) currentEl.textContent = '00:00';

    if (reduceMotion || !isPlaying) {
      baseAmps.set(targetAmps);
      renderFrame(performance.now());
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectMode(tab));
    tab.addEventListener('keydown', event => {
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
          ? 0
          : event.key === 'End'
          ? tabs.length - 1
          : null;
      if (next === null) return;
      event.preventDefault();
      selectMode(tabs[next]);
      tabs[next].focus();
    });
  });

  // 滚动渐现与卡片光标柔光（仅非减弱动效模式启用）
  if (!reduceMotion) {
    const revealTargets = [...document.querySelectorAll('.engine-card, .bento-card, .step-card, .download-shell')];
    revealTargets.forEach((el, idx) => {
      el.setAttribute('data-reveal', '');
      el.style.transitionDelay = `${(idx % 4) * 55}ms`;
    });

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.setAttribute('data-reveal', 'in');
              io.unobserve(entry.target);
            }
          });
        },
        { rootMargin: '0px 0px -48px 0px', threshold: 0.08 }
      );
      revealTargets.forEach(el => io.observe(el));
    } else {
      revealTargets.forEach(el => el.setAttribute('data-reveal', 'in'));
    }

    document.querySelectorAll('.engine-card, .bento-card, .step-card').forEach(card => {
      card.addEventListener('pointermove', event => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${(event.clientX - rect.left).toFixed(0)}px`);
        card.style.setProperty('--my', `${(event.clientY - rect.top).toFixed(0)}px`);
      });
    });
  }

  // 安全读取 config.js：联系地址仅允许 https:// 或 mailto:，文字仅用 textContent 注入。
  const config = window.OVOICE_SITE || {};
  const validContact = typeof config.contactUrl === 'string' && /^(https:\/\/|mailto:)/i.test(config.contactUrl);
  if (validContact) {
    document.querySelectorAll('.contact-link').forEach(link => {
      link.href = config.contactUrl;
      link.textContent = config.contactLabel || '咨询授权';
      if (/^https:\/\//i.test(config.contactUrl)) {
        link.target = '_blank';
        link.rel = 'noopener';
      }
    });
  }
  const contactHelp = document.querySelector('#contact-help');
  if (contactHelp && typeof config.contactText === 'string' && config.contactText.trim()) {
    contactHelp.textContent = config.contactText;
  }
  const icpLink = document.querySelector('#icp-link');
  if (icpLink && typeof config.icpNumber === 'string' && config.icpNumber.trim()) {
    icpLink.textContent = config.icpNumber;
    icpLink.hidden = false;
  }

  const downloadBtn = document.querySelector('#installer-download');
  const feedbackEl = document.querySelector('#download-feedback');
  if (downloadBtn && feedbackEl) {
    downloadBtn.addEventListener('click', () => {
      feedbackEl.textContent = '已开始下载 V1.0.3 Windows 安装包，请在浏览器下载列表中查看。';
    });
  }

  const copyBtn = document.querySelector('#copy-sha256');
  const hashVal = document.querySelector('#sha256-value');
  if (copyBtn && hashVal && navigator.clipboard) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard
        .writeText(hashVal.textContent.trim())
        .then(() => {
          copyBtn.textContent = '已复制';
          setTimeout(() => {
            copyBtn.textContent = '复制哈希';
          }, 1800);
        })
        .catch(() => {});
    });
  }

  const year = document.querySelector('#copyright-year');
  if (year) year.textContent = String(Math.max(2026, new Date().getFullYear()));
})();
