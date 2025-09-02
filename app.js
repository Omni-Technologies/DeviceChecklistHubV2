import { CHECKLISTS } from './checklists.js';

// --- UTILITIES ---
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => parent.querySelectorAll(selector);

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
 */
function normalizeDevice(device) {
    // This function handles different potential structures for a device object.
    const isExcelFormat = device.hasOwnProperty('System Address ( Node : Card : Device )');
    if (isExcelFormat) {
        const systemAddress = device['System Address ( Node : Card : Device )'] || 'N/A:N/A:N/A';
        const addressParts = String(systemAddress).split(':');
        return {
            loop: addressParts.length > 1 ? addressParts[1].trim() : '',
            address: addressParts.length > 2 ? addressParts[2].trim() : '',
            systemAddress: systemAddress,
            model: device['SKU'] || '',
            deviceType: device['SKU Description'] || '',
            deviceTypeID: device['Device Type ID'] || '',
            serialNumber: device['Serial Number'] || '',
            messages: (device['Location Text'] || '').replace(/\n/g, ' '),
        };
    } else {
        // This handles the original hardcoded format and the exported JSON format.
        return {
            loop: device.loop || '',
            address: device.address || '',
            systemAddress: device.systemAddress || '',
            model: device.model || '',
            deviceType: device.deviceType || '',
            deviceTypeID: device.deviceTypeID || '',
            serialNumber: device.serialNumber || '',
            messages: device.messages || '',
        };
    }
}

/**
 * Shows a temporary notification toast.
 */
function showToast(message, type = 'info') {
    const container = $('#toast-container');
    if (!container) return;
    const toastId = `toast-${Date.now()}`;
    const colors = {
        success: 'bg-green-500 dark:bg-green-600',
        error: 'bg-red-500 dark:bg-red-600',
        info: 'bg-sky-500 dark:bg-sky-600',
    };
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = `transform transition-all duration-300 ease-out translate-y-4 opacity-0 p-4 rounded-lg shadow-lg text-white ${colors[type] || colors.info}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `<p class="font-semibold">${escapeHTML(message)}</p>`;
    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
    });
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-full');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 5000);
}

// --- MODAL LOGIC ---
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
        modalPanel.classList.remove('opacity-0', 'translate-y-4', 'sm:translate-y-0', 'sm:scale-95');
    });
}

function hideConfirmationModal() {
     if (!modal) return;
     modalPanel.classList.add('opacity-0', 'translate-y-4', 'sm:translate-y-0', 'sm:scale-95');
     modal.addEventListener('transitionend', () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
     }, { once: true });
     confirmCallback = null;
}
confirmButton.addEventListener('click', () => {
    if (typeof confirmCallback === 'function') confirmCallback();
    hideConfirmationModal();
});
cancelButton.addEventListener('click', hideConfirmationModal);
modal.addEventListener('click', (e) => {
    if (e.target === modal) hideConfirmationModal();
});

// --- WEB COMPONENTS ---

// --- BuildingPicker Web Component ---
class BuildingPicker extends HTMLElement {
    constructor() {
        super();
        this.isMobile = window.innerWidth < 640;
        this.checklists = CHECKLISTS || [];
    }
    connectedCallback() {
        this.render();
        this.attachEventListeners();
        window.addEventListener('resize', debounce(() => this.handleResize(), 200));
    }
    render() {
        const containerId = this.isMobile ? '#mobile-building-picker-container' : '#desktop-building-picker-container';
        const otherContainerId = this.isMobile ? '#desktop-building-picker-container' : '#mobile-building-picker-container';
        const container = $(containerId);
        const otherContainer = $(otherContainerId);
        if (!container) return;
        container.innerHTML = this.isMobile ? this.getMobileHTML() : this.getDesktopHTML();
        if (otherContainer) otherContainer.innerHTML = '';
        this.attachEventListeners();
    }
    getMobileHTML() {
         if (this.checklists.length === 0) return `<p class="text-center text-sm text-slate-500">No checklists available.</p>`;
        return `
            <label for="building-select" class="sr-only">Select Checklist</label>
            <select id="building-select" class="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-3 focus-ring sm:text-sm">
                <option value="">-- Select a Checklist --</option>
                ${this.checklists.map(c => `<option value="${c.key}">${escapeHTML(c.name)}</option>`).join('')}
            </select>
        `;
    }
    getDesktopHTML() {
         return `
            <div class="sticky top-20">
                <div class="bg-white dark:bg-slate-900 rounded-xl shadow p-4">
                    <h2 class="text-lg font-semibold mb-3">Checklists</h2>
                     <input type="search" id="building-search" placeholder="Search checklists..." class="mb-3 block w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md shadow-sm py-2 px-3 focus-ring sm:text-sm">
                    <ul id="building-list" class="space-y-1 max-h-[calc(100vh-12rem)] overflow-y-auto">
                        ${this.checklists.length === 0 ? `<li class="text-sm text-slate-500">No checklists available.</li>` : ''}
                        ${this.checklists.map(c => `
                            <li>
                                <a href="#" data-key="${c.key}" class="block p-2 rounded-md hover:bg-sky-100 dark:hover:bg-sky-900/50 focus-ring font-medium text-slate-700 dark:text-slate-300">
                                    ${escapeHTML(c.name)}
                                </a>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            </div>
        `;
    }
    attachEventListeners() {
        const mobileSelect = $('#building-select');
        if (mobileSelect) mobileSelect.addEventListener('change', (e) => { if (e.target.value) this.selectChecklist(e.target.value); });
        const desktopList = $('#building-list');
        if (desktopList) {
            desktopList.addEventListener('click', (e) => {
                e.preventDefault();
                const link = e.target.closest('a');
                if (link && link.dataset.key) {
                    $$('a', desktopList).forEach(a => a.classList.remove('bg-sky-100', 'dark:bg-sky-900/50'));
                    link.classList.add('bg-sky-100', 'dark:bg-sky-900/50');
                    this.selectChecklist(link.dataset.key);
                }
            });
        }
        const searchInput = $('#building-search');
        if (searchInput) searchInput.addEventListener('input', debounce((e) => this.filterChecklists(e.target.value), 200));
    }
    filterChecklists(query) {
        const q = query.toLowerCase();
        $$('#building-list li').forEach(li => {
            const link = li.querySelector('a');
            if (link) {
                const name = link.textContent.toLowerCase();
                li.style.display = name.includes(q) ? '' : 'none';
            }
        });
    }
    selectChecklist(key) {
        document.dispatchEvent(new CustomEvent('checklist-selected', { detail: { key } }));
    }
    handleResize() {
        const newIsMobile = window.innerWidth < 640;
        if (newIsMobile !== this.isMobile) {
            this.isMobile = newIsMobile;
            this.render();
        }
    }
}
customElements.define('building-picker', BuildingPicker);


// --- ChecklistWorkspace Web Component ---
class ChecklistWorkspace extends HTMLElement {
    constructor() {
        super();
        this.data = null;
        this.checklistKey = null;
        this.sortState = { key: 'address', dir: 'asc' };
        this.state = {
            checkedDevices: new Set(),
            checkHistory: [],
        };
        // Bind 'this' for event handlers that are added/removed
        this.handleMenuAction = this.handleMenuAction.bind(this);
        this.handleSortChange = this.handleSortChange.bind(this);
        this.handleFileImport = this.handleFileImport.bind(this);
    }
    
    static get observedAttributes() { return ['building-key']; }

    connectedCallback() {
        document.addEventListener('request-workspace-action', this.handleMenuAction);
        // Listen for file import
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
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'building-key' && oldValue !== newValue) {
            this.checklistKey = newValue;
            this.loadChecklist();
        }
    }
    
    getUniqueDeviceId(device) {
        // Use a combination of properties to create a reliable unique ID
        return `${this.checklistKey}-${device.serialNumber}-${device.loop}-${device.address}-${device.messages}`;
    }

    loadChecklist() {
        this.innerHTML = `<div class="text-center py-20">Loading checklist...</div>`;
        try {
            const checklistData = CHECKLISTS.find(c => c.key === this.checklistKey);
            if (!checklistData) throw new Error("Checklist not found.");
            
            this.data = JSON.parse(JSON.stringify(checklistData));
            this.data.devices = this.data.devices.map(device => normalizeDevice(device));
            
            this.loadInspectedState();
            this.render();
        } catch (error) {
            showToast(error.message, 'error');
            this.innerHTML = `<div class="text-center py-20 text-red-500">${escapeHTML(error.message)}</div>`;
            console.error("Failed to load checklist:", error);
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
                           <svg class="h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" /></svg>
                        </div>
                        <input type="search" id="search-input" placeholder="Search all devices..." class="block w-full bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 rounded-md shadow-sm py-2 pl-10 pr-4 focus-ring sm:text-sm">
                    </div>
                    <div class="flex items-center gap-2">
                        <label for="sort-select" class="text-sm font-medium text-slate-600 dark:text-slate-300">Sort by:</label>
                        <select id="sort-select" class="w-full sm:w-auto bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-3 focus-ring text-sm">
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

                <div id="completed-container"></div>
                <div id="active-container"></div>
            </div>
        `;
    }

    updateProgress() {
        const container = $(`#progress-container`, this);
        if (!container) return;
        const total = this.data.devices.length;
        const inspectedCount = this.state.checkedDevices.size;
        const percent = total > 0 ? Math.round((inspectedCount / total) * 100) : 0;
        container.innerHTML = `
            <div class="flex justify-between items-center mb-1 text-sm font-medium px-2 sm:px-0">
                <span class="text-slate-600 dark:text-slate-300">Progress</span>
                <span>${inspectedCount} / ${total} inspected (${percent}%)</span>
            </div>
            <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5">
                <div class="bg-sky-600 h-2.5 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
            </div>
        `;
    }

    renderTableAndAccordion() {
        const contentContainer = $('#checklist-content', this);
        if (!contentContainer) return;
        
        const searchInput = $('#search-input', this);
        const currentSearchQuery = searchInput ? searchInput.value : '';

        contentContainer.innerHTML = this.renderChecklistContent();
        
        let allDevices = [...this.data.devices];
        
        allDevices.sort((a, b) => {
            const dir = this.sortState.dir === 'asc' ? 1 : -1;
            const key = this.sortState.key;
            const loopA = isNaN(parseInt(a.loop)) ? Infinity : parseInt(a.loop);
            const loopB = isNaN(parseInt(b.loop)) ? Infinity : parseInt(b.loop);
            if (loopA !== loopB) return (loopA - loopB) * dir;
            const valA = a[key];
            const valB = b[key];
            if (key === 'address' || key === 'serialNumber') {
                const numA = parseInt(valA, 10) || 0;
                const numB = parseInt(valB, 10) || 0;
                return (numA - numB) * dir;
            } else {
                const strA = String(valA || '').toLowerCase();
                const strB = String(valB || '').toLowerCase();
                return strA.localeCompare(strB, undefined, { sensitivity: 'base' }) * dir;
            }
        });
        
        const inspectedDevices = allDevices.filter(d => this.state.checkedDevices.has(this.getUniqueDeviceId(d)));
        const activeDevices = allDevices.filter(d => !this.state.checkedDevices.has(this.getUniqueDeviceId(d)));
        
        $(`#completed-container`, this).innerHTML = this.renderAccordionHTML(inspectedDevices);
        $(`#active-container`, this).innerHTML = this.renderListHTML(activeDevices);
        
        this.updateProgress();

        const newSearchInput = $('#search-input', this);
        if (newSearchInput && currentSearchQuery) {
            newSearchInput.value = currentSearchQuery;
            this.filterTable(currentSearchQuery);
        } else {
             this.updateDeviceCounter();
        }
    }

   renderAccordionHTML(devices) {
      if (devices.length === 0) return '';
      const listId = `completed-list-${this.checklistKey}`;
      return `
        <div class="border border-slate-200 dark:border-slate-800 rounded-lg">
          <button aria-expanded="false" aria-controls="${listId}" class="accordion-toggle w-full flex justify-between items-center p-3 font-semibold text-sm bg-slate-100 dark:bg-slate-800/80 rounded-t-lg focus-ring">
            <span>Completed Devices (${devices.length})</span>
            <svg class="accordion-arrow w-5 h-5 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
          </button>
          <div id="${listId}" class="hidden">
            ${this.renderListHTML(devices, false)}
          </div>
        </div>
      `;
    }

    getSortIcon(key) {
        if (this.sortState.key !== key) {
            return `<svg class="sort-icon inline-block w-4 h-4 ml-1 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4"></path></svg>`;
        }
        if (this.sortState.dir === 'asc') {
            return `<svg class="sort-icon inline-block w-4 h-4 ml-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd"></path></svg>`;
        } else {
            return `<svg class="sort-icon inline-block w-4 h-4 ml-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>`;
        }
    }
    
    renderListHTML(devices, showHeader = true) {
        return `
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                   ${showHeader ? `
                    <thead class="text-xs text-slate-700 dark:text-slate-300 uppercase bg-slate-50 dark:bg-slate-800 hidden sm:table-header-group">
                        <tr>
                            <th scope="col" class="p-3 table-header-sortable cursor-pointer" data-sort-key="loop">Loop ${this.getSortIcon('loop')}</th>
                            <th scope="col" class="p-3 table-header-sortable cursor-pointer" data-sort-key="address">Address ${this.getSortIcon('address')}</th>
                            <th scope="col" class="p-3 table-header-sortable cursor-pointer" data-sort-key="messages">Location/Message ${this.getSortIcon('messages')}</th>
                            <th scope="col" class="p-3 table-header-sortable cursor-pointer" data-sort-key="deviceType">Type ${this.getSortIcon('deviceType')}</th>
                            <th scope="col" class="p-3">Model/SKU</th>
                            <th scope="col" class="p-3 table-header-sortable cursor-pointer" data-sort-key="serialNumber">Serial # ${this.getSortIcon('serialNumber')}</th>
                            <th scope="col" class="p-3 text-center">✅</th>
                        </tr>
                    </thead>` : ''}
                    <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                       ${devices.map(d => this.renderRowHTML(d)).join('') || `<tr class="device-row"><td colspan="7" class="p-4 text-center text-slate-500">No devices to show.</td></tr>`}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    renderRowHTML(device) {
        const uniqueId = this.getUniqueDeviceId(device);
        const isInspected = this.state.checkedDevices.has(uniqueId);
        
        return `
            <tr data-device-id="${uniqueId}" class="device-row block sm:table-row cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isInspected ? 'bg-slate-100/50 dark:bg-slate-800/20 opacity-70' : ''}">
                
                <!-- Mobile Card View -->
                <td class="sm:hidden w-full p-3">
                    <div class="flex items-center justify-between gap-3 w-full">
                        <div class="flex-grow space-y-3">
                            <div class="flex items-start gap-3">
                                <div class="flex-shrink-0 bg-slate-100 dark:bg-slate-800 rounded-md p-2 text-center w-20">
                                    <p class="text-xs text-slate-500 dark:text-slate-400 font-medium">Loop</p>
                                    <p class="font-black text-xl text-slate-800 dark:text-slate-200">${escapeHTML(device.loop) || 'N/A'}</p>
                                    <hr class="border-slate-300 dark:border-slate-600 my-1">
                                    <p class="text-xs text-slate-500 dark:text-slate-400 font-medium">Address</p>
                                    <p class="font-black text-xl text-slate-800 dark:text-slate-200">${escapeHTML(device.address) || 'N/A'}</p>
                                </div>
                                <div class="flex-grow pt-1">
                                    <p class="font-semibold text-slate-800 dark:text-slate-100 leading-tight">${escapeHTML(device.messages)}</p>
                                    <p class="text-sm text-slate-600 dark:text-slate-400">${escapeHTML(device.deviceType)}</p>
                                </div>
                            </div>
                            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 pl-1">
                                <dt class="font-medium text-slate-600 dark:text-slate-300 col-span-1">Serial #:</dt>
                                <dd class="truncate col-span-1">${escapeHTML(device.serialNumber) || 'N/A'}</dd>
                                <dt class="font-medium text-slate-600 dark:text-slate-300 col-span-1">Model/SKU:</dt>
                                <dd class="truncate col-span-1">${escapeHTML(device.model) || 'N/A'}</dd>
                            </dl>
                        </div>
                        <div class="flex-shrink-0">
                            <input type="checkbox" data-device-id="${uniqueId}" class="h-8 w-8 rounded-md border-slate-400 text-sky-600 focus-ring pointer-events-none" ${isInspected ? 'checked' : ''} tabindex="-1">
                        </div>
                    </div>
                </td>

                <!-- Desktop Table Cells -->
                <td class="hidden sm:table-cell p-3 font-medium whitespace-nowrap">${escapeHTML(device.loop)}</td>
                <td class="hidden sm:table-cell p-3 font-medium whitespace-nowrap">${escapeHTML(device.address)}</td>
                <td class="hidden sm:table-cell p-3 max-w-sm truncate" title="${escapeHTML(device.messages)}">${escapeHTML(device.messages)}</td>
                <td class="hidden sm:table-cell p-3 max-w-xs truncate" title="${escapeHTML(device.deviceType)}">${escapeHTML(device.deviceType)}</td>
                <td class="hidden sm:table-cell p-3 whitespace-nowrap">${escapeHTML(device.model)}</td>
                <td class="hidden sm:table-cell p-3 whitespace-nowrap">${escapeHTML(device.serialNumber)}</td>
                <td class="hidden sm:table-cell p-3 text-center">
                    <input type="checkbox" data-device-id="${uniqueId}" class="h-5 w-5 rounded border-slate-300 text-sky-600 focus-ring pointer-events-none" ${isInspected ? 'checked' : ''} tabindex="-1">
                </td>
            </tr>
        `;
    }

    attachEventListeners() {
        this.addEventListener('click', (e) => {
            const row = e.target.closest('.device-row');
            const accordionToggle = e.target.closest('.accordion-toggle');
            const sortHeader = e.target.closest('.table-header-sortable');

            if (accordionToggle) {
                const content = this.querySelector(`#${accordionToggle.getAttribute('aria-controls')}`);
                const isExpanded = accordionToggle.getAttribute('aria-expanded') === 'true';
                accordionToggle.setAttribute('aria-expanded', String(!isExpanded));
                if(content) content.classList.toggle('hidden');
                this.updateDeviceCounter();
                return;
            }
            
            if(sortHeader) {
                this.handleSortClick(sortHeader);
                return;
            }
            
            if (row) {
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
    }

    handleGlobalAction(action) {
        if (action === 'clear-all') {
            showConfirmationModal(
                "Are you sure you want to clear all inspection checkmarks for this list? This cannot be undone.",
                () => { 
                    this.state.checkedDevices.clear();
                    this.state.checkHistory = [];
                    showToast('All checks cleared.', 'info');
                    this.saveInspectedState();
                    this.updateLastCheckedFooter();
                    this.updateUI();
                }
            );
            return;
        }

        if (action === 'undo') {
            if (this.state.checkHistory.length === 0) {
                showToast('No actions to undo.', 'info');
                return;
            }
            const lastCheckedId = this.state.checkHistory.pop();
            this.state.checkedDevices.delete(lastCheckedId);
            const device = this.data.devices.find(d => this.getUniqueDeviceId(d) === lastCheckedId);
            if (device) {
                showToast(`Undo: Unchecked "${device.messages}"`, 'info');
            }
        }
        
        if (action === 'import') {
            this.fileInput.click(); // Trigger the hidden file input
            return;
        }

        if (action === 'export') {
            this.exportInspectedList();
            return;
        }
        
        this.saveInspectedState();
        this.updateLastCheckedFooter();
        this.updateUI();
    }
    
    exportInspectedList() {
        const inspectedDevices = this.data.devices.filter(d => this.state.checkedDevices.has(this.getUniqueDeviceId(d)));
        if(inspectedDevices.length === 0) {
            showToast('No inspected devices to export.', 'info');
            return;
        }
        const dataToExport = {
            checklistName: this.data.name,
            exportDate: new Date().toISOString(),
            inspectedCount: inspectedDevices.length,
            devices: inspectedDevices
        };
        const data = JSON.stringify(dataToExport, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.checklistKey}-inspected-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Exported inspected list as JSON.', 'success');
    }
    
    handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return; // User cancelled the dialog

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                
                // Validation
                if (!importedData.checklistName || !Array.isArray(importedData.devices)) {
                    throw new Error("Invalid file format. Missing 'checklistName' or 'devices' properties.");
                }
                if (importedData.checklistName !== this.data.name) {
                    throw new Error(`Checklist mismatch. Current is "${this.data.name}", but file is for "${importedData.checklistName}".`);
                }

                // Merge the imported data
                let newDevicesImported = 0;
                importedData.devices.forEach(device => {
                    const normalizedDevice = normalizeDevice(device);
                    const deviceId = this.getUniqueDeviceId(normalizedDevice);
                    if (!this.state.checkedDevices.has(deviceId)) {
                        this.state.checkedDevices.add(deviceId);
                        newDevicesImported++;
                    }
                });

                this.saveInspectedState();
                this.updateUI();
                this.updateLastCheckedFooter();
                showToast(`${newDevicesImported} new device states imported successfully! Total inspected: ${this.state.checkedDevices.size}.`, 'success');

            } catch (error) {
                showToast(`Import Failed: ${error.message}`, 'error');
                console.error("Import error:", error);
            } finally {
                // Reset file input to allow importing the same file again if needed
                event.target.value = '';
            }
        };
        reader.onerror = () => {
            showToast('Error reading the selected file.', 'error');
            event.target.value = '';
        };
        reader.readAsText(file);
    }

    filterTable(query) {
        const q = query.toLowerCase().trim();
        $$('.device-row', this).forEach(row => {
            if (!q) {
                 row.style.display = window.innerWidth >= 640 ? 'table-row' : 'block';
                return;
            }
            const textContent = row.textContent.toLowerCase();
            const shouldShow = textContent.includes(q);
            
            if (window.innerWidth >= 640) {
                row.style.display = shouldShow ? 'table-row' : 'none';
            } else {
                 row.style.display = shouldShow ? 'block' : 'none';
            }
        });
        this.updateDeviceCounter();
    }

    updateDeviceCounter() {
      const counterElement = $('#footer-device-count');
      if (!counterElement) return;

      const visibleRows = Array.from($$('.device-row', this)).filter(row => {
        const rowIsHiddenBySearch = row.style.display === 'none';
        const completedList = row.closest('[id^="completed-list-"]'); // updated: matches new per-checklist ID
        const accordionIsCollapsed = completedList && completedList.classList.contains('hidden');
        return !rowIsHiddenBySearch && !accordionIsCollapsed;
      });

      counterElement.textContent = visibleRows.length;
    }
    
    updateUI() {
        this.renderTableAndAccordion();
    }
    
    updateLastCheckedFooter() {
        const footer = $('#last-checked-footer');
        const lastCheckedContainer = $('#last-checked-container');
        const lastCheckedText = $('#last-checked-text');
        if (!footer || !lastCheckedContainer || !lastCheckedText) return;

        if (this.data) {
            footer.classList.remove('hidden');
        }

        if (this.state.checkHistory.length > 0) {
            const lastCheckedId = this.state.checkHistory[this.state.checkHistory.length - 1];
            const device = this.data.devices.find(d => this.getUniqueDeviceId(d) === lastCheckedId);
            if (device) {
                const idText = device.systemAddress ? device.systemAddress : (device.loop !== 'N/A' ? `L${device.loop}/A${device.address}` : `${device.deviceType} ${device.address}`);
                lastCheckedText.textContent = ` ${idText}: ${device.messages}`;
                lastCheckedContainer.classList.remove('invisible');
            }
        } else {
            lastCheckedContainer.classList.add('invisible');
        }
    }
}
customElements.define('checklist-workspace', ChecklistWorkspace);

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    const mobilePickerContainer = $('#mobile-building-picker-container');
    const desktopPickerContainer = $('#desktop-building-picker-container');
    if (mobilePickerContainer) mobilePickerContainer.appendChild(document.createElement('building-picker'));
    if (desktopPickerContainer) desktopPickerContainer.appendChild(document.createElement('building-picker'));
    
    document.addEventListener('checklist-selected', (e) => {
        const { key } = e.detail;
        const workspaceContainer = $('#checklist-workspace');
        $('#welcome-message')?.remove();
        let workspace = $('checklist-workspace', workspaceContainer);
        if (!workspace) {
            workspace = document.createElement('checklist-workspace');
            workspaceContainer.innerHTML = '';
            workspaceContainer.appendChild(workspace);
        }
        workspace.setAttribute('building-key', key);

        $('#header-menu-container').classList.remove('invisible', 'opacity-50');
        $('#menu-toggle-button').disabled = false;
    });

    // --- HEADER MENU LOGIC ---
    const menuContainer = $('#header-menu-container');
    const menuButton = $('#menu-toggle-button');
    const menuDropdown = $('#menu-dropdown');
    
    menuContainer.classList.add('invisible', 'opacity-50');
    menuButton.disabled = true;

    function toggleMenu(show) {
        const isVisible = !menuDropdown.classList.contains('hidden');
        if (typeof show !== 'boolean') show = !isVisible;
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
