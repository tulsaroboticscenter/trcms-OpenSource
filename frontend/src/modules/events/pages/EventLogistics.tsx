import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { eventsApi, type EventLogistics as LogisticsType, type HotelRoom, type TRCEvent } from "../api";
import { PlusCircle, Trash2, BedDouble, CheckSquare, Square, ChevronDown, ChevronUp, FileDown } from "lucide-react";
import PhoneInput from "../../../core/components/PhoneInput";
import { api } from "../../../core/api";
import EventParticipants from "../components/EventParticipants";
import EventFundraisingPanel from "../components/EventFundraisingPanel";
import { useAuth } from "../../../core/AuthContext";
import { usePanelLayout } from "../../members/hooks/usePanelLayout";
import DraggablePanel from "../../members/components/DraggablePanel";
import { useGoBack } from "../../../core/useGoBack";
import { useIsMobile } from "../../../core/useIsMobile";

const DEFAULT_LOGISTICS_PANELS = [
  "logistics_lead",
  "travel",
  "housing",
  "meal",
  "equipment",
  "participants",
];

interface MentorOption { id: number; first_name: string; last_name: string; }

const DEFAULT_EQUIPMENT = [
  "Robot", "Battery box", "Chargers", "Tool kit", "Spare parts kit",
  "Awards / trophies", "Table cloths", "Team banner", "Sponsor banners",
  "Pop-up tent", "Extension cords", "First aid kit", "Giveaways",
];

const TRC_ADDRESS = "4500 South 129th East Avenue, Tulsa, OK 74134";

export default function EventLogistics() {
  const { id: eventId } = useParams<{ id: string }>();
  const goBack = useGoBack(`/events/${eventId}`);
  const { canWrite } = useAuth();
  const isMobile = useIsMobile();
  // Two-column form grids collapse to one column on phones so fields aren't cramped.
  const grid2 = { ...styles.grid2, ...(isMobile ? { gridTemplateColumns: "1fr" } : {}) };
  const canManageFundraising = canWrite("events.fundraising");
  const [event, setEvent] = useState<TRCEvent | null>(null);
  const [logistics, setLogistics] = useState<LogisticsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mentors, setMentors] = useState<MentorOption[]>([]);

  // Lead mentors
  const [logisticsLead, setLogisticsLead] = useState("");
  const [travelLead, setTravelLead] = useState("");
  const [equipmentLead, setEquipmentLead] = useState("");

  // Form state
  const [destination, setDestination] = useState("");
  const [meetupLocation, setMeetupLocation] = useState("");
  const [meetupAddress, setMeetupAddress] = useState("");
  const [meetupTime, setMeetupTime] = useState("");
  const [numDays, setNumDays] = useState("");
  const [travelRequired, setTravelRequired] = useState(false);
  const [housingNeeded, setHousingNeeded] = useState(false);
  const [hotelName, setHotelName] = useState("");
  const [hotelAddr1, setHotelAddr1] = useState("");
  const [hotelCity, setHotelCity] = useState("");
  const [hotelState, setHotelState] = useState("");
  const [hotelZip, setHotelZip] = useState("");
  const [hotelContact, setHotelContact] = useState("");
  const [hotelPhone, setHotelPhone] = useState("");
  const [hotelEmail, setHotelEmail] = useState("");
  const [mealBudget, setMealBudget] = useState("");
  const [totalMealBudget, setTotalMealBudget] = useState("");
  const [youthContribution, setYouthContribution] = useState("");
  const [youthMealsCount, setYouthMealsCount] = useState("");
  const [mealNotes, setMealNotes] = useState("");
  const [checklist, setChecklist] = useState<{ item: string; checked: boolean }[]>([]);
  const [newItem, setNewItem] = useState("");

  // Hotel rooms (managed separately after main logistics save)
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [addingRoom, setAddingRoom] = useState(false);
  const [newRoomLabel, setNewRoomLabel] = useState("");
  const [newRoomType, setNewRoomType] = useState("");
  const [newRoomRate, setNewRoomRate] = useState("");
  const [newRoomMax, setNewRoomMax] = useState("");
  const [expandedRoom, setExpandedRoom] = useState<number | null>(null);

  // Draggable panel layout — persisted per user
  const { order: panelOrder, setOrder: setPanelOrder } = usePanelLayout(
    DEFAULT_LOGISTICS_PANELS,
    "logistics_panels",
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  function handleDragStart(id: string) { setDragging(id); }
  function handleDragOver(e: React.DragEvent, id: string) { e.preventDefault(); setDragOver(id); }
  function handleDragEnd() { setDragging(null); setDragOver(null); }
  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragging || dragging === targetId) { handleDragEnd(); return; }
    const next = [...panelOrder];
    const from = next.indexOf(dragging);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) { handleDragEnd(); return; }
    next.splice(from, 1);
    next.splice(to, 0, dragging);
    setPanelOrder(next);
    handleDragEnd();
  }

  useEffect(() => {
    const eid = parseInt(eventId!);
    Promise.all([
      eventsApi.get(eid),
      eventsApi.getLogistics(eid).catch(() => null),
      api.get("/api/v1/members/?member_type=mentor&is_active=true&limit=200"),
    ]).then(([ev, lg, mentorRes]) => {
      setEvent(ev);
      setMentors(mentorRes.data.members);
      if (lg) {
        setLogistics(lg);
        setLogisticsLead(String(lg.logistics_lead_id ?? ""));
        setTravelLead(String(lg.travel_lead_id ?? ""));
        setEquipmentLead(String(lg.equipment_lead_id ?? ""));
        setDestination(lg.destination_address ?? "");
        setMeetupLocation(lg.meetup_location ?? "");
        setMeetupAddress(lg.meetup_address ?? "");
        setMeetupTime(lg.meetup_time ?? "");
        setNumDays(lg.num_days ? String(lg.num_days) : "");
        setTravelRequired(lg.travel_required);
        setHousingNeeded(lg.housing_needed);
        setHotelName(lg.official_hotel_name ?? "");
        setHotelAddr1(lg.hotel_address_line1 ?? "");
        setHotelCity(lg.hotel_city ?? "");
        setHotelState(lg.hotel_state ?? "");
        setHotelZip(lg.hotel_zip ?? "");
        setHotelContact(lg.hotel_contact_name ?? "");
        setHotelPhone(lg.hotel_contact_phone ?? "");
        setHotelEmail(lg.hotel_contact_email ?? "");
        setMealBudget(lg.budget_per_meal ? String(lg.budget_per_meal) : "");
        setTotalMealBudget(lg.total_meal_budget ? String(lg.total_meal_budget) : "");
        setYouthContribution(lg.youth_meal_contribution ? String(lg.youth_meal_contribution) : "");
        setYouthMealsCount(lg.youth_meals_responsible_for ? String(lg.youth_meals_responsible_for) : "");
        setMealNotes(lg.meal_notes ?? "");
        setChecklist(lg.equipment_checklist.length ? lg.equipment_checklist : DEFAULT_EQUIPMENT.map((item) => ({ item, checked: false })));
        setRooms(lg.hotel_rooms);
      } else {
        setChecklist(DEFAULT_EQUIPMENT.map((item) => ({ item, checked: false })));
      }
    }).finally(() => setLoading(false));
  }, [eventId]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const updated = await eventsApi.saveLogistics(parseInt(eventId!), {
        logistics_lead_id: logisticsLead ? parseInt(logisticsLead) : null,
        destination_address: destination || null,
        meetup_location: meetupLocation || null,
        meetup_address: meetupAddress || null,
        meetup_time: meetupTime || null,
        num_days: numDays ? parseInt(numDays) : null,
        travel_required: travelRequired,
        travel_lead_id: travelLead ? parseInt(travelLead) : null,
        housing_needed: housingNeeded,
        housing_arranger_id: logistics?.housing_arranger_id || null,
        official_hotel_name: hotelName || null,
        hotel_address_line1: hotelAddr1 || null,
        hotel_city: hotelCity || null,
        hotel_state: hotelState || null,
        hotel_zip: hotelZip || null,
        hotel_contact_name: hotelContact || null,
        hotel_contact_phone: hotelPhone || null,
        hotel_contact_email: hotelEmail || null,
        budget_per_meal: mealBudget ? parseFloat(mealBudget) : null,
        total_meal_budget: totalMealBudget ? parseFloat(totalMealBudget) : null,
        youth_meal_contribution: youthContribution ? parseFloat(youthContribution) : null,
        youth_meals_responsible_for: youthMealsCount ? parseInt(youthMealsCount) : null,
        meal_notes: mealNotes,
        meal_coordinator_id: logistics?.meal_coordinator_id || null,
        equipment_checklist: checklist,
        equipment_lead_id: equipmentLead ? parseInt(equipmentLead) : null,
      });
      setLogistics(updated);
      setRooms(updated.hotel_rooms);
    } catch {
      setError("Failed to save logistics.");
    } finally {
      setSaving(false);
    }
  }

  function toggleCheck(i: number) {
    setChecklist((prev) => prev.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it));
  }

  function removeItem(i: number) {
    setChecklist((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addItem() {
    if (!newItem.trim()) return;
    setChecklist((prev) => [...prev, { item: newItem.trim(), checked: false }]);
    setNewItem("");
  }

  async function addRoom() {
    if (!newRoomLabel.trim()) return;
    try {
      const room = await eventsApi.addRoom(parseInt(eventId!), {
        room_label: newRoomLabel.trim(),
        room_type: newRoomType || null,
        room_rate: newRoomRate ? parseFloat(newRoomRate) : null,
        max_occupants: newRoomMax ? parseInt(newRoomMax) : null,
        paid_by_trc: true,
      });
      setRooms((prev) => [...prev, room]);
      setNewRoomLabel(""); setNewRoomType(""); setNewRoomRate(""); setNewRoomMax("");
      setAddingRoom(false);
    } catch {
      alert("Failed to add room.");
    }
  }

  const mentorName = (id?: number | string | null): string => {
    if (id === null || id === undefined || id === "") return "";
    const nid = typeof id === "string" ? parseInt(id) : id;
    const m = mentors.find((x) => x.id === nid);
    return m ? `${m.first_name} ${m.last_name}` : "";
  };
  const fmtTime = (t?: string): string => {
    if (!t) return "";
    const [h, m] = t.split(":");
    const d = new Date(); d.setHours(parseInt(h), parseInt(m || "0"), 0, 0);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };
  const money = (v?: string | number | null): string =>
    v === null || v === undefined || v === "" ? "" : `$${Number(v).toFixed(2)}`;

  // Build a downloadable logistics sheet from the on-screen data. Sections whose fields
  // are all empty (no hotel, no meals, etc.) are omitted entirely.
  function downloadPdf() {
    const doc = new jsPDF();
    const margin = 14;
    let y = 16;
    doc.setFontSize(16); doc.setTextColor(26, 58, 92);
    doc.text(`Event Logistics — ${event?.name ?? ""}`, margin, y); y += 7;
    const dateStr = event?.event_date
      ? new Date(event.event_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : "";
    const meta = [dateStr, event?.location, event?.event_type].filter(Boolean).join("   •   ");
    if (meta) { doc.setFontSize(10); doc.setTextColor(110); doc.text(meta, margin, y); y += 6; }
    doc.setTextColor(0);

    const advance = () => { y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8; };
    const section = (title: string, rows: [string, string | number | null | undefined][], fill: [number, number, number] = [26, 58, 92]) => {
      const body = rows
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
        .map(([k, v]) => [k, String(v)]);
      if (!body.length) return;
      autoTable(doc, {
        startY: y,
        head: [[{ content: title, colSpan: 2 }]],
        body,
        theme: "grid",
        headStyles: { fillColor: fill, fontSize: 11, textColor: 255, halign: "left" },
        bodyStyles: { fontSize: 10 },
        columnStyles: { 0: { cellWidth: 58, fontStyle: "bold", textColor: [70, 70, 70] } },
        margin: { left: margin, right: margin },
      });
      advance();
    };

    // Travel & Meet-Up
    section("Travel & Meet-Up", [
      ["Logistics Lead", mentorName(logisticsLead)],
      ["Travel Lead", mentorName(travelLead)],
      ["Travel arrangements", travelRequired ? "Required" : ""],
      ["Meet-Up Location", meetupLocation],
      ["Meet-Up Address", meetupAddress],
      ["Meet-Up Time", fmtTime(meetupTime)],
      ["Destination Address", destination],
      ["Number of Days", numDays],
    ]);

    // Housing / Hotel — only when housing is needed and something is filled in
    if (housingNeeded) {
      const hotelAddr = [hotelAddr1, [hotelCity, hotelState].filter(Boolean).join(", "), hotelZip].filter(Boolean).join("  ");
      section("Housing / Hotel", [
        ["Housing Lead", mentorName(logistics?.housing_arranger_id)],
        ["Hotel", hotelName],
        ["Address", hotelAddr],
        ["Contact", hotelContact],
        ["Contact Phone", hotelPhone],
        ["Contact Email", hotelEmail],
      ], [106, 27, 154]);
      const roomRows = rooms
        .filter((r) => !r.canceled)
        .map((r) => [
          r.room_label + (r.room_type ? ` (${r.room_type})` : ""),
          money(r.room_rate),
          r.confirmation_number || "",
          (r.assignments || []).map((a) => a.member_name).filter(Boolean).join(", ")
            || (r.max_occupants ? `0 / ${r.max_occupants}` : ""),
        ]);
      if (roomRows.length) {
        autoTable(doc, {
          startY: y,
          head: [["Room", "Rate", "Confirmation #", "Occupants"]],
          body: roomRows,
          theme: "grid",
          headStyles: { fillColor: [106, 27, 154], fontSize: 10, textColor: 255 },
          bodyStyles: { fontSize: 9.5 },
          columnStyles: { 1: { cellWidth: 22 }, 2: { cellWidth: 32 } },
          margin: { left: margin, right: margin },
        });
        advance();
      }
    }

    // Meal Planning — only if any meal field is set
    section("Meal Planning", [
      ["Meal Coordinator", mentorName(logistics?.meal_coordinator_id)],
      ["Budget Per Meal", money(mealBudget)],
      ["Total Meal Budget", money(totalMealBudget)],
      ["Youth Meal Contribution", money(youthContribution)],
      ["Meals Youth Responsible For", youthMealsCount],
      ["Notes", mealNotes],
    ], [176, 96, 11]);

    // Equipment Checklist — only if there are items
    const equip = checklist.filter((c) => c.item && c.item.trim());
    if (equip.length) {
      const lead = mentorName(equipmentLead);
      autoTable(doc, {
        startY: y,
        head: [[{ content: "Equipment Checklist" + (lead ? `   (Lead: ${lead})` : ""), colSpan: 2, styles: { halign: "left" as const } }], ["Item", "Packed"]],
        body: equip.map((c) => [c.item, c.checked ? "Yes" : ""]),
        theme: "grid",
        headStyles: { fillColor: [46, 125, 50], fontSize: 10, textColor: 255 },
        bodyStyles: { fontSize: 9.5 },
        columnStyles: { 1: { cellWidth: 26, halign: "center" } },
        margin: { left: margin, right: margin },
      });
      advance();
    }

    doc.save(`logistics-${(event?.name ?? "event").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
  }

  if (loading) return <div style={{ padding: "2rem", color: "#888" }}>Loading…</div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}>
          ← Back to Event
        </button>
        <h1 style={styles.heading}>
          Logistics — {event?.name}
        </h1>
        <p style={styles.sub}>
          {event?.event_date ? new Date(event.event_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : ""}
        </p>
        <button onClick={downloadPdf} style={styles.pdfBtn}>
          <FileDown size={15} /> Download PDF
        </button>
      </div>

      {/* Team Fundraising pane — only for fundraising-opportunity events, to managers */}
      {event?.fundraising_opportunity && canManageFundraising && eventId && (
        <EventFundraisingPanel eventId={parseInt(eventId)} />
      )}

      <p style={styles.dragHint}>💡 Drag panels by the ⠿ handle to rearrange. Layout is saved automatically.</p>

      {/* Draggable panel container — renders panels in user-defined order */}
      <div>
        {panelOrder.map(panelId => {
          const dpProps = {
            id: panelId, dragging, dragOver,
            onDragStart: handleDragStart, onDragOver: handleDragOver,
            onDrop: handleDrop, onDragEnd: handleDragEnd,
          };

          if (panelId === "logistics_lead") return (
        <DraggablePanel key={panelId} title="Logistics Lead" icon={null} {...dpProps}>
          <Field label="Lead Mentor Responsible for Overall Logistics">
            <MentorSelect value={logisticsLead} onChange={setLogisticsLead} mentors={mentors} />
          </Field>
          <p style={styles.hint}>This mentor is the primary point of contact for all logistical coordination.</p>
        </DraggablePanel>
          );

          if (panelId === "travel") return (
        <DraggablePanel key={panelId} title="Travel" icon={null} {...dpProps}>
          {/* Lead mentor at the top of the section */}
          {/* Lead mentor at the top of the section */}
          <Field label="Lead Mentor for Travel">
            <MentorSelect value={travelLead} onChange={setTravelLead} mentors={mentors} placeholder="Not assigned" />
          </Field>

          {/* Meet-up details */}
          <div style={{ ...grid2, marginTop: 12 }}>
            <Field label="Meet-Up Location">
              <input style={styles.input} value={meetupLocation}
                onChange={(e) => setMeetupLocation(e.target.value)}
                placeholder="e.g. TRC Parking Lot" />
            </Field>
            <Field label="Meet-Up Time">
              <input
                type="time"
                style={styles.input}
                value={meetupTime}
                onChange={(e) => setMeetupTime(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="Meet-Up Address">
              <input style={styles.input} value={meetupAddress}
                onChange={(e) => setMeetupAddress(e.target.value)}
                placeholder="Street address of the meet-up location" />
            </Field>
          </div>

          {/* Destination & travel details */}
          <div style={grid2}>
            <Field label={`Destination Address (from TRC: ${TRC_ADDRESS})`}>
              <input style={{ ...styles.input, gridColumn: "1/-1" }} value={destination}
                onChange={(e) => setDestination(e.target.value)} placeholder="Venue or hotel address" />
            </Field>
            <Field label="Number of Days">
              <input type="number" min="1" style={styles.input} value={numDays} onChange={(e) => setNumDays(e.target.value)} />
            </Field>
          </div>
          <label style={styles.checkRow}>
            <input type="checkbox" checked={travelRequired} onChange={(e) => setTravelRequired(e.target.checked)} />
            <span style={styles.checkLabel}>Travel arrangements required</span>
          </label>
        </DraggablePanel>
          );

          if (panelId === "housing") return (
        <DraggablePanel key={panelId} title="Housing / Hotel" icon={null} {...dpProps}>
          <Field label="Lead Mentor for Housing / Hotel">
            <MentorSelect value={String(logistics?.housing_arranger_id ?? "")}
              onChange={v => setLogistics(l => l ? { ...l, housing_arranger_id: v ? parseInt(v) : undefined } : l)}
              mentors={mentors} placeholder="Not assigned" />
          </Field>
          <label style={{ ...styles.checkRow, marginTop: 12 }}>
            <input type="checkbox" checked={housingNeeded} onChange={(e) => setHousingNeeded(e.target.checked)} />
            <span style={styles.checkLabel}>Hotel / housing arrangements needed</span>
          </label>
          {housingNeeded && (
            <div style={{ marginTop: 14 }}>
              <div style={grid2}>
                <Field label="Hotel Name">
                  <input style={styles.input} value={hotelName} onChange={(e) => setHotelName(e.target.value)} />
                </Field>
                <Field label="Address">
                  <input style={styles.input} value={hotelAddr1} onChange={(e) => setHotelAddr1(e.target.value)} />
                </Field>
                <Field label="City">
                  <input style={styles.input} value={hotelCity} onChange={(e) => setHotelCity(e.target.value)} />
                </Field>
                <div style={grid2}>
                  <Field label="State">
                    <input style={styles.input} value={hotelState} onChange={(e) => setHotelState(e.target.value)} maxLength={2} />
                  </Field>
                  <Field label="ZIP">
                    <input style={styles.input} value={hotelZip} onChange={(e) => setHotelZip(e.target.value)} />
                  </Field>
                </div>
                <Field label="Contact Name">
                  <input style={styles.input} value={hotelContact} onChange={(e) => setHotelContact(e.target.value)} />
                </Field>
                <Field label="Contact Phone">
                  <PhoneInput style={styles.input} value={hotelPhone} onChange={setHotelPhone} />
                </Field>
                <Field label="Contact Email">
                  <input type="email" style={styles.input} value={hotelEmail} onChange={(e) => setHotelEmail(e.target.value)} />
                </Field>
              </div>

              {/* ── Room Assignments — merged into this panel ── */}
              <div style={styles.roomSection}>
                <div style={styles.roomSectionTitle}>
                  Room Assignments ({rooms.length} room{rooms.length !== 1 ? "s" : ""})
                </div>
                {rooms.map((room) => (
                  <HotelRoomCard
                    key={room.id}
                    room={room}
                    eventId={parseInt(eventId!)}
                    expanded={expandedRoom === room.id}
                    onToggle={() => setExpandedRoom(expandedRoom === room.id ? null : room.id)}
                    onUpdate={async (data) => {
                      await eventsApi.updateRoom(room.id, data);
                      const updated = await eventsApi.getLogistics(parseInt(eventId!));
                      setRooms(updated.hotel_rooms);
                    }}
                  />
                ))}
                {addingRoom ? (
                  <div style={styles.addRoomForm}>
                    <div style={grid2}>
                      <Field label="Room Label *">
                        <input style={styles.input} value={newRoomLabel} onChange={(e) => setNewRoomLabel(e.target.value)} placeholder="e.g. Mentor Room A" />
                      </Field>
                      <Field label="Room Type">
                        <input style={styles.input} value={newRoomType} onChange={(e) => setNewRoomType(e.target.value)} placeholder="e.g. Double, King, Suite" />
                      </Field>
                      <Field label="Nightly Rate ($)">
                        <input type="number" step="0.01" style={styles.input} value={newRoomRate} onChange={(e) => setNewRoomRate(e.target.value)} />
                      </Field>
                      <Field label="Max Occupants">
                        <input type="number" min="1" style={styles.input} value={newRoomMax} onChange={(e) => setNewRoomMax(e.target.value)} />
                      </Field>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button type="button" onClick={addRoom} style={styles.saveBtn}>Add Room</button>
                      <button type="button" onClick={() => setAddingRoom(false)} style={styles.cancelBtn}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" style={styles.addRoomBtn} onClick={() => setAddingRoom(true)}>
                    <BedDouble size={14} /> <PlusCircle size={13} /> Add Hotel Room
                  </button>
                )}
              </div>
            </div>
          )}
        </DraggablePanel>
          );

          if (panelId === "meal") return (
        <DraggablePanel key={panelId} title="Meal Planning" icon={null} {...dpProps}>
          <Field label="Lead Mentor for Meal Planning">
            <MentorSelect value={String(logistics?.meal_coordinator_id ?? "")}
              onChange={v => setLogistics(l => l ? { ...l, meal_coordinator_id: v ? parseInt(v) : undefined } : l)}
              mentors={mentors} placeholder="Not assigned" />
          </Field>
          <div style={{ ...grid2, marginTop: 10 }}>
            <Field label="Budget Per Meal ($)">
              <input type="number" step="0.01" style={styles.input} value={mealBudget}
                onChange={(e) => setMealBudget(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Total Meal Budget ($)">
              <input type="number" step="0.01" style={styles.input} value={totalMealBudget}
                onChange={(e) => setTotalMealBudget(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Youth Meal Contribution ($)">
              <input type="number" step="0.01" style={styles.input} value={youthContribution}
                onChange={(e) => setYouthContribution(e.target.value)} placeholder="Amount each youth should bring" />
            </Field>
            <Field label="Meals Youth Are Responsible For">
              <input type="number" min="0" style={styles.input} value={youthMealsCount}
                onChange={(e) => setYouthMealsCount(e.target.value)} />
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="Notes">
              <textarea style={{ ...styles.input, minHeight: 72, resize: "vertical", fontFamily: "inherit" }}
                value={mealNotes} onChange={(e) => setMealNotes(e.target.value)}
                placeholder="Additional meal details — menu, dietary needs/allergies, who's bringing what, pickup times, etc." />
            </Field>
          </div>
        </DraggablePanel>
          );

          if (panelId === "equipment") return (
        <DraggablePanel key={panelId} title="Equipment Checklist" icon={null} {...dpProps}>
          <Field label="Lead Mentor for Equipment">
            <MentorSelect value={equipmentLead} onChange={setEquipmentLead} mentors={mentors} placeholder="Not assigned" />
          </Field>
          <p style={{ ...styles.hint, marginTop: 10 }}>Check off items as they are packed. Add team-specific items as needed.</p>
          <div style={styles.checklistGrid}>
            {checklist.map((item, i) => (
              <div key={i} style={styles.checklistItem}>
                <button type="button" onClick={() => toggleCheck(i)} style={styles.checkBtn}>
                  {item.checked ? <CheckSquare size={16} color="#2e7d32" /> : <Square size={16} color="#ccc" />}
                </button>
                <span style={{ fontSize: 13, flex: 1, textDecoration: item.checked ? "line-through" : "none", color: item.checked ? "#aaa" : "#333" }}>
                  {item.item}
                </span>
                <button type="button" onClick={() => removeItem(i)} style={styles.removeItemBtn}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div style={styles.addItemRow}>
            <input style={{ ...styles.input, flex: 1 }} value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())}
              placeholder="Add item to checklist…" />
            <button type="button" onClick={addItem} style={styles.addItemBtn}>
              <PlusCircle size={13} /> Add
            </button>
          </div>
        </DraggablePanel>
          );

          if (panelId === "participants") return (
        <DraggablePanel key={panelId} title="Participant List" icon={null} {...dpProps}>
          <EventParticipants eventId={parseInt(eventId!)} housingNeeded={housingNeeded} />
        </DraggablePanel>
          );

          return null;
        })}
      </div>

      {/* Save button — always at the bottom, outside the draggable panels */}
      {error && <div style={styles.errorBox}>{error}</div>}
      <div style={styles.saveRow}>
        <button onClick={handleSave} style={styles.saveBtn} disabled={saving}>
          {saving ? "Saving…" : "Save Logistics"}
        </button>
      </div>
    </div>
  );
}

function HotelRoomCard({ room, expanded, onToggle, onUpdate, eventId }: {
  room: HotelRoom;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (data: Record<string, unknown>) => Promise<void>;
  eventId: number;
}) {
  // Same single-column-on-mobile grid the page uses; this is its own component, so
  // it can't see the one declared up in EventLogistics.
  const isMobile = useIsMobile();
  const grid2 = { ...styles.grid2, ...(isMobile ? { gridTemplateColumns: "1fr" } : {}) };
  const [confNum, setConfNum] = useState(room.confirmation_number ?? "");
  const [roomNum, setRoomNum] = useState(room.room_number ?? "");
  const [canceled, setCanceled] = useState(room.canceled);
  const [cancNum, setCancNum] = useState(room.cancellation_number ?? "");
  const [saving, setSaving] = useState(false);

  // Room occupant assignment
  const [occupants, setOccupants] = useState<{ id: number; member_id: number; member_name?: string }[]>(room.assignments ?? []);
  const [participants, setParticipants] = useState<{ member_id: number; first_name?: string; last_name?: string; separate_housing: boolean }[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assigningId, setAssigningId] = useState<number | null>(null);

  useEffect(() => {
    if (showAssign && participants.length === 0) {
      api.get(`/api/v1/events/${eventId}/participants`).then(({ data: d }) => {
        const all = (d.sections ?? []).flatMap((s: { participants: { member_id: number; first_name?: string; last_name?: string; separate_housing: boolean }[] }) => s.participants)
          .filter((p: { member_id?: number; separate_housing: boolean }) => p.member_id && !p.separate_housing);
        setParticipants(all);
      }).catch(() => {});
    }
  }, [showAssign, eventId]);

  async function assignOccupant(memberId: number) {
    setAssigningId(memberId);
    try {
      await api.post(`/api/v1/events/rooms/${room.id}/assign`, { member_id: memberId });
      const p = participants.find(px => px.member_id === memberId);
      const member_name = p ? `${p.last_name ?? ""}, ${p.first_name ?? ""}`.trim().replace(/^,\s*/, "") : undefined;
      setOccupants(prev => [...prev, { id: Date.now(), member_id: memberId, member_name }]);
    } catch { /* ignore if already assigned */ }
    finally { setAssigningId(null); }
  }

  async function removeOccupant(memberId: number) {
    await api.delete(`/api/v1/events/rooms/${room.id}/assign/${memberId}`);
    setOccupants(prev => prev.filter(o => o.member_id !== memberId));
  }

  const occupantIds = new Set(occupants.map(o => o.member_id));
  const unassigned = participants.filter(p => p.member_id && !occupantIds.has(p.member_id));

  async function save() {
    setSaving(true);
    await onUpdate({ confirmation_number: confNum || null, room_number: roomNum || null, canceled, cancellation_number: cancNum || null });
    setSaving(false);
  }

  return (
    <div style={styles.roomCard}>
      <div style={styles.roomHeader} onClick={onToggle}>
        <BedDouble size={15} color="#1a3a5c" />
        <span style={styles.roomLabel}>{room.room_label}</span>
        {room.room_type && <span style={styles.roomType}>{room.room_type}</span>}
        {room.room_rate && <span style={styles.roomRate}>${room.room_rate}/night</span>}
        {room.canceled && <span style={styles.canceledTag}>Canceled</span>}
        {room.confirmation_number && <span style={styles.confNum}>Conf: {room.confirmation_number}</span>}
        {expanded ? <ChevronUp size={14} color="#888" style={{ marginLeft: "auto" }} /> : <ChevronDown size={14} color="#888" style={{ marginLeft: "auto" }} />}
      </div>
      {expanded && (
        <div style={styles.roomBody}>
          <div style={grid2}>
            <Field label="Room Number (assigned at check-in)">
              <input style={styles.input} value={roomNum} onChange={(e) => setRoomNum(e.target.value)} placeholder="e.g. 214" />
            </Field>
            <Field label="Confirmation Number">
              <input style={styles.input} value={confNum} onChange={(e) => setConfNum(e.target.value)} />
            </Field>
          </div>
          <label style={styles.checkRow}>
            <input type="checkbox" checked={canceled} onChange={(e) => setCanceled(e.target.checked)} />
            <span style={styles.checkLabel}>Room Canceled</span>
          </label>
          {canceled && (
            <Field label="Cancellation Number">
              <input style={styles.input} value={cancNum} onChange={(e) => setCancNum(e.target.value)} />
            </Field>
          )}
          <div style={{ marginTop: 12 }}>
            <button type="button" style={styles.saveBtn} onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save Room Details"}
            </button>
          </div>

          {/* Occupant assignments */}
          <div style={{ marginTop: 14, borderTop: "1px solid #f0f4f8", paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
              <span>Room Occupants ({occupants.length}{room.max_occupants ? ` / ${room.max_occupants}` : ""})</span>
              <button style={{ ...styles.saveBtn, fontSize: 11, padding: "3px 10px" }} type="button" onClick={() => setShowAssign(!showAssign)}>
                {showAssign ? "Done" : "+ Add Person"}
              </button>
            </div>

            {/* Current occupants */}
            {occupants.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                {occupants.map(o => {
                  const p = participants.find(px => px.member_id === o.member_id);
                  const fromList = p ? `${p.last_name ?? ""}, ${p.first_name ?? ""}`.trim().replace(/^,\s*/,"") : "";
                  const name = o.member_name || fromList || `Member #${o.member_id}`;
                  return (
                    <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", background: "#e8f5e9", borderRadius: 5, fontSize: 12 }}>
                      <span style={{ flex: 1, color: "#1a3a5c", fontWeight: 500 }}>{name}</span>
                      <button type="button" style={{ background: "none", border: "none", cursor: "pointer", color: "#c62828", fontSize: 11 }}
                        onClick={() => removeOccupant(o.member_id)}>Remove</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Assign panel */}
            {showAssign && (
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7, padding: "8px 10px" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
                  Select from participants (excludes those with separate housing):
                </div>
                {unassigned.length === 0 && <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>All eligible participants are assigned to rooms.</p>}
                <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 160, overflowY: "auto" }}>
                  {unassigned.map(p => (
                    <div key={p.member_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 12 }}>
                      <span style={{ flex: 1, color: "#1a3a5c" }}>
                        {`${p.last_name ?? ""}, ${p.first_name ?? ""}`.trim().replace(/^,\s*/,"")}
                      </span>
                      <button type="button"
                        style={{ padding: "2px 10px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                        disabled={assigningId === p.member_id}
                        onClick={() => p.member_id && assignOccupant(p.member_id)}>
                        {assigningId === p.member_id ? "…" : "Assign"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 860, margin: "0 auto" },
  header: { marginBottom: 20 },
  backBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, display: "block", marginBottom: 4 },
  heading: { margin: "0 0 2px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: 0, fontSize: 13, color: "#888" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 14 },
  cardTitle: { margin: "0 0 1rem", fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, borderBottom: "1px solid #f0f4f8", paddingBottom: 8 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 10 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  checkRow: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 6 },
  checkLabel: { fontSize: 14, color: "#333" },
  hint: { fontSize: 12, color: "#888", margin: "0 0 10px" },
  checklistGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10 },
  checklistItem: { display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", background: "#f8fafc", borderRadius: 5 },
  checkBtn: { background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" },
  removeItemBtn: { background: "none", border: "none", cursor: "pointer", padding: 0, color: "#ccc", display: "flex" },
  addItemRow: { display: "flex", gap: 8 },
  addItemBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#f0f4f8", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" as const },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  dragHint: { fontSize: 12, color: "#aaa", textAlign: "right" as const, margin: "0 0 10px" },
  saveRow: { display: "flex", justifyContent: "flex-end", marginBottom: 24, marginTop: 8 },
  saveBtn: { padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  pdfBtn: { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, padding: "8px 16px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  roomSection: { marginTop: 20, paddingTop: 16, borderTop: "2px solid #e2e8f0" },
  roomSectionTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 12 },
  addRoomBtn: { display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#f0f4f8", border: "2px dashed #ccc", borderRadius: 8, cursor: "pointer", fontSize: 13, width: "100%", justifyContent: "center", marginTop: 8 },
  addRoomForm: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "1rem", marginTop: 8 },
  roomCard: { border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 8, overflow: "hidden" },
  roomHeader: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", background: "#f8fafc" },
  roomLabel: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  roomType: { fontSize: 12, color: "#888" },
  roomRate: { fontSize: 12, color: "#2e7d32", fontWeight: 600 },
  canceledTag: { fontSize: 11, padding: "2px 8px", background: "#ffebee", color: "#c62828", borderRadius: 6, fontWeight: 600 },
  confNum: { fontSize: 11, color: "#888" },
  roomBody: { padding: "12px 14px", borderTop: "1px solid #f0f4f8" },
};

// ── Helper components ───────────────────────────────────────────────────────

function MentorSelect({ value, onChange, mentors, placeholder = "Not assigned" }: {
  value: string;
  onChange: (v: string) => void;
  mentors: MentorOption[];
  placeholder?: string;
}) {
  return (
    <select
      style={{ width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {mentors.map(m => (
        <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
      ))}
    </select>
  );
}


