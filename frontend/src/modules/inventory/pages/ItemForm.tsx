import { useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { inventoryApi, ITEM_TYPE_LABELS, type Vendor, type InvLocation, type CatalogCategory, type AssetCategory } from "../api";
import { compressImage } from "../../../core/imageCompress";
import { ArrowLeft, Plus, Trash2, ImagePlus, X } from "lucide-react";

const QTY_TYPES = ["part", "consumable"];

export default function ItemForm() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canMove = canWrite("inventory.move");   // rack/shelf/bin lives behind the move permission
  const { id } = useParams<{ id: string }>();
  const editing = id && id !== "new";
  const itemId = editing ? parseInt(id!) : null;

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [cats, setCats] = useState<CatalogCategory[]>([]);
  const [assetCats, setAssetCats] = useState<AssetCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const [f, setF] = useState<Record<string, string>>({
    item_type: "part", name: "", category: "", subcategory: "", category_id: "", asset_category_id: "", description: "",
    part_number: "", asset_tag: "", serial_number: "", url: "", vendor_id: "", location_id: "",
    rack: "", shelf: "", bin: "",
    unit_of_measure: "", package_quantity: "", current_quantity: "", minimum_stock_level: "",
    cost: "", purchase_date: "", warranty_info: "", battery_type: "", notes: "",
    color: "", length: "", pitch: "", pattern: "", inner_diameter: "", outer_diameter: "", measurement_system: "na",
  });

  const [discontinued, setDiscontinued] = useState(false);
  const [isKit, setIsKit] = useState(false);
  function set(k: string, v: string) { setF((p) => ({ ...p, [k]: v })); }

  // Donation tracking (asset types).
  const [donated, setDonated] = useState(false);
  const [donorMode, setDonorMode] = useState<"member" | "sponsor" | "name">("member");
  const [donorMemberId, setDonorMemberId] = useState<number | "">("");
  const [donorMemberLabel, setDonorMemberLabel] = useState("");
  const [donorSponsorId, setDonorSponsorId] = useState<number | "">("");
  const [donorName, setDonorName] = useState("");
  const [donationDate, setDonationDate] = useState("");
  const [sponsors, setSponsors] = useState<{ id: number; name: string }[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<{ id: number; first_name: string; last_name: string; member_type: string }[]>([]);

  useEffect(() => { if (donated && sponsors.length === 0) inventoryApi.listSponsors().then(setSponsors).catch(() => {}); }, [donated, sponsors.length]);
  useEffect(() => {
    if (donorMode !== "member" || memberQuery.trim().length < 2) { setMemberResults([]); return; }
    const t = setTimeout(() => inventoryApi.searchDonorMembers(memberQuery.trim()).then(setMemberResults).catch(() => setMemberResults([])), 250);
    return () => clearTimeout(t);
  }, [memberQuery, donorMode]);

  async function addAssetCategory() {
    const name = window.prompt("New asset category (e.g. Electronic Assets, Robot Assets):")?.trim();
    if (!name) return;
    try {
      const cat = await inventoryApi.createAssetCategory(name);
      setAssetCats((cs) => (cs.some((c) => c.id === cat.id) ? cs : [...cs, cat]).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
      set("asset_category_id", String(cat.id));
    } catch { /* ignore */ }
  }

  // Bulk-add: create several assets at once, each with its own asset tag + serial.
  const isAsset = f.item_type === "asset_tagged" || f.item_type === "asset_nontagged";
  const [bulkMode, setBulkMode] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);

  // Upload any staged photos to a just-created asset (compressed first).
  async function uploadStagedPhotos(itemId: number) {
    if (!photos.length) return;
    const urls: { url: string }[] = [];
    for (const p of photos) {
      try { const r = await inventoryApi.uploadPhoto(await compressImage(p)); urls.push({ url: r.url }); } catch { /* skip a bad file */ }
    }
    if (urls.length) await inventoryApi.addItemPhotos(itemId, urls);
  }
  const [variants, setVariants] = useState<{ asset_tag: string; serial_number: string; photo?: File }[]>([
    { asset_tag: "", serial_number: "" }, { asset_tag: "", serial_number: "" },
  ]);
  const setVariant = (i: number, k: "asset_tag" | "serial_number", v: string) =>
    setVariants((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setVariantPhoto = (i: number, photo: File | undefined) =>
    setVariants((rows) => rows.map((r, j) => (j === i ? { ...r, photo } : r)));
  const addRows = (n: number) => setVariants((rows) => [...rows, ...Array.from({ length: n }, () => ({ asset_tag: "", serial_number: "" }))]);
  const removeRow = (i: number) => setVariants((rows) => rows.filter((_, j) => j !== i));

  useEffect(() => {
    inventoryApi.listVendors().then(setVendors).catch(() => {});
    inventoryApi.listLocations().then(setLocations).catch(() => {});
    inventoryApi.listCategories().then(setCats).catch(() => {});
    inventoryApi.listAssetCategories().then(setAssetCats).catch(() => {});
    if (itemId) {
      inventoryApi.getItem(itemId).then((i) => {
        setF({
          item_type: i.item_type, name: i.name, category: i.category ?? "", subcategory: i.subcategory ?? "",
          category_id: i.category_id ? String(i.category_id) : "",
          asset_category_id: i.asset_category_id ? String(i.asset_category_id) : "",
          description: i.description ?? "", part_number: i.part_number ?? "", asset_tag: i.asset_tag ?? "", serial_number: i.serial_number ?? "",
          url: i.url ?? "",
          vendor_id: i.vendor_id ? String(i.vendor_id) : "", location_id: i.location_id ? String(i.location_id) : "",
          rack: i.location_spot?.rack ?? "", shelf: i.location_spot?.shelf ?? "", bin: i.location_spot?.bin ?? "",
          unit_of_measure: i.unit_of_measure ?? "", package_quantity: i.package_quantity ? String(i.package_quantity) : "",
          current_quantity: i.current_quantity != null ? String(i.current_quantity) : "",
          minimum_stock_level: i.minimum_stock_level != null ? String(i.minimum_stock_level) : "",
          cost: i.cost != null ? String(i.cost) : "", purchase_date: i.purchase_date ?? "",
          warranty_info: i.warranty_info ?? "", battery_type: i.battery_type ?? "", notes: i.notes ?? "",
          color: i.color ?? "", length: i.length ?? "", pitch: i.pitch ?? "", pattern: i.pattern ?? "",
          inner_diameter: i.inner_diameter ?? "", outer_diameter: i.outer_diameter ?? "",
          measurement_system: i.measurement_system ?? "na",
        });
        setDiscontinued(!!i.is_discontinued);
        setIsKit(!!i.is_kit);
        setDonated(!!i.is_donated);
        setDonationDate(i.donation_date ?? "");
        if (i.donor_member_id) { setDonorMode("member"); setDonorMemberId(i.donor_member_id); setDonorMemberLabel(i.donor_member_name ?? ""); }
        else if (i.donor_sponsor_id) { setDonorMode("sponsor"); setDonorSponsorId(i.donor_sponsor_id); }
        else if (i.donor_name) { setDonorMode("name"); setDonorName(i.donor_name); }
      }).catch(() => setError("Failed to load item."));
    }
  }, [itemId]);

  const isQty = QTY_TYPES.includes(f.item_type);
  const isBattery = f.item_type === "battery";

  // Persist the rack/shelf/bin for the item's chosen location (needs inventory.move).
  // On edit we always sync so an existing spot can be cleared; on create we only call
  // when something was entered. A spot failure must not claim the item save failed.
  async function saveSpot(savedId: number, always: boolean) {
    if (!canMove || !f.location_id) return;
    const hasSpot = !!(f.rack.trim() || f.shelf.trim() || f.bin.trim());
    if (!always && !hasSpot) return;
    try {
      await inventoryApi.setLocationBin(savedId, {
        location_id: parseInt(f.location_id),
        rack: f.rack.trim() || null, shelf: f.shelf.trim() || null, bin: f.bin.trim() || null,
      });
    } catch { setSavedMsg("Item saved, but the storage spot could not be saved (check your permissions)."); }
  }

  async function doSave(andNew: boolean) {
    if (!f.name.trim()) { setError("Name is required."); return; }
    setSaving(true); setError(""); setSavedMsg("");
    try {
      const payload: Record<string, unknown> = { item_type: f.item_type, name: f.name.trim() };
      const strFields = ["category", "subcategory", "description", "part_number", "serial_number",
        "url", "unit_of_measure", "warranty_info", "battery_type", "notes", "purchase_date",
        "color", "length", "pitch", "pattern", "inner_diameter", "outer_diameter"];
      for (const k of strFields) if (f[k]?.trim()) payload[k] = f[k].trim();
      // TRC Asset ID: always sent (even blank) so it can be set, changed, or cleared;
      // the server auto-generates a TRC-##### for tagged assets when left blank on create.
      payload.asset_tag = f.asset_tag.trim() || null;
      payload.measurement_system = f.measurement_system || "na";
      payload.is_discontinued = discontinued;
      payload.is_kit = isKit;
      payload.category_id = f.category_id ? parseInt(f.category_id) : null;
      payload.asset_category_id = isAsset && f.asset_category_id ? parseInt(f.asset_category_id) : null;
      // Donation: keep only the selected donor reference; clear the rest.
      const isDon = isAsset && donated;
      payload.is_donated = isDon;
      payload.donor_member_id = isDon && donorMode === "member" && donorMemberId ? donorMemberId : null;
      payload.donor_sponsor_id = isDon && donorMode === "sponsor" && donorSponsorId ? donorSponsorId : null;
      payload.donor_name = isDon && donorMode === "name" && donorName.trim() ? donorName.trim() : null;
      payload.donation_date = isDon && donationDate ? donationDate : null;
      if (f.vendor_id) payload.vendor_id = parseInt(f.vendor_id);
      if (f.location_id) payload.location_id = parseInt(f.location_id);
      if (f.package_quantity) payload.package_quantity = parseInt(f.package_quantity);
      for (const k of ["current_quantity", "minimum_stock_level", "cost"]) {
        if (f[k] !== "") payload[k] = parseFloat(f[k]);
      }

      // Bulk-create several assets sharing these common attributes.
      if (bulkMode && !editing && isAsset) {
        // Keep the filtered variants (with their staged photos) so we can attach
        // each row's photo to the matching created asset — the server returns the
        // created items in the same order we send them.
        const kept = variants.filter((v) => v.asset_tag.trim() || v.serial_number.trim());
        if (kept.length === 0) { setError("Add at least one asset (a tag or serial), or turn off multi-add."); setSaving(false); return; }
        const rows = kept.map((v) => ({ asset_tag: v.asset_tag.trim(), serial_number: v.serial_number.trim() }));
        const { asset_tag: _t, serial_number: _s, ...common } = payload; void _t; void _s;
        const r = await inventoryApi.createItemsBulk({ ...common, variants: rows });
        // Upload any per-row photos to their newly-created assets (compressed first).
        await Promise.all(kept.map(async (v, k) => {
          const item = r.items?.[k];
          if (!v.photo || !item) return;
          try {
            const up = await inventoryApi.uploadPhoto(await compressImage(v.photo));
            await inventoryApi.addItemPhotos(item.id, [{ url: up.url }]);
          } catch { /* skip a bad photo, keep the asset */ }
        }));
        navigate("/inventory", { state: { flash: `Created ${r.created} asset${r.created !== 1 ? "s" : ""}.` } });
        return;
      }

      if (editing) {
        await inventoryApi.updateItem(itemId!, payload);
        await saveSpot(itemId!, true);   // editing: always sync (lets you clear an old spot)
        navigate(`/inventory/items/${itemId}`);
      } else {
        const created = await inventoryApi.createItem(payload);
        await saveSpot(created.id, false);
        await uploadStagedPhotos(created.id);
        if (andNew) {
          // Keep the "context" fields so repeated entry is fast; clear the rest.
          setF((p) => ({
            ...p,
            name: "", part_number: "", serial_number: "", url: "", description: "",
            rack: "", shelf: "", bin: "",
            current_quantity: "", package_quantity: "", minimum_stock_level: "",
            cost: "", warranty_info: "", battery_type: "", notes: "",
            // item_type, vendor_id, location_id, category, subcategory, unit_of_measure, purchase_date retained
          }));
          setPhotos([]);
          setSavedMsg(`Saved "${created.name}". Ready for the next item.`);
          nameRef.current?.focus();
        } else {
          navigate(`/inventory/items/${created.id}`);
        }
      }
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to save item.");
    } finally { setSaving(false); }
  }

  function submit(e: FormEvent) { e.preventDefault(); doSave(false); }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</button>
      <h1 style={st.heading}>{editing ? "Edit Item" : "Add Item"}</h1>

      <form onSubmit={submit}>
        <div style={st.card}>
          <div style={st.grid}>
            <Field label="Item Type *">
              <select style={st.input} value={f.item_type} onChange={(e) => set("item_type", e.target.value)} disabled={!!editing}>
                {Object.entries(ITEM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Name *"><input ref={nameRef} style={st.input} value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Catalog Category">
              <select style={st.input} value={f.category_id} onChange={(e) => set("category_id", e.target.value)}>
                <option value="">— Uncategorized —</option>
                {cats.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    <option value={c.id}>{c.name} (general)</option>
                    {c.children.map((s) => <option key={s.id} value={s.id}>&nbsp;&nbsp;{s.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Part Number"><input style={st.input} value={f.part_number} onChange={(e) => set("part_number", e.target.value)} /></Field>
            {isAsset && (
              <Field label="Asset Category">
                <select style={st.input} value={f.asset_category_id}
                  onChange={(e) => { if (e.target.value === "__new__") addAssetCategory(); else set("asset_category_id", e.target.value); }}>
                  <option value="">— none —</option>
                  {assetCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">＋ Add new category…</option>
                </select>
              </Field>
            )}
            {isAsset && !bulkMode && (
              <Field label="TRC Asset ID">
                <input style={st.input} value={f.asset_tag} placeholder={f.item_type === "asset_tagged" ? "Blank = auto-generate TRC-#####" : "e.g. TRC-00042"}
                  onChange={(e) => set("asset_tag", e.target.value)} />
              </Field>
            )}
            {!bulkMode && <Field label="Serial Number"><input style={st.input} value={f.serial_number} onChange={(e) => set("serial_number", e.target.value)} /></Field>}
            <Field label="Vendor">
              <select style={st.input} value={f.vendor_id} onChange={(e) => set("vendor_id", e.target.value)}>
                <option value="">—</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <select style={st.input} value={f.location_id} onChange={(e) => set("location_id", e.target.value)}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
              </select>
            </Field>
          </div>

          {isAsset && !editing && (
            <div style={st.bulkBox}>
              <label style={st.bulkToggle}>
                <input type="checkbox" checked={bulkMode} onChange={(e) => setBulkMode(e.target.checked)} />
                <span><strong>Add several of these at once</strong> — same details above, each with its own Asset ID &amp; serial number</span>
              </label>
              {bulkMode && (
                <div style={st.bulkRows}>
                  <div style={st.bulkHead}><span style={st.bulkColH}>TRC Asset ID</span><span style={st.bulkColH}>Serial Number</span><span style={{ gridColumn: "span 2" }} /></div>
                  {variants.map((v, i) => (
                    <div key={i} style={st.bulkRow}>
                      <input style={st.input} value={v.asset_tag} placeholder={f.item_type === "asset_tagged" ? "blank = auto TRC-#####" : "TRC Asset ID"}
                        onChange={(e) => setVariant(i, "asset_tag", e.target.value)} />
                      <input style={st.input} value={v.serial_number} placeholder="Serial (optional)"
                        onChange={(e) => setVariant(i, "serial_number", e.target.value)} />
                      {v.photo ? (
                        <button type="button" style={st.bulkPhotoSet} title={`Photo: ${v.photo.name} — click to remove`}
                          onClick={() => setVariantPhoto(i, undefined)}>
                          <img src={URL.createObjectURL(v.photo)} alt="" style={st.bulkThumb} /><X size={11} />
                        </button>
                      ) : (
                        <label style={st.bulkPhotoBtn} title="Add a photo for this asset">
                          <ImagePlus size={14} />
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            onChange={(e) => { const file = e.target.files?.[0]; if (file) setVariantPhoto(i, file); e.target.value = ""; }} />
                        </label>
                      )}
                      <button type="button" style={st.bulkDel} title="Remove" disabled={variants.length <= 1}
                        onClick={() => removeRow(i)}><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <div style={st.bulkActions}>
                    <button type="button" style={st.bulkAddBtn} onClick={() => addRows(1)}><Plus size={13} /> Add row</button>
                    <button type="button" style={st.bulkAddBtn} onClick={() => addRows(5)}><Plus size={13} /> Add 5</button>
                    <span style={st.bulkCount}>{variants.filter((v) => v.asset_tag.trim() || v.serial_number.trim()).length} asset(s) will be created</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {canMove && (
            <div style={st.spotRow}>
              <label style={st.label}>
                Storage spot{" "}
                <span style={st.spotHint}>{f.location_id ? "— rack / shelf / bin within that location" : "— pick a Location first"}</span>
              </label>
              <div style={st.spotInputs}>
                <input style={st.input} placeholder="Rack" value={f.rack} disabled={!f.location_id} onChange={(e) => set("rack", e.target.value)} />
                <input style={st.input} placeholder="Shelf" value={f.shelf} disabled={!f.location_id} onChange={(e) => set("shelf", e.target.value)} />
                <input style={st.input} placeholder="Bin" value={f.bin} disabled={!f.location_id} onChange={(e) => set("bin", e.target.value)} />
              </div>
            </div>
          )}
          <Field label="Product URL"><input type="url" style={st.input} value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://… (vendor / reorder link)" /></Field>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#445", margin: "4px 0" }}>
            <input type="checkbox" checked={discontinued} onChange={(e) => setDiscontinued(e.target.checked)} />
            Discontinued <span style={{ color: "#888" }}>— no longer orderable; existing stock stays usable and transferable</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#445", margin: "4px 0" }}>
            <input type="checkbox" checked={isKit} onChange={(e) => setIsKit(e.target.checked)} />
            This is a kit <span style={{ color: "#888" }}>— a bundle of parts; set its contents on the item page after saving</span>
          </label>

          {isAsset && (
            <div style={st.donateBox}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#334", fontWeight: 600 }}>
                <input type="checkbox" checked={donated} onChange={(e) => setDonated(e.target.checked)} />
                🎁 This asset was donated to the program
              </label>
              {donated && (
                <div style={{ marginTop: 10 }}>
                  <div style={st.donorModes}>
                    {(["member", "sponsor", "name"] as const).map((m) => (
                      <button key={m} type="button" style={{ ...st.modeBtn, ...(donorMode === m ? st.modeBtnOn : {}) }} onClick={() => setDonorMode(m)}>
                        {m === "member" ? "Member" : m === "sponsor" ? "Sponsor" : "Other name"}
                      </button>
                    ))}
                  </div>

                  {donorMode === "member" && (
                    donorMemberId ? (
                      <div style={st.donorChip}>{donorMemberLabel}
                        <button type="button" style={st.donorClear} onClick={() => { setDonorMemberId(""); setDonorMemberLabel(""); setMemberQuery(""); }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ position: "relative" }}>
                        <input style={st.input} placeholder="Search members (parents, mentors, volunteers)…" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} />
                        {memberResults.length > 0 && (
                          <div style={st.results}>
                            {memberResults.map((r) => (
                              <button type="button" key={r.id} style={st.resultRow}
                                onClick={() => { setDonorMemberId(r.id); setDonorMemberLabel(`${r.first_name} ${r.last_name}`); setMemberResults([]); setMemberQuery(""); }}>
                                {r.first_name} {r.last_name} <span style={{ color: "#889" }}>· {r.member_type}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  )}
                  {donorMode === "sponsor" && (
                    <select style={st.input} value={donorSponsorId} onChange={(e) => setDonorSponsorId(e.target.value ? parseInt(e.target.value) : "")}>
                      <option value="">— pick a sponsor —</option>
                      {sponsors.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                    </select>
                  )}
                  {donorMode === "name" && (
                    <input style={st.input} placeholder="Donor name (individual or company)" value={donorName} onChange={(e) => setDonorName(e.target.value)} />
                  )}

                  <label style={{ ...st.donorDateLbl }}>Donation date
                    <input style={st.input} type="date" value={donationDate} onChange={(e) => setDonationDate(e.target.value)} />
                  </label>
                </div>
              )}
            </div>
          )}

          <Field label="Description"><textarea style={st.textarea} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>

          {isAsset && !editing && !bulkMode && (
            <Field label="Photos">
              <label style={st.photoBtn}>
                <ImagePlus size={14} /> Add photos
                <input type="file" accept="image/*" multiple hidden
                  onChange={(e) => { setPhotos((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
              </label>
              {photos.length > 0 && (
                <div style={st.photoStrip}>
                  {photos.map((p, i) => (
                    <div key={i} style={st.photoChip}>
                      <img src={URL.createObjectURL(p)} alt="" style={st.photoThumb} />
                      <button type="button" style={st.photoDel} onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div style={st.photoHint}>Photos are attached when you save. They're auto-shrunk before upload.</div>
            </Field>
          )}
        </div>

        {isQty && (
          <div style={st.card}>
            <h3 style={st.cardTitle}>Stock</h3>
            <div style={st.grid}>
              <Field label="Unit of Measure"><input style={st.input} placeholder="each, ft, roll…" value={f.unit_of_measure} onChange={(e) => set("unit_of_measure", e.target.value)} /></Field>
              <Field label="Package Quantity"><input type="number" style={st.input} value={f.package_quantity} onChange={(e) => set("package_quantity", e.target.value)} /></Field>
              <Field label="Current Quantity"><input type="number" step="0.01" style={st.input} value={f.current_quantity} onChange={(e) => set("current_quantity", e.target.value)} /></Field>
              <Field label="Minimum Stock Level"><input type="number" step="0.01" style={st.input} value={f.minimum_stock_level} onChange={(e) => set("minimum_stock_level", e.target.value)} /></Field>
            </div>
          </div>
        )}

        <div style={st.card}>
          <h3 style={st.cardTitle}>Specifications</h3>
          <div style={st.grid}>
            <Field label="Measurement System">
              <select style={st.input} value={f.measurement_system} onChange={(e) => set("measurement_system", e.target.value)}>
                <option value="na">Not Applicable</option>
                <option value="metric">Metric</option>
                <option value="imperial">Imperial</option>
              </select>
            </Field>
            <Field label="Color"><input style={st.input} value={f.color} onChange={(e) => set("color", e.target.value)} /></Field>
            <Field label="Length"><input style={st.input} value={f.length} onChange={(e) => set("length", e.target.value)} placeholder="e.g. 120 or 120mm" /></Field>
            <Field label="Pitch"><input style={st.input} value={f.pitch} onChange={(e) => set("pitch", e.target.value)} placeholder="belts, e.g. GT2 / 5mm" /></Field>
            <Field label="Pattern"><input style={st.input} value={f.pattern} onChange={(e) => set("pattern", e.target.value)} /></Field>
            <Field label="Inner Diameter"><input style={st.input} value={f.inner_diameter} onChange={(e) => set("inner_diameter", e.target.value)} /></Field>
            <Field label="Outer Diameter"><input style={st.input} value={f.outer_diameter} onChange={(e) => set("outer_diameter", e.target.value)} /></Field>
          </div>
        </div>

        <div style={st.card}>
          <h3 style={st.cardTitle}>Acquisition</h3>
          <div style={st.grid}>
            <Field label={f.item_type === "asset_nontagged" ? "Cost (per item)" : "Cost"}><input type="number" step="0.01" style={st.input} value={f.cost} onChange={(e) => set("cost", e.target.value)} /></Field>
            {f.item_type === "asset_nontagged" && (
              <Field label="Quantity"><input type="number" min="1" step="1" style={st.input} value={f.current_quantity} placeholder="e.g. 10 chairs" onChange={(e) => set("current_quantity", e.target.value)} /></Field>
            )}
            <Field label="Purchase Date"><input type="date" style={st.input} value={f.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} /></Field>
            <Field label="Warranty Info"><input style={st.input} value={f.warranty_info} onChange={(e) => set("warranty_info", e.target.value)} /></Field>
            {isBattery && <Field label="Battery Type"><input style={st.input} value={f.battery_type} onChange={(e) => set("battery_type", e.target.value)} /></Field>}
          </div>
          {f.item_type === "asset_nontagged" && f.cost !== "" && (
            <p style={st.note}>
              Total value: <strong>${(parseFloat(f.cost || "0") * Math.max(parseInt(f.current_quantity || "1") || 1, 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              {" "}({f.current_quantity || 1} × ${parseFloat(f.cost || "0").toFixed(2)})
            </p>
          )}
          {f.item_type === "asset_tagged" && !editing && (
            <p style={st.note}>Enter this asset's existing TRC Asset ID above, or leave it blank to auto-generate a unique TRC-##### tag. Either way a printable QR code is created.</p>
          )}
        </div>

        <div style={st.card}>
          <Field label="Notes"><textarea style={st.textarea} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>

        {error && <div style={st.error}>{error}</div>}
        {savedMsg && <div style={st.savedMsg}>✓ {savedMsg}</div>}
        <div style={st.actions}>
          <button type="button" style={st.cancelBtn} onClick={() => navigate(-1)}>Cancel</button>
          {!editing && !bulkMode && (
            <button type="button" style={st.saveNewBtn} disabled={saving} onClick={() => doSave(true)}>
              {saving ? "Saving…" : "Save & New"}
            </button>
          )}
          <button type="submit" style={st.saveBtn} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save Changes" : bulkMode
              ? `Create ${variants.filter((v) => v.asset_tag.trim() || v.serial_number.trim()).length} Assets`
              : "Add Item"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.label}>{label}</label>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  heading: { margin: "0 0 16px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem", marginBottom: 14 },
  cardTitle: { margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 8 },
  spotRow: { marginBottom: 8 },
  spotInputs: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  spotHint: { color: "#888", fontWeight: 400 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  textarea: { width: "100%", minHeight: 70, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, resize: "vertical", boxSizing: "border-box" },
  photoBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#eef2f7", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, padding: "7px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 },
  photoStrip: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 },
  photoChip: { position: "relative", width: 64, height: 64, borderRadius: 6, overflow: "hidden", border: "1px solid #e2e8f0" },
  photoThumb: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  photoDel: { position: "absolute", top: 2, right: 2, background: "rgba(255,255,255,.9)", border: "none", borderRadius: 4, padding: 2, cursor: "pointer", color: "#c62828", lineHeight: 0 },
  photoHint: { fontSize: 11, color: "#90a4ae", marginTop: 5 },
  note: { fontSize: 12, color: "#1565c0", margin: "8px 0 0" },
  error: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 14, fontSize: 14 },
  savedMsg: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 6, padding: "10px 14px", color: "#2e7d32", marginBottom: 14, fontSize: 14 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 12, paddingBottom: 32 },
  cancelBtn: { padding: "10px 22px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 14 },
  saveNewBtn: { padding: "10px 22px", border: "1px solid #1a3a5c", borderRadius: 6, background: "#fff", color: "#1a3a5c", cursor: "pointer", fontWeight: 600, fontSize: 14 },
  saveBtn: { padding: "10px 26px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  bulkBox: { border: "1px solid #d6e0ea", background: "#f7fafc", borderRadius: 10, padding: 12, margin: "4px 0 8px" },
  bulkToggle: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#334", cursor: "pointer" },
  bulkRows: { marginTop: 10, display: "flex", flexDirection: "column", gap: 6 },
  bulkHead: { display: "grid", gridTemplateColumns: "1fr 1fr 28px 28px", gap: 8, fontSize: 11, fontWeight: 700, color: "#667", textTransform: "uppercase", letterSpacing: 0.3 },
  bulkColH: { paddingLeft: 2 },
  bulkRow: { display: "grid", gridTemplateColumns: "1fr 1fr 28px 28px", gap: 8, alignItems: "center" },
  bulkDel: { background: "none", border: "1px solid #e2e8f0", borderRadius: 6, color: "#c62828", cursor: "pointer", padding: 5, display: "flex", alignItems: "center", justifyContent: "center" },
  bulkPhotoBtn: { background: "#fff", border: "1px solid #cdd7e3", borderRadius: 6, color: "#1565c0", cursor: "pointer", padding: 5, display: "flex", alignItems: "center", justifyContent: "center" },
  bulkPhotoSet: { background: "#eef4fb", border: "1px solid #1565c0", borderRadius: 6, color: "#1565c0", cursor: "pointer", padding: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 1 },
  bulkThumb: { width: 20, height: 20, objectFit: "cover", borderRadius: 3 },
  bulkActions: { display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" },
  bulkAddBtn: { display: "flex", alignItems: "center", gap: 4, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 7, padding: "5px 10px", fontSize: 12.5, cursor: "pointer", color: "#1565c0", fontWeight: 600 },
  bulkCount: { fontSize: 12, color: "#667", marginLeft: "auto" },
  donateBox: { border: "1px solid #d6e0ea", background: "#f7fafc", borderRadius: 10, padding: 12, margin: "4px 0 8px" },
  donorModes: { display: "inline-flex", border: "1px solid #cdd7e3", borderRadius: 8, overflow: "hidden", marginBottom: 8 },
  modeBtn: { padding: "6px 14px", background: "#fff", color: "#556", border: "none", borderRight: "1px solid #e2e8f0", cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  modeBtnOn: { background: "#1a3a5c", color: "#fff" },
  donorChip: { display: "inline-flex", alignItems: "center", gap: 8, background: "#e8f0fe", border: "1px solid #b8d0f5", borderRadius: 16, padding: "6px 14px", fontSize: 13.5, fontWeight: 600, color: "#1a3a5c" },
  donorClear: { background: "none", border: "none", color: "#556", cursor: "pointer", fontSize: 13, padding: 0 },
  results: { position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 8, marginTop: 3, maxHeight: 220, overflowY: "auto", boxShadow: "0 6px 20px rgba(0,0,0,0.12)" },
  resultRow: { display: "block", width: "100%", textAlign: "left", background: "#fff", border: "none", borderBottom: "1px solid #f0f4f8", padding: "8px 11px", cursor: "pointer", fontSize: 13.5, color: "#1a3a5c" },
  donorDateLbl: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#556", marginTop: 8, maxWidth: 200 },
};
