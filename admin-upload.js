// admin-upload.js
// Simple admin page to paste a checklist JSON and push it into Supabase.

const db = window.supabaseClient;

// --- small helpers ---
const $  = (sel, parent = document) => parent.querySelector(sel);

function appendLog(message, type = "info") {
  const log = $("#log-output");
  if (!log) return;

  const line = document.createElement("div");
  const timestamp = new Date().toLocaleTimeString();
  const color =
    type === "error"
      ? "text-red-500"
      : type === "success"
      ? "text-green-500"
      : "text-slate-500";

  line.className = `${color} whitespace-pre-wrap`;
  line.textContent = `[${timestamp}] ${message}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  console[type === "error" ? "error" : "log"](message);
}

function showToast(message, type = "info") {
  const container = $("#toast-container");
  if (!container) return;

  const id = `toast-${Date.now()}`;
  const colors = {
    success: "bg-green-500 dark:bg-green-600",
    error: "bg-red-500 dark:bg-red-600",
    info: "bg-sky-500 dark:bg-sky-600",
  };

  const toast = document.createElement("div");
  toast.id = id;
  toast.className = `transform transition-all duration-300 ease-out translate-y-4 opacity-0 p-3 rounded-lg shadow-lg text-white text-sm ${colors[type] || colors.info}`;
  toast.setAttribute("role", "alert");
  toast.innerHTML = `<p class="font-semibold">${message}</p>`;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-4", "opacity-0");
  });

  setTimeout(() => {
    toast.classList.add("opacity-0", "translate-x-full");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 4500);
}

/**
 * Helper: convert value to integer or null.
 */
function toIntOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toUpperCase() === "N/A") return null;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

// --- Supabase helpers (local copies of logic you already use) ---

async function getOrCreateCompanyByName(name) {
  let { data, error } = await db
    .from("companies")
    .select("*")
    .eq("name", name)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw error;
  }
  if (data) return data;

  const { data: inserted, error: insertError } = await db
    .from("companies")
    .insert({ name })
    .select()
    .single();

  if (insertError) throw insertError;

  return inserted;
}

async function getChecklistByName(companyId, checklistName) {
  const { data, error } = await db
    .from("checklists")
    .select("*")
    .eq("company_id", companyId)
    .eq("name", checklistName)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw error;
  }
  return data || null;
}

async function createChecklist(companyId, checklistName, year = null) {
  const { data, error } = await db
    .from("checklists")
    .insert({
      company_id: companyId,
      name: checklistName,
      year: year ?? new Date().getFullYear(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function replaceDevicesForChecklist(checklistId, devicesArray) {
  // delete existing
  const { error: delErr } = await db
    .from("devices")
    .delete()
    .eq("checklist_id", checklistId);

  if (delErr) throw delErr;

  if (!devicesArray || devicesArray.length === 0) {
    return;
  }

  const rows = devicesArray.map((d) => ({
    checklist_id: checklistId,
    loop: toIntOrNull(d.loop),
    address: toIntOrNull(d.address),
    model: d.model ?? null,
    device_type: d.deviceType ?? null,
    serial_number: d.serialNumber ?? null,
    messages: d.messages ?? null,
  }));

  const { error } = await db.from("devices").insert(rows);
  if (error) throw error;
}

// --- core upload logic ---

/**
 * Upsert one checklist object:
 * - companyName = obj.name || obj.key
 * - checklistName = obj.location || obj.name || obj.key
 * - devices = obj.devices
 */
async function upsertChecklistFromObject(obj, existingMode = "replace") {
  if (!obj || typeof obj !== "object") {
    throw new Error("Checklist JSON must be an object.");
  }

  const companyName = obj.name || obj.key;
  const checklistName = obj.location || obj.name || obj.key || "Unnamed Checklist";
  const devicesArray = Array.isArray(obj.devices) ? obj.devices : [];

  if (!companyName) {
    throw new Error("Missing 'name' (or 'key') on checklist object.");
  }
  if (devicesArray.length === 0) {
    appendLog(
      `Warning: checklist "${checklistName}" for company "${companyName}" has 0 devices. Continuing anyway.`,
      "info"
    );
  }

  appendLog(`Company name: "${companyName}"`);
  appendLog(`Checklist name: "${checklistName}"`);
  appendLog(`Devices in payload: ${devicesArray.length}`);

  const company = await getOrCreateCompanyByName(companyName);
  appendLog(`Company ID: ${company.id}`, "info");

  let checklist = await getChecklistByName(company.id, checklistName);
  const exists = !!checklist;

  if (exists && existingMode === "skip") {
    appendLog(
      `Checklist already exists (id=${checklist.id}). Mode=skip → not modifying devices.`,
      "info"
    );
    return { company, checklist, created: false, devicesUpdated: false };
  }

  if (!exists) {
    checklist = await createChecklist(company.id, checklistName);
    appendLog(`Created new checklist with id=${checklist.id}`, "success");
  } else {
    appendLog(
      `Checklist exists (id=${checklist.id}). Mode=${existingMode} → replacing devices.`,
      "info"
    );
  }

  await replaceDevicesForChecklist(checklist.id, devicesArray);
  appendLog(
    `Inserted ${devicesArray.length} device(s) for checklist id=${checklist.id}.`,
    "success"
  );

  return { company, checklist, created: !exists, devicesUpdated: true };
}

// --- UI wiring ---

function loadSampleJSON() {
  const sample = {
    key: "mcfarland_psc",
    name: "McFarland Public Safety Center",
    location: "Fire Alarm Device Inspection",
    devices: [
      {
        loop: 1,
        address: 1,
        model: "PS",
        deviceType: "Smoke Verified",
        serialNumber: "3939747909",
        messages: "BASEMENT SMOKE ABOVE FACP",
      },
      {
        loop: 1,
        address: 2,
        model: "HRS",
        deviceType: "Heat ROR",
        serialNumber: "3831067556",
        messages: "BASEMENT HEAT BY SPRINK PIPING",
      },
    ],
  };

  $("#checklist-json").value = JSON.stringify(sample, null, 2);
  appendLog("Loaded sample JSON into textarea.", "info");
}

async function handleUploadClick() {
  const raw = $("#checklist-json").value.trim();
  const existingMode = $("#existing-mode").value || "replace";

  if (!raw) {
    showToast("Paste a checklist JSON first.", "error");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    showToast("Invalid JSON. Check the console/log for details.", "error");
    appendLog(`JSON parse error: ${err.message}`, "error");
    return;
  }

  const isArray = Array.isArray(parsed);
  const items = isArray ? parsed : [parsed];

  appendLog(
    `Starting upload of ${items.length} checklist(s). Mode: ${existingMode}`,
    "info"
  );
  showToast("Uploading checklist(s) to Supabase...", "info");

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    try {
      appendLog(`--- Checklist ${i + 1}/${items.length} ---`, "info");
      await upsertChecklistFromObject(c, existingMode);
      successCount++;
    } catch (err) {
      failCount++;
      appendLog(
        `Error on checklist ${i + 1}: ${err.message || String(err)}`,
        "error"
      );
    }
  }

  appendLog(
    `Upload complete. Success: ${successCount}, Failed: ${failCount}.`,
    failCount === 0 ? "success" : "error"
  );

  if (failCount === 0) {
    showToast(`Upload complete: ${successCount} checklist(s) updated.`, "success");
  } else {
    showToast(
      `Upload finished with errors. See log (success=${successCount}, failed=${failCount}).`,
      "error"
    );
  }
}

// --- init ---

window.addEventListener("DOMContentLoaded", () => {
  const uploadBtn = $("#upload-btn");
  const sampleBtn = $("#load-sample-btn");
  const clearLogBtn = $("#clear-log-btn");

  if (uploadBtn) uploadBtn.addEventListener("click", () => handleUploadClick());
  if (sampleBtn) sampleBtn.addEventListener("click", () => loadSampleJSON());
  if (clearLogBtn)
    clearLogBtn.addEventListener("click", () => {
      const log = $("#log-output");
      if (log) log.innerHTML = "";
    });

  appendLog("Admin upload page ready.", "info");
});
