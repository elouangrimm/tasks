(async () => {
    'use strict';

    // ─── IndexedDB Wrapper ───────────────────────────────────────
    class TasksDB {
        constructor() { this.db = null; this.fallback = false; }

        async open() {
            try {
                await new Promise((resolve, reject) => {
                    const req = indexedDB.open('TasksApp', 1);
                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
                    };
                    req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
                    req.onerror = () => { this.fallback = true; resolve(); };
                });
            } catch (e) { this.fallback = true; }
        }

        async get(key) {
            if (this.fallback) {
                try { return JSON.parse(localStorage.getItem('tasks_idb_' + key)); } catch (e) { return null; }
            }
            return new Promise(resolve => {
                try {
                    const tx = this.db.transaction('kv', 'readonly');
                    const req = tx.objectStore('kv').get(key);
                    req.onsuccess = () => resolve(req.result != null ? req.result : null);
                    req.onerror = () => resolve(null);
                } catch (e) { resolve(null); }
            });
        }

        async put(key, value) {
            if (this.fallback) {
                try { localStorage.setItem('tasks_idb_' + key, JSON.stringify(value)); } catch (e) {}
                return;
            }
            return new Promise(resolve => {
                try {
                    const tx = this.db.transaction('kv', 'readwrite');
                    tx.objectStore('kv').put(value, key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => resolve();
                } catch (e) { resolve(); }
            });
        }
    }

    // ─── Constants ───────────────────────────────────────────────
    const SAVE_DEBOUNCE_MS = 300;
    const LS_STATE_KEY = 'tasks_app_data';
    const LS_IMAGE_KEY = 'tasks_app_images';

    // ─── Icons ───────────────────────────────────────────────────
    const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
    const ICON_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

    // ─── DOM Refs ────────────────────────────────────────────────
    const editor = document.getElementById('editor');
    const preview = document.getElementById('preview');
    const modeToggle = document.getElementById('mode-toggle');
    const newPageBtn = document.getElementById('new-page-btn');
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsOverlay = document.getElementById('settings-overlay');
    const settingsClose = document.getElementById('settings-close');
    const fontSizeSlider = document.getElementById('font-size');
    const fontSizeValue = document.getElementById('font-size-value');
    const wordCountEl = document.getElementById('word-count');
    const taskCountEl = document.getElementById('task-count');
    const pageList = document.getElementById('page-list');
    const addPageBtn = document.getElementById('add-page');
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const importFile = document.getElementById('import-file');
    const clearBtn = document.getElementById('clear-btn');
    const notifIntervalSelect = document.getElementById('notif-interval');
    const notifFilterSelect = document.getElementById('notif-filter');
    const notifDot = document.getElementById('notif-dot');
    const notifStatusText = document.getElementById('notif-status-text');
    const notifTestBtn = document.getElementById('notif-test');
    const tabBar = document.getElementById('tab-bar');

    // ─── Database ────────────────────────────────────────────────
    const db = new TasksDB();

    // ─── State ───────────────────────────────────────────────────
    let state = null;
    let imageStore = {};
    let saveTimeout = null;
    let notifTimerId = null;

    // ─── State Management ────────────────────────────────────────
    function generateId() {
        return 'p_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    function getDefaultState() {
        const id = generateId();
        return {
            currentPageId: id,
            fontSize: 25,
            mode: 'edit',
            notifInterval: 0,
            notifFilter: 'all',
            pageOrder: [id],
            pages: {
                [id]: { title: 'Notes', content: '', lastEdited: Date.now(), isNew: false }
            }
        };
    }

    function ensureStateIntegrity(s) {
        if (!s.pageOrder || !Array.isArray(s.pageOrder)) {
            s.pageOrder = Object.keys(s.pages);
        }
        s.pageOrder = s.pageOrder.filter(id => s.pages[id]);
        for (const id of Object.keys(s.pages)) {
            if (!s.pageOrder.includes(id)) s.pageOrder.push(id);
        }
        for (const page of Object.values(s.pages)) {
            if (page.isNew === undefined) page.isNew = false;
        }
        if (!s.pages[s.currentPageId]) {
            s.currentPageId = s.pageOrder[0];
        }
        if (s.notifInterval === undefined) s.notifInterval = 0;
        if (s.notifFilter === undefined) s.notifFilter = 'all';
        return s;
    }

    async function loadFromDB() {
        await db.open();

        let s = await db.get('state');
        let imgs = await db.get('images');

        // Migrate from old localStorage keys
        if (!s) {
            try {
                const raw = localStorage.getItem(LS_STATE_KEY);
                if (raw) {
                    s = JSON.parse(raw);
                    localStorage.removeItem(LS_STATE_KEY);
                }
            } catch (e) {}
        }
        if (!imgs) {
            try {
                const raw = localStorage.getItem(LS_IMAGE_KEY);
                if (raw) {
                    imgs = JSON.parse(raw);
                    localStorage.removeItem(LS_IMAGE_KEY);
                }
            } catch (e) {}
        }

        if (s && s.pages && s.currentPageId) {
            state = ensureStateIntegrity(s);
        } else {
            state = getDefaultState();
        }
        imageStore = imgs || {};

        // Persist to IndexedDB (migration or first save)
        await db.put('state', state);
        if (Object.keys(imageStore).length > 0) {
            await db.put('images', imageStore);
        }

        // Clean up empty new pages from previous sessions
        const toDelete = [];
        for (const id of state.pageOrder) {
            const page = state.pages[id];
            if (page && page.isNew && !page.content.trim() && state.pageOrder.length - toDelete.length > 1) {
                toDelete.push(id);
            }
        }
        for (const id of toDelete) {
            delete state.pages[id];
            state.pageOrder = state.pageOrder.filter(x => x !== id);
        }
        if (toDelete.includes(state.currentPageId)) {
            state.currentPageId = state.pageOrder[0];
        }
    }

    function saveState() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            db.put('state', state).catch(() => {});
        }, SAVE_DEBOUNCE_MS);
    }

    function saveStateImmediate() {
        clearTimeout(saveTimeout);
        db.put('state', state).catch(() => {});
    }

    function saveImageStore() {
        db.put('images', imageStore).catch(() => {});
    }

    function getCurrentPage() {
        return state.pages[state.currentPageId];
    }

    // ─── Image Store ─────────────────────────────────────────────
    function storeImage(dataUrl) {
        const id = 'img_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
        imageStore[id] = dataUrl;
        saveImageStore();
        return id;
    }

    function resolveImageSrc(src) {
        if (src.startsWith('img:') || src.startsWith('img_')) {
            const id = src.startsWith('img:') ? src.slice(4) : src;
            return imageStore[id] || src;
        }
        return src;
    }

    // ─── Markdown Parser ─────────────────────────────────────────
    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderInline(text) {
        text = escapeHtml(text);
        // Bold (must be before italic)
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Underline (before italic to avoid _ conflicts)
        text = text.replace(/__(.+?)__/g, '<u>$1</u>');
        // Italic
        text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
        // Strikethrough
        text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
        // Inline code
        text = text.replace(/`(.+?)`/g, '<code class="inline-code">$1</code>');
        // Images ![alt](url)
        text = text.replace(/!\[([^\]]*)\]\((.+?)\)/g, (_, alt, src) => {
            const resolved = resolveImageSrc(src);
            return '<img src="' + resolved + '" alt="' + alt + '" loading="lazy">';
        });
        // Links [text](url)
        text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        // Bare URLs
        text = text.replace(/(?<!href=")(?<!src=")(https?:\/\/[^\s<"]+)/g, (match) => {
            let hostname;
            try { hostname = new URL(match).hostname; } catch (e) { hostname = ''; }
            const favicon = hostname ? '<img class="link-favicon" src="https://www.google.com/s2/favicons?domain=' + hostname + '&sz=32" alt="">' : '';
            return '<span class="link-embed">' + favicon + '<a href="' + match + '" target="_blank" rel="noopener">' + match + '</a></span>';
        });
        return text;
    }

    function parseTaskLine(line) {
        const bracketMatch = line.match(/^(\s*(?:-\s+)?)\[([ xX]?)\](!!?)?\s*(.*)$/);
        if (bracketMatch) {
            const bangs = bracketMatch[3] || '';
            const leadingSpaces = bracketMatch[1].match(/^(\s*)/)[1].length;
            return {
                prefix: bracketMatch[1],
                checked: bracketMatch[2].toLowerCase() === 'x',
                text: bracketMatch[4],
                type: 'bracket',
                priority: bangs === '!!' ? 'high' : bangs === '!' ? 'medium' : 'normal',
                indent: leadingSpaces
            };
        }
        const ampMatch = line.match(/^(\s*(?:-\s+)?)&(!!?)?\s+(.+)$/);
        if (ampMatch) {
            const bangs = ampMatch[2] || '';
            const leadingSpaces = ampMatch[1].match(/^(\s*)/)[1].length;
            return {
                prefix: ampMatch[1],
                checked: false,
                text: ampMatch[3],
                type: 'ampersand',
                priority: bangs === '!!' ? 'high' : bangs === '!' ? 'medium' : 'normal',
                indent: leadingSpaces
            };
        }
        return null;
    }

    function renderTask(task, lineIndex) {
        const checkedClass = task.checked ? ' checked' : '';
        const priorityClass = task.priority !== 'normal' ? ' priority-' + task.priority : '';
        const subtaskClass = task.indent > 0 ? ' subtask' : '';
        let badge = '';
        if (task.priority === 'medium') {
            badge = '<span class="priority-badge medium">!</span>';
        } else if (task.priority === 'high') {
            badge = '<span class="priority-badge high">!!</span>';
        }
        return '<div class="task-line' + checkedClass + priorityClass + subtaskClass + '" data-line="' + lineIndex + '">' +
            '<div class="task-checkbox' + checkedClass + '"></div>' +
            badge +
            '<span class="task-text">' + renderInline(task.text) + '</span>' +
            '</div>';
    }

    function renderLine(line, lineIndex) {
        const trimmed = line.trim();

        if (trimmed === '') return '<div class="empty-line"></div>';

        const task = parseTaskLine(line);
        if (task) return renderTask(task, lineIndex);

        if (trimmed.startsWith('### ')) return '<h3>' + renderInline(trimmed.slice(4)) + '</h3>';
        if (trimmed.startsWith('## '))  return '<h2>' + renderInline(trimmed.slice(3)) + '</h2>';
        if (trimmed.startsWith('# '))   return '<h1>' + renderInline(trimmed.slice(2)) + '</h1>';

        if (/^[-]{3,}$/.test(trimmed) || /^[*]{3,}$/.test(trimmed)) return '<hr>';

        if (trimmed.startsWith('> ')) {
            return '<blockquote>' + renderInline(trimmed.slice(2)) + '</blockquote>';
        }

        const imgMatch = trimmed.match(/^!\[([^\]]*)\]\((.+?)\)$/);
        if (imgMatch) {
            const resolved = resolveImageSrc(imgMatch[2]);
            return '<p><img src="' + escapeHtml(resolved) + '" alt="' + escapeHtml(imgMatch[1]) + '" loading="lazy"></p>';
        }

        const listMatch = line.match(/^(\s*)-\s+(.*)$/);
        if (listMatch) {
            return '<div class="list-item"><span class="bullet">\u2022</span><span>' + renderInline(listMatch[2]) + '</span></div>';
        }

        return '<p>' + renderInline(line) + '</p>';
    }

    function renderMarkdown(source) {
        const lines = source.split('\n');
        let html = '';
        let inCodeBlock = false;
        let codeContent = '';
        let codeLang = '';
        let inDrawer = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('```')) {
                if (inCodeBlock) {
                    const escaped = escapeHtml(codeContent);
                    const langAttr = codeLang ? ' class="language-' + codeLang + '"' : '';
                    const langLabel = codeLang ? '<span class="code-lang-label">' + escapeHtml(codeLang) + '</span>' : '';
                    html += '<pre>' + langLabel + '<code' + langAttr + '>' + escaped + '</code></pre>';
                    codeContent = '';
                    codeLang = '';
                    inCodeBlock = false;
                } else {
                    inCodeBlock = true;
                    codeLang = trimmed.slice(3).trim();
                }
                continue;
            }

            if (inCodeBlock) {
                codeContent += (codeContent ? '\n' : '') + line;
                continue;
            }

            if (trimmed === '>>>') {
                if (inDrawer) {
                    html += '</div></details>';
                    inDrawer = false;
                }
                continue;
            }

            if (trimmed.startsWith('<<<') || trimmed.startsWith('!<<<')) {
                const startsClosed = trimmed.startsWith('!<<<');
                const title = (startsClosed ? trimmed.slice(4) : trimmed.slice(3)).trim();
                const openAttr = startsClosed ? '' : ' open';
                html += '<details class="drawer"' + openAttr + '><summary class="drawer-summary">' + renderInline(title || 'Details') + '</summary><div class="drawer-content">';
                inDrawer = true;
                continue;
            }

            html += renderLine(line, i);
        }

        if (inCodeBlock) {
            const escaped = escapeHtml(codeContent);
            const langAttr = codeLang ? ' class="language-' + codeLang + '"' : '';
            html += '<pre><code' + langAttr + '>' + escaped + '</code></pre>';
        }

        if (inDrawer) {
            html += '</div></details>';
        }

        return html;
    }

    // ─── Checkbox Toggle ─────────────────────────────────────────
    function toggleCheckbox(lineIndex) {
        const page = getCurrentPage();
        const lines = page.content.split('\n');
        if (lineIndex < 0 || lineIndex >= lines.length) return;

        const line = lines[lineIndex];
        const task = parseTaskLine(line);
        if (!task) return;

        let newLine;
        let newChecked;

        if (task.type === 'ampersand') {
            const bangStr = task.priority === 'high' ? '!!' : task.priority === 'medium' ? '!' : '';
            newLine = task.prefix + '[x]' + bangStr + ' ' + task.text;
            newChecked = true;
        } else if (task.checked) {
            newLine = line.replace(/\[[xX]\]/, '[ ]');
            newChecked = false;
        } else {
            newLine = line.replace(/\[\s?\]/, '[x]');
            newChecked = true;
        }

        lines[lineIndex] = newLine;
        page.content = lines.join('\n');
        page.lastEdited = Date.now();

        if (state.mode === 'edit') {
            const pos = editor.selectionStart;
            editor.value = page.content;
            editor.selectionStart = editor.selectionEnd = pos;
        }

        const taskLineEl = preview.querySelector('.task-line[data-line="' + lineIndex + '"]');
        if (taskLineEl) {
            const checkboxEl = taskLineEl.querySelector('.task-checkbox');

            if (newChecked) {
                taskLineEl.classList.add('checked');
                checkboxEl.classList.add('checked');
            } else {
                taskLineEl.classList.remove('checked');
                checkboxEl.classList.remove('checked');
            }

            taskLineEl.classList.remove('just-toggled');
            void taskLineEl.offsetWidth;
            taskLineEl.classList.add('just-toggled');
            setTimeout(() => taskLineEl.classList.remove('just-toggled'), 600);
        }

        saveState();
        updateStatus();
    }

    // ─── View Management ─────────────────────────────────────────
    function setMode(mode) {
        state.mode = mode;

        if (mode === 'edit') {
            preview.classList.add('hidden');
            editor.classList.remove('hidden');
            editor.value = getCurrentPage().content;
            editor.focus();
            modeToggle.innerHTML = ICON_EYE;
            modeToggle.title = 'Preview (Ctrl+E)';
        } else {
            editor.classList.add('hidden');
            preview.classList.remove('hidden');
            renderPreview();
            modeToggle.innerHTML = ICON_PENCIL;
            modeToggle.title = 'Edit (Ctrl+E)';
        }

        saveState();
        updateStatus();
    }

    function toggleMode() {
        setMode(state.mode === 'edit' ? 'preview' : 'edit');
    }

    function renderPreview() {
        const page = getCurrentPage();
        if (!page.content.trim()) {
            preview.innerHTML = '<div class="empty-state">Press Ctrl+E to start writing</div>';
        } else {
            const scrollPos = preview.scrollTop;
            preview.innerHTML = renderMarkdown(page.content);
            if (typeof hljs !== 'undefined') {
                preview.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            }
            preview.scrollTop = scrollPos;
        }
    }

    // ─── Status Bar ──────────────────────────────────────────────
    function updateStatus() {
        const page = getCurrentPage();
        const content = page.content;

        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        wordCountEl.textContent = words + ' word' + (words !== 1 ? 's' : '');

        const lines = content.split('\n');
        let total = 0, done = 0;
        for (const line of lines) {
            const task = parseTaskLine(line);
            if (task) {
                total++;
                if (task.checked) done++;
            }
        }
        taskCountEl.textContent = total > 0 ? done + '/' + total + ' tasks' : '';
    }

    // ─── Tab Bar ─────────────────────────────────────────────────
    function renderTabBar() {
        if (state.pageOrder.length <= 1) {
            tabBar.classList.add('hidden');
            tabBar.innerHTML = '';
            return;
        }

        tabBar.classList.remove('hidden');
        let html = '';
        for (const id of state.pageOrder) {
            const page = state.pages[id];
            if (!page) continue;
            const isActive = id === state.currentPageId;
            html += '<div class="tab' + (isActive ? ' active' : '') + '" data-page-id="' + id + '">' +
                '<span class="tab-title">' + escapeHtml(page.title) + '</span>' +
                '<span class="tab-close" data-page-id="' + id + '">&times;</span>' +
                '</div>';
        }
        tabBar.innerHTML = html;

        const activeTab = tabBar.querySelector('.tab.active');
        if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }

    // ─── Page Management ─────────────────────────────────────────
    function switchPage(pageId) {
        if (!state.pages[pageId]) return;
        if (pageId === state.currentPageId) return;

        // Save current editor content
        if (state.mode === 'edit') {
            getCurrentPage().content = editor.value;
        }

        /* Auto-delete current page if new and empty (disabled for now, can be annoying if triggered unintentionally)
        const currentId = state.currentPageId;
        const currentPage = state.pages[currentId];
        if (currentPage && currentPage.isNew && !currentPage.content.trim() && state.pageOrder.length > 1) {
            delete state.pages[currentId];
            state.pageOrder = state.pageOrder.filter(id => id !== currentId);
        }
        */

        state.currentPageId = pageId;
        editor.value = getCurrentPage().content;

        if (state.mode === 'preview') {
            renderPreview();
        }

        saveStateImmediate();
        updateStatus();
        renderTabBar();
        renderPageList();
    }

    function addPage() {
        // Save current editor content
        if (state.mode === 'edit') {
            getCurrentPage().content = editor.value;
        }

        const count = Object.keys(state.pages).length + 1;
        const id = generateId();
        state.pages[id] = { title: 'Page ' + count, content: '', lastEdited: Date.now(), isNew: true };
        state.pageOrder.push(id);

        // Switch to the new page
        const prevId = state.currentPageId;

        /* Auto-delete the previous page if it was new and empty (disabled for now, can be annoying if triggered unintentionally)
        const prevPage = state.pages[prevId];
        if (prevPage && prevPage.isNew && !prevPage.content.trim() && state.pageOrder.length > 1) {
            delete state.pages[prevId];
            state.pageOrder = state.pageOrder.filter(pid => pid !== prevId);
        }
        */

        state.currentPageId = id;
        editor.value = '';

        if (state.mode === 'preview') {
            setMode('edit');
        }

        editor.focus();
        saveStateImmediate();
        updateStatus();
        renderTabBar();
        renderPageList();
    }

    function deletePage(pageId, skipConfirm) {
        if (state.pageOrder.length <= 1) return;
        const page = state.pages[pageId];
        if (!page) return;

        if (!skipConfirm && page.content.trim()) {
            if (!confirm('Delete "' + page.title + '"?')) return;
        }

        const wasActive = (pageId === state.currentPageId);
        const idx = state.pageOrder.indexOf(pageId);

        delete state.pages[pageId];
        state.pageOrder.splice(idx, 1);

        if (wasActive) {
            const newIdx = Math.min(idx, state.pageOrder.length - 1);
            state.currentPageId = state.pageOrder[newIdx];
            editor.value = getCurrentPage().content;
            if (state.mode === 'preview') renderPreview();
        }

        saveStateImmediate();
        updateStatus();
        renderTabBar();
        renderPageList();
    }

    // ─── Settings ────────────────────────────────────────────────
    function openSettings() {
        settingsOverlay.classList.add('active');
        renderPageList();
    }

    function closeSettings() {
        settingsOverlay.classList.remove('active');
    }

    function formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm ago';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        const days = Math.floor(hours / 24);
        return days + 'd ago';
    }

    function renderPageList() {
        const ids = state.pageOrder;
        let html = '';
        for (const id of ids) {
            const page = state.pages[id];
            if (!page) continue;
            const isActive = id === state.currentPageId;
            const timeAgo = formatTimeAgo(page.lastEdited);
            html += '<div class="page-item' + (isActive ? ' active' : '') + '" data-page-id="' + id + '">' +
                '<span class="page-title" data-page-id="' + id + '">' + escapeHtml(page.title) + '</span>' +
                '<span class="page-meta">' + timeAgo + '</span>' +
                (ids.length > 1
                    ? '<button class="page-delete" data-page-id="' + id + '" title="Delete">&times;</button>'
                    : '') +
                '</div>';
        }
        pageList.innerHTML = html;
    }

    function exportCurrentPage() {
        const page = getCurrentPage();
        const blob = new Blob([page.content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (page.title || 'notes') + '.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importMarkdown(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const page = getCurrentPage();
            page.content = content;
            page.lastEdited = Date.now();
            if (page.isNew) page.isNew = false;
            editor.value = content;
            if (state.mode === 'preview') renderPreview();
            saveStateImmediate();
            updateStatus();
        };
        reader.readAsText(file);
    }

    function clearCurrentPage() {
        if (!confirm('Clear all content on this page?')) return;
        const page = getCurrentPage();
        page.content = '';
        page.lastEdited = Date.now();
        editor.value = '';
        if (state.mode === 'preview') renderPreview();
        saveStateImmediate();
        updateStatus();
    }

    // ─── Editor Helpers ──────────────────────────────────────────
    function insertAtCursor(text) {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + text + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + text.length;
        editor.dispatchEvent(new Event('input'));
    }

    // ─── Event Listeners ─────────────────────────────────────────

    // Editor input — save content & auto-fix priority markers
    editor.addEventListener('input', (e) => {
        if (e.inputType === 'insertText' && e.data === '!') {
            const pos = editor.selectionStart;
            const before = editor.value.substring(0, pos);
            const lineStart = before.lastIndexOf('\n') + 1;
            const lineBeforeCursor = before.substring(lineStart);

            const singleMatch = lineBeforeCursor.match(/^(\s*)& !$/);
            if (singleMatch) {
                const prefix = singleMatch[1];
                const replaceFrom = lineStart;
                const newText = prefix + '&! ';
                editor.value = editor.value.substring(0, replaceFrom) + newText + editor.value.substring(pos);
                editor.selectionStart = editor.selectionEnd = replaceFrom + newText.length;
            } else {
                const doubleMatch = lineBeforeCursor.match(/^(\s*)&! !$/);
                if (doubleMatch) {
                    const prefix = doubleMatch[1];
                    const replaceFrom = lineStart;
                    const newText = prefix + '&!! ';
                    editor.value = editor.value.substring(0, replaceFrom) + newText + editor.value.substring(pos);
                    editor.selectionStart = editor.selectionEnd = replaceFrom + newText.length;
                }
            }
        }

        const page = getCurrentPage();
        page.content = editor.value;
        page.lastEdited = Date.now();

        // Clear isNew flag once content is added
        if (page.isNew && page.content.trim()) {
            page.isNew = false;
        }

        saveState();
        updateStatus();
    });

    // Tab key — indent instead of changing focus
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const before = editor.value.substring(0, start);
            const lineStart = before.lastIndexOf('\n') + 1;
            const lineEnd = editor.value.indexOf('\n', start);
            const fullLine = editor.value.substring(lineStart, lineEnd === -1 ? editor.value.length : lineEnd);

            const taskPrefixMatch = fullLine.match(/^(\s*)(&(?:!!?)?\s)(.*)$/);

            if (e.shiftKey) {
                if (fullLine.startsWith('    ')) {
                    editor.value = editor.value.substring(0, lineStart) + editor.value.substring(lineStart + 4);
                    editor.selectionStart = editor.selectionEnd = Math.max(lineStart, start - 4);
                    editor.dispatchEvent(new Event('input'));
                } else if (fullLine.startsWith('\t')) {
                    editor.value = editor.value.substring(0, lineStart) + editor.value.substring(lineStart + 1);
                    editor.selectionStart = editor.selectionEnd = Math.max(lineStart, start - 1);
                    editor.dispatchEvent(new Event('input'));
                }
            } else if (taskPrefixMatch) {
                const newLine = taskPrefixMatch[1] + '    ' + taskPrefixMatch[2] + taskPrefixMatch[3];
                editor.value = editor.value.substring(0, lineStart) + newLine + editor.value.substring(lineEnd === -1 ? editor.value.length : lineEnd);
                editor.selectionStart = editor.selectionEnd = start + 4;
                editor.dispatchEvent(new Event('input'));
            } else {
                insertAtCursor('    ');
            }
            return;
        }

        // Enter key — auto-continue lists and tasks
        if (e.key === 'Enter' && !e.shiftKey) {
            const start = editor.selectionStart;
            const textBefore = editor.value.substring(0, start);
            const currentLine = textBefore.split('\n').pop();

            let continuationPrefix = null;

            if (/^(\s*)(?:-\s+)?\[[ xX]?\](?:!!?)?\s/.test(currentLine)) {
                const indent = currentLine.match(/^(\s*)/)[1];
                const hasDash = /^(\s*)-\s+\[/.test(currentLine);
                continuationPrefix = indent + (hasDash ? '- [ ] ' : '[ ] ');
            } else if (/^(\s*)(?:-\s+)?&(?:!!?)?\s/.test(currentLine)) {
                const indent = currentLine.match(/^(\s*)/)[1];
                const hasDash = /^(\s*)-\s+&/.test(currentLine);
                continuationPrefix = indent + (hasDash ? '- & ' : '& ');
            } else if (/^(\s*)-\s+/.test(currentLine)) {
                const indent = currentLine.match(/^(\s*)/)[1];
                continuationPrefix = indent + '- ';
            }

            if (continuationPrefix) {
                const contentAfterPrefix = currentLine
                    .replace(/^\s*(?:-\s+)?(?:\[[ xX]?\](?:!!?)?\s*|&(?:!!?)?\s*)?/, '')
                    .trim();

                if (contentAfterPrefix === '') {
                    e.preventDefault();
                    const lineStart = textBefore.lastIndexOf('\n') + 1;
                    const after = editor.value.substring(start);
                    editor.value = editor.value.substring(0, lineStart) + '\n' + after;
                    editor.selectionStart = editor.selectionEnd = lineStart + 1;
                    editor.dispatchEvent(new Event('input'));
                } else {
                    e.preventDefault();
                    const after = editor.value.substring(start);
                    editor.value = textBefore + '\n' + continuationPrefix + after;
                    editor.selectionStart = editor.selectionEnd = start + 1 + continuationPrefix.length;
                    editor.dispatchEvent(new Event('input'));
                }
            }
        }
    });

    // Preview click — handle checkbox toggles
    preview.addEventListener('click', (e) => {
        const taskLine = e.target.closest('.task-line');
        if (taskLine) {
            e.preventDefault();
            const lineIndex = parseInt(taskLine.dataset.line, 10);
            toggleCheckbox(lineIndex);
        }
    });

    // Mode toggle button
    modeToggle.addEventListener('click', toggleMode);

    // New page button
    newPageBtn.addEventListener('click', addPage);

    // Settings button
    settingsToggle.addEventListener('click', openSettings);
    settingsClose.addEventListener('click', closeSettings);

    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) closeSettings();
    });

    // Font size slider
    fontSizeSlider.addEventListener('input', () => {
        const size = parseInt(fontSizeSlider.value, 10);
        state.fontSize = size;
        fontSizeValue.textContent = size + 'px';
        document.documentElement.style.setProperty('--font-size', size + 'px');
        saveState();
    });

    // Page list interactions (settings panel)
    pageList.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.page-delete');
        if (deleteBtn) {
            e.stopPropagation();
            deletePage(deleteBtn.dataset.pageId);
            return;
        }
        const pageItem = e.target.closest('.page-item');
        if (pageItem) {
            switchPage(pageItem.dataset.pageId);
        }
    });

    pageList.addEventListener('dblclick', (e) => {
        const titleEl = e.target.closest('.page-title');
        if (titleEl) {
            e.stopPropagation();
            const pageId = titleEl.dataset.pageId;
            const page = state.pages[pageId];
            if (!page) return;
            const newTitle = prompt('Rename page:', page.title);
            if (newTitle && newTitle.trim()) {
                page.title = newTitle.trim();
                saveStateImmediate();
                renderPageList();
                renderTabBar();
            }
        }
    });

    addPageBtn.addEventListener('click', addPage);

    // Tab bar interactions
    tabBar.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('.tab-close');
        if (closeBtn) {
            e.stopPropagation();
            deletePage(closeBtn.dataset.pageId);
            return;
        }
        const tab = e.target.closest('.tab');
        if (tab) {
            switchPage(tab.dataset.pageId);
        }
    });

    // Double-click tab to rename inline
    tabBar.addEventListener('dblclick', (e) => {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        e.stopPropagation();
        const pageId = tab.dataset.pageId;
        const page = state.pages[pageId];
        if (!page) return;

        const titleSpan = tab.querySelector('.tab-title');
        if (!titleSpan) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-rename-input';
        input.value = page.title;
        titleSpan.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        const finishRename = () => {
            if (finished) return;
            finished = true;
            const newTitle = input.value.trim();
            if (newTitle && newTitle !== page.title) {
                page.title = newTitle;
                saveStateImmediate();
            }
            renderTabBar();
            renderPageList();
        };

        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { input.value = page.title; input.blur(); }
        });
    });

    // Export / Import / Clear
    exportBtn.addEventListener('click', exportCurrentPage);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importMarkdown(file);
        e.target.value = '';
    });
    clearBtn.addEventListener('click', clearCurrentPage);

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        const isSettingsOpen = settingsOverlay.classList.contains('active');

        // Ctrl+E / Cmd+E — toggle mode
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            if (isSettingsOpen) closeSettings();
            toggleMode();
            return;
        }

        // Alt+N — New page
        if (e.altKey && e.key === 'n') {
            e.preventDefault();
            if (isSettingsOpen) closeSettings();
            addPage();
            return;
        }

        // Alt+W — Close/delete current page
        if (e.altKey && e.key === 'w') {
            e.preventDefault();
            if (state.pageOrder.length > 1) {
                deletePage(state.currentPageId);
            }
            return;
        }

        // Alt+[ — Previous page
        if (e.altKey && e.key === '[') {
            e.preventDefault();
            const idx = state.pageOrder.indexOf(state.currentPageId);
            if (idx > 0) switchPage(state.pageOrder[idx - 1]);
            return;
        }

        // Alt+] — Next page
        if (e.altKey && e.key === ']') {
            e.preventDefault();
            const idx = state.pageOrder.indexOf(state.currentPageId);
            if (idx < state.pageOrder.length - 1) switchPage(state.pageOrder[idx + 1]);
            return;
        }

        // Escape — close settings or exit preview
        if (e.key === 'Escape') {
            if (isSettingsOpen) {
                closeSettings();
            } else if (state.mode === 'preview') {
                setMode('edit');
            }
        }
    });

    // ─── Notification System ─────────────────────────────────────

    function collectPendingTasks() {
        const filter = state.notifFilter || 'all';
        const tasks = [];

        for (const [id, page] of Object.entries(state.pages)) {
            const lines = page.content.split('\n');
            for (const line of lines) {
                const task = parseTaskLine(line);
                if (!task || task.checked) continue;

                if (filter === 'high' && task.priority !== 'high') continue;
                if (filter === 'medium' && task.priority === 'normal') continue;

                tasks.push({
                    text: task.text,
                    priority: task.priority,
                    page: page.title
                });
            }
        }

        const order = { high: 0, medium: 1, normal: 2 };
        tasks.sort((a, b) => order[a.priority] - order[b.priority]);

        return tasks;
    }

    function formatTaskForNotif(task) {
        const marker = task.priority === 'high' ? '\u203C\uFE0F ' : task.priority === 'medium' ? '\u26A0\uFE0F ' : '\u2022 ';
        return marker + task.text;
    }

    async function sendTaskNotification(isTest) {
        if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') return;
        }
        if (Notification.permission !== 'granted') return;

        const tasks = collectPendingTasks();

        if (tasks.length === 0 && !isTest) return;

        const highCount = tasks.filter(t => t.priority === 'high').length;
        const medCount = tasks.filter(t => t.priority === 'medium').length;

        let title;
        if (isTest && tasks.length === 0) {
            title = '\u2705 No pending tasks!';
        } else if (highCount > 0) {
            title = '\uD83D\uDD34 ' + tasks.length + ' task' + (tasks.length !== 1 ? 's' : '') + ' pending';
        } else if (medCount > 0) {
            title = '\uD83D\uDFE1 ' + tasks.length + ' task' + (tasks.length !== 1 ? 's' : '') + ' pending';
        } else {
            title = '\uD83D\uDCCB ' + tasks.length + ' task' + (tasks.length !== 1 ? 's' : '') + ' pending';
        }

        const maxShow = 6;
        const shown = tasks.slice(0, maxShow);
        const bodyLines = shown.map(formatTaskForNotif);
        if (tasks.length > maxShow) {
            bodyLines.push('  ...and ' + (tasks.length - maxShow) + ' more');
        }
        const body = bodyLines.join('\n');

        const notif = new Notification(title, {
            body: body || 'All clear \u2014 nothing to do!',
            icon: 'icons/favicon-192x192.png',
            tag: 'tasks-reminder',
            renotify: true,
            silent: false,
            requireInteraction: highCount > 0,
        });

        notif.onclick = () => {
            window.focus();
            notif.close();
        };
    }

    function startNotifTimer() {
        if (notifTimerId) {
            clearInterval(notifTimerId);
            notifTimerId = null;
        }

        const minutes = parseInt(state.notifInterval, 10) || 0;
        if (minutes <= 0) {
            updateNotifStatus();
            return;
        }

        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        notifTimerId = setInterval(() => {
            sendTaskNotification(false);
        }, minutes * 60 * 1000);

        updateNotifStatus();
    }

    function updateNotifStatus() {
        const minutes = parseInt(state.notifInterval, 10) || 0;
        const isActive = minutes > 0;
        const hasPermission = 'Notification' in window && Notification.permission === 'granted';

        notifDot.className = 'notif-dot ' + (isActive ? 'active' : 'inactive');

        if (!('Notification' in window)) {
            notifStatusText.textContent = 'Notifications not supported';
        } else if (minutes === 0) {
            notifStatusText.textContent = 'Notifications off';
        } else if (!hasPermission && Notification.permission === 'denied') {
            notifStatusText.textContent = 'Blocked \u2014 allow in browser settings';
            notifDot.className = 'notif-dot inactive';
        } else if (!hasPermission) {
            notifStatusText.textContent = 'Every ' + formatInterval(minutes) + ' \u2014 click Test to enable';
        } else {
            const filterLabel = { all: 'all tasks', medium: 'medium+ priority', high: 'high priority only' };
            notifStatusText.textContent = 'Every ' + formatInterval(minutes) + ' \u00B7 ' + (filterLabel[state.notifFilter] || 'all tasks');
        }
    }

    function formatInterval(minutes) {
        if (minutes < 60) return minutes + 'm';
        const h = minutes / 60;
        return h === 1 ? '1 hour' : h + ' hours';
    }

    notifIntervalSelect.addEventListener('change', () => {
        state.notifInterval = parseInt(notifIntervalSelect.value, 10);
        saveStateImmediate();
        startNotifTimer();
    });

    notifFilterSelect.addEventListener('change', () => {
        state.notifFilter = notifFilterSelect.value;
        saveStateImmediate();
        updateNotifStatus();
    });

    notifTestBtn.addEventListener('click', async () => {
        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }
        sendTaskNotification(true);
        updateNotifStatus();
    });

    // ─── Image Paste & Drag Support ──────────────────────────────

    function fileToDataUrl(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });
    }

    editor.addEventListener('paste', async (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (!file) return;
                const dataUrl = await fileToDataUrl(file);
                const id = storeImage(dataUrl);
                insertAtCursor('![image](img:' + id + ')');
                return;
            }
        }

        const text = e.clipboardData.getData('text/plain');
        if (text && /^https?:\/\/\S+$/.test(text.trim())) {
            const url = text.trim();
            if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(url)) {
                e.preventDefault();
                insertAtCursor('![image](' + url + ')');
            }
        }
    });

    // Drag & drop support
    let dragCounter = 0;
    const dragOverlay = document.createElement('div');
    dragOverlay.className = 'drag-overlay';
    dragOverlay.innerHTML = '<div class="drag-overlay-text">Drop image or link</div>';
    document.body.appendChild(dragOverlay);

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dragOverlay.classList.add('visible');
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dragOverlay.classList.remove('visible');
        }
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        dragOverlay.classList.remove('visible');

        if (state.mode !== 'edit') setMode('edit');

        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    const dataUrl = await fileToDataUrl(file);
                    const id = storeImage(dataUrl);
                    insertAtCursor('\n![' + file.name + '](img:' + id + ')\n');
                }
            }
            return;
        }

        const url = (e.dataTransfer && e.dataTransfer.getData('text/uri-list')) || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
        if (url && /^https?:\/\/\S+$/.test(url.trim())) {
            const trimUrl = url.trim();
            if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(trimUrl)) {
                insertAtCursor('\n![image](' + trimUrl + ')\n');
            } else {
                insertAtCursor(trimUrl);
            }
        }
    });

    // ─── Service Worker Registration ─────────────────────────────
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(function(reg) { console.log('SW registered:', reg.scope); })
            .catch(function(err) { console.warn('SW registration failed:', err); });
    }

    // ─── Initialization ──────────────────────────────────────────
    async function init() {
        await loadFromDB();

        // Apply saved font size
        document.documentElement.style.setProperty('--font-size', state.fontSize + 'px');
        fontSizeSlider.value = state.fontSize;
        fontSizeValue.textContent = state.fontSize + 'px';

        // Apply saved notification settings
        notifIntervalSelect.value = state.notifInterval;
        notifFilterSelect.value = state.notifFilter;

        // Set icons
        settingsToggle.innerHTML = ICON_GEAR;
        newPageBtn.innerHTML = ICON_PLUS;

        // Load content
        editor.value = getCurrentPage().content;

        // Determine initial mode
        const hasContent = getCurrentPage().content.trim().length > 0;
        setMode(hasContent ? (state.mode || 'edit') : 'edit');

        updateStatus();
        renderTabBar();
        renderPageList();

        // Start notification timer
        startNotifTimer();

        // Handle new-page shortcut from manifest
        if (location.search.includes('new-page')) {
            addPage();
            history.replaceState({}, '', location.pathname);
        }
    }

    init();
})();
