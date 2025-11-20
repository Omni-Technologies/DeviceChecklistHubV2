// supabase-checklists.js (ES module)

import { CHECKLISTS } from "./checklists.js";

// Supabase client created in supabase-config.js (classic script)
const db = window.supabaseClient;

/**
 * Helper: convert value to integer or null.
 */
function toIntOrNull(value) {
  if (value === undefined || value === null) return null;

  // If it's already a number
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  // If it's a string like "N/A", "", etc., try to parse
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed.toUpperCase() === "N/A") return null;

  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Ensure a company exists with the given name, return its row.
 */
async function getOrCreateCompanyByName(name) {
  let { data, error } = await db
    .from("companies")
    .select("*")
    .eq("name", name)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Error fetching company:", error);
    throw error;
  }

  if (data) return data;

  const { data: inserted, error: insertError } = await db
    .from("companies")
    .insert({ name })
    .select()
    .single();

  if (insertError) {
    console.error("Error inserting company:", insertError);
    throw insertError;
  }

  return inserted;
}

/**
 * Create a checklist for a given company.
 */
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

  if (error) {
    console.error("Error creating checklist:", error);
    throw error;
  }

  return data;
}

/**
 * Bulk insert device rows for a checklist.
 * devicesArray items must have: loop, address, model, deviceType, serialNumber, messages
 */
async function insertDevicesForChecklist(checklistId, devicesArray) {
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

  if (error) {
    console.error("Error inserting devices:", error);
    console.error("Offending rows sample:", rows.slice(0, 5));
    throw error;
  }
}

/**
 * ONE-TIME MIGRATION:
 * Reads all CHECKLISTS from checklists.js and pushes them to Supabase.
 *
 * Usage in browser console:
 *   migrateExistingChecklistsOnce()
 */
export async function migrateExistingChecklistsOnce() {
  if (!Array.isArray(CHECKLISTS) || CHECKLISTS.length === 0) {
    alert("No CHECKLISTS found or array is empty.");
    return;
  }

  const summary = [];
  console.log(`Starting migration of ${CHECKLISTS.length} checklists...`);

  for (const cl of CHECKLISTS) {
    // {
    //   key: "mcfarland_psc",
    //   name: "McFarland Public Safety Center",
    //   location: "Fire Alarm Device Inspection",
    //   devices: [ ... ]
    // }

    const companyName = cl.name || cl.key; // Treat building name as "company"
    const checklistName =
      cl.location || cl.name || cl.key || "Unnamed Checklist";
    const devicesArray = cl.devices || [];

    if (!companyName || devicesArray.length === 0) {
      console.warn("Skipping checklist with missing data:", cl);
      continue;
    }

    // Get or create company
    const company = await getOrCreateCompanyByName(companyName);

    // Avoid duplicates: same company + checklistName
    const { data: existing, error: existingErr } = await db
      .from("checklists")
      .select("*")
      .eq("company_id", company.id)
      .eq("name", checklistName);

    if (existingErr) {
      console.error(
        `Error checking existing checklist for ${companyName} / ${checklistName}:`,
        existingErr
      );
      throw existingErr;
    }

    if (existing && existing.length > 0) {
      console.log(
        `Skipping existing checklist "${checklistName}" for "${companyName}".`
      );
      continue;
    }

    // Create checklist + insert its devices
    const checklist = await createChecklist(company.id, checklistName);
    await insertDevicesForChecklist(checklist.id, devicesArray);

    summary.push({
      companyName,
      checklistName,
      deviceCount: devicesArray.length,
    });

    console.log(
      `✅ Migrated "${companyName}" / "${checklistName}" (${devicesArray.length} devices)`
    );
  }

  console.log("Migration complete. Summary:", summary);
  alert("✅ Migration to Supabase finished. Check console for summary.");
}

// Also expose it globally for easy console access
window.migrateExistingChecklistsOnce = migrateExistingChecklistsOnce;

console.log(
  "supabase-checklists.js loaded. You can run migrateExistingChecklistsOnce() from the console."
);
