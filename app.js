(() => {
    'use strict';

    // ─── Constants ───────────────────────────────────────────────
    const STORAGE_KEY = 'tasks_app_data';
    const SAVE_DEBOUNCE_MS = 300;

    // ─── Icons ───────────────────────────────────────────────────
    const ICON_EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const ICON_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
    const ICON_GEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

    // ─── DOM Refs ────────────────────────────────────────────────
    const editor = document.getElementById('editor');
    const preview = document.getElementById('preview');
    const modeToggle = document.getElementById('mode-toggle');
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
    const tabsContainer = document.getElementById('tabs-container');
    const tabAddBtn = document.getElementById('tab-add');

    // ─── State ───────────────────────────────────────────────────
    let state = loadState();
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
            fontSize: 16,
            mode: 'edit',
            notifInterval: 0,
            notifFilter: 'all',
            pages: {
                [id]: { title: 'Notes', content: '', lastEdited: Date.now() }
            }
        };
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                // Validate structure
                if (parsed && parsed.pages && parsed.currentPageId && parsed.pages[parsed.currentPageId]) {
                    return parsed;
                }
            }
        } catch (e) { /* corrupted data, start fresh */ }
        return getDefaultState();
    }

    function saveState() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            } catch (e) {
                console.warn('Failed to save:', e);
            }
        }, SAVE_DEBOUNCE_MS);
    }

    function saveStateImmediate() {
        clearTimeout(saveTimeout);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('Failed to save:', e);
        }
    }

    function getCurrentPage() {
        return state.pages[state.currentPageId];
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
        // Italic
        text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
        // Strikethrough
        text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
        // Inline code
        text = text.replace(/`(.+?)`/g, '<code class="inline-code">$1</code>');
        // Images ![alt](url)
        text = text.replace(/!\[([^\]]*)\]\((.+?)\)/g, '<img src="$2" alt="$1" loading="lazy">');
        // Links [text](url)
        text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        // Bare URLs (not already inside href or src) — turn into link embeds with favicons
        text = text.replace(/(?<!href=")(?<!src=")(https?:\/\/[^\s<"]+)/g, (match) => {
            let hostname;
            try { hostname = new URL(match).hostname; } catch { hostname = ''; }
            const favicon = hostname ? `<img class="link-favicon" src="https://www.google.com/s2/favicons?domain=${hostname}&sz=32" alt="">` : '';
            return `<span class="link-embed">${favicon}<a href="${match}" target="_blank" rel="noopener">${match}</a></span>`;
        });
        return text;
    }

    /**
     * Parse a line to see if it's a task/checkbox line.
     * Supports:
     *   [ ] text, [x] text, [] text           (bracket syntax)
     *   [ ]! text, [ ]!! text                  (bracket + priority)
     *   & text                                 (ampersand shorthand)
     *   &! text, &!! text                      (ampersand + priority)
     *   - [ ] text, - & text                   (with list prefix)
     *
     * Priority: !! = high (red), ! = medium (amber), none = normal
     */
    function parseTaskLine(line) {
        // Bracket syntax: optional "- ", then [<space or x>], optional ! or !!, then text
        const bracketMatch = line.match(/^(\s*(?:-\s+)?)\[([ xX]?)\](!!?)?\s*(.*)$/);
        if (bracketMatch) {
            const bangs = bracketMatch[3] || '';
            return {
                prefix: bracketMatch[1],
                checked: bracketMatch[2].toLowerCase() === 'x',
                text: bracketMatch[4],
                type: 'bracket',
                priority: bangs === '!!' ? 'high' : bangs === '!' ? 'medium' : 'normal'
            };
        }
        // Ampersand syntax: optional "- ", then & optional ! or !!, followed by space and text
        const ampMatch = line.match(/^(\s*(?:-\s+)?)&(!!?)?\s+(.+)$/);
        if (ampMatch) {
            const bangs = ampMatch[2] || '';
            return {
                prefix: ampMatch[1],
                checked: false,
                text: ampMatch[3],
                type: 'ampersand',
                priority: bangs === '!!' ? 'high' : bangs === '!' ? 'medium' : 'normal'
            };
        }
        return null;
    }

    function renderTask(task, lineIndex) {
        const checkedClass = task.checked ? ' checked' : '';
        const priorityClass = task.priority !== 'normal' ? ` priority-${task.priority}` : '';
        let badge = '';
        if (task.priority === 'medium') {
            badge = '<span class="priority-badge medium">!</span>';
        } else if (task.priority === 'high') {
            badge = '<span class="priority-badge high">!!</span>';
        }
        return `<div class="task-line${checkedClass}${priorityClass}" data-line="${lineIndex}">` +
            `<div class="task-checkbox${checkedClass}"></div>` +
            badge +
            `<span class="task-text">${renderInline(task.text)}</span>` +
            `</div>`;
    }

    function renderLine(line, lineIndex) {
        const trimmed = line.trim();

        // Empty line
        if (trimmed === '') return '<div class="empty-line"></div>';

        // Task / checkbox (check before list items)
        const task = parseTaskLine(line);
        if (task) return renderTask(task, lineIndex);

        // Headers
        if (trimmed.startsWith('### ')) return `<h3>${renderInline(trimmed.slice(4))}</h3>`;
        if (trimmed.startsWith('## '))  return `<h2>${renderInline(trimmed.slice(3))}</h2>`;
        if (trimmed.startsWith('# '))   return `<h1>${renderInline(trimmed.slice(2))}</h1>`;

        // Horizontal rule
        if (/^[-]{3,}$/.test(trimmed) || /^[*]{3,}$/.test(trimmed)) return '<hr>';

        // Blockquote
        if (trimmed.startsWith('> ')) {
            return `<blockquote>${renderInline(trimmed.slice(2))}</blockquote>`;
        }

        // Image-only line: ![alt](url)
        const imgMatch = trimmed.match(/^!\[([^\]]*)\]\((.+?)\)$/);
        if (imgMatch) {
            return `<p><img src="${escapeHtml(imgMatch[2])}" alt="${escapeHtml(imgMatch[1])}" loading="lazy"></p>`;
        }

        // List item
        const listMatch = line.match(/^(\s*)-\s+(.*)$/);
        if (listMatch) {
            return `<div class="list-item"><span class="bullet">•</span><span>${renderInline(listMatch[2])}</span></div>`;
        }

        // Regular paragraph
        return `<p>${renderInline(line)}</p>`;
    }

    function renderMarkdown(source) {
        const lines = source.split('\n');
        let html = '';
        let inCodeBlock = false;
        let codeContent = '';
        let codeLang = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Code block fence
            if (trimmed.startsWith('```')) {
                if (inCodeBlock) {
                    // Close code block
                    html += `<pre><code>${escapeHtml(codeContent)}</code></pre>`;
                    codeContent = '';
                    codeLang = '';
                    inCodeBlock = false;
                } else {
                    // Open code block
                    inCodeBlock = true;
                    codeLang = trimmed.slice(3).trim();
                }
                continue;
            }

            if (inCodeBlock) {
                codeContent += (codeContent ? '\n' : '') + line;
                continue;
            }

            html += renderLine(line, i);
        }

        // Close any unclosed code block
        if (inCodeBlock) {
            const escaped = escapeHtml(codeContent);
            const langAttr = codeLang ? ` class="language-${codeLang}"` : '';
            html += `<pre><code${langAttr}>${escaped}</code></pre>`;
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
            // &[!|!!] text → [x][!|!!] text — preserve priority markers
            const bangStr = task.priority === 'high' ? '!!' : task.priority === 'medium' ? '!' : '';
            newLine = task.prefix + '[x]' + bangStr + ' ' + task.text;
            newChecked = true;
        } else if (task.checked) {
            // [x] → [ ]
            newLine = line.replace(/\[[xX]\]/, '[ ]');
            newChecked = false;
        } else {
            // [ ] or [] → [x]
            newLine = line.replace(/\[\s?\]/, '[x]');
            newChecked = true;
        }

        lines[lineIndex] = newLine;
        page.content = lines.join('\n');
        page.lastEdited = Date.now();

        // Update editor content if in edit mode
        if (state.mode === 'edit') {
            const pos = editor.selectionStart;
            editor.value = page.content;
            editor.selectionStart = editor.selectionEnd = pos;
        }

        // Smooth DOM update (no full re-render)
        const taskLineEl = preview.querySelector(`.task-line[data-line="${lineIndex}"]`);
        if (taskLineEl) {
            const checkboxEl = taskLineEl.querySelector('.task-checkbox');

            if (newChecked) {
                taskLineEl.classList.add('checked');
                checkboxEl.classList.add('checked');
            } else {
                taskLineEl.classList.remove('checked');
                checkboxEl.classList.remove('checked');
            }

            // Flash animation
            taskLineEl.classList.remove('just-toggled');
            // Force reflow to restart animation
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
            // Apply syntax highlighting to code blocks
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

        // Word count
        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        wordCountEl.textContent = `${words} word${words !== 1 ? 's' : ''}`;

        // Task count
        const lines = content.split('\n');
        let total = 0, done = 0;
        for (const line of lines) {
            const task = parseTaskLine(line);
            if (task) {
                total++;
                if (task.checked) done++;
            }
        }
        taskCountEl.textContent = total > 0 ? `${done}/${total} tasks` : '';
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
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    function renderPageList() {
        const ids = Object.keys(state.pages);
        let html = '';
        for (const id of ids) {
            const page = state.pages[id];
            const isActive = id === state.currentPageId;
            const timeAgo = formatTimeAgo(page.lastEdited);
            html += `<div class="page-item${isActive ? ' active' : ''}" data-page-id="${id}">` +
                `<span class="page-title" data-page-id="${id}">${escapeHtml(page.title)}</span>` +
                `<span class="page-meta">${timeAgo}</span>` +
                (ids.length > 1
                    ? `<button class="page-delete" data-page-id="${id}" title="Delete">&times;</button>`
                    : '') +
                `</div>`;
        }
        pageList.innerHTML = html;
    }

    function switchPage(pageId) {
        if (!state.pages[pageId]) return;

        // Save current editor content before switching
        if (state.mode === 'edit') {
            getCurrentPage().content = editor.value;
        }

        state.currentPageId = pageId;
        editor.value = getCurrentPage().content;

        if (state.mode === 'preview') {
            renderPreview();
        }

        saveStateImmediate();
        updateStatus();
        renderPageList();
        renderTabBar();
    }

    function addPage() {
        // Save current editor content
        if (state.mode === 'edit') {
            getCurrentPage().content = editor.value;
        }

        const count = Object.keys(state.pages).length + 1;
        const id = generateId();
        state.pages[id] = { title: `Page ${count}`, content: '', lastEdited: Date.now() };
        switchPage(id);
    }

    function deletePage(pageId) {
        if (Object.keys(state.pages).length <= 1) return;
        if (!confirm(`Delete "${state.pages[pageId].title}"?`)) return;

        delete state.pages[pageId];
        if (state.currentPageId === pageId) {
            state.currentPageId = Object.keys(state.pages)[0];
        }
        switchPage(state.currentPageId);
    }

    function renamePage(pageId) {
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

    // Editor input — save content
    editor.addEventListener('input', () => {
        const page = getCurrentPage();
        page.content = editor.value;
        page.lastEdited = Date.now();
        saveState();
        updateStatus();
    });

    // Tab key — indent instead of changing focus
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                // Outdent: remove leading 4 spaces or tab from current line
                const start = editor.selectionStart;
                const before = editor.value.substring(0, start);
                const lineStart = before.lastIndexOf('\n') + 1;
                const linePrefix = editor.value.substring(lineStart, start);
                if (linePrefix.startsWith('    ')) {
                    editor.value = editor.value.substring(0, lineStart) + editor.value.substring(lineStart + 4);
                    editor.selectionStart = editor.selectionEnd = Math.max(lineStart, start - 4);
                    editor.dispatchEvent(new Event('input'));
                } else if (linePrefix.startsWith('\t')) {
                    editor.value = editor.value.substring(0, lineStart) + editor.value.substring(lineStart + 1);
                    editor.selectionStart = editor.selectionEnd = Math.max(lineStart, start - 1);
                    editor.dispatchEvent(new Event('input'));
                }
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

            // Priority order: task patterns first, then plain lists
            if (/^(\s*)(?:-\s+)?\[[ xX]?\](?:!!?)?\s/.test(currentLine)) {
                // Task line with brackets → continue with [ ] (no priority — user adds manually)
                const indent = currentLine.match(/^(\s*)/)[1];
                const hasDash = /^(\s*)-\s+\[/.test(currentLine);
                continuationPrefix = indent + (hasDash ? '- [ ] ' : '[ ] ');
            } else if (/^(\s*)(?:-\s+)?&(?:!!?)?\s/.test(currentLine)) {
                // Task line with & → continue with &
                const indent = currentLine.match(/^(\s*)/)[1];
                const hasDash = /^(\s*)-\s+&/.test(currentLine);
                continuationPrefix = indent + (hasDash ? '- & ' : '& ');
            } else if (/^(\s*)-\s+/.test(currentLine)) {
                // Plain list item → continue with -
                const indent = currentLine.match(/^(\s*)/)[1];
                continuationPrefix = indent + '- ';
            }

            if (continuationPrefix) {
                // Check if the current line has content beyond the prefix
                const contentAfterPrefix = currentLine
                    .replace(/^\s*(?:-\s+)?(?:\[[ xX]?\](?:!!?)?\s*|&(?:!!?)?\s*)?/, '')
                    .trim();

                if (contentAfterPrefix === '') {
                    // Empty list/task item — break out of the list
                    e.preventDefault();
                    const lineStart = textBefore.lastIndexOf('\n') + 1;
                    const after = editor.value.substring(start);
                    editor.value = editor.value.substring(0, lineStart) + '\n' + after;
                    editor.selectionStart = editor.selectionEnd = lineStart + 1;
                    editor.dispatchEvent(new Event('input'));
                } else {
                    // Continue the list/task
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

    // Settings button
    settingsToggle.addEventListener('click', openSettings);
    settingsClose.addEventListener('click', closeSettings);

    // Click outside settings panel to close
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

    // Page list interactions
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

    // Double-click page title to rename
    pageList.addEventListener('dblclick', (e) => {
        const titleEl = e.target.closest('.page-title');
        if (titleEl) {
            e.stopPropagation();
            renamePage(titleEl.dataset.pageId);
        }
    });

    // Add page
    addPageBtn.addEventListener('click', addPage);

    // Export / Import / Clear
    exportBtn.addEventListener('click', exportCurrentPage);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importMarkdown(file);
        e.target.value = ''; // Reset so same file can be re-imported
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

    /**
     * Collect incomplete tasks from ALL pages, filtered by priority setting.
     * Returns array of { text, priority, page } sorted: high → medium → normal.
     */
    function collectPendingTasks() {
        const filter = state.notifFilter || 'all';
        const tasks = [];

        for (const [id, page] of Object.entries(state.pages)) {
            const lines = page.content.split('\n');
            for (const line of lines) {
                const task = parseTaskLine(line);
                if (!task || task.checked) continue;

                // Apply filter
                if (filter === 'high' && task.priority !== 'high') continue;
                if (filter === 'medium' && task.priority === 'normal') continue;

                tasks.push({
                    text: task.text,
                    priority: task.priority,
                    page: page.title
                });
            }
        }

        // Sort: high first, then medium, then normal
        const order = { high: 0, medium: 1, normal: 2 };
        tasks.sort((a, b) => order[a.priority] - order[b.priority]);

        return tasks;
    }

    /**
     * Format a task for notification body text.
     */
    function formatTaskForNotif(task) {
        const marker = task.priority === 'high' ? '‼️ ' : task.priority === 'medium' ? '⚠️ ' : '• ';
        return marker + task.text;
    }

    /**
     * Send a browser notification with pending tasks.
     * Uses the Notification API with actions, icons, and tag for stacking.
     */
    async function sendTaskNotification(isTest = false) {
        // Ensure we have permission
        if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') return;
        }
        if (Notification.permission !== 'granted') return;

        const tasks = collectPendingTasks();

        if (tasks.length === 0 && !isTest) return;

        const highCount = tasks.filter(t => t.priority === 'high').length;
        const medCount = tasks.filter(t => t.priority === 'medium').length;

        // Build title
        let title;
        if (isTest && tasks.length === 0) {
            title = '✅ No pending tasks!';
        } else if (highCount > 0) {
            title = `🔴 ${tasks.length} task${tasks.length !== 1 ? 's' : ''} pending`;
        } else if (medCount > 0) {
            title = `🟡 ${tasks.length} task${tasks.length !== 1 ? 's' : ''} pending`;
        } else {
            title = `📋 ${tasks.length} task${tasks.length !== 1 ? 's' : ''} pending`;
        }

        // Build body — show up to 6 tasks, grouped nicely
        const maxShow = 6;
        const shown = tasks.slice(0, maxShow);
        const bodyLines = shown.map(formatTaskForNotif);
        if (tasks.length > maxShow) {
            bodyLines.push(`  ...and ${tasks.length - maxShow} more`);
        }
        const body = bodyLines.join('\n');

        // Priority summary for the tag line
        const parts = [];
        if (highCount) parts.push(`${highCount} urgent`);
        if (medCount) parts.push(`${medCount} important`);
        const normalCount = tasks.length - highCount - medCount;
        if (normalCount) parts.push(`${normalCount} normal`);

        // Create the notification
        const notif = new Notification(title, {
            body: body || 'All clear — nothing to do!',
            icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="8" fill="#1c1917" stroke="#3b82f6" stroke-width="4"/><path d="M16 32l10 10 22-24" stroke="#3b82f6" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
            tag: 'tasks-reminder', // Replaces previous notification instead of stacking
            renotify: true, // Vibrate/sound even when replacing
            silent: false,
            requireInteraction: highCount > 0, // Stay visible if urgent tasks exist
        });

        // Click notification → focus the tab
        notif.onclick = () => {
            window.focus();
            notif.close();
        };
    }

    /**
     * Start or restart the notification interval timer.
     */
    function startNotifTimer() {
        // Clear any existing timer
        if (notifTimerId) {
            clearInterval(notifTimerId);
            notifTimerId = null;
        }

        const minutes = parseInt(state.notifInterval, 10) || 0;
        if (minutes <= 0) {
            updateNotifStatus();
            return;
        }

        // Request permission proactively
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        notifTimerId = setInterval(() => {
            sendTaskNotification(false);
        }, minutes * 60 * 1000);

        updateNotifStatus();
    }

    /**
     * Update the notification status indicator in settings.
     */
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
            notifStatusText.textContent = 'Blocked — allow in browser settings';
            notifDot.className = 'notif-dot inactive';
        } else if (!hasPermission) {
            notifStatusText.textContent = `Every ${formatInterval(minutes)} — click Test to enable`;
        } else {
            const filterLabel = { all: 'all tasks', medium: 'medium+ priority', high: 'high priority only' };
            notifStatusText.textContent = `Every ${formatInterval(minutes)} · ${filterLabel[state.notifFilter] || 'all tasks'}`;
        }
    }

    function formatInterval(minutes) {
        if (minutes < 60) return `${minutes}m`;
        const h = minutes / 60;
        return h === 1 ? '1 hour' : `${h} hours`;
    }

    // ─── Notification Event Listeners ────────────────────────────

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

    // ─── Tab Bar ──────────────────────────────────────────────────

    function renderTabBar() {
        const ids = Object.keys(state.pages);
        let html = '';
        for (const id of ids) {
            const page = state.pages[id];
            const isActive = id === state.currentPageId;
            html += `<div class="tab${isActive ? ' active' : ''}" data-page-id="${id}">` +
                `<span class="tab-title">${escapeHtml(page.title)}</span>` +
                (ids.length > 1 ? `<span class="tab-close" data-page-id="${id}">&times;</span>` : '') +
                `</div>`;
        }
        tabsContainer.innerHTML = html;

        // Scroll active tab into view
        const activeTab = tabsContainer.querySelector('.tab.active');
        if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }

    // Tab bar event listeners
    tabsContainer.addEventListener('click', (e) => {
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

    // Double-click tab to rename (inline)
    tabsContainer.addEventListener('dblclick', (e) => {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        e.stopPropagation();
        const pageId = tab.dataset.pageId;
        const page = state.pages[pageId];
        if (!page) return;

        const titleSpan = tab.querySelector('.tab-title');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-rename-input';
        input.value = page.title;
        titleSpan.replaceWith(input);
        input.focus();
        input.select();

        const finishRename = () => {
            const newTitle = input.value.trim();
            if (newTitle) {
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

    tabAddBtn.addEventListener('click', addPage);

    // ─── Image Paste & Drag Support ──────────────────────────────

    function fileToDataUrl(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });
    }

    // Paste images
    editor.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        // Check for image files in clipboard
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (!file) return;
                const dataUrl = await fileToDataUrl(file);
                insertAtCursor(`![image](${dataUrl})`);
                return;
            }
        }

        // Check for pasted plain text that looks like a URL
        const text = e.clipboardData.getData('text/plain');
        if (text && /^https?:\/\/\S+$/.test(text.trim())) {
            // Check if the URL points to an image
            const url = text.trim();
            if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(url)) {
                e.preventDefault();
                insertAtCursor(`![image](${url})`);
            }
            // Otherwise let it paste normally — renderInline will auto-linkify it
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

        // Ensure we're in edit mode
        if (state.mode !== 'edit') setMode('edit');

        // Check for image files
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    const dataUrl = await fileToDataUrl(file);
                    insertAtCursor(`\n![${file.name}](${dataUrl})\n`);
                }
            }
            return;
        }

        // Check for dropped URLs
        const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
        if (url && /^https?:\/\/\S+$/.test(url.trim())) {
            const trimUrl = url.trim();
            if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(trimUrl)) {
                insertAtCursor(`\n![image](${trimUrl})\n`);
            } else {
                insertAtCursor(trimUrl);
            }
        }
    });

    // ─── Initialization ──────────────────────────────────────────
    function init() {
        // Apply saved font size
        document.documentElement.style.setProperty('--font-size', state.fontSize + 'px');
        fontSizeSlider.value = state.fontSize;
        fontSizeValue.textContent = state.fontSize + 'px';

        // Apply saved notification settings
        if (state.notifInterval === undefined) state.notifInterval = 0;
        if (state.notifFilter === undefined) state.notifFilter = 'all';
        notifIntervalSelect.value = state.notifInterval;
        notifFilterSelect.value = state.notifFilter;

        // Set icons
        settingsToggle.innerHTML = ICON_GEAR;

        // Load content
        editor.value = getCurrentPage().content;

        // Determine initial mode: if there's content, use saved mode; otherwise edit
        const hasContent = getCurrentPage().content.trim().length > 0;
        setMode(hasContent ? (state.mode || 'edit') : 'edit');

        updateStatus();
        renderTabBar();

        // Start notification timer
        startNotifTimer();
    }

    init();
})();
