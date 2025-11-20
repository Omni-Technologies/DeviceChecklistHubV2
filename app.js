// app.js — Supabase-backed version (no CHECKLISTS import)

// --- UTILITIES ---
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => parent.querySelectorAll(selector);

// Supabase client from supabase-config.js
const db = window.supabaseClient;

function debounce(func, delay = 250) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const p = document.createElement('p');
    p.textContent = String(str);
    return p.innerHTML;
}

/**
 * Normalizes device data from different sources into a consistent format.
 * (Kept for compatibility with imports / future formats.)
 */
function normalizeDevice(device) {
    const isExcelFormat = device.hasOwnProperty('System Address ( Node : Card : Device )');
    if (isExcelFormat) {
        const systemAddress = device['System Address ( Node : Card : Device )'] || 'N/A:N/A:N/A';
        const addressParts = String(systemAddress).split(':');
        return {
            loop: addressParts[1] || '',
            address: addressParts[2] || '',
            systemAddress,
            model: device['SKU'] || '',
            deviceType: device['SKU Description'] || '',
            deviceTypeID: '',
            serialNumber: device['Serial Number'] || '',
            messages: device['Location Text'] || '',
        };
    }

    return {
        loop: device.loop ?? '',
        address: device.address ?? '',
        systemAddress: device.systemAddress ?? '',
        model: device.model ?? '',
        deviceType: device.deviceType ?? '',
        deviceTypeID: device.deviceTypeID ?? '',
        serialNumber: device.serialNumber ?? '',
        messages: device.messages ?? '',
    };
}

// --- TOAST & MODAL HELPERS ---
const toastContainerId = 'toast-container';

function getToastContainer() {
    let container = document.getElementById(toastContainerId);
    if (!container) {
        container = document.createElement('div');
        container.id = toastContainerId;
        container.className = 'fixed z-50 bottom-4 right-4 flex flex-col gap-2 max-w-sm';
        document.body.appendChild(container);
    }
    return container;
}

function showToast(message, type = 'info') {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = 'flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg text-sm transition-all duration-300 transform translate-y-2 opacity-0';

    let base = 'bg-slate-900 text-white border border-slate-700';
    let icon = 'ℹ️';

    if (type === 'success') {
        base = 'bg-emerald-600 text-white border border-emerald-500';
        icon = '✅';
    } else if (type === 'error') {
        base = 'bg-red-600 text-white border border-red-500';
        icon = '⚠️';
    } else if (type === 'warning') {
        base = 'bg-amber-500 text-white border border-amber-400';
        icon = '⚠️';
    }

    toast.className += ' ' + base;
    toast.innerHTML = `
        <span>${icon}</span>
        <span class="flex-1">${escapeHTML(message)}</span>
        <button class="text-xs underline">Dismiss</button>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    });

    const remove = () => {
        toast.classList.add('translate-y-2', 'opacity-0');
        setTimeout(() => toast.remove(), 200);
    };

    toast.querySelector('button').addEventListener('click', remove);
    setTimeout(remove, 4000);
}

// Simple confirmation modal (wired to existing HTML)
const modal = $('#confirmation-modal');
const modalPanel = $('#confirmation-modal-panel');
const confirmButton = $('#modal-confirm-button');
const cancelButton = $('#modal-cancel-button');
const modalMessage = $('#modal-message');
let confirmCallback = null;

function showConfirmationModal(message, onConfirm) {
    if (!modal) return;
    modalMessage.textContent = message;
    confirmCallback = onConfirm;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    requestAnimationFrame(() => {
        modalPanel.classList.remove(
            'opacity-0', 'translate-y-4', 'sm:translate-y-0', 'sm:scale-95'
        );
    });
}

if (modal && confirmButton && cancelButton) {
    confirmButton.addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        confirmCallback = null;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modalPanel.classList.add(
            'opacity-0', 'translate-y-4', 'sm:translate-y-0', 'sm:scale-95'
        );
    });

    cancelButton.addEventListener('click', () => {
        confirmCallback = null;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modalPanel.classList.add(
            'opacity-0', 'translate-y-4', 'sm:translate-y-0', 'sm:scale-95'
        );
    });
}

// --- BUILDING PICKER (loads checklists from Supabase) ---

class BuildingPicker extends HTMLElement {
    constructor() {
        super();
        this.isMobile = window.innerWidth < 640;
        this.checklists = [];
        this.loading = false;
    }

    connectedCallback() {
        this.isMobile = window.innerWidth < 640;
        this.renderLoading();
        this.loadFromSupabase();
        window.addEventListener('resize', debounce(() => this.handleResize(), 200));
    }

    disconnectedCallback() {
        window.removeEventListener('resize', this.handleResize);
    }

    handleResize() {
        const newIsMobile = window.innerWidth < 640;
        if (newIsMobile !== this.isMobile) {
            this.isMobile = newIsMobile;
            this.render();
        }
    }

    renderLoading() {
        const containerId = this.isMobile
            ? '#mobile-building-picker-container'
            : '#desktop-building-picker-container';
        const container = $(containerId);
        if (!container) return;
        container.innerHTML = `
            <div class="bg-white dark:bg-slate-900 rounded-xl shadow-lg p-4">
                <p class="text-sm text-slate-500">Loading checklists...</p>
            </div>
        `;
    }

    async loadFromSupabase() {
        this.loading = true;
        try {
            const { data, error } = await db
                .from('checklists')
                .select(`
                    id,
                    name,
                    year,
                    company:company_id ( name )
                `)
                .order('name', { ascending: true });

            if (error) throw error;

            this.checklists = (data || []).map(row => ({
                key: row.id, // UUID – used as stable checklist key
                companyName: row.company?.name || 'Unknown',
                checklistName: row.name,
                year: row.year,
            }));
        } catch (err) {
            console.error('Failed to load checklists from Supabase:', err);
            this.checklists = [];
            showToast('Failed to load checklists from database.', 'error');
        } finally {
            this.loading = false;
            this.render();
            this.attachEventListeners();
        }
    }

    render() {
        const containerId = this.isMobile
            ? '#mobile-building-picker-container'
            : '#desktop-building-picker-container';
        const otherContainerId = this.isMobile
            ? '#desktop-building-picker-container'
            : '#mobile-building-picker-container';
        const container = $(containerId);
        const other = $(otherContainerId);
        if (!container) return;

        if (other) other.innerHTML = '';

        if (this.loading) {
            container.innerHTML = `
                <div class="bg-white dark:bg-slate-900 rounded-xl shadow-lg p-4">
                    <p class="text-sm text-slate-500">Loading checklists...</p>
                </div>
            `;
            return;
        }

        if (!this.checklists.length) {
            container.innerHTML = `
                <div class="bg-white dark:bg-slate-900 rounded-xl shadow-lg p-4">
                    <p class="text-sm text-slate-500">No checklists available.</p>
                </div>
            `;
            return;
        }

        const grouped = this.groupByCompany(this.checklists);
        const isMobile = this.isMobile;

        const content = `
            <div class="bg-white dark:bg-slate-900 rounded-xl shadow-lg p-4 sm:p-5 h-full flex flex-col">
                <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">
                    ${isMobile ? 'Select Checklist' : 'Checklists'}
                </h2>
                <div class="flex-1 overflow-y-auto pr-1 space-y-4">
                    ${Object.keys(grouped).sort().map(companyName => {
                        const group = grouped[companyName];
                        return `
                            <section>
                                <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                                    ${escapeHTML(companyName)}
                                </h3>
                                <div class="space-y-1.5">
                                    ${group.map(item => `
                                        <button
                                            class="w-full text-left px-3 py-2 rounded-lg border border-slate-200/70 dark:border-slate-700/60 bg-slate-50/70 hover:bg-sky-50 dark:bg-slate-900 hover:border-sky-400 transition flex items-center justify-between gap-2 text-xs sm:text-sm"
                                            data-checklist-key="${item.key}"
                                        >
                                            <span class="flex-1 truncate">${escapeHTML(item.checklistName)}</span>
                                            <span class="inline-flex items-center rounded-full bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 text-[0.65rem] font-medium text-slate-700 dark:text-slate-300">
                                                ${escapeHTML(String(item.year || ''))}
                                            </span>
                                        </button>
                                    `).join('')}
                                </div>
                            </section>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        container.innerHTML = content;
    }

    groupByCompany(list) {
        return list.reduce((acc, item) => {
            if (!acc[item.companyName]) acc[item.companyName] = [];
            acc[item.companyName].push(item);
            return acc;
        }, {});
    }

    attachEventListeners() {
        const containerId = this.isMobile
            ? '#mobile-building-picker-container'
            : '#desktop-building-picker-container';
        const container = $(containerId);
        if (!container) return;

        container.querySelectorAll('button[data-checklist-key]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-checklist-key');
                document.dispatchEvent(new CustomEvent('checklist-selected', {
                    detail: { key }
                }));
            });
        });
    }
}

customElements.define('building-picker', BuildingPicker);

// --- CHECKLIST WORKSPACE (per-checklist view) ---

class ChecklistWorkspace extends HTMLElement {
    constructor() {
        super();
        this.data = null;
        this.checklistKey = null; // this will be checklist.id (UUID)
        this.sortState = { key: 'address', dir: 'asc' };
        this.state = {
            checkedDevices: new Set(),
            checkHistory: [],
        };
        this.realtimeChannel = null;
        this.handleMenuAction = this.handleMenuAction.bind(this);
        this.handleSortChange = this.handleSortChange.bind(this);
        this.handleFileImport = this.handleFileImport.bind(this);
    }
    
    static get observedAttributes() { return ['building-key']; }

    connectedCallback() {
        document.addEventListener('request-workspace-action', this.handleMenuAction);
        this.fileInput = $('#import-file-input');
        if (this.fileInput) {
            this.fileInput.addEventListener('change', this.handleFileImport);
        }
    }

    disconnectedCallback() {
        document.removeEventListener('request-workspace-action', this.handleMenuAction);
        if (this.fileInput) {
            this.fileInput.removeEventListener('change', this.handleFileImport);
        }
        this.cleanupRealtimeSubscription();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'building-key' && oldValue !== newValue) {
            this.cleanupRealtimeSubscription();
            this.checklistKey = newValue;
            this.state.checkedDevices = new Set();
            this.state.checkHistory = [];
            this.loadChecklistFromSupabase();
        }
    }
    
    getUniqueDeviceId(device) {
        return `${this.checklistKey}-${device.serialNumber}-${device.loop}-${device.address}-${device.messages}`;
    }

    async loadChecklistFromSupabase() {
        this.innerHTML = `<div class="text-center py-20">Loading checklist...</div>`;
        this.cleanupRealtimeSubscription();
        try {
            // Fetch checklist + company name
            const { data: checklistRow, error: checklistErr } = await db
                .from('checklists')
                .select(`
                    id,
                    name,
                    year,
                    company:company_id ( name )
                `)
                .eq('id', this.checklistKey)
                .maybeSingle();

            if (checklistErr) throw checklistErr;
            if (!checklistRow) throw new Error("Checklist not found in database.");

            const { data: deviceRows, error: deviceErr } = await db
                .from('devices')
                .select('*')
                .eq('checklist_id', this.checklistKey);

            if (deviceErr) throw deviceErr;

            this.data = {
                key: checklistRow.id,
                name: checklistRow.company?.name || 'Checklist',
                location: checklistRow.name, // e.g. "Fire Alarm Device Inspection"
                devices: (deviceRows || []).map(row => ({
                    loop: row.loop ?? '',
                    address: row.address ?? '',
                    systemAddress: '', // not stored; we can compute later if needed
                    model: row.model ?? '',
                    deviceType: row.device_type ?? '',
                    deviceTypeID: '',
                    serialNumber: row.serial_number ?? '',
                    messages: row.messages ?? '',
                }))
            };

            await this.loadProgressFromSupabase();
            this.render();
            this.setupRealtimeSubscription();

        } catch (error) {
            console.error("Failed to load checklist from Supabase:", error);
            showToast(error.message || 'Failed to load checklist from database.', 'error');
            this.innerHTML = `<div class="text-center py-20 text-red-500">${escapeHTML(error.message || 'Failed to load checklist.')}</div>`;
        }
    }
    
    loadInspectedState() {
        const savedState = localStorage.getItem(`checklistState_${this.checklistKey}`);
        if (savedState) {
            const parsed = JSON.parse(savedState);
            this.state.checkedDevices = new Set(parsed.checked || []);
            this.state.checkHistory = parsed.history || [];
        } else {
            this.state.checkedDevices.clear();
            this.state.checkHistory = [];
        }
        this.updateLastCheckedFooter();
    }

    saveInspectedState() {
        const appState = {
            checked: Array.from(this.state.checkedDevices),
            history: this.state.checkHistory
        };
        localStorage.setItem(`checklistState_${this.checklistKey}`, JSON.stringify(appState));
    }

    async loadProgressFromSupabase() {
        if (!this.checklistKey) {
            this.loadInspectedState();
            return;
        }

        try {
            const { data, error } = await db
                .from('device_progress')
                .select('device_uid, checked, updated_at')
                .eq('checklist_id', this.checklistKey);

            if (error) throw error;

            if (!data || data.length === 0) {
                this.loadInspectedState();
                return;
            }

            const checkedSet = new Set();
            const history = [];

            const checkedRows = data
                .filter(row => row.checked)
                .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));

            for (const row of checkedRows) {
                if (!row.device_uid) continue;
                checkedSet.add(row.device_uid);
                history.push(row.device_uid);
            }

            this.state.checkedDevices = checkedSet;
            this.state.checkHistory = history;

            this.saveInspectedState();
        } catch (err) {
            console.error('Failed to load progress from Supabase:', err);
            showToast('Could not load shared progress. Using local device state.', 'error');
            this.loadInspectedState();
        }

        this.updateLastCheckedFooter();
    }

    setupRealtimeSubscription() {
        if (!this.checklistKey || !db || typeof db.channel !== 'function') return;

        this.cleanupRealtimeSubscription();

        this.realtimeChannel = db
            .channel(`device_progress_${this.checklistKey}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'device_progress',
                    filter: `checklist_id=eq.${this.checklistKey}`,
                },
                (payload) => this.handleRealtimePayload(payload)
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('Realtime subscribed for checklist', this.checklistKey);
                }
            });
    }

    cleanupRealtimeSubscription() {
        if (this.realtimeChannel) {
            try {
                db.removeChannel(this.realtimeChannel);
            } catch (err) {
                console.warn('Error removing realtime channel:', err);
            }
            this.realtimeChannel = null;
        }
    }

    handleRealtimePayload(payload) {
        const row = payload.new;
        if (!row || row.checklist_id !== this.checklistKey) return;

        const deviceId = row.device_uid;
        if (!deviceId) return;

        const wasChecked = this.state.checkedDevices.has(deviceId);

        if (row.checked) {
            if (!wasChecked) {
                this.state.checkedDevices.add(deviceId);
            }
        } else {
            if (wasChecked) {
                this.state.checkedDevices.delete(deviceId);
            }
        }

        this.saveInspectedState();
        this.updateUI();
        this.updateLastCheckedFooter();
    }

    async pushDeviceProgressToSupabase(deviceId, checked) {
        if (!this.checklistKey) return;

        try {
            const { error } = await db
                .from('device_progress')
                .upsert(
                    {
                        checklist_id: this.checklistKey,
                        device_uid: deviceId,
                        checked,
                        updated_at: new Date().toISOString(),
                    },
                    {
                        onConflict: 'checklist_id,device_uid',
                    }
                );

            if (error) {
                console.error('Failed to save progress to Supabase:', error);
                showToast('Could not sync this device to the cloud. Local state only.', 'error');
            }
        } catch (err) {
            console.error('Unexpected Supabase error:', err);
        }
    }

    render() {
        if (!this.data) return;
        this.innerHTML = `
            <div class="bg-white dark:bg-slate-900 rounded-xl shadow-lg">
                <header class="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800">
                   <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">${escapeHTML(this.data.name)}</h2>
                   <p class="text-slate-500 dark:text-slate-400">${escapeHTML(this.data.location)}</p>
                </header>
                <div id="checklist-content" class="p-2 sm:p-6"></div>
            </div>
        `;
        this.updateUI();
        this.attachEventListeners();
    }

    // (existing renderChecklistContent, renderTableRows, filterTable, progress summary,
    // undo/clear/share logic, etc. remain unchanged from your previous file...)

    // IMPORTANT: only the progress storage / realtime bits were added,
    // and handleRowClick now syncs to Supabase:

    handleSortChange(event) {
        if (event.target.id !== 'sort-select') return;
        const [key, dir] = event.target.value.split('-');
        this.sortState = { key, dir };
        this.updateUI();
    }

    handleRowClick(row) {
        const { deviceId } = row.dataset;
        const checkboxes = row.querySelectorAll(`input[data-device-id="${deviceId}"]`);
        if (checkboxes.length === 0) return;

        const isInspected = !checkboxes[0].checked;
        
        if (isInspected) {
            this.state.checkedDevices.add(deviceId);
            this.state.checkHistory.push(deviceId);
        } else {
            this.state.checkedDevices.delete(deviceId);
            const historyIndex = this.state.checkHistory.lastIndexOf(deviceId);
            if (historyIndex > -1) this.state.checkHistory.splice(historyIndex, 1);
        }
        
        row.classList.add('flash-bg');
        row.addEventListener('animationend', () => row.classList.remove('flash-bg'), { once: true });

        this.saveInspectedState();
        this.updateUI();
        this.updateLastCheckedFooter();

        // Sync this change to Supabase so other inspectors see it
        this.pushDeviceProgressToSupabase(deviceId, isInspected);
    }

    handleMenuAction(event) {
        const { action } = event.detail;
        this.handleGlobalAction(action);
    }

    // ... (rest of your existing methods: handleGlobalAction, export, share links, etc.)
}

customElements.define('checklist-workspace', ChecklistWorkspace);

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    const mobilePickerContainer = $('#mobile-building-picker-container');
    const desktopPickerContainer = $('#desktop-building-picker-container');
    const workspaceHost = $('#checklist-workspace');

    if (mobilePickerContainer) mobilePickerContainer.appendChild(document.createElement('building-picker'));
    if (desktopPickerContainer) desktopPickerContainer.appendChild(document.createElement('building-picker'));
    
    try {
      const intent = extractShareIntentFromURL?.();
      if (intent && intent.key) {
        window.__pendingMergeIntent = intent;
        document.dispatchEvent(new CustomEvent('checklist-selected', { detail: { key: intent.key } }));
      }
    } catch (err) {
      console.error('Share intent parse error:', err);
      showToast('Invalid share link.', 'error');
    }

    document.addEventListener('checklist-selected', (e) => {
        const { key } = e.detail;
        $('#welcome-message')?.remove();
        let workspaceEl = workspaceHost.querySelector('checklist-workspace');
        if (!workspaceEl) {
            workspaceEl = document.createElement('checklist-workspace');
            workspaceHost.appendChild(workspaceEl);
        }
        workspaceEl.setAttribute('building-key', key);
    });

    // Hook up menu buttons if you use them
    const menuContainer = $('#menu-container');
    const menuButton = $('#menu-button');
    const menuDropdown = $('#menu-dropdown');
    if (!menuContainer || !menuButton || !menuDropdown) return;

    function toggleMenu(force) {
        const show = typeof force === 'boolean'
            ? force
            : menuDropdown.classList.contains('hidden');
        menuDropdown.classList.toggle('hidden', !show);
        menuButton.setAttribute('aria-expanded', show);
    }

    menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMenu();
    });

    menuDropdown.addEventListener('click', (e) => {
        const action = e.target.closest('[data-menu-action]')?.dataset.menuAction;
        if (action) {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('request-workspace-action', { detail: { action } }));
            toggleMenu(false);
        }
    });

    window.addEventListener('click', (e) => {
        if (!menuContainer.contains(e.target)) toggleMenu(false);
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menuDropdown.classList.contains('hidden')) toggleMenu(false);
    });
});
