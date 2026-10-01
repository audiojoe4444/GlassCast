/* GlassCast — a streaming podcast player for Meta Ray-Ban Display glasses.
 * Plain HTML/CSS/JS, no build step. Host on any HTTPS static host (e.g. GitHub Pages).
 *
 * Input: the glasses send ArrowUp/Down/Left/Right + Enter as keydown events and the
 * WebView moves focus between native <button>s itself (spatial navigation).
 * Back: the glasses' Back gesture calls history.back(), so every screen is a history entry.
 * Data: Apple's public iTunes Search/Lookup API via JSONP (no key, no CORS problems).
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const NS = 'glasscast.';
  const SKIP_BACK = 15;
  const SKIP_FWD = 30;
  const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.8];
  const PLAYED_TAIL = 20;          // seconds from the end that counts as "heard"
  const REFRESH_MS = 30 * 60e3;    // re-check library shows for new episodes every 30 min
  const MAX_DEPTH = 4;             // glasses cap pushState history at 5 entries
  const COUNTRY = (() => {
    const m = (navigator.language || 'en-US').match(/-([A-Za-z]{2})$/);
    return (m ? m[1] : 'US').toUpperCase();
  })();

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); }
      catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(NS + k, JSON.stringify(v)); }
      catch (e) { console.warn('GlassCast storage failed:', e); }
    },
    del(k) { try { localStorage.removeItem(NS + k); } catch {} }
  };

  let library = store.get('library', []);   // [{id,title,author,art,added}]
  let progress = store.get('progress', {});  // {epId:{p:pos,d:dur,played:bool,t:ts}}
  let speed = store.get('speed', 1);
  let nowPlaying = store.get('now', null);   // {ep:{...}, show:{...}}
  const showMeta = {};                       // id -> show (search results etc.)
  const epMem = {};                          // id -> {t, eps}
  library.forEach(s => (showMeta[s.id] = s));

  const saveLibrary = () => store.set('library', library);
  let progTimer = 0;
  const saveProgress = (now) => {
    clearTimeout(progTimer);
    if (now) store.set('progress', progress);
    else progTimer = setTimeout(() => store.set('progress', progress), 800);
  };

  // ---------------------------------------------------------------- helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inLib = (id) => library.some(s => String(s.id) === String(id));

  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function fmtDur(sec) {
    if (!sec) return '';
    const m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    const days = Math.floor((now - d) / 864e5);
    if (days < 1) return 'Today';
    if (days < 2) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    const o = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString(undefined, o);
  }
  const art = (url, size = 300) => url ? url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`) : '';

  let toastT = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------------------------------------------------------------- icons
  const I = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    checks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12.5l4.5 4.5L15 8.5M11 16l1 1L21.5 7.5"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.8-6.8c.6-.4.6-1.3 0-1.7L9.6 4.3C8.9 3.9 8 4.4 8 5.2z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1.4"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.4"/></svg>',
    start: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="5" width="2.6" height="14" rx="1.2"/><path d="M19.5 6.3v11.4c0 .8-.9 1.2-1.5.8L9.6 12.8a1 1 0 0 1 0-1.6L18 5.5c.6-.4 1.5 0 1.5.8z"/></svg>',
    end: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="17.4" y="5" width="2.6" height="14" rx="1.2"/><path d="M4.5 6.3v11.4c0 .8.9 1.2 1.5.8l8.4-5.7a1 1 0 0 0 0-1.6L6 5.5c-.6-.4-1.5 0-1.5.8z"/></svg>',
    rew: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 3.5v4h4"/></svg>',
    kbd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9"/></svg>',
    rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10 10.5v5.5M14 10.5v5.5"/></svg>',
    bksp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="M12 9.5l5 5M17 9.5l-5 5"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M20 3.5v4h-4"/></svg>'
  };

  function logo(live = false, cls = '') {
    const bars = [10, 18, 26, 18, 10].map((h, i) =>
      `<rect class="bar" x="${16.3 + i * 5}" y="${32 - h / 2}" width="3.4" height="${h}" rx="1.7"/>`).join('');
    return `<svg class="logo ${live ? 'live' : ''} ${cls}" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M44.85 46.14A22 22 0 1 1 44.85 17.86" fill="none" stroke="url(#gc-grad)" stroke-width="4" stroke-linecap="round"/>
      <g fill="url(#gc-grad)">${bars}</g>
      <path class="ripple" d="M53.38 20.17A28 28 0 0 1 53.38 43.83" fill="none" stroke="url(#gc-grad)" stroke-width="3.6" stroke-linecap="round"/>
      <path class="ripple r2" d="M59.95 20.37A34 34 0 0 1 59.95 43.63" fill="none" stroke="url(#gc-grad)" stroke-width="3.2" stroke-linecap="round" opacity=".6"/>
    </svg>`;
  }

  // ---------------------------------------------------------------- data (iTunes API via JSONP)
  let jsonpN = 0;
  function jsonp(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const cb = '__gc_cb' + (++jsonpN);
      const s = document.createElement('script');
      const done = () => { clearTimeout(t); window[cb] = () => {}; s.remove(); };
      const t = setTimeout(() => { done(); reject(new Error('timeout')); }, timeout);
      window[cb] = (data) => { done(); resolve(data); };
      s.onerror = () => { done(); reject(new Error('network')); };
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(s);
    });
  }

  async function searchShows(term) {
    const d = await jsonp(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=30&country=${COUNTRY}&term=${encodeURIComponent(term)}`);
    return (d.results || []).filter(r => r.collectionId).map(r => {
      const s = {
        id: r.collectionId,
        title: r.collectionName || r.trackName,
        author: r.artistName || '',
        art: r.artworkUrl600 || r.artworkUrl100 || '',
        feedUrl: r.feedUrl || '',
        genre: r.primaryGenreName || ''
      };
      showMeta[s.id] = Object.assign(showMeta[s.id] || {}, s);
      return s;
    });
  }

  async function fetchEpisodes(id, force = false) {
    const mem = epMem[id] || store.get('eps.' + id, null);
    if (mem && !force && Date.now() - mem.t < REFRESH_MS) return (epMem[id] = mem).eps;
    try {
      if (isRss(id)) return await fetchFeedShow(id, feedUrlOf(id));
      const d = await jsonp(`https://itunes.apple.com/lookup?id=${id}&entity=podcastEpisode&limit=200&country=${COUNTRY}`);
      const res = d.results || [];
      const head = res.find(r => r.wrapperType !== 'podcastEpisode');
      if (head) {
        showMeta[id] = Object.assign(showMeta[id] || {}, {
          id, title: head.collectionName, author: head.artistName,
          art: head.artworkUrl600 || head.artworkUrl100 || (showMeta[id] || {}).art,
          feedUrl: head.feedUrl || (showMeta[id] || {}).feedUrl || ''
        });
        const lib = library.find(x => String(x.id) === String(id));
        if (lib && head.feedUrl && lib.feedUrl !== head.feedUrl) { lib.feedUrl = head.feedUrl; saveLibrary(); }
      }
      const eps = res.filter(r => r.wrapperType === 'podcastEpisode' && r.episodeUrl).map(r => ({
        id: String(r.trackId),
        title: r.trackName,
        url: r.episodeUrl,
        date: r.releaseDate,
        dur: Math.round((r.trackTimeMillis || 0) / 1000)
      })).sort((a, b) => new Date(b.date) - new Date(a.date));
      const entry = { t: Date.now(), eps };
      epMem[id] = entry;
      if (inLib(id)) store.set('eps.' + id, entry);
      return eps;
    } catch (e) {
      if (mem) return (epMem[id] = mem).eps; // stale is better than nothing
      throw e;
    }
  }

  // ---------------------------------------------------------------- shows added by RSS feed
  // Anything typed into Search that looks like a feed address is read as an RSS feed instead
  // of searched for. Those shows (ids start "rss:") get their episodes straight from the feed.
  const isRss = (id) => String(id).startsWith('rss:');
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function feedAddress(term) {
    let t = (term || '').trim();
    if (!t) return '';
    // An address anywhere in the text wins (the glasses' text panel adds to what's already there).
    const at = t.search(/(https?:\/\/|feed:|itpc:|pcast:|www\.)/i);
    if (at >= 0) t = t.slice(at).replace(/\s+/g, '');
    else if (/\s/.test(t)) return '';
    t = t.replace(/^(feed|itpc|pcast|podcast):(\/\/)?/i, '');
    if (/^https?:\/\//i.test(t)) return t;
    if (/^www\./i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*/i.test(t) && /(rss|feed|xml|podcast|\.php|\/)/i.test(t)) return 'https://' + t;
    return '';
  }

  class FeedError extends Error {
    constructor(kind, status) { super(kind); this.kind = kind; this.status = status; }
  }
  async function readFeedFull(url) {
    const original = url;
    const secure = url.replace(/^http:\/\//i, 'https://');
    let lastErr;
    for (const [i, route] of FEED_ROUTES.entries()) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), i === 0 ? 30000 : 20000);
      let res;
      try {
        res = await fetch(route(i === 0 ? secure : original), { signal: ctrl.signal, credentials: 'omit' });
      } catch (e) {
        lastErr = new FeedError(e && e.name === 'AbortError' ? 'timeout' : 'blocked');
        clearTimeout(timer);
        continue; // the browser couldn't read it at all — try a relay
      }
      try {
        if (!res.ok) {
          // The feed's own host answered with an error: the address or its key is wrong.
          if (i === 0) throw new FeedError('status', res.status);
          lastErr = new FeedError('blocked');
          continue;
        }
        const text = await res.text();
        if (!/<(rss|channel|feed)[\s>]/i.test(text)) {
          if (i === 0) throw new FeedError('notfeed');
          lastErr = new FeedError('blocked');
          continue;
        }
        return text;
      } catch (e) {
        if (e instanceof FeedError) throw e;
        lastErr = new FeedError(e && e.name === 'AbortError' ? 'timeout' : 'blocked');
      } finally { clearTimeout(timer); }
    }
    throw lastErr || new FeedError('blocked');
  }
  function feedErrorText(e) {
    const k = e && e.kind;
    if (k === 'status' && (e.status === 401 || e.status === 403)) return `The feed host refused access (error ${e.status}). For a private feed like Patreon, copy a fresh RSS link from your account — the key in it may have changed.`;
    if (k === 'status' && e.status === 404) return 'The feed host says that address doesn\'t exist (error 404). Check every character, including capitals.';
    if (k === 'status') return `The feed host returned error ${e.status}. Check the address and try again.`;
    if (k === 'notfeed') return 'That address opened a web page, not a podcast feed. Make sure it\'s the RSS link.';
    if (k === 'timeout') return 'The feed took too long to load. Try again in a moment.';
    return 'The feed couldn\'t be reached. Check your connection and the address.';
  }

  function parseDur(v) {
    if (!v) return 0;
    v = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(v)) return Math.round(+v);
    const parts = v.split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  function parseFeed(xml, feedUrl, id) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length && !doc.getElementsByTagName('item').length) throw new Error('bad feed');
    const ch = doc.getElementsByTagName('channel')[0] || doc.documentElement;
    const txt = (el, tag) => { const n = el && el.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ''; };
    const direct = (el, tag) => { for (const c of el.children) if (c.tagName === tag) return c.textContent.trim(); return ''; };
    const title = direct(ch, 'title') || 'Untitled feed';
    const author = direct(ch, 'itunes:author') || direct(ch, 'author') || direct(ch, 'managingEditor') || '';
    const items = [...doc.getElementsByTagName('item')].slice(0, 300);
    const eps = [];
    for (const it of items) {
      const enc = it.getElementsByTagName('enclosure')[0];
      const url = enc && enc.getAttribute('url');
      if (!url) continue;
      const guid = txt(it, 'guid') || url;
      const d = new Date(txt(it, 'pubDate') || txt(it, 'dc:date'));
      eps.push({
        id: 'r' + hash(id + '|' + guid),
        title: txt(it, 'title') || 'Untitled episode',
        url: url.replace(/^http:\/\//i, 'https://'),
        date: isNaN(d) ? '' : d.toISOString(),
        dur: parseDur(txt(it, 'itunes:duration'))
      });
    }
    eps.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { title, author, art: parseFeedArt(xml), eps };
  }

  async function fetchFeedShow(id, feedUrl) {
    const f = parseFeed(await readFeedFull(feedUrl), feedUrl, id);
    showMeta[id] = Object.assign(showMeta[id] || {}, { id, title: f.title, author: f.author, art: f.art, feedUrl, rss: true });
    if (f.art) { feedArt[id] = { u: f.art, t: Date.now() }; store.set('feedart', feedArt); }
    const lib = library.find(x => String(x.id) === String(id));
    if (lib) { Object.assign(lib, { title: f.title, author: f.author, art: f.art }); saveLibrary(); }
    const entry = { t: Date.now(), eps: f.eps };
    epMem[id] = entry;
    if (inLib(id)) store.set('eps.' + id, entry);
    return f.eps;
  }

  async function lookupFeed(feedUrl) {
    const id = 'rss:' + hash(feedUrl.replace(/^https?:\/\//i, '').toLowerCase());
    showMeta[id] = Object.assign(showMeta[id] || {}, { id, feedUrl, rss: true });
    await fetchFeedShow(id, feedUrl);
    const m = showMeta[id];
    return [{ id, title: m.title, author: m.author, art: m.art, feedUrl, rss: true }];
  }

  // ---------------------------------------------------------------- artwork (from each show's RSS feed)
  // Every image in the app is the podcast's own cover from its RSS feed (<itunes:image> or
  // <image><url>). Feeds are read directly when the host allows it, otherwise through a public
  // CORS relay. Only the feed's header is downloaded (we stop at the first <item>).
  // If a feed can't be read at all, Apple's copy of the cover is used so nothing is left blank.
  const FEED_ROUTES = [
    (u) => u,
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u)
  ];
  const ART_TTL = 7 * 864e5, ART_RETRY = 864e5;
  let feedArt = store.get('feedart', {});            // id -> {u, t} or {f:1, t}
  const artBusy = {};
  const artQueue = [];
  let artRunning = 0;

  function artUrl(show) {
    if (!show) return '';
    const e = feedArt[show.id];
    if (e && e.u) return e.u;
    if (e && e.f) { const m = show.art || (showMeta[show.id] || {}).art; return m ? art(m, 600) : ''; }
    return '';
  }

  function artImg(show, cls = 'art', lazy = true) {
    const u = artUrl(show);
    queueArt(show);
    return `<img class="${cls}" data-art-show="${esc(show.id)}"${u ? ` src="${esc(u)}"` : ''} alt=""${lazy ? ' loading="lazy"' : ''} decoding="async">`;
  }

  function queueArt(show) {
    const id = show && show.id;
    if (!id || artBusy[id]) return;
    const e = feedArt[id];
    if (e && Date.now() - e.t < (e.u ? ART_TTL : ART_RETRY)) return;
    artBusy[id] = true;
    artQueue.push(id);
    pumpArt();
  }
  function pumpArt() {
    while (artRunning < 3 && artQueue.length) {
      const id = artQueue.shift();
      artRunning++;
      resolveArt(id).finally(() => { artRunning--; delete artBusy[id]; pumpArt(); });
    }
  }

  async function resolveArt(id) {
    const prev = feedArt[id];
    try {
      let fu = feedUrlOf(id);
      if (!fu && !isRss(id)) {
        const d = await jsonp(`https://itunes.apple.com/lookup?id=${id}&country=${COUNTRY}`);
        const r = (d.results || [])[0] || {};
        fu = r.feedUrl || '';
        showMeta[id] = Object.assign(showMeta[id] || { id }, { feedUrl: fu, art: (showMeta[id] || {}).art || r.artworkUrl600 || '' });
      }
      if (!fu) throw new Error('no feed');
      const u = parseFeedArt(await readFeedHead(fu));
      if (!u) throw new Error('no artwork in feed');
      feedArt[id] = { u, t: Date.now() };
    } catch (e) {
      // keep a previously found image if a refresh fails
      feedArt[id] = prev && prev.u ? { u: prev.u, t: Date.now() - ART_TTL + ART_RETRY } : { f: 1, t: Date.now() };
    }
    store.set('feedart', feedArt);
    applyArt(id);
  }

  function feedUrlOf(id) {
    const m = showMeta[id] || {}, l = library.find(x => String(x.id) === String(id)) || {};
    return m.feedUrl || l.feedUrl || (nowPlaying && String(nowPlaying.show.id) === String(id) && nowPlaying.show.feedUrl) || '';
  }

  async function readFeedHead(url) {
    url = url.replace(/^http:\/\//i, 'https://');
    let lastErr;
    for (const route of FEED_ROUTES) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch(route(url), { signal: ctrl.signal, credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        let text = '';
        if (res.body && res.body.getReader) {
          const rd = res.body.getReader(), dec = new TextDecoder();
          for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            text += dec.decode(value, { stream: true });
            if (/<item[\s>]/i.test(text) || text.length > 500000) { try { rd.cancel(); } catch {} break; }
          }
        } else text = await res.text();
        if (!/<(rss|channel|feed)[\s>]/i.test(text)) throw new Error('not a feed');
        return text;
      } catch (e) { lastErr = e; }
      finally { clearTimeout(timer); }
    }
    throw lastErr || new Error('feed unavailable');
  }

  function parseFeedArt(xml) {
    const head = xml.split(/<item[\s>]/i)[0];
    const m = head.match(/<itunes:image\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)
      || head.match(/<image\b[^>]*>[\s\S]*?<url>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/i)
      || head.match(/<media:thumbnail\b[^>]*\burl\s*=\s*["']([^"']+)["']/i)
      || head.match(/<logo>\s*([^<\s]+)\s*<\/logo>/i);
    if (!m) return '';
    const u = m[1].replace(/&amp;/g, '&').replace(/&#38;/g, '&').trim().replace(/^http:\/\//i, 'https://');
    return /^https:\/\//i.test(u) ? u : '';
  }

  function applyArt(id) {
    const show = showMeta[id] || library.find(x => String(x.id) === String(id)) || { id };
    const u = artUrl(show);
    if (!u) return;
    $$(`img[data-art-show="${CSS.escape(String(id))}"]`).forEach(img => {
      if (img.getAttribute('src') !== u) img.src = u;
    });
    if (nowPlaying && String(nowPlaying.show.id) === String(id)) setMediaSession();
  }

  // If a feed's image URL itself is broken, fall back to Apple's copy of the cover.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.artShow || img.dataset.fellBack) return;
    const id = img.dataset.artShow;
    const m = (showMeta[id] || library.find(x => String(x.id) === String(id)) || {}).art;
    img.dataset.fellBack = '1';
    if (m) img.src = art(m, 600);
  }, true);

  // ---------------------------------------------------------------- played state
  const isPlayed = (ep) => !!(progress[ep.id] && progress[ep.id].played);
  const posOf = (ep) => (progress[ep.id] && !progress[ep.id].played ? progress[ep.id].p || 0 : 0);
  function setPlayed(ep, played) {
    const cur = progress[ep.id] || {};
    progress[ep.id] = { p: played ? 0 : cur.p || 0, d: cur.d || ep.dur, played, t: Date.now() };
    saveProgress(true);
  }
  function newCount(show) {
    const e = epMem[show.id] || store.get('eps.' + show.id, null);
    if (!e) return null;
    const since = new Date(show.added || 0);
    return e.eps.filter(ep => new Date(ep.date) >= since && !isPlayed(ep)).length;
  }

  // ---------------------------------------------------------------- library
  function addShow(id) {
    if (inLib(id)) return;
    const m = showMeta[id] || { id };
    // "New" means episodes released after you added it — with the latest one lit up
    // so there's always something to start on.
    const added = new Date(Date.now() - 1).toISOString();
    library.unshift({ id: m.id, title: m.title, author: m.author, art: m.art, feedUrl: m.feedUrl || '', added });
    saveLibrary();
    const e = epMem[id];
    if (e) {
      store.set('eps.' + id, e);
      if (e.eps[0]) library[0].added = e.eps[0].date;
      saveLibrary();
    } else {
      fetchEpisodes(id, true).then(eps => {
        const s = library.find(x => String(x.id) === String(id));
        if (s && eps[0]) { s.added = eps[0].date; saveLibrary(); }
      }).catch(() => {});
    }
    toast('Added to Library');
  }
  function removeShow(id) {
    library = library.filter(s => String(s.id) !== String(id));
    saveLibrary();
    store.del('eps.' + id);
    toast('Removed from Library');
  }

  // ---------------------------------------------------------------- audio engine
  const audio = $('#audio');
  let lastSave = 0;

  function loadEpisode(ep, show, autoplay = true) {
    const same = nowPlaying && nowPlaying.ep.id === ep.id && audio.src;
    nowPlaying = { ep, show: { id: show.id, title: show.title, author: show.author, art: show.art, feedUrl: show.feedUrl || feedUrlOf(show.id) } };
    store.set('now', nowPlaying);
    if (!same) {
      audio.src = ep.url;
      audio.playbackRate = speed;
      const start = posOf(ep);
      if (start > 5) {
        const seek = () => { try { audio.currentTime = start; } catch {} };
        audio.addEventListener('loadedmetadata', seek, { once: true });
      }
      setMediaSession();
    }
    if (autoplay) play();
  }

  function play() {
    if (!audio.src && nowPlaying) loadEpisode(nowPlaying.ep, nowPlaying.show, false);
    audio.playbackRate = speed;
    const p = audio.play();
    if (p && p.catch) p.catch(err => {
      if (err && err.name !== 'AbortError') toast("Couldn't start playback");
    });
  }
  const pause = () => audio.pause();
  const toggle = () => (audio.paused ? play() : pause());
  const dur = () => (isFinite(audio.duration) && audio.duration) || (nowPlaying && nowPlaying.ep.dur) || 0;

  function seekBy(delta) {
    if (!audio.src) return;
    const d = dur();
    audio.currentTime = Math.max(0, Math.min(d ? d - 0.5 : Infinity, audio.currentTime + delta));
    persistPos(true);
    paintPlayer();
  }
  function toStart() {
    if (!audio.src) return;
    audio.currentTime = 0;
    persistPos(true);
    paintPlayer();
  }
  function toEnd() {
    if (!audio.src || !nowPlaying) return;
    audio.pause();
    const d = dur();
    if (d) audio.currentTime = Math.max(0, d - 0.05);
    setPlayed(nowPlaying.ep, true);
    toast('Marked as played');
    paintPlayer();
  }

  function persistPos(force) {
    if (!nowPlaying || !audio.src) return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    const ep = nowPlaying.ep, d = dur(), p = audio.currentTime || 0;
    const cur = progress[ep.id] || {};
    const played = cur.played || (d > 60 && p >= d - PLAYED_TAIL);
    progress[ep.id] = { p: played ? 0 : p, d, played, t: now };
    saveProgress(force);
  }

  audio.addEventListener('timeupdate', () => { persistPos(false); paintPlayer(); });
  audio.addEventListener('play', () => { paintPlayer(); setPlaybackState(); });
  audio.addEventListener('pause', () => { persistPos(true); paintPlayer(); setPlaybackState(); });
  audio.addEventListener('waiting', () => paintPlayer(true));
  audio.addEventListener('playing', () => paintPlayer(false));
  audio.addEventListener('loadedmetadata', () => paintPlayer());
  audio.addEventListener('ended', () => {
    if (nowPlaying) setPlayed(nowPlaying.ep, true);
    paintPlayer();
    setPlaybackState();
  });
  let retriedFor = null;
  audio.addEventListener('error', async () => {
    if (!audio.src || !nowPlaying) return;
    const { ep, show } = nowPlaying;
    // Private-feed audio links expire. Re-read the feed once for a fresh link before giving up.
    if (isRss(show.id) && retriedFor !== ep.id) {
      retriedFor = ep.id;
      try {
        const eps = await fetchEpisodes(show.id, true);
        const fresh = eps.find(x => x.id === ep.id);
        if (fresh && fresh.url !== ep.url) {
          const pos = audio.currentTime || posOf(ep);
          nowPlaying.ep = fresh; store.set('now', nowPlaying);
          audio.src = fresh.url;
          audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = pos; } catch {} }, { once: true });
          play();
          return;
        }
      } catch {}
    }
    toast("Couldn't stream this episode");
    paintPlayer(false);
  });
  window.addEventListener('pagehide', () => persistPos(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistPos(true); });

  // Media Session: lets any system/headset media controls drive GlassCast too.
  function setMediaSession() {
    if (!('mediaSession' in navigator) || !nowPlaying) return;
    try {
      const a = artUrl(nowPlaying.show);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: nowPlaying.ep.title,
        artist: nowPlaying.show.title,
        album: 'GlassCast',
        artwork: a ? [{ src: a }] : []
      });
    } catch {}
  }
  function setPlaybackState() {
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing'; } catch {}
    }
  }
  if ('mediaSession' in navigator) {
    const h = {
      play, pause,
      seekbackward: () => seekBy(-SKIP_BACK),
      seekforward: () => seekBy(SKIP_FWD),
      previoustrack: toStart,
      nexttrack: toEnd
    };
    for (const [k, fn] of Object.entries(h)) {
      try { navigator.mediaSession.setActionHandler(k, fn); } catch {}
    }
  }

  // ---------------------------------------------------------------- router (history-backed)
  const app = $('#app');
  const lastFocus = {};        // screen key -> data-key of last focused element
  let current = { name: 'home', params: {}, depth: 0 };
  const screenKey = (st) => st.name + ':' + (st.params && st.params.id || '');

  function go(name, params = {}) {
    rememberFocus();
    let depth = current.depth + 1;
    const st = { name, params, depth };
    if (depth > MAX_DEPTH) { st.depth = current.depth; history.replaceState(st, ''); }
    else history.pushState(st, '');
    render(st);
  }
  function back() {
    if (current.depth > 0) history.back();
    else if (current.name !== 'home') { history.replaceState({ name: 'home', params: {}, depth: 0 }, ''); render({ name: 'home', params: {}, depth: 0 }); }
  }
  window.addEventListener('popstate', (e) => {
    rememberFocus();
    render(e.state || { name: 'home', params: {}, depth: 0 });
  });

  function rememberFocus() {
    const a = document.activeElement;
    if (a && a.dataset && a.dataset.key) lastFocus[screenKey(current)] = a.dataset.key;
  }
  function focusFirst(...cands) {
    const saved = lastFocus[screenKey(current)];
    const el = (saved && $(`[data-key="${CSS.escape(saved)}"]`)) || cands.map(c => typeof c === 'string' ? $(c) : c).find(Boolean);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  function render(st) {
    current = st;
    stopMarquee();
    const r = SCREENS[st.name] || SCREENS.home;
    r(st.params || {});
  }

  const backBtn = (label = 'Back') =>
    `<button class="back" data-act="back" data-key="back" aria-label="Back">${I.back}<span>${label}</span></button>`;

  // Now-playing pill: pinned to the top of every screen while an episode is loaded.
  function nowBar() {
    if (!nowPlaying || !audio.src) return '<div class="nowslot"></div>';
    const playing = !audio.paused && !audio.ended;
    return `<div class="nowslot"><div class="nowbar">
      <button class="nowpill" data-act="player" data-key="now-open" aria-label="Open player: ${esc(nowPlaying.ep.title)}">
        ${logo(playing)}
        <span class="txt"><span class="t">${esc(nowPlaying.ep.title)}</span><span class="s">${esc(nowPlaying.show.title)}</span></span>
        <span class="go">Player</span>
      </button>
      <button class="icon-btn" data-act="toggle" data-key="now-toggle" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? I.pause : I.play}</button>
    </div></div>`;
  }

  // ---------------------------------------------------------------- screens
  const SCREENS = {};

  // HOME / LIBRARY
  SCREENS.home = () => {
    const shows = [...library].sort((a, b) => latestDate(b) - latestDate(a));
    const cont = continueCard();
    app.innerHTML = `${nowBar()}
      <header class="top">
        <div class="brand">${logo(!audio.paused)}<span class="wordmark">Glass<b>Cast</b></span></div>
        <button class="icon-btn" data-act="search" data-key="search" aria-label="Search podcasts">${I.search}</button>
      </header>
      <main class="content" id="scroller">
        ${cont}
        ${shows.length ? `<h2 class="sect">Library</h2><div class="list">${shows.map(showRow).join('')}</div>` : `
          <div class="status">
            ${logo(true)}
            <div class="big">Your Library is empty</div>
            <div>Search for a show and add it here.</div>
            <button class="pill primary" data-act="search" data-key="empty-search">${I.search}<span>Find a show</span></button>
          </div>`}
      </main>
`;
    focusFirst('.continue', '.row', '[data-act="search"]');
    refreshLibrary();
  };

  function latestDate(show) {
    const e = epMem[show.id] || store.get('eps.' + show.id, null);
    return e && e.eps[0] ? new Date(e.eps[0].date).getTime() : new Date(show.added || 0).getTime();
  }

  function badgeHtml(show) {
    const n = newCount(show);
    if (n == null) return '';
    return n ? `<span class="badge" aria-label="${n} new">${n > 99 ? '99+' : n} new</span>` : `<span class="badge quiet">Up to date</span>`;
  }

  function showRow(s) {
    const e = epMem[s.id] || store.get('eps.' + s.id, null);
    const latest = e && e.eps[0] ? 'Latest · ' + fmtDate(e.eps[0].date) : esc(s.author);
    return `<div class="rowwrap libitem" data-libitem="${esc(s.id)}">
      <button class="row" data-act="show" data-id="${s.id}" data-key="show-${s.id}">
        ${artImg(s)}
        <span class="txt"><div class="t">${esc(s.title)}</div><div class="s">${latest}</div></span>
        <span data-badge="${s.id}">${badgeHtml(s)}</span>
      </button>
      <button class="rm" data-act="libremove" data-id="${s.id}" data-key="rm-${s.id}" aria-label="Remove ${esc(s.title)} from Library">${I.trash}<span>Remove?</span></button>
    </div>`;
  }

  function continueCard() {
    if (!nowPlaying || audio.src) return '';
    const { ep, show } = nowPlaying;
    const pr = progress[ep.id];
    if (!pr || pr.played || !(pr.p > 5)) return '';
    const d = pr.d || ep.dur || 1;
    return `<h2 class="sect">Continue listening</h2>
      <button class="continue" data-act="resume" data-key="continue">
        ${artImg(show, 'art', false)}
        <span class="txt">
          <div class="k">${esc(show.title)}</div>
          <div class="t">${esc(ep.title)}</div>
          <div class="meter"><i style="width:${Math.min(100, (pr.p / d) * 100).toFixed(1)}%"></i></div>
        </span>
      </button>`;
  }

  let refreshing = false;
  async function refreshLibrary() {
    if (refreshing) return;
    refreshing = true;
    for (const s of library) {
      try {
        await fetchEpisodes(s.id);
        const slot = $(`[data-badge="${s.id}"]`);
        if (slot) slot.innerHTML = badgeHtml(s);
        const row = $(`[data-act="show"][data-id="${s.id}"] .s`);
        const e = epMem[s.id];
        if (row && e && e.eps[0]) row.textContent = 'Latest · ' + fmtDate(e.eps[0].date);
      } catch {}
    }
    refreshing = false;
  }

  // SEARCH
  let lastSearch = { q: '', results: null, error: null, loading: false, feed: false };
  let kbOpen = false, kbShift = false;
  SCREENS.search = () => {
    app.innerHTML = `${nowBar()}
      <header class="top">
        ${backBtn('')}
        <form class="searchbar ${lastSearch.q ? 'has-text' : ''}" id="sform" role="search" autocomplete="off">
          <input id="q" type="search" enterkeyhint="search" autocapitalize="off" spellcheck="false" placeholder="Show name or RSS feed" value="${esc(lastSearch.q)}" data-key="q" aria-label="Search by show name, or enter an RSS feed address">
          <button type="button" class="clearq" data-act="clearq" data-key="clearq" aria-label="Clear search">${I.x}</button>
        </form>
        <button class="icon-btn kbtoggle ${kbOpen ? 'on' : ''}" data-act="keyboard" data-key="kb" aria-label="${kbOpen ? 'Hide keyboard' : 'Show keyboard'}">${I.kbd}</button>
        <button class="pill gobtn" data-act="dosearch" data-key="go">${I.search}<span>Search</span></button>
      </header>
      <main class="content" id="results">${kbOpen ? keyboardHtml() : resultsHtml()}</main>`;
    const q = $('#q');
    $('#sform').addEventListener('submit', (e) => { e.preventDefault(); runSearch(q.value); });
    let deb = 0;
    // Dictation/handwriting arrives in one go when the glasses' text panel closes, so search
    // as soon as the text lands and then move the highlight onto the results.
    q.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => runSearch(q.value, true), 700); });
    q.addEventListener('change', () => { clearTimeout(deb); runSearch(q.value, true); });
    q.addEventListener('input', () => syncClear());
    if (kbOpen) focusFirst(q.value ? '[data-key="k-go"]' : '[data-key="k-https"]');
    else focusFirst(lastSearch.results && lastSearch.results.length ? '#results .row' : '[data-key="go"]', '#q');
  };

  // On-screen keyboard (for typing feed addresses, which dictation can't do well).
  const KB_ROWS = [
    '1234567890'.split(''),
    'qwertyuiop'.split(''),
    'asdfghjkl-'.split(''),
    'zxcvbnm./:'.split(''),
    [['https://', 'https'], ['www.', 'www'], ['.com', 'com'], ['.xml', 'xml'], ['?', 'q'], ['=', 'eq'], ['&', 'amp'], ['_', 'us']],
  ];
  function keyboardHtml() {
    const key = (label, k, cls = '') => {
      const shown = kbShift && /^[a-z]$/.test(label) ? label.toUpperCase() : label;
      return `<button class="key ${cls}" data-act="key" data-k="${esc(label)}" data-key="k-${esc(k)}">${esc(shown)}</button>`;
    };
    const rows = KB_ROWS.map((row, i) => `<div class="krow ${i === 4 ? 'wide' : ''}">${row.map(c =>
      Array.isArray(c) ? key(c[0], c[1], 'chunk') : key(c, c === '/' ? 'slash' : c === '.' ? 'dot' : c === ':' ? 'colon' : c === '-' ? 'dash' : c)).join('')}</div>`).join('');
    return `<div class="kb" role="group" aria-label="Keyboard">
      ${rows}
      <div class="krow fn">
        <button class="key fnk ${kbShift ? 'on' : ''}" data-act="kshift" data-key="k-shift" aria-label="Capital letters">${kbShift ? 'ABC' : 'abc'}</button>
        <button class="key fnk space" data-act="key" data-k=" " data-key="k-space">space</button>
        <button class="key fnk" data-act="kback" data-key="k-back" aria-label="Delete">${I.bksp}</button>
        <button class="key fnk" data-act="kclear" data-key="k-clear">Clear</button>
        <button class="key fnk go" data-act="dosearch" data-key="k-go">${I.search}<span>Search</span></button>
      </div>
    </div>`;
  }
  function kbType(fn) {
    const q = $('#q');
    if (!q) return;
    q.value = fn(q.value);
    lastSearch.q = q.value;
    q.scrollLeft = q.scrollWidth;
    syncClear();
  }
  function syncClear() {
    const f = $('#sform'), q = $('#q');
    if (f && q) f.classList.toggle('has-text', !!q.value);
  }

  function resultsHtml() {
    const s = lastSearch;
    if (s.loading) return `<div class="searching">${s.feed ? 'Reading feed' : 'Searching for'} “${esc(s.q)}”…</div><div class="list">${'<div class="skel"></div>'.repeat(4)}</div>`;
    if (s.error) return s.feed
      ? `<div class="status"><div class="big">Couldn't read that feed</div><div>${esc(feedErrorText(s.error))}</div>
          <button class="pill" data-act="clearq" data-key="err-clear">${I.x}<span>Clear and start again</span></button></div>`
      : `<div class="status"><div class="big">Search failed</div><div>Check your connection and try again.</div></div>`;
    if (!s.results) return `<div class="status">${logo(false)}<div>Find shows by name, host, topic or RSS feed.</div>
      <button class="pill" data-act="keyboard" data-key="kb-open">${I.kbd}<span>Type with keyboard</span></button></div>`;
    if (!s.results.length) return `<div class="status"><div class="big">No shows found</div><div>Try a different search.</div></div>`;
    return `<div class="list">${s.results.map(r => {
      const on = inLib(r.id);
      return `<div class="rowwrap">
        <button class="row" data-act="show" data-id="${r.id}" data-key="res-${r.id}">
          ${artImg(r)}
          <span class="txt"><div class="t">${esc(r.title)}</div><div class="s">${r.rss ? 'From RSS feed' + (r.author ? ' · ' + esc(r.author) : '') : esc(r.author)}</div></span>
        </button>
        <button class="add ${on ? 'on' : ''}" data-act="toggleadd" data-id="${r.id}" data-key="add-${r.id}" aria-label="${on ? 'In Library — remove' : 'Add to Library'}">${on ? I.check : I.plus}</button>
      </div>`;
    }).join('')}</div>`;
  }

  let searchSeq = 0;
  async function runSearch(term, quiet = false) {
    term = (term || '').trim();
    if (!term) return;
    if (term === lastSearch.q && (lastSearch.loading || (lastSearch.results && quiet))) return;
    kbOpen = false;
    const kb = $('.kbtoggle'); if (kb) kb.classList.remove('on');
    syncClear();
    const feed = feedAddress(term);
    const seq = ++searchSeq;
    lastSearch = { q: term, results: null, error: null, loading: true, feed: !!feed };
    paintResults(false);
    try {
      const res = feed ? await lookupFeed(feed) : await searchShows(term);
      if (seq !== searchSeq) return;
      lastSearch = { q: term, results: res, error: null, loading: false, feed: !!feed };
    } catch (e) {
      if (seq !== searchSeq) return;
      lastSearch = { q: term, results: null, error: e, loading: false, feed: !!feed };
    }
    paintResults(true);
  }
  function paintResults(moveFocus) {
    const box = $('#results');
    if (!box || current.name !== 'search') return;
    box.innerHTML = resultsHtml();
    box.scrollTop = 0;
    if (moveFocus) {
      const f = $('#results .row') || $('#results button') || $('[data-key="go"]');
      if (f) f.focus({ preventScroll: true });
    }
  }

  // SHOW (episodes)
  SCREENS.show = async ({ id }) => {
    const s = showMeta[id] || library.find(x => String(x.id) === String(id)) || { id, title: '', author: '' };
    const on = inLib(id);
    app.innerHTML = `${nowBar()}
      <header class="top">${backBtn()}</header>
      <main class="content" id="scroller">
        <div class="hero">
          ${artImg(s, 'art', false)}
          <div><h1>${esc(s.title)}</h1><p>${esc(s.author)}</p></div>
        </div>
        <div class="actions">
          <button class="pill ${on ? '' : 'primary'}" data-act="libtoggle" data-id="${id}" data-key="libtoggle">${on ? I.check + '<span>In Library</span>' : I.plus + '<span>Add to Library</span>'}</button>
          <button class="pill" data-act="allplayed" data-id="${id}" data-key="allplayed">${I.checks}<span>Mark all played</span></button>
        </div>
        <h2 class="sect">Episodes</h2>
        <div class="list" id="eps"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
      </main>
`;
    focusFirst('[data-act="libtoggle"]');
    const token = current;
    try {
      const eps = await fetchEpisodes(id);
      if (current !== token) return;
      paintEpisodes(id, eps);
    } catch {
      if (current !== token) return;
      $('#eps').innerHTML = `<div class="status"><div class="big">Couldn't load episodes</div><button class="pill" data-act="retry" data-key="retry">Try again</button></div>`;
    }
  };

  function epRow(ep, showId) {
    const pr = progress[ep.id];
    const played = isPlayed(ep);
    const now = nowPlaying && nowPlaying.ep.id === ep.id;
    const d = (pr && pr.d) || ep.dur;
    const pos = posOf(ep);
    let meta = [fmtDate(ep.date), fmtDur(ep.dur)].filter(Boolean).join(' · ');
    if (played) meta += ' · Played';
    else if (pos > 5 && d) meta += ' · ' + fmtDur(Math.max(60, d - pos)) + ' left';
    if (now && !audio.paused) meta = 'Now playing · ' + meta;
    return `<div class="epwrap" data-ep="${ep.id}">
      <button class="ep ${played ? 'played' : ''} ${now ? 'now' : ''}" data-act="play" data-id="${ep.id}" data-show="${showId}" data-key="ep-${ep.id}">
        <span class="dot"></span>
        <span class="et">${esc(ep.title)}</span>
        <span class="em">${meta}</span>
        ${!played && pos > 5 && d ? `<span class="meter"><i style="width:${Math.min(100, pos / d * 100).toFixed(1)}%"></i></span>` : ''}
      </button>
      <button class="mark ${played ? 'on' : ''}" data-act="markplayed" data-id="${ep.id}" data-show="${showId}" data-key="mk-${ep.id}" aria-label="${played ? 'Mark as unplayed' : 'Mark as played'}">${I.check}</button>
    </div>`;
  }

  function paintEpisodes(id, eps) {
    const box = $('#eps');
    if (!box) return;
    const hadFocus = box.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    box.innerHTML = eps.length ? eps.map(e => epRow(e, id)).join('')
      : `<div class="status"><div>No streamable episodes found.</div></div>`;
    const saved = lastFocus[screenKey(current)];
    const target = (hadFocus && $(`[data-key="${CSS.escape(hadFocus)}"]`))
      || (saved && $(`[data-key="${CSS.escape(saved)}"]`))
      || $('#eps .ep:not(.played)')
      || $('#eps .ep');
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
    // Hero hidden if we scrolled down to an older unplayed ep — that's fine; Up gets back.
  }

  function repaintEp(epId) {
    const wrap = $(`[data-ep="${CSS.escape(epId)}"]`);
    if (!wrap) return;
    const showId = wrap.querySelector('.ep').dataset.show;
    const ep = findEp(showId, epId);
    if (!ep) return;
    const focusKey = document.activeElement && document.activeElement.dataset.key;
    wrap.outerHTML = epRow(ep, showId);
    if (focusKey) { const f = $(`[data-key="${CSS.escape(focusKey)}"]`); if (f) f.focus({ preventScroll: true }); }
  }
  function findEp(showId, epId) {
    const e = epMem[showId];
    return e && e.eps.find(x => x.id === String(epId));
  }

  // PLAYER
  let marqueeTimers = [];
  function stopMarquee() { marqueeTimers.forEach(clearTimeout); marqueeTimers = []; }

  SCREENS.player = () => {
    if (!nowPlaying) return SCREENS.home();
    const { ep, show } = nowPlaying;
    app.innerHTML = `<div class="nowslot"></div>
      <header class="top player-top">
        ${backBtn()}
        <div class="pl-kicker">Now playing</div>
        <button class="pill speed" data-act="speed" data-key="speed" aria-label="Playback speed">${speed}×</button>
      </header>
      <main class="player" id="player">
        <div class="cover-wrap">${artImg(show, 'cover', false)}</div>
        <div class="show-name">${esc(show.title)}</div>
        <div class="marquee" id="mq"><span>${esc(ep.title)}</span></div>
        <div class="timeline">
          <div class="meter"><i id="bar" style="width:0%"></i></div>
          <div class="times"><span id="tcur">0:00</span><span id="tleft">-0:00</span></div>
        </div>
        <div class="controls">
          <button class="ctl small" data-act="tostart" data-key="c-start" aria-label="Back to start">${I.start}</button>
          <button class="ctl" data-act="rew" data-key="c-rew" aria-label="Back ${SKIP_BACK} seconds">${I.rew}<span class="num">${SKIP_BACK}</span></button>
          <button class="ctl main" data-act="toggle" data-key="c-play" aria-label="Play">${I.play}</button>
          <button class="ctl" data-act="fwd" data-key="c-fwd" aria-label="Forward ${SKIP_FWD} seconds">${I.fwd}<span class="num">${SKIP_FWD}</span></button>
          <button class="ctl small" data-act="toend" data-key="c-end" aria-label="Skip to end">${I.end}</button>
        </div>
      </main>`;
    paintPlayer();
    const saved = lastFocus[screenKey(current)];
    const f = (saved && $(`[data-key="${saved}"]`)) || $('[data-key="c-play"]');
    f.focus({ preventScroll: true });
    startMarquee();
  };

  // Long titles: wait, scroll slowly to the end once, pause, then settle back to the start.
  function startMarquee() {
    const box = $('#mq');
    if (!box) return;
    const span = box.firstElementChild;
    requestAnimationFrame(() => {
      const over = span.scrollWidth - (box.clientWidth - 32);
      if (over <= 4) return;
      box.classList.add('overflow');
      const pxPerSec = 32;
      const dur = Math.max(3, over / pxPerSec);
      marqueeTimers.push(setTimeout(() => {
        span.style.transition = `transform ${dur}s linear, opacity .5s`;
        span.style.transform = `translateX(${-over}px)`;
        marqueeTimers.push(setTimeout(() => {
          span.style.opacity = '0';
          marqueeTimers.push(setTimeout(() => {
            span.style.transition = 'opacity .5s';
            span.style.transform = 'translateX(0)';
            span.style.opacity = '1';
          }, 550));
        }, dur * 1000 + 2500));
      }, 2200));
    });
  }

  let lastPaintedPlaying = null;
  function paintPlayer(buffering) {
    const playing = !audio.paused && !audio.ended;
    // Player screen
    if (current.name === 'player' && $('#player')) {
      const d = dur(), c = audio.src ? audio.currentTime || 0 : posOf(nowPlaying.ep);
      const bar = $('#bar');
      if (bar) bar.style.width = (d ? Math.min(100, c / d * 100) : 0).toFixed(2) + '%';
      $('#tcur').textContent = fmtClock(c);
      $('#tleft').textContent = '-' + fmtClock(Math.max(0, d - c));
      const btn = $('[data-act="toggle"].main');
      if (btn && lastPaintedPlaying !== playing) {
        btn.innerHTML = playing ? I.pause : I.play;
        btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      }
      if (btn && buffering !== undefined) btn.classList.toggle('buffering', !!buffering && !audio.paused);
      $('#player').classList.toggle('playing', playing);
    }
    // Mini player + live logo elsewhere
    if (lastPaintedPlaying !== playing) {
      const mt = $('.nowbar [data-act="toggle"]');
      if (mt) { mt.innerHTML = playing ? I.pause : I.play; mt.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
      $$('.logo').forEach(l => l.classList.toggle('live', playing || l.closest('.status') !== null));
      if (current.name === 'show' && nowPlaying) repaintEp(nowPlaying.ep.id);
    }
    lastPaintedPlaying = playing;
  }

  // Two-step confirm: the first press arms the button, a second press within 4 s confirms.
  // Moving the highlight away (or waiting) cancels it.
  function armConfirm(b, revert) {
    if (b.dataset.armed === '1') { delete b.dataset.armed; clearTimeout(b._armT); return true; }
    b.dataset.armed = '1';
    const cancel = () => {
      if (b.dataset.armed !== '1') return;
      delete b.dataset.armed; clearTimeout(b._armT); revert();
    };
    b._armT = setTimeout(cancel, 4000);
    b.addEventListener('blur', cancel, { once: true });
    return false;
  }

  // ---------------------------------------------------------------- actions
  const ACTIONS = {
    back,
    search: () => go('search'),
    dosearch: () => { const q = $('#q'); if (q) runSearch(q.value); },
    show: (b) => go('show', { id: b.dataset.id }),
    player: () => go('player'),
    resume: () => { if (nowPlaying) { loadEpisode(nowPlaying.ep, nowPlaying.show, true); go('player'); } },
    toggle: () => { toggle(); },
    rew: () => seekBy(-SKIP_BACK),
    fwd: () => seekBy(SKIP_FWD),
    tostart: toStart,
    toend: toEnd,
    speed: (b) => {
      speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
      audio.playbackRate = speed;
      store.set('speed', speed);
      b.textContent = speed + '×';
    },
    toggleadd: (b) => {
      const id = b.dataset.id;
      if (inLib(id)) {
        if (!armConfirm(b, () => {
          b.classList.add('on'); b.innerHTML = I.check; b.setAttribute('aria-label', 'In Library — remove');
        })) {
          b.classList.remove('confirm', 'wide'); b.classList.remove('on');
          b.innerHTML = 'Remove?'; b.classList.add('confirm', 'wide');
          b.setAttribute('aria-label', 'Press again to remove from Library');
          return;
        }
        removeShow(id);
      } else addShow(id);
      const on = inLib(id);
      b.classList.remove('confirm', 'wide');
      b.classList.toggle('on', on);
      b.innerHTML = on ? I.check : I.plus;
      b.setAttribute('aria-label', on ? 'In Library — remove' : 'Add to Library');
    },
    libtoggle: (b) => {
      const id = b.dataset.id;
      const paint = () => {
        const on = inLib(id);
        b.classList.remove('confirm');
        b.classList.toggle('primary', !on);
        b.innerHTML = on ? I.check + '<span>In Library</span>' : I.plus + '<span>Add to Library</span>';
      };
      if (inLib(id)) {
        if (!armConfirm(b, paint)) {
          b.classList.remove('primary'); b.classList.add('confirm');
          b.innerHTML = I.trash + '<span>Remove from Library?</span>';
          return;
        }
        removeShow(id);
      } else addShow(id);
      paint();
    },
    libremove: (b) => {
      const id = b.dataset.id;
      if (!armConfirm(b, () => b.classList.remove('confirm'))) { b.classList.add('confirm'); return; }
      const item = b.closest('.libitem');
      removeShow(id);
      // move the highlight to a neighbouring show (or Search if the Library is now empty)
      const next = item && (item.nextElementSibling || item.previousElementSibling);
      if (item) {
        item.classList.add('leaving');
        setTimeout(() => {
          item.remove();
          const f = next && next.querySelector('.row');
          if (f) f.focus({ preventScroll: true });
          else render(current);
        }, 260);
      }
    },
    clearq: () => {
      const q = $('#q');
      if (q) q.value = '';
      lastSearch = { q: '', results: null, error: null, loading: false, feed: false };
      searchSeq++;
      syncClear();
      const box = $('#results');
      if (box) box.innerHTML = kbOpen ? keyboardHtml() : resultsHtml();
      const f = kbOpen ? $('[data-key="k-https"]') : q;
      if (f) f.focus({ preventScroll: true });
      toast('Search cleared');
    },
    allplayed: (b) => {
      const e = epMem[b.dataset.id];
      if (!e) return;
      const allDone = e.eps.every(isPlayed);
      e.eps.forEach(ep => {
        const cur = progress[ep.id] || {};
        progress[ep.id] = { p: allDone ? cur.p || 0 : 0, d: cur.d || ep.dur, played: !allDone, t: Date.now() };
      });
      saveProgress(true);
      paintEpisodes(b.dataset.id, e.eps);
      b.focus();
      b.querySelector('span').textContent = allDone ? 'Mark all played' : 'Mark all unplayed';
      toast(allDone ? 'All marked unplayed' : 'All marked played');
    },
    markplayed: (b) => {
      const ep = findEp(b.dataset.show, b.dataset.id);
      if (!ep) return;
      setPlayed(ep, !isPlayed(ep));
      repaintEp(ep.id);
    },
    play: (b) => {
      const ep = findEp(b.dataset.show, b.dataset.id);
      const show = showMeta[b.dataset.show] || library.find(s => String(s.id) === b.dataset.show);
      if (!ep || !show) return;
      const same = nowPlaying && nowPlaying.ep.id === ep.id && audio.src;
      if (!same) {
        if (nowPlaying) persistPos(true);
        // Replaying a heard episode starts from the top; it stays "heard" until you finish or un-mark it.
        loadEpisode(ep, show, true);
      } else if (audio.paused) play();
      go('player');
    },
    retry: () => render(current),
    keyboard: () => {
      kbOpen = !kbOpen;
      const box = $('#results'), t = $('.kbtoggle');
      if (!box) return;
      box.innerHTML = kbOpen ? keyboardHtml() : resultsHtml();
      box.scrollTop = 0;
      if (t) { t.classList.toggle('on', kbOpen); t.setAttribute('aria-label', kbOpen ? 'Hide keyboard' : 'Show keyboard'); }
      const f = kbOpen ? ($('#q').value ? $('[data-key="k-go"]') : $('[data-key="k-https"]')) : ($('#results .row') || t);
      if (f) f.focus({ preventScroll: true });
    },
    key: (b) => {
      let k = b.dataset.k;
      if (kbShift && /^[a-z]$/.test(k)) k = k.toUpperCase();
      kbType(v => v + k);
    },
    kback: () => kbType(v => v.slice(0, -1)),
    kclear: () => kbType(() => ''),
    kshift: (b) => {
      kbShift = !kbShift;
      b.classList.toggle('on', kbShift);
      b.textContent = kbShift ? 'ABC' : 'abc';
      $$('.key[data-k]').forEach(el => { const k = el.dataset.k; if (/^[a-z]$/.test(k)) el.textContent = kbShift ? k.toUpperCase() : k; });
    }
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.preventDefault();
    const fn = ACTIONS[b.dataset.act];
    if (fn) fn(b);
  });

  // Keyboard shortcuts that don't fight spatial navigation.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Backspace' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); back();
    } else if (e.key === ' ' && current.name === 'player' && document.activeElement.tagName !== 'BUTTON') {
      e.preventDefault(); toggle();
    }
  });

  // ---------------------------------------------------------------- spatial navigation
  // GlassCast moves focus itself rather than relying on the WebView's built-in spatial
  // navigation. The built-in navigator won't enter a scrolling list from the header (on the
  // glasses you could never reach the episode list), so this one is used everywhere: it can
  // reach off-screen items and scrolls them into view. ?nav=native turns it off for testing.
  const navParam = new URLSearchParams(location.search).get('nav');
  const useJsNav = navParam !== 'native';
  if (useJsNav) {
    document.documentElement.classList.add('js-nav');
    const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const FOCUSABLE = 'button:not([disabled]), input, a[href]';
    // The screen is three regions: the now-playing pill (.nowbar), the header (.top) and
    // the scrolling body (.content / .player). Moves stay inside a region where possible — including
    // items scrolled out of view — and only hop to the next region at its edge.
    const regionOf = (el) => el && el.closest('.nowbar, .top, .content, .player, #app');
    const regions = () => $$('.nowbar, .top, .content, .player').filter(r => r.offsetParent !== null || r.getClientRects().length);
    const visibleIn = (el, region) => {
      const r = el.getBoundingClientRect(), v = region.getBoundingClientRect();
      return r.bottom > v.top + 4 && r.top < v.bottom - 4;
    };

    function pick(cands, from, dir) {
      const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
      let best = null, bestScore = Infinity;
      for (const el of cands) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const along = (cx - fx) * dir[0] + (cy - fy) * dir[1];
        if (along <= 4) continue;
        const overlap = dir[0]
          ? Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top)
          : Math.min(r.right, from.right) - Math.max(r.left, from.left);
        if (dir[0] && overlap <= 0) continue; // left/right only moves along the same row
        const cross = overlap > 0 ? 0 : Math.abs(cx - fx);
        const score = along + cross * 3;
        if (score < bestScore) { bestScore = score; best = el; }
      }
      return best;
    }

    function move(dir) {
      const a = document.activeElement;
      const all = $$(FOCUSABLE, app);
      if (!a || a === document.body || !app.contains(a)) {
        const first = all.find(el => el.offsetParent !== null);
        if (first) focusEl(first);
        return;
      }
      const from = a.getBoundingClientRect();
      const home = regionOf(a);
      // 1) same region (even if scrolled out of view)
      let best = pick(all.filter(el => el !== a && regionOf(el) === home), from, dir);
      // 2) neighbouring region in that direction — enter at the visible edge
      if (!best && dir[1] !== 0) {
        const rs = regions();
        let i = rs.indexOf(home) + dir[1];
        while (!best && i >= 0 && i < rs.length) {
          const reg = rs[i];
          const inReg = all.filter(el => regionOf(el) === reg);
          const vis = inReg.filter(el => visibleIn(el, reg));
          const pool = vis.length ? vis : inReg;
          // pick the item nearest the edge we're entering from, closest horizontally
          const fx = from.left + from.width / 2;
          pool.sort((p, q) => {
            const rp = p.getBoundingClientRect(), rq = q.getBoundingClientRect();
            const ep = dir[1] > 0 ? rp.top : -rp.bottom, eq = dir[1] > 0 ? rq.top : -rq.bottom;
            if (Math.abs(ep - eq) > 8) return ep - eq;
            return Math.abs(rp.left + rp.width / 2 - fx) - Math.abs(rq.left + rq.width / 2 - fx);
          });
          best = pool[0] || null;
          i += dir[1];
        }
      }
      // 3) Left at the edge of a list jumps to Back
      if (!best && dir[0] < 0) best = $('[data-act="back"]', app);
      if (best) focusEl(best);
      else if (home && home.classList.contains('content')) home.scrollBy({ top: dir[1] * 160 });
    }

    function focusEl(el) {
      el.focus({ preventScroll: true });
      const sc = el.closest('.content');
      if (sc) {
        const r = el.getBoundingClientRect(), v = sc.getBoundingClientRect(), pad = 16;
        if (r.top < v.top + pad) sc.scrollTop -= (v.top + pad - r.top);
        else if (r.bottom > v.bottom - pad) sc.scrollTop += (r.bottom - (v.bottom - pad));
      }
    }

    document.addEventListener('keydown', (e) => {
      const dir = DIRS[e.key];
      if (!dir) return;
      const a = document.activeElement;
      e.preventDefault();
      move(dir);
    });
  }

  // ---------------------------------------------------------------- boot
  history.replaceState({ name: 'home', params: {}, depth: 0 }, '');
  render({ name: 'home', params: {}, depth: 0 });
})();
