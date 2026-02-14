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

    // ─── State ───────────────────────────────────────────────────
    let state = loadState();
    let saveTimeout = null;

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
        // Links [text](url)
        text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        return text;
    }

    /**
     * Parse a line to see if it's a task/checkbox line.
     * Supports:
     *   [ ] text, [x] text, [] text  (bracket syntax)
     *   & text                        (ampersand shorthand)
     *   - [ ] text, - & text          (with list prefix)
     */
    function parseTaskLine(line) {
        // Bracket syntax: optional "- ", then [<space or x>], then text
        const bracketMatch = line.match(/^(\s*(?:-\s+)?)\[([ xX]?)\]\s*(.*)$/);
        if (bracketMatch) {
            return {
                prefix: bracketMatch[1],
                checked: bracketMatch[2].toLowerCase() === 'x',
                text: bracketMatch[3],
                type: 'bracket'
            };
        }
        // Ampersand syntax: optional "- ", then & followed by space and text
        const ampMatch = line.match(/^(\s*(?:-\s+)?)&\s+(.+)$/);
        if (ampMatch) {
            return {
                prefix: ampMatch[1],
                checked: false,
                text: ampMatch[2],
                type: 'ampersand'
            };
        }
        return null;
    }

    function renderTask(task, lineIndex) {
        const checkedClass = task.checked ? ' checked' : '';
        return `<div class="task-line${checkedClass}" data-line="${lineIndex}">` +
            `<div class="task-checkbox${checkedClass}"></div>` +
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
            html += `<pre><code>${escapeHtml(codeContent)}</code></pre>`;
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
            // & text → [x] text
            newLine = task.prefix + '[x] ' + task.text;
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
            if (/^(\s*)(?:-\s+)?\[[ xX]?\]\s/.test(currentLine)) {
                // Task line with brackets → continue with [ ]
                const indent = currentLine.match(/^(\s*)/)[1];
                const hasDash = /^(\s*)-\s+\[/.test(currentLine);
                continuationPrefix = indent + (hasDash ? '- [ ] ' : '[ ] ');
            } else if (/^(\s*)(?:-\s+)?&\s/.test(currentLine)) {
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
                    .replace(/^\s*(?:-\s+)?(?:\[[ xX]?\]\s*|&\s*)?/, '')
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

    // ─── Initialization ──────────────────────────────────────────
    function init() {
        // Apply saved font size
        document.documentElement.style.setProperty('--font-size', state.fontSize + 'px');
        fontSizeSlider.value = state.fontSize;
        fontSizeValue.textContent = state.fontSize + 'px';

        // Set icons
        settingsToggle.innerHTML = ICON_GEAR;

        // Load content
        editor.value = getCurrentPage().content;

        // Determine initial mode: if there's content, use saved mode; otherwise edit
        const hasContent = getCurrentPage().content.trim().length > 0;
        setMode(hasContent ? (state.mode || 'edit') : 'edit');

        updateStatus();
    }

    init();
})();
