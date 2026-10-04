/* ============================================================
   Dra. Rayssa Gomes — Psicóloga
   Motor de interação e animações
   ------------------------------------------------------------
   Arquitetura: um único loop de requestAnimationFrame que
   concentra revelações, parallax e efeitos de scroll.
   Os efeitos de scroll só são recalculados quando a página
   realmente rola (flag "dirty"), mantendo o custo baixo.
   ============================================================ */
(() => {
    'use strict';

    /* ---------- UTILIDADES ---------- */
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const FINE = window.matchMedia('(pointer: fine)').matches;

    // Contato centralizado: país + DDD + número, somente dígitos.
    // Exemplo: '5511999999999'. Vazio abre o WhatsApp sem destinatário definido.
    const WHATSAPP_PHONE = '';
    const WHATSAPP_MESSAGE = 'Olá, gostaria de saber mais sobre a terapia online.';

    const state = { y: window.scrollY, dirty: true, vw: innerWidth, vh: innerHeight };

    function initWhatsappLinks() {
        const phone = WHATSAPP_PHONE.replace(/\D/g, '');
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

        $$('[data-whatsapp]').forEach(link => {
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        });
    }

    /* ---------- PRELOADER ---------- */
    const loader = $('#loader');
    const loaderDone = new Promise(resolve => {
        if (!loader) return resolve();
        const min = REDUCED ? 100 : 900;
        const t0 = performance.now();
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            setTimeout(() => {
                loader.classList.add('is-done');
                document.body.classList.remove('is-locked');
                setTimeout(() => loader.remove(), 900);
                resolve();
            }, Math.max(0, min - (performance.now() - t0)));
        };
        if (document.readyState === 'complete') finish();
        else window.addEventListener('load', finish, { once: true });
        setTimeout(finish, 3000);
    });
    if (loader) document.body.classList.add('is-locked');

    /* ---------- SPLIT DE TEXTO ---------- */
    const splitTargets = [];

    function splitElement(el, mode) {
        const frag = document.createDocumentFragment();
        let i = 0;
        const style = n => `--d:${Math.min(n, 44)}`;

        const unit = node => {
            const w = document.createElement('span'); w.className = 'split-w';
            const inner = document.createElement('span');
            inner.className = 'split-i';
            inner.setAttribute('style', style(i++));
            if (mode === 'chars' && node.nodeType === 3) {
                for (const ch of node.textContent) {
                    const c = document.createElement('span');
                    c.className = 'split-c';
                    c.textContent = ch;
                    c.setAttribute('style', style(i++));
                    inner.appendChild(c);
                }
            } else {
                inner.appendChild(node);
            }
            w.appendChild(inner);
            frag.appendChild(w);
        };

        const pushWords = node => {
            for (const part of node.textContent.split(/(\s+)/)) {
                if (!part) continue;
                if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); continue; }
                unit(document.createTextNode(part));
            }
        };

        Array.from(el.childNodes).forEach(node => {
            if (node.nodeType === 3) { pushWords(node); return; }
            if (node.nodeType !== 1) return;
            const textOnly = Array.from(node.childNodes).every(c => c.nodeType === 3);
            if (textOnly && !node.classList?.contains('u')) {
                for (const part of node.textContent.split(/(\s+)/)) {
                    if (!part) continue;
                    if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); continue; }
                    const clone = node.cloneNode(false);
                    clone.textContent = part;
                    unit(clone);
                }
            } else {
                unit(node);
            }
        });

        el.textContent = '';
        el.appendChild(frag);
    }

    function initSplit() {
        $$('[data-split]').forEach(el => {
            splitElement(el, el.dataset.split === 'chars' ? 'chars' : 'words');
            splitTargets.push(el);
        });
    }

    /* ---------- REVELAÇÕES ---------- */
    let pendingReveals = [];

    function initReveal() {
        $$('[data-stagger]').forEach(group => {
            $$('[data-reveal]', group).forEach((el, i) => el.style.setProperty('--d', i));
        });
        $$('[data-reveal][data-delay]').forEach(el => el.style.setProperty('--d', el.dataset.delay));

        pendingReveals = [...$$('[data-reveal]'), ...splitTargets].map(el => ({ el, done: false }));
        if (REDUCED) { pendingReveals.forEach(o => o.el.classList.add('is-in')); pendingReveals = []; }
    }

    function checkReveals() {
        if (!pendingReveals.length) return;
        const limit = state.vh * 0.9;
        const next = [];
        for (const item of pendingReveals) {
            const r = item.el.getBoundingClientRect();
            if (r.top < limit && r.bottom > -state.vh * 0.25) {
                item.el.classList.add('is-in');
                const onEnd = ev => {
                    if (ev.propertyName === 'transform') {
                        item.el.style.willChange = 'auto';
                        if (item.el.dataset.reveal === 'clip' || item.el.dataset.reveal === 'mask') {
                            item.el.style.clipPath = 'none';
                        }
                        item.el.removeEventListener('transitionend', onEnd);
                    }
                };
                item.el.addEventListener('transitionend', onEnd);
            } else {
                next.push(item);
            }
        }
        pendingReveals = next;
    }

    /* ---------- PARALLAX ---------- */
    let parallax = [];
    function initParallax() {
        if (REDUCED) return;
        const map = new Map(); // um único registro por elemento (pode ter scroll + mouse)
        const reg = el => {
            let o = map.get(el);
            if (!o) { o = { el, speed: 0, mouse: 0, base: 0, useVars: el.hasAttribute('data-var') }; map.set(el, o); }
            return o;
        };
        $$('[data-parallax]').forEach(el => { reg(el).speed = parseFloat(el.dataset.parallax) || 0.05; });
        $$('[data-mouse]').forEach(el => { reg(el).mouse = parseFloat(el.dataset.mouse) || 0.02; });
        parallax = [...map.values()];
        measureParallax();
    }

    // Mede a posição "natural" (sem transform/animação) para evitar realimentação
    function measureParallax() {
        for (const it of parallax) {
            if (!it.speed) continue;
            const prevTransform = it.el.style.transform;
            const prevAnim = it.el.style.animation;
            it.el.style.transform = 'none';
            it.el.style.animation = 'none';
            const r = it.el.getBoundingClientRect();
            it.base = r.top + window.scrollY + r.height / 2;
            it.el.style.transform = prevTransform;
            it.el.style.animation = prevAnim;
        }
    }

    const pointer = { x: 0, y: 0, cx: 0, cy: 0 };
    window.addEventListener('pointermove', e => {
        pointer.x = (e.clientX - state.vw / 2) / (state.vw / 2);
        pointer.y = (e.clientY - state.vh / 2) / (state.vh / 2);
        state.dirty = true; // mantém o parallax de mouse ativo sem depender do scroll
    }, { passive: true });

    /* ---------- TILT + SPOTLIGHT ---------- */
    function initTilt() {
        if (FINE) {
            $$('[data-spotlight]').forEach(el => {
                el.addEventListener('pointermove', e => {
                    const r = el.getBoundingClientRect();
                    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
                    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
                });
            });
        }
        if (!FINE || REDUCED) return;
        const MAX = 6;
        $$('[data-tilt]').forEach(card => {
            let raf = null, tx = 0, ty = 0, cx = 0, cy = 0;
            const loop = () => {
                cx = lerp(cx, tx, 0.15); cy = lerp(cy, ty, 0.15);
                card.style.transform = `perspective(900px) rotateX(${(-cy * MAX).toFixed(2)}deg) rotateY(${(cx * MAX).toFixed(2)}deg) translateY(-6px)`;
                if (Math.abs(cx - tx) > 0.002 || Math.abs(cy - ty) > 0.002) raf = requestAnimationFrame(loop);
                else { raf = null; }
            };
            card.addEventListener('pointermove', e => {
                const r = card.getBoundingClientRect();
                tx = ((e.clientX - r.left) / r.width) * 2 - 1;
                ty = ((e.clientY - r.top) / r.height) * 2 - 1;
                if (!raf) raf = requestAnimationFrame(loop);
            });
            card.addEventListener('pointerleave', () => {
                tx = 0; ty = 0;
                if (!raf) raf = requestAnimationFrame(loop);
            });
        });
    }

    /* ---------- MAGNETISMO + RIPPLE ---------- */
    function initMagnetic() {
        if (!FINE || REDUCED) return;
        $$('[data-magnetic]').forEach(el => {
            let raf = null, tx = 0, ty = 0, cx = 0, cy = 0, hold = false;
            const loop = () => {
                cx = lerp(cx, tx, 0.18); cy = lerp(cy, ty, 0.18);
                el.style.transform = `translate3d(${cx.toFixed(2)}px,${cy.toFixed(2)}px,0)`;
                if (hold || Math.abs(cx - tx) > 0.06 || Math.abs(cy - ty) > 0.06) raf = requestAnimationFrame(loop);
                else { el.style.transform = ''; raf = null; }
            };
            el.addEventListener('pointermove', e => {
                const r = el.getBoundingClientRect();
                tx = clamp((e.clientX - (r.left + r.width / 2)) * 0.3, -24, 24);
                ty = clamp((e.clientY - (r.top + r.height / 2)) * 0.36, -16, 16);
                hold = true;
                if (!raf) raf = requestAnimationFrame(loop);
            });
            el.addEventListener('pointerleave', () => { hold = false; tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(loop); });
        });
    }

    function initRipple() {
        $$('[data-ripple]').forEach(el => {
            el.addEventListener('pointerdown', e => {
                const r = el.getBoundingClientRect();
                const size = Math.max(r.width, r.height) * 2.4;
                const s = document.createElement('span');
                s.className = 'button__ripple';
                s.style.width = s.style.height = `${size}px`;
                s.style.left = `${e.clientX - r.left}px`;
                s.style.top = `${e.clientY - r.top}px`;
                el.appendChild(s);
                setTimeout(() => s.remove(), 800);
            });
        });
    }

    /* ---------- CONTADORES ---------- */
    let counters = [];
    function initCounters() {
        counters = $$('[data-count]').map(el => ({ el, done: false }));
    }
    function checkCounters() {
        if (!counters.length) return;
        const next = [];
        for (const c of counters) {
            const r = c.el.getBoundingClientRect();
            if (r.top < state.vh * 0.85 && r.bottom > 0) {
                const end = parseFloat(c.el.dataset.count) || 0;
                const prefix = c.el.dataset.prefix || '';
                const dur = REDUCED ? 1 : 1600;
                const t0 = performance.now();
                const tick = now => {
                    const p = clamp((now - t0) / dur);
                    const eased = 1 - Math.pow(1 - p, 3);
                    c.el.textContent = prefix + Math.round(end * eased).toLocaleString('pt-BR');
                    if (p < 1) requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            } else next.push(c);
        }
        counters = next;
    }

    /* ---------- NAV, PROGRESSO, FAB ---------- */
    const nav = $('#nav'), progressBar = $('#progressBar'), fab = $('#fab');
    const navLinks = $$('.nav__link');
    const navSections = navLinks.map(l => $(l.getAttribute('href'))).filter(Boolean);

    function updateChrome() {
        if (nav) nav.classList.toggle('is-stuck', state.y > 30);
        if (fab) fab.classList.toggle('is-in', state.y > state.vh * 0.75);
        if (progressBar) {
            const max = document.documentElement.scrollHeight - state.vh;
            progressBar.style.transform = `scaleX(${max > 0 ? clamp(state.y / max) : 0})`;
        }
        if (navSections.length) {
            let current = navSections[0];
            for (const s of navSections) {
                if (s.getBoundingClientRect().top <= state.vh * 0.35) current = s;
            }
            navLinks.forEach(l => l.classList.toggle('is-active', l.getAttribute('href') === `#${current.id}`));
        }
    }

    /* ---------- PASSOS ---------- */
    const stepsList = $('#stepsList'), stepsFill = $('#stepsFill');
    function updateSteps() {
        if (!stepsList || !stepsFill) return;
        const r = stepsList.getBoundingClientRect();
        const start = state.vh * 0.88;
        const p = clamp((start - r.top) / Math.max(1, (start - state.vh * 0.34) + r.height * 0.5));
        stepsFill.style.transform = state.vw <= 1000 ? `scaleY(${p})` : `scaleX(${p})`;
    }

    /* ---------- CITAÇÃO (palavra a palavra) ---------- */
    const quoteEl = $('[data-quote-reveal]');
    let quoteWords = [];
    function initQuote() {
        if (!quoteEl) return;
        quoteEl.classList.add('is-in');
        quoteWords = $$('.split-i', quoteEl);
        if (REDUCED) { quoteWords.forEach(w => { w.style.opacity = '1'; w.style.filter = 'none'; }); quoteWords = []; }
    }
    function updateQuote() {
        if (!quoteWords.length) return;
        const r = quoteEl.getBoundingClientRect();
        const p = clamp((state.vh * 0.85 - r.top) / Math.max(1, r.height + state.vh * 0.4));
        const head = p * (quoteWords.length + 4);
        quoteWords.forEach((w, i) => {
            const o = clamp(head - i);
            w.style.opacity = (0.16 + 0.84 * o).toFixed(3);
            w.style.filter = o < 1 ? `blur(${((1 - o) * 2.2).toFixed(2)}px)` : 'none';
        });
    }

    /* ---------- SCROLL DIRTY ---------- */
    function markDirty() { state.y = window.scrollY; state.dirty = true; }
    window.addEventListener('scroll', markDirty, { passive: true });
    window.addEventListener('resize', () => {
        state.vw = innerWidth; state.vh = innerHeight;
        measureParallax();
        markDirty();
    });

    /* ---------- LOOP PRINCIPAL ---------- */
    function tick() {
        if (state.dirty) {
            state.dirty = false;
            checkReveals();
            checkCounters();
            updateChrome();
            updateSteps();
            updateQuote();

            if (parallax.length && !REDUCED) {
                const still = Math.abs(pointer.cx - pointer.x) < 0.0005 && Math.abs(pointer.cy - pointer.y) < 0.0005;
                if (!still) state.dirty = true;
                pointer.cx = lerp(pointer.cx, pointer.x, 0.08);
                pointer.cy = lerp(pointer.cy, pointer.y, 0.08);
                for (const it of parallax) {
                    const y = it.speed ? ((it.base - state.y) - state.vh / 2) * -it.speed : 0;
                    const mx = it.mouse ? pointer.cx * it.mouse * 300 : 0;
                    const my = it.mouse ? pointer.cy * it.mouse * 300 : 0;
                    if (it.useVars) {
                        // elementos com animação CSS própria: a animação vence o transform inline,
                        // então a paralaxe é injetada como variável consumida pelos keyframes
                        it.el.style.setProperty('--px', `${mx.toFixed(2)}px`);
                        it.el.style.setProperty('--py', `${(y + my).toFixed(2)}px`);
                    } else {
                        it.el.style.transform = `translate3d(${mx.toFixed(2)}px,${(y + my).toFixed(2)}px,0)`;
                    }
                }
            }
        }
        requestAnimationFrame(tick);
    }

    /* ---------- MENU MOBILE ---------- */
    function initMenu() {
        const burger = $('#burger'), menu = $('#menu');
        if (!burger || !menu) return;
        $$('.menu__links a', menu).forEach((a, i) => a.style.setProperty('--i', i));
        const setOpen = open => {
            burger.classList.toggle('is-open', open);
            menu.classList.toggle('is-open', open);
            burger.setAttribute('aria-expanded', String(open));
            burger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
            menu.setAttribute('aria-hidden', String(!open));
            document.body.classList.toggle('is-locked', open);
        };
        burger.addEventListener('click', () => setOpen(!menu.classList.contains('is-open')));
        $$('.menu__links a, .menu__foot a', menu).forEach(a => a.addEventListener('click', () => setOpen(false)));
        window.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
        window.addEventListener('resize', () => { if (innerWidth > 1180) setOpen(false); });
    }

    /* ---------- MARQUEE ---------- */
    function initMarquee() {
        const track = $('#marqueeTrack');
        if (!track || !track.firstElementChild) return;
        const base = track.firstElementChild;
        for (let i = 0; i < 3; i++) track.appendChild(base.cloneNode(true));
    }

    /* ---------- FAQ ---------- */
    function initFaq() {
        const OUT = 'cubic-bezier(.22,1,.36,1)', IN = 'cubic-bezier(.4,0,.2,1)';
        const openItem = qa => {
            const body = $('.qa__body', qa);
            qa.open = true;
            if (REDUCED || !body.animate) return;
            body.animate([{ height: '0px' }, { height: `${body.scrollHeight}px` }], { duration: 420, easing: OUT });
        };
        const closeItem = qa => {
            const body = $('.qa__body', qa);
            if (REDUCED || !body.animate) { qa.open = false; return; }
            let done = false;
            const settle = () => { if (done) return; done = true; qa.open = false; };
            const anim = body.animate([{ height: `${body.scrollHeight}px` }, { height: '0px' }], { duration: 320, easing: IN });
            anim.onfinish = settle;
            anim.oncancel = settle;
            setTimeout(settle, 380); // salvaguarda: garante o estado mesmo se a animação não concluir
        };
        $$('.qa').forEach(qa => {
            const sum = $('summary', qa);
            if (!sum) return;
            sum.addEventListener('click', e => {
                e.preventDefault();
                if (qa.open) { closeItem(qa); return; }
                $$('.qa[open]').forEach(o => {
                    if (o !== qa && o.getAttribute('name') === qa.getAttribute('name')) closeItem(o);
                });
                openItem(qa);
            });
        });
    }

    /* ---------- BOOT ---------- */
    initWhatsappLinks();
    initMarquee();

    loaderDone.then(() => {
        initSplit();
        initReveal();
        initParallax();
        initTilt();
        initMagnetic();
        initRipple();
        initCounters();
        initQuote();
        initMenu();
        initFaq();

        // imagens que chegam depois alteram a altura da página
        $$('img').forEach(img => {
            if (!img.complete) img.addEventListener('load', () => { measureParallax(); markDirty(); }, { once: true });
        });

        state.dirty = true;
        requestAnimationFrame(tick);

        if (document.fonts?.ready) document.fonts.ready.then(() => { measureParallax(); markDirty(); });
    });
})();
