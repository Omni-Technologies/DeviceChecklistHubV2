// app.js — Supabase-backed, shared progress via Realtime

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
 * Normalizes device data when importing from Excel / JSON, etc.
 * (Kept for compatibility with import features.)
 */
function normalizeDevice(device) {
    const isExcelFormat = device.hasOwnProperty('System Address ( Node : Card : Device )');
    
    if (isExcelFormat) {
        const systemAddress = device['System Address ( Node : Card : Device )'] || '';
        const parts = systemAddress.split(':').map(p => p.trim());
        const card = parts.length >= 2 ? parts[1] : '';
        const deviceNum = parts.length >= 3 ? parts[2] : '';

        return {
            loop: card,
            address: deviceNum,
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

// --- TOAST / MODALS ---
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container') || createToastContainer();
    const toast = document.createElement('div');
    
    const baseClasses = 'rounded-lg shadow-lg px-4 py-3 text-sm flex items-center gap-3 mb-3 transition-all duration-300 transform translate-y-4 opacity-0';
    let typeClasses = 'bg-slate-900 text-white border border-slate-700';
    let icon = 'ℹ️';

    if (type === 'success') {
        typeClasses = 'bg-emerald-600 text-white border border-emerald-500';
        icon = '✅';
    } else if (type === 'error') {
        typeClasses = 'bg-red-600 text-white border border-red-500';
        icon = '⚠️';
    } else if (type === 'warning') {
        typeClasses = 'bg-amber-500 text-white border border-amber-400';
        icon = '⚠️';
    }

    toast.className = `${baseClasses} ${typeClasses}`;
    toast.innerHTML = `
        <div class="flex-shrink-0">${icon}</div>
        <div class="flex-1">${escapeHTML(message)}</div>
        <button class="flex-shrink-0 ml-2 text-sm font-medium hover:underline">Dismiss</button>
    `;

    toast.querySelector('button').addEventListener('click', () => {
        toast.classList.add('opacity-0', 'translate-y-4');
        setTimeout(() => toast.remove(), 200);
    });

    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
    });

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-4');
        setTimeout(() => toast.remove(), 200);
    }, 4000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed z-50 bottom-4 right-4 flex flex-col items-end';
    document.body.appendChild(container);
    return container;
}

function showConfirmationModal(message, onConfirm) {
    const modal = document.getElementById('confirmation-modal');
    const messageEl = document.getElementById('confirmation-message');
    const confirmBtn = document.getElementById('confirm-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    messageEl.textContent = message;
    modal.classList.remove('hidden');

    const cleanup = () => {
        modal.classList.add('hidden');
        confirmBtn.removeEventListener('click', confirmHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
        modal.removeEventListener('click', outsideClickHandler);
        document.removeEventListener('keydown', escapeHandler);
    };

    const confirmHandler = () => {
        onConfirm();
        cleanup();
    };

    const cancelHandler = () => cleanup();
    const outsideClickHandler = (e) => {
        if (e.target === modal) cleanup();
    };
    const escapeHandler = (e) => {
        if (e.key === 'Escape') cleanup();
    };

    confirmBtn.addEventListener('click', confirmHandler);
    cancelBtn.addEventListener('click', cancelHandler);
    modal.addEventListener('click', outsideClickHandler);
    document.addEventListener('keydown', escapeHandler);
}

// --- DATA LAYER HELPERS (Supabase) ---

async function fetchCompanies() {
    const { data, error } = await db
        .from('companies')
        .select('id, name')
        .order('name', { ascending: true });

    if (error) {
        console.error('Error fetching companies:', error);
        showToast('Could not load companies from database.', 'error');
        return [];
    }
    return data || [];
}

async function fetchChecklistsForCompany(companyId) {
    const { data, error } = await db
        .from('checklists')
        .select('id, name, year')
        .eq('company_id', companyId)
        .order('year', { ascending: false });

    if (error) {
        console.error('Error fetching checklists:', error);
        showToast('Could not load checklists for this company.', 'error');
        return [];
    }
    return data || [];
}

// --- CUSTOM ELEMENT: ChecklistWorkspace ---

class ChecklistWorkspace extends HTMLElement {
    constructor() {
        super();
        this.data = null;
        this.checklistKey = null; // checklist.id (UUID)
        this.sortState = { key: 'address', dir: 'asc' };
        this.state = {
            checkedDevices: new Set(),
            checkHistory: [],
        };
        this.realtimeChannel = null; // Supabase realtime channel

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
            this.cleanupRealtimeSubscription(); // stop listening to old checklist
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

        // Make sure any old subscription is cleared before loading a new checklist
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
                location: checklistRow.name,
                devices: (deviceRows || []).map(row => ({
                    loop: row.loop ?? '',
                    address: row.address ?? '',
                    systemAddress: '',
                    model: row.model ?? '',
                    deviceType: row.device_type ?? '',
                    deviceTypeID: '',
                    serialNumber: row.serial_number ?? '',
                    messages: row.messages ?? '',
                }))
            };

            // Load shared progress from Supabase (with local fallback)
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

            // If no cloud data yet, fall back to whatever is on this device
            if (!data || data.length === 0) {
                this.loadInspectedState();
                return;
            }

            const checkedSet = new Set();
            const history = [];

            // Use updated_at to approximate "check history" order for devices that are currently checked
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

            // Keep a local mirror for offline / quick reloads
            this.saveInspectedState();
        } catch (err) {
            console.error('Failed to load progress from Supabase:', err);
            showToast('Could not load shared progress. Using local device state.', 'error');
            this.loadInspectedState();
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
                // Do not modify checkHistory here; keep Undo mostly local
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
                   <p class="text-slate-600 dark:text-slate-300 mt-1">${escapeHTML(this.data.location || '')}</p>
                   <p id="last-checked-footer" class="text-xs text-slate-500 dark:text-slate-400 mt-1"></p>
                </header>
                <section class="p-3 sm:p-4">
                    ${this.renderChecklistContent()}
                </section>
            </div>
        `;
        this.updateUI();
        this.attachEventListeners();
    }

    renderChecklistContent() {
        const currentSortValue = `${this.sortState.key}-${this.sortState.dir}`;
        
        return `
            <div class="space-y-4">
                <div id="progress-container"></div>
                
                <!-- Search and Sort Controls -->
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-2 sm:p-0">
                    <div class="relative flex-grow">
                        <label for="search-input" class="sr-only">Search Devices</label>
                        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                           <svg class="h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-3.329-3.329m0 0A7 7 0 105.671 5.671a7 7 0 0012 12z" />
                           </svg>
                        </div>
                        <input type="search" id="search-input" placeholder="Search by address, location, type, serial..." class="block w-full rounded-lg border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 focus:border-sky-500 focus:ring-sky-500 sm:text-sm pl-10 py-2">
                    </div>
                    <div class="flex items-center gap-2">
                        <label for="sort-select" class="text-sm font-medium text-slate-600 dark:text-slate-300">Sort by:</label>
                        <select id="sort-select" class="w-full sm:w-52 rounded-md border border-slate-300 bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 focus:border-sky-500 focus:ring-sky-500 text-sm py-2 px-3">
                            <option value="address-asc" ${currentSortValue === 'address-asc' ? 'selected' : ''}>Address (Asc)</option>
                            <option value="address-desc" ${currentSortValue === 'address-desc' ? 'selected' : ''}>Address (Desc)</option>
                            <option value="messages-asc" ${currentSortValue === 'messages-asc' ? 'selected' : ''}>Location (A-Z)</option>
                            <option value="messages-desc" ${currentSortValue === 'messages-desc' ? 'selected' : ''}>Location (Z-A)</option>
                            <option value="deviceType-asc" ${currentSortValue === 'deviceType-asc' ? 'selected' : ''}>Type (A-Z)</option>
                            <option value="deviceType-desc" ${currentSortValue === 'deviceType-desc' ? 'selected' : ''}>Type (Z-A)</option>
                            <option value="serialNumber-asc" ${currentSortValue === 'serialNumber-asc' ? 'selected' : ''}>Serial # (Asc)</option>
                            <option value="serialNumber-desc" ${currentSortValue === 'serialNumber-desc' ? 'selected' : ''}>Serial # (Desc)</option>
                        </select>
                    </div>
                </div>

                <!-- Device Table -->
                <div class="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 max-h-[70vh]">
                    <table class="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                        <thead class="bg-slate-50 dark:bg-slate-900/80 sticky top-0 z-10">
                            <tr>
                                <th scope="col" class="px-2 sm:px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 tracking-wider">Done</th>
                                <th scope="col" data-sort-key="address" class="px-2 sm:px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 tracking-wider cursor-pointer hover:text-slate-700 dark:hover:text-slate-200">Address</th>
                                <th scope="col" data-sort-key="messages" class="px-2 sm:px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 tracking-wider cursor-pointer hover:text-slate-700 dark:hover:text-slate-200">Location</th>
                                <th scope="col" data-sort-key="deviceType" class="px-2 sm:px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 tracking-wider cursor-pointer hover:text-slate-700 dark:hover:text-slate-200">Type</th>
                                <th scope="col" data-sort-key="model" class="px-2 sm:px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 tracking-wider">Model</th>
                                <th scope="col" data-sort-key="serialNumber" class="px-2 sm:px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 tracking-wider cursor-pointer hover:text-slate-700 dark:hover:text-slate-200">Serial #</th>
                            </tr>
                        </thead>
                        <tbody id="device-table-body" class="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
                            ${this.renderTableRows(this.data.devices)}
                        </tbody>
                    </table>
                </div>

                <!-- Completed summary accordion -->
                <div id="completed-summary-section"></div>
            </div>
        `;
    }

    renderTableRows(devices) {
        if (!devices || devices.length === 0) {
            return `
                <tr>
                    <td colspan="6" class="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                        No devices found for this checklist yet.
                    </td>
                </tr>
            `;
        }

        const sortedDevices = [...devices].sort((a, b) => {
            const key = this.sortState.key;
            const dir = this.sortState.dir === 'asc' ? 1 : -1;
            const valA = (a[key] ?? '').toString().toLowerCase();
            const valB = (b[key] ?? '').toString().toLowerCase();
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });

        return sortedDevices.map(device => {
            const deviceId = this.getUniqueDeviceId(device);
            const isChecked = this.state.checkedDevices.has(deviceId);
            const address = [device.loop, device.address].filter(Boolean).join(':');

            return `
                <tr class="device-row ${isChecked ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}" data-device-id="${deviceId}">
                    <td class="px-2 sm:px-3 py-2 whitespace-nowrap text-center">
                        <input type="checkbox" class="device-checkbox h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" data-device-id="${deviceId}" ${isChecked ? 'checked' : ''} />
                    </td>
                    <td class="px-2 sm:px-3 py-2 whitespace-nowrap text-xs sm:text-sm font-mono text-slate-800 dark:text-slate-100">${escapeHTML(address)}</td>
                    <td class="px-2 sm:px-3 py-2 text-xs sm:text-sm text-slate-800 dark:text-slate-100">${escapeHTML(device.messages)}</td>
                    <td class="px-2 sm:px-3 py-2 text-xs sm:text-sm text-slate-700 dark:text-slate-200">${escapeHTML(device.deviceType)}</td>
                    <td class="px-2 sm:px-3 py-2 text-xs sm:text-sm text-slate-500 dark:text-slate-300">${escapeHTML(device.model)}</td>
                    <td class="px-2 sm:px-3 py-2 text-xs sm:text-sm text-slate-500 dark:text-slate-300">${escapeHTML(device.serialNumber)}</td>
                </tr>
            `;
        }).join('');
    }

    attachEventListeners() {
        const tbody = this.querySelector('#device-table-body');
        if (!tbody) return;
        
        tbody.addEventListener('click', (e) => {
            const row = e.target.closest('.device-row');
            if (!row) return;
            
            if (e.target.matches('input[type="checkbox"]')) {
                this.handleRowClick(row);
                return;
            }

            // If user clicks anywhere else on the row, toggle the checkbox
            const checkbox = row.querySelector('.device-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                this.handleRowClick(row);
                return;
            }
        });
        
        this.addEventListener('input', debounce((e) => {
            if (e.target.id === 'search-input') this.filterTable(e.target.value);
        }, 250));

        this.addEventListener('change', this.handleSortChange);
    }

    handleMenuAction(event) {
        const { action } = event.detail;
        this.handleGlobalAction(action);
    }
    
    handleSortClick(header) {
        const newKey = header.dataset.sortKey;
        let newDir = 'asc';
        if (this.sortState.key === newKey && this.sortState.dir === 'asc') {
            newDir = 'desc';
        }
        this.sortState = { key: newKey, dir: newDir };
        this.updateUI();
    }

    handleSortChange(e) {
        if (e.target.id !== 'sort-select') return;
        const [key, dir] = e.target.value.split('-');
        this.sortState = { key, dir };
        this.updateUI();
    }

    filterTable(query) {
        const rows = this.querySelectorAll('.device-row');
        const lower = query.toLowerCase().trim();

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            const text = Array.from(cells).map(td => td.textContent.toLowerCase()).join(' ');
            row.classList.toggle('hidden', !text.includes(lower));
        });
    }

    updateUI() {
        const tbody = this.querySelector('#device-table-body');
        if (!tbody || !this.data) return;
        tbody.innerHTML = this.renderTableRows(this.data.devices);

        const headers = this.querySelectorAll('thead th[data-sort-key]');
        headers.forEach(header => {
            const key = header.dataset.sortKey;
            header.classList.remove('text-sky-600', 'dark:text-sky-400');
            header.querySelectorAll('span.sort-icon').forEach(el => el.remove());

            if (key === this.sortState.key) {
                header.classList.add('text-sky-600', 'dark:text-sky-400');
                const iconSpan = document.createElement('span');
                iconSpan.className = 'sort-icon inline-block ml-1';
                iconSpan.textContent = this.sortState.dir === 'asc' ? '▲' : '▼';
                header.appendChild(iconSpan);
            }
        });

        const rows = this.querySelectorAll('.device-row');
        rows.forEach(row => {
            const deviceId = row.dataset.deviceId;
            const checkbox = row.querySelector('.device-checkbox');
            const isChecked = this.state.checkedDevices.has(deviceId);
            if (checkbox) checkbox.checked = isChecked;
            row.classList.toggle('bg-emerald-50', isChecked);
            row.classList.toggle('dark:bg-emerald-900/20', isChecked);
        });

        this.updateProgressSummary();
    }

    updateProgressSummary() {
        const container = this.querySelector('#progress-container');
        if (!container || !this.data) return;
        const total = this.data.devices.length;
        const done = this.state.checkedDevices.size;
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;

        container.innerHTML = `
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div>
                    <p class="text-sm font-medium text-slate-700 dark:text-slate-200">
                        Devices completed: <span class="font-semibold">${done}</span> of <span class="font-semibold">${total}</span> (${percent}%)
                    </p>
                </div>
                <div class="w-full sm:w-64 h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div class="h-full bg-emerald-500 transition-all duration-500" style="width: ${percent}%;"></div>
                </div>
            </div>
        `;
    }

    updateLastCheckedFooter() {
        const footer = this.querySelector('#last-checked-footer');
        if (!footer || !this.data) return;

        if (this.state.checkHistory.length === 0) {
            footer.textContent = 'No devices have been checked yet.';
            return;
        }

        const lastDeviceId = this.state.checkHistory[this.state.checkHistory.length - 1];
        const lastDevice = this.data.devices.find(d => this.getUniqueDeviceId(d) === lastDeviceId);

        if (!lastDevice) {
            footer.textContent = '';
            return;
        }

        const address = [lastDevice.loop, lastDevice.address].filter(Boolean).join(':');
        footer.textContent = `Last checked: Address ${address} — ${lastDevice.messages}`;
    }

    handleFileImport(e) {
        // (Keep your existing import logic here if you are using it)
        // This function is left as-is from your previous version.
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

        // NEW: sync this change to Supabase so other inspectors see it
        this.pushDeviceProgressToSupabase(deviceId, isInspected);
    }

    handleGlobalAction(action) {
        if (action === 'clear-all') {
            showConfirmationModal(
                "Are you sure you want to clear all inspection checkmarks for this list? This cannot be undone.",
                () => { 
                    this.state.checkedDevices.clear();
                    this.state.checkHistory = [];
                    this.saveInspectedState();
                    this.updateUI();
                    this.updateLastCheckedFooter();
                    showToast('All device checkmarks cleared.', 'warning');
                }
            );
        }
        // You can keep or remove export/share actions here if you still use them.
    }
}

customElements.define('checklist-workspace', ChecklistWorkspace);

// --- UI WIRING: company + checklist selection ---

document.addEventListener('DOMContentLoaded', async () => {
    const companySelect = document.getElementById('company-select');
    const checklistSelect = document.getElementById('checklist-select');
    const workspace = document.querySelector('checklist-workspace');

    if (!companySelect || !checklistSelect || !workspace) {
        console.warn('Missing required UI elements for checklist workspace.');
        return;
    }

    // Load companies into dropdown
    const companies = await fetchCompanies();
    companySelect.innerHTML = `
        <option value="">Select a Company...</option>
        ${companies.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('')}
    `;

    companySelect.addEventListener('change', async () => {
        const companyId = companySelect.value;
        checklistSelect.innerHTML = `<option value="">Loading...</option>`;
        if (!companyId) {
            checklistSelect.innerHTML = `<option value="">Select a company first...</option>`;
            return;
        }

        const checklists = await fetchChecklistsForCompany(companyId);
        if (!checklists.length) {
            checklistSelect.innerHTML = `<option value="">No checklists for this company yet.</option>`;
            return;
        }

        checklistSelect.innerHTML = `
            <option value="">Select a Checklist...</option>
            ${checklists.map(ch => `<option value="${ch.id}">${escapeHTML(ch.year)} — ${escapeHTML(ch.name)}</option>`).join('')}
        `;
    });

    checklistSelect.addEventListener('change', () => {
        const checklistId = checklistSelect.value;
        if (!checklistId) return;
        workspace.setAttribute('building-key', checklistId);
    });

    // Global menu buttons -> dispatch workspace actions
    document.querySelectorAll('[data-workspace-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-workspace-action');
            const event = new CustomEvent('request-workspace-action', {
                bubbles: true,
                detail: { action }
            });
            document.dispatchEvent(event);
        });
    });
});
