import { useEffect, useMemo, useRef, useState } from "react";
import { hasSupabaseConfig, supabase } from "./supabaseClient";

const CATEGORIES = [
  { id: "tob",      name: "الطوب",        icon: "🧱", subcategories: ["طوب أحمر","أسمنت","رمل","أكل عمال","مصاريف نقل"] },
  { id: "soba",     name: "الصبة",        icon: "🏗️", subcategories: ["حديد تسليح","أسمنت","رمل","حصى","شدة خشب","أكل عمال","إيجار معدات"] },
  { id: "kahrabaa", name: "الكهرباء",     icon: "⚡", subcategories: ["أسلاك","لوحة كهرباء","مفاتيح وبرايز","إنارة","أجرة كهربائي","توصيلات"] },
  { id: "mohara",   name: "المحارة",      icon: "🪣", subcategories: ["أسمنت","رمل","جبس","أكل عمال","أدوات"] },
  { id: "sba7a",    name: "السباكة",      icon: "🔧", subcategories: ["مواسير","خلاطات وحنفيات","أحواض","أدوات سباكة","أجرة سباك"] },
  { id: "blat",     name: "البلاط",       icon: "🟫", subcategories: ["بلاط أرضي","بلاط حوائط","لاصق بلاط","فاصل بلاط","أكل عمال"] },
  { id: "naggara",  name: "النجارة",      icon: "🚪", subcategories: ["أبواب","شبابيك","خشب","أقفال وإكسسوار","أجرة نجار"] },
  { id: "dahan",    name: "الدهان",       icon: "🎨", subcategories: ["دهان جدران","بلاستيك أبيض","فرشات وأدوات","أجرة نقاش"] },
  { id: "other",    name: "مصاريف أخرى", icon: "📦", subcategories: ["مصاريف عامة","نقل وتوصيل","أدوات متنوعة","طوارئ"] },
];

const SRC = {
  investment: { label: "من الاستثمار", color: "#D4A843", bg: "#2A2208" },
  personal:   { label: "من الشخصي",    color: "#5B8DEF", bg: "#0D1A35" },
};

const SOURCE_IDS = Object.keys(SRC);

const fmt = (n) =>
  new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n || 0);

function today() { return new Date().toISOString().slice(0, 10); }

const KEY = "construct_v3";
const EMPTY_STATE = { entries: {}, repayLogs: [], cashWithdrawals: [] };

const cleanAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeState = (raw) => ({
  entries: raw?.entries && typeof raw.entries === "object" ? raw.entries : {},
  repayLogs: Array.isArray(raw?.repayLogs) ? raw.repayLogs : [],
  cashWithdrawals: Array.isArray(raw?.cashWithdrawals)
    ? raw.cashWithdrawals
        .filter(w => SOURCE_IDS.includes(w?.source))
        .map((w, idx) => ({
          id: w.id ?? `${w.source}-${w.date || "no-date"}-${idx}`,
          date: w.date || today(),
          source: w.source,
          amount: cleanAmount(w.amount),
          note: w.note || "",
        }))
        .filter(w => w.amount > 0)
    : [],
});

const hasMeaningfulData = (s) => {
  const ns = normalizeState(s);
  const entryCount = Object.values(ns.entries).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  return entryCount > 0 || ns.repayLogs.length > 0 || ns.cashWithdrawals.length > 0;
};

const load = () => {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || "{}");
    return normalizeState(r);
  } catch { return { ...EMPTY_STATE }; }
};
const save = (s) => localStorage.setItem(KEY, JSON.stringify(normalizeState(s)));

async function loadCloudState(userId) {
  const { data, error } = await supabase
    .from("user_app_state")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.state ? normalizeState(data.state) : null;
}

async function saveCloudState(userId, state) {
  const { error } = await supabase
    .from("user_app_state")
    .upsert({
      user_id: userId,
      state: normalizeState(state),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (error) throw error;
}


function applyRepayment(entries, amount) {
  const personal = [];
  CATEGORIES.forEach(({ id }) => {
    (entries[id] || []).forEach((e, idx) => {
      if (e.source === "personal") personal.push({ catId: id, idx, amount: e.amount });
    });
  });
  personal.sort((a, b) => b.amount - a.amount);
  let remaining = amount;
  const newEntries = {};
  CATEGORIES.forEach(({ id }) => { newEntries[id] = (entries[id] || []).map(e => ({ ...e })); });
  for (const p of personal) {
    if (remaining <= 0) break;
    const entry = newEntries[p.catId][p.idx];
    if (!entry || entry.source !== "personal") continue;
    if (entry.amount <= remaining) {
      remaining -= entry.amount;
      entry.source = "investment";
      entry.note = (entry.note ? entry.note + " · " : "") + "محوّل من شخصي";
    } else {
      const convertAmt = remaining;
      remaining = 0;
      entry.amount -= convertAmt;
      newEntries[p.catId].push({
        id: Date.now() + Math.random(),
        date: entry.date,
        subcategory: entry.subcategory,
        amount: convertAmt,
        source: "investment",
        note: (entry.note ? entry.note + " · " : "") + "محوّل من شخصي",
      });
    }
  }
  return { newEntries, converted: amount - remaining };
}

function sortCashWithdrawals(items) {
  return [...items].sort((a, b) => {
    const byDate = (b.date || "").localeCompare(a.date || "");
    if (byDate) return byDate;
    return String(b.id).localeCompare(String(a.id));
  });
}

function getCashStatus(entries, cashWithdrawals) {
  return SOURCE_IDS.reduce((acc, source) => {
    const withdrawals = sortCashWithdrawals((cashWithdrawals || []).filter(w => w.source === source));
    const last = withdrawals[0] || null;
    const spent = last
      ? CATEGORIES.reduce((sum, { id }) => (
          sum + (entries[id] || []).reduce((entrySum, e) => {
            if (e.source !== source) return entrySum;
            if ((e.date || "") < last.date) return entrySum;
            return entrySum + cleanAmount(e.amount);
          }, 0)
        ), 0)
      : 0;

    acc[source] = {
      last,
      withdrawals,
      spent,
      remaining: last ? cleanAmount(last.amount) - spent : 0,
    };
    return acc;
  }, {});
}

const emptyForm = () => ({ subcategory: "", customSub: "", amount: "", source: "investment", note: "", date: today() });
const emptyCashForm = () => ({ source: "investment", amount: "", note: "", date: today() });

export default function App() {
  const [state, setState] = useState(load);
  const [view, setView]   = useState("home");
  const [form, setForm]   = useState(emptyForm());
  const [editId, setEditId]   = useState(null); // id of entry being edited
  const [repayForm, setRepayForm] = useState({ amount: "", note: "", date: today() });
  const [repayPreview, setRepayPreview] = useState(null);
  const [cashForm, setCashForm] = useState(emptyCashForm());
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(hasSupabaseConfig);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(hasSupabaseConfig ? "غير متصل" : "وضع محلي فقط");
  const [cloudError, setCloudError] = useState("");
  const importRef = useRef();
  const cloudReadyRef = useRef(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || !user) {
      cloudReadyRef.current = false;
      return;
    }

    let cancelled = false;
    async function hydrateFromCloud() {
      setCloudLoading(true);
      setCloudError("");
      setCloudStatus("جاري تحميل البيانات من Supabase...");
      try {
        const localState = load();
        const cloudState = await loadCloudState(user.id);
        let nextState = cloudState ?? localState;

        if (!cloudState) {
          await saveCloudState(user.id, nextState);
        } else if (!hasMeaningfulData(cloudState) && hasMeaningfulData(localState)) {
          nextState = localState;
          await saveCloudState(user.id, localState);
        }

        if (!cancelled) {
          const normalized = normalizeState(nextState);
          setState(normalized);
          save(normalized);
          cloudReadyRef.current = true;
          setCloudStatus("متزامن مع Supabase");
        }
      } catch (error) {
        if (!cancelled) {
          cloudReadyRef.current = false;
          setCloudError(error.message || "حدث خطأ أثناء الاتصال بـ Supabase");
          setCloudStatus("فشل الاتصال — البيانات محفوظة محليًا فقط الآن");
        }
      } finally {
        if (!cancelled) setCloudLoading(false);
      }
    }

    hydrateFromCloud();
    return () => { cancelled = true; };
  }, [user?.id]);

  const persist = (ns) => {
    const normalized = normalizeState(ns);
    setState(normalized);
    save(normalized);

    if (hasSupabaseConfig && supabase && user && cloudReadyRef.current) {
      setCloudStatus("جاري الحفظ...");
      setCloudError("");
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await saveCloudState(user.id, normalized);
          setCloudStatus("متزامن مع Supabase");
        } catch (error) {
          setCloudError(error.message || "حدث خطأ أثناء الحفظ");
          setCloudStatus("لم يتم الحفظ على السحابة — البيانات محفوظة محليًا");
        }
      }, 350);
    }
  };

  const totals = useMemo(() => {
    const t = {};
    CATEGORIES.forEach(({ id }) => {
      const es = state.entries[id] || [];
      t[id] = {
        total:      es.reduce((s, e) => s + e.amount, 0),
        investment: es.filter(e => e.source === "investment").reduce((s, e) => s + e.amount, 0),
        personal:   es.filter(e => e.source === "personal").reduce((s, e) => s + e.amount, 0),
      };
    });
    return t;
  }, [state.entries]);

  const grand = useMemo(() => ({
    total:      Object.values(totals).reduce((s, t) => s + t.total, 0),
    investment: Object.values(totals).reduce((s, t) => s + t.investment, 0),
    personal:   Object.values(totals).reduce((s, t) => s + t.personal, 0),
  }), [totals]);

  const cashStatus = useMemo(
    () => getCashStatus(state.entries, state.cashWithdrawals),
    [state.entries, state.cashWithdrawals]
  );

  // routing
  const page     = view.startsWith("cat:") ? "cat" : view.startsWith("add:") ? "add" : view;
  const curCatId = (view.startsWith("cat:") || view.startsWith("add:")) ? view.slice(4) : null;
  const curCat   = CATEGORIES.find(c => c.id === curCatId);
  const goBack   = () => page === "add" ? setView(`cat:${curCatId}`) : setView("home");

  // ---- entry handlers ----
  const openAdd = (catId) => {
    setEditId(null);
    setForm({ ...emptyForm(), subcategory: CATEGORIES.find(c => c.id === catId).subcategories[0] });
    setView(`add:${catId}`);
  };

  const openEdit = (catId, entry) => {
    setEditId(entry.id);
    const isKnown = CATEGORIES.find(c => c.id === catId)?.subcategories.includes(entry.subcategory);
    setForm({
      subcategory: isKnown ? entry.subcategory : "__custom__",
      customSub:   isKnown ? "" : entry.subcategory,
      amount:      String(entry.amount),
      source:      entry.source,
      note:        entry.note || "",
      date:        entry.date,
    });
    setView(`add:${catId}`);
  };

  const saveEntry = (catId) => {
    const sub = form.subcategory === "__custom__" ? (form.customSub.trim() || "أخرى") : form.subcategory;
    if (!sub || !form.amount || isNaN(+form.amount)) return;
    let catEntries = state.entries[catId] || [];
    if (editId) {
      catEntries = catEntries.map(e => e.id === editId
        ? { ...e, subcategory: sub, amount: +form.amount, source: form.source, note: form.note, date: form.date }
        : e
      );
    } else {
      catEntries = [...catEntries, { id: Date.now(), date: form.date, subcategory: sub, amount: +form.amount, source: form.source, note: form.note }];
    }
    persist({ ...state, entries: { ...state.entries, [catId]: catEntries } });
    setEditId(null);
    setForm(emptyForm());
    setView(`cat:${catId}`);
  };

  const deleteEntry = (catId, id) => {
    persist({ ...state, entries: { ...state.entries, [catId]: state.entries[catId].filter(e => e.id !== id) } });
  };

  // ---- repayment ----
  const previewRepay = () => {
    const amt = parseFloat(repayForm.amount);
    if (!amt || isNaN(amt)) return;
    const { newEntries, converted } = applyRepayment(state.entries, amt);
    const np = CATEGORIES.reduce((s, { id }) => s + (newEntries[id] || []).filter(e => e.source === "personal").reduce((a, e) => a + e.amount, 0), 0);
    const ni = CATEGORIES.reduce((s, { id }) => s + (newEntries[id] || []).filter(e => e.source === "investment").reduce((a, e) => a + e.amount, 0), 0);
    setRepayPreview({ converted, newPersonal: np, newInvestment: ni, newEntries });
  };

  const confirmRepay = () => {
    if (!repayPreview) return;
    const log = { id: Date.now(), date: repayForm.date, amount: repayPreview.converted, note: repayForm.note };
    persist({ ...state, entries: repayPreview.newEntries, repayLogs: [...state.repayLogs, log] });
    setRepayForm({ amount: "", note: "", date: today() });
    setRepayPreview(null);
  };

  // ---- cash withdrawals ----
  const saveCashWithdrawal = () => {
    const amount = parseFloat(cashForm.amount);
    if (!amount || isNaN(amount) || amount <= 0) return;

    const withdrawal = {
      id: Date.now(),
      date: cashForm.date || today(),
      source: cashForm.source,
      amount,
      note: cashForm.note.trim(),
    };

    persist({ ...state, cashWithdrawals: [...state.cashWithdrawals, withdrawal] });
    setCashForm(f => ({ ...emptyCashForm(), source: f.source }));
  };

  const deleteCashWithdrawal = (id) => {
    if (!window.confirm("متأكد إنك عايز تحذف سحبة الكاش دي؟")) return;
    persist({ ...state, cashWithdrawals: state.cashWithdrawals.filter(w => w.id !== id) });
  };

  // ---- export / import ----
  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `بناء-${today()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed.entries) { persist(parsed); alert("✓ تم الاستيراد بنجاح"); }
        else alert("الملف غير صحيح");
      } catch { alert("خطأ في قراءة الملف"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    cloudReadyRef.current = false;
    setCloudStatus("غير متصل");
  };

  if (hasSupabaseConfig && authLoading) {
    return <FullPageMessage title="جاري التحقق من تسجيل الدخول..." subtitle="لحظات ويتم فتح التطبيق." />;
  }

  if (hasSupabaseConfig && !user) {
    return <AuthScreen />;
  }

  if (hasSupabaseConfig && cloudLoading) {
    return <FullPageMessage title="جاري تحميل بياناتك..." subtitle="نقوم بمزامنة مصاريف البناء من Supabase." />;
  }

  // ===================================================
  return (
    <div style={{ minHeight: "100vh", background: "#111418", color: "#E8E2D8", fontFamily: "'Segoe UI', Tahoma, sans-serif", direction: "rtl" }}>

      {/* HEADER */}
      <div style={{ background: "#1A1D22", borderBottom: "1px solid #2A2D35", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 100 }}>
        {view !== "home" && (
          <button onClick={goBack} style={{ background: "none", border: "none", color: "#D4A843", fontSize: 22, cursor: "pointer", padding: "0 4px" }}>‹</button>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>
            {view === "home"       ? "🏠 مشروع البناء" :
             view === "summary"    ? "📊 الملخص الكامل" :
             view === "cash"       ? "💵 متابعة الكاش" :
             view === "repayments" ? "💰 تحويل الشخصي لاستثمار" :
             view === "settings"   ? "⚙️ البيانات والنسخ الاحتياطي" :
             page === "cat"        ? `${curCat?.icon} ${curCat?.name}` :
             editId                ? `تعديل مصروف — ${curCat?.name}` :
                                     `إضافة مصروف — ${curCat?.name}`}
          </div>
          {view === "home" && <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>إجمالي: {fmt(grand.total)}</div>}
          {hasSupabaseConfig && user && <div style={{ fontSize: 11, color: cloudError ? "#EF5B5B" : "#5BEF8D", marginTop: 2 }}>{cloudStatus}</div>}
        </div>
        {view === "home" && (
          <div style={{ display: "flex", gap: 8 }}>
            {grand.personal > 0 && (
              <button onClick={() => setView("repayments")}
                style={{ background: "#0D1A35", color: "#5B8DEF", border: "1px solid #5B8DEF44", borderRadius: 8, padding: "6px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>💰</button>
            )}
            <button onClick={() => setView("settings")}
              style={{ background: "#1A1D22", color: "#888", border: "1px solid #2A2D35", borderRadius: 8, padding: "6px 10px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>⚙️</button>
            {hasSupabaseConfig && (
              <button onClick={signOut}
                style={{ background: "#1A1D22", color: "#EF5B5B", border: "1px solid #5B1A1A", borderRadius: 8, padding: "6px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>خروج</button>
            )}
            <button onClick={() => setView("cash")}
              style={{ background: "#0F1A0F", color: "#5BEF8D", border: "1px solid #2A5A2A", borderRadius: 8, padding: "6px 10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>كاش</button>
            <button onClick={() => setView("summary")}
              style={{ background: "#D4A843", color: "#111", border: "none", borderRadius: 8, padding: "6px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>ملخص</button>
          </div>
        )}
      </div>

      {/* ===== HOME ===== */}
      {view === "home" && (
        <div style={{ padding: 16 }}>
          <div style={{ background: "#1A1D22", borderRadius: 14, padding: 18, marginBottom: 14, border: "1px solid #2A2D35" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ color: "#888", fontSize: 13 }}>إجمالي المشروع</span>
              <span style={{ fontWeight: 800, fontSize: 20 }}>{fmt(grand.total)}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <Tag color="#D4A843" label="استثمار" value={fmt(grand.investment)} />
              <Tag color="#5B8DEF"  label="شخصي"    value={fmt(grand.personal)} />
            </div>
            {grand.total > 0 && <SBar inv={grand.investment} total={grand.total} />}
          </div>

          <CashOverview status={cashStatus} onOpen={() => setView("cash")} />

          {grand.personal > 0 && (
            <div onClick={() => setView("repayments")}
              style={{ background: "#0D1A35", borderRadius: 12, padding: "12px 16px", marginBottom: 14, border: "1px solid #5B8DEF44", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 12, color: "#5B8DEF", fontWeight: 700 }}>💰 شخصي لم يُسترد بعد</div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>اضغط لتحويله لاستثمار</div>
              </div>
              <div style={{ fontWeight: 900, fontSize: 20, color: "#5B8DEF" }}>{fmt(grand.personal)}</div>
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {CATEGORIES.map(cat => {
              const t = totals[cat.id];
              return (
                <div key={cat.id} onClick={() => setView(`cat:${cat.id}`)}
                  style={{ background: "#1A1D22", borderRadius: 12, padding: "14px 16px", border: "1px solid #2A2D35", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 22 }}>{cat.icon}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{cat.name}</div>
                        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{(state.entries[cat.id] || []).length} مصروف</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontWeight: 800, fontSize: 16, color: t.total > 0 ? "#E8E2D8" : "#444" }}>{fmt(t.total)}</div>
                      {t.total > 0 && (
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                          <span style={{ color: "#D4A843" }}>◆ {fmt(t.investment)}</span> · <span style={{ color: "#5B8DEF" }}>◆ {fmt(t.personal)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {t.total > 0 && <div style={{ marginTop: 10 }}><SBar inv={t.investment} total={t.total} /></div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== CAT DETAIL ===== */}
      {page === "cat" && curCat && (
        <div style={{ padding: 16 }}>
          <div style={{ background: "#1A1D22", borderRadius: 14, padding: 16, marginBottom: 16, border: "1px solid #2A2D35" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ color: "#888", fontSize: 13 }}>إجمالي البند</span>
              <span style={{ fontWeight: 800, fontSize: 20 }}>{fmt(totals[curCatId]?.total)}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <Tag color="#D4A843" label="استثمار" value={fmt(totals[curCatId]?.investment)} />
              <Tag color="#5B8DEF"  label="شخصي"    value={fmt(totals[curCatId]?.personal)} />
            </div>
            {(totals[curCatId]?.total || 0) > 0 && <SBar inv={totals[curCatId].investment} total={totals[curCatId].total} />}
          </div>

          <SubTotals entries={state.entries[curCatId] || []} />

          <div style={{ marginBottom: 16 }}>
            {[...(state.entries[curCatId] || [])].reverse().map(e => (
              <EntryRow key={e.id} entry={e}
                onEdit={() => openEdit(curCatId, e)}
                onDelete={() => deleteEntry(curCatId, e.id)} />
            ))}
            {!(state.entries[curCatId] || []).length && (
              <div style={{ textAlign: "center", color: "#555", padding: "40px 0" }}>لا يوجد مصاريف بعد</div>
            )}
          </div>

          <button onClick={() => openAdd(curCatId)}
            style={{ width: "100%", background: "#D4A843", color: "#111", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 16, cursor: "pointer" }}>
            + إضافة مصروف
          </button>
        </div>
      )}

      {/* ===== ADD / EDIT FORM ===== */}
      {page === "add" && curCat && (
        <div style={{ padding: 16 }}>
          <div style={{ background: "#1A1D22", borderRadius: 14, padding: 20, border: "1px solid #2A2D35" }}>
            <Field label="التاريخ">
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={iS} />
            </Field>
            <Field label="البند الفرعي">
              <select value={form.subcategory} onChange={e => setForm(f => ({ ...f, subcategory: e.target.value }))} style={iS}>
                <option value="">— اختر —</option>
                {curCat.subcategories.map(s => <option key={s} value={s}>{s}</option>)}
                <option value="__custom__">أخرى (اكتب اسمها)</option>
              </select>
            </Field>
            {form.subcategory === "__custom__" && (
              <Field label="اسم البند الفرعي">
                <input type="text" placeholder="مثلاً: إيجار رافعة..." value={form.customSub}
                  onChange={e => setForm(f => ({ ...f, customSub: e.target.value }))} style={iS} />
              </Field>
            )}
            <Field label="المبلغ (جنيه)">
              <input type="number" inputMode="numeric" placeholder="0" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                style={{ ...iS, fontSize: 20, fontWeight: 700 }} />
            </Field>
            <Field label="المصدر">
              <div style={{ display: "flex", gap: 10 }}>
                {["investment", "personal"].map(src => (
                  <button key={src} onClick={() => setForm(f => ({ ...f, source: src }))}
                    style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `2px solid ${form.source === src ? SRC[src].color : "#333"}`, background: form.source === src ? SRC[src].bg : "transparent", color: form.source === src ? SRC[src].color : "#666", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                    {SRC[src].label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="ملاحظة (اختياري)">
              <input type="text" placeholder="مثلاً: ١٠٠ كيس أسمنت..." value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={iS} />
            </Field>
            <button onClick={() => saveEntry(curCatId)}
              disabled={!form.subcategory || (form.subcategory === "__custom__" && !form.customSub.trim()) || !form.amount}
              style={{ width: "100%", background: "#D4A843", color: "#111", border: "none", borderRadius: 12, padding: 16, fontWeight: 800, fontSize: 17, cursor: "pointer", marginTop: 8, opacity: (!form.subcategory || !form.amount) ? 0.4 : 1 }}>
              {editId ? "✓ حفظ التعديل" : "حفظ المصروف"}
            </button>
          </div>
        </div>
      )}

      {/* ===== CASH WITHDRAWALS ===== */}
      {view === "cash" && (
        <div style={{ padding: 16 }}>
          <div style={{ background: "#0F1A0F", borderRadius: 14, padding: 18, marginBottom: 16, border: "1px solid #2A5A2A" }}>
            <div style={{ fontSize: 13, color: "#5BEF8D", fontWeight: 700, marginBottom: 12 }}>💵 كاش المدة الحالية</div>
            <div style={{ fontSize: 12, color: "#9BCF9B", marginBottom: 14, lineHeight: 1.7 }}>
              آخر سحبة من كل مصدر هي بداية المدة الحالية. أي مصروف بنفس المصدر وتاريخه بعد السحبة هيتخصم تلقائيًا من الباقي.
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
              {SOURCE_IDS.map(source => (
                <CashSourceCard key={source} source={source} status={cashStatus[source]} />
              ))}
            </div>
          </div>

          <div style={{ background: "#1A1D22", borderRadius: 14, padding: 18, marginBottom: 16, border: "1px solid #2A2D35" }}>
            <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>تسجيل سحبة كاش جديدة</div>
            <Field label="المصدر">
              <div style={{ display: "flex", gap: 10 }}>
                {SOURCE_IDS.map(src => (
                  <button key={src} onClick={() => setCashForm(f => ({ ...f, source: src }))}
                    style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `2px solid ${cashForm.source === src ? SRC[src].color : "#333"}`, background: cashForm.source === src ? SRC[src].bg : "transparent", color: cashForm.source === src ? SRC[src].color : "#666", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                    {SRC[src].label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="تاريخ السحب">
              <input type="date" value={cashForm.date} onChange={e => setCashForm(f => ({ ...f, date: e.target.value }))} style={iS} />
            </Field>
            <Field label="المبلغ المسحوب كاش (جنيه)">
              <input type="number" inputMode="numeric" placeholder="0" value={cashForm.amount}
                onChange={e => setCashForm(f => ({ ...f, amount: e.target.value }))}
                style={{ ...iS, fontSize: 20, fontWeight: 700 }} />
            </Field>
            <Field label="ملاحظة (اختياري)">
              <input type="text" placeholder="مثلاً: سحب من البنك أو محفظة..." value={cashForm.note}
                onChange={e => setCashForm(f => ({ ...f, note: e.target.value }))} style={iS} />
            </Field>
            <button onClick={saveCashWithdrawal}
              disabled={!cashForm.amount || cleanAmount(cashForm.amount) <= 0}
              style={{ width: "100%", background: "#5BEF8D", color: "#111", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 16, cursor: "pointer", opacity: (!cashForm.amount || cleanAmount(cashForm.amount) <= 0) ? 0.4 : 1 }}>
              حفظ السحبة
            </button>
          </div>

          {state.cashWithdrawals.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 10, fontWeight: 600 }}>سجل سحوبات الكاش</div>
              {sortCashWithdrawals(state.cashWithdrawals).map(w => (
                <CashWithdrawalRow key={w.id} withdrawal={w} onDelete={() => deleteCashWithdrawal(w.id)} />
              ))}
            </>
          )}
        </div>
      )}

      {/* ===== REPAYMENTS ===== */}
      {view === "repayments" && (
        <div style={{ padding: 16 }}>
          <div style={{ background: "#0D1A35", borderRadius: 14, padding: 18, marginBottom: 16, border: "1px solid #5B8DEF44" }}>
            <div style={{ fontSize: 13, color: "#5B8DEF", fontWeight: 700, marginBottom: 12 }}>💰 تحويل مصاريف الشخصي → استثمار</div>
            <div style={{ fontSize: 12, color: "#778", marginBottom: 14, lineHeight: 1.7 }}>
              لما بتجيب فلوس من الاستثمار وترد على نفسك، المبلغ بيتحول من "شخصي" لـ"استثمار" في الأرقام.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, background: "#111418", borderRadius: 10, padding: "10px 12px", border: "1px solid #222" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>باقي شخصي</div>
                <div style={{ fontWeight: 800, fontSize: 18, color: grand.personal > 0 ? "#5B8DEF" : "#5BEF8D" }}>{fmt(grand.personal)}</div>
              </div>
              <div style={{ flex: 1, background: "#111418", borderRadius: 10, padding: "10px 12px", border: "1px solid #222" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>إجمالي استثمار</div>
                <div style={{ fontWeight: 800, fontSize: 18, color: "#D4A843" }}>{fmt(grand.investment)}</div>
              </div>
            </div>
          </div>

          {grand.personal > 0 && (
            <div style={{ background: "#1A1D22", borderRadius: 14, padding: 18, marginBottom: 16, border: "1px solid #2A2D35" }}>
              <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>سجّل استرداد جديد</div>
              <Field label="التاريخ">
                <input type="date" value={repayForm.date} onChange={e => setRepayForm(f => ({ ...f, date: e.target.value }))} style={iS} />
              </Field>
              <Field label="المبلغ المسترد (جنيه)">
                <input type="number" inputMode="numeric" placeholder="0" value={repayForm.amount}
                  onChange={e => { setRepayForm(f => ({ ...f, amount: e.target.value })); setRepayPreview(null); }}
                  style={{ ...iS, fontSize: 20, fontWeight: 700 }} />
              </Field>
              <Field label="ملاحظة (اختياري)">
                <input type="text" placeholder="مثلاً: بعد بيع وحدة استثمارية..." value={repayForm.note}
                  onChange={e => setRepayForm(f => ({ ...f, note: e.target.value }))} style={iS} />
              </Field>

              {repayPreview && (
                <div style={{ background: "#0F1A0F", borderRadius: 10, padding: 14, marginBottom: 14, border: "1px solid #2A5A2A" }}>
                  <div style={{ fontSize: 12, color: "#5BEF8D", fontWeight: 700, marginBottom: 10 }}>معاينة التأثير على الأرقام</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                    <span style={{ color: "#888" }}>شخصي</span>
                    <span>
                      <span style={{ color: "#5B8DEF" }}>{fmt(grand.personal)}</span>
                      <span style={{ color: "#5BEF8D", margin: "0 6px" }}>←</span>
                      <span style={{ color: "#5BEF8D", fontWeight: 700 }}>{fmt(repayPreview.newPersonal)}</span>
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#888" }}>استثمار</span>
                    <span>
                      <span style={{ color: "#D4A843" }}>{fmt(grand.investment)}</span>
                      <span style={{ color: "#5BEF8D", margin: "0 6px" }}>←</span>
                      <span style={{ color: "#5BEF8D", fontWeight: 700 }}>{fmt(repayPreview.newInvestment)}</span>
                    </span>
                  </div>
                  {repayPreview.converted < parseFloat(repayForm.amount) && (
                    <div style={{ fontSize: 11, color: "#F4A843", marginTop: 8 }}>
                      ⚠ المبلغ المتاح من الشخصي {fmt(repayPreview.converted)} فقط
                    </div>
                  )}
                </div>
              )}

              {!repayPreview ? (
                <button onClick={previewRepay} disabled={!repayForm.amount}
                  style={{ width: "100%", background: "#5B8DEF22", color: "#5B8DEF", border: "1px solid #5B8DEF55", borderRadius: 12, padding: 14, fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: !repayForm.amount ? 0.4 : 1 }}>
                  معاينة التأثير
                </button>
              ) : (
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setRepayPreview(null)}
                    style={{ flex: 1, background: "#2A2D35", color: "#888", border: "none", borderRadius: 10, padding: 12, fontWeight: 700, cursor: "pointer" }}>تعديل</button>
                  <button onClick={confirmRepay}
                    style={{ flex: 2, background: "#5B8DEF", color: "#fff", border: "none", borderRadius: 10, padding: 12, fontWeight: 800, fontSize: 15, cursor: "pointer" }}>✓ تأكيد التحويل</button>
                </div>
              )}
            </div>
          )}

          {state.repayLogs.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 10, fontWeight: 600 }}>سجل عمليات الاسترداد</div>
              {[...state.repayLogs].reverse().map(r => (
                <div key={r.id} style={{ background: "#161A1F", borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: "1px solid #222", display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 4, borderRadius: 99, alignSelf: "stretch", background: "#5BEF8D", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#5BEF8D" }}>تحويل شخصي ← استثمار</div>
                    <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{r.date}{r.note ? ` · ${r.note}` : ""}</div>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{fmt(r.amount)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ===== SETTINGS ===== */}
      {view === "settings" && (
        <div style={{ padding: 16 }}>
          <div style={{ background: "#0F1A0F", borderRadius: 14, padding: 20, marginBottom: 14, border: "1px solid #2A5A2A" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: "#5BEF8D" }}>☁️ حالة المزامنة</div>
            <div style={{ fontSize: 13, color: cloudError ? "#EF5B5B" : "#9BCF9B", marginBottom: 8, lineHeight: 1.6 }}>{cloudStatus}</div>
            {user && <div style={{ fontSize: 12, color: "#777" }}>الحساب: {user.email}</div>}
            {cloudError && <div style={{ fontSize: 11, color: "#EF5B5B", marginTop: 8 }}>{cloudError}</div>}
          </div>

          <div style={{ background: "#1A1D22", borderRadius: 14, padding: 20, marginBottom: 14, border: "1px solid #2A2D35" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>📤 تصدير البيانات</div>
            <div style={{ fontSize: 13, color: "#777", marginBottom: 14, lineHeight: 1.6 }}>
              احفظ نسخة احتياطية من كل بياناتك كملف JSON. استخدمه لو عايز تنقل البيانات أو تحتاط ضد مسح المتصفح.
            </div>
            <button onClick={exportData}
              style={{ width: "100%", background: "#D4A843", color: "#111", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 15, cursor: "pointer" }}>
              تحميل نسخة احتياطية (JSON)
            </button>
          </div>

          <div style={{ background: "#1A1D22", borderRadius: 14, padding: 20, marginBottom: 14, border: "1px solid #2A2D35" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>📥 استيراد البيانات</div>
            <div style={{ fontSize: 13, color: "#777", marginBottom: 14, lineHeight: 1.6 }}>
              استعد بيانات من نسخة احتياطية سابقة. <span style={{ color: "#EF5B5B" }}>تنبيه: هيتم استبدال البيانات الحالية.</span>
            </div>
            <input ref={importRef} type="file" accept=".json" onChange={importData} style={{ display: "none" }} />
            <button onClick={() => importRef.current.click()}
              style={{ width: "100%", background: "#2A2D35", color: "#E8E2D8", border: "1px solid #3A3D45", borderRadius: 12, padding: 14, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              استيراد من ملف JSON
            </button>
          </div>

          <div style={{ background: "#1A0D0D", borderRadius: 14, padding: 20, border: "1px solid #5B1A1A" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: "#EF5B5B" }}>🗑️ حذف كل البيانات</div>
            <div style={{ fontSize: 13, color: "#777", marginBottom: 14 }}>لا يمكن التراجع عن هذه العملية.</div>
            <button onClick={() => { if (window.confirm("متأكد؟ كل البيانات هتتمسح.")) { persist({ ...EMPTY_STATE }); setView("home"); } }}
              style={{ width: "100%", background: "#EF5B5B22", color: "#EF5B5B", border: "1px solid #EF5B5B44", borderRadius: 12, padding: 14, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              حذف كل البيانات
            </button>
          </div>
        </div>
      )}

      {/* ===== SUMMARY ===== */}
      {view === "summary" && (
        <div style={{ padding: 16 }}>
          <div style={{ background: "#1A1D22", borderRadius: 14, padding: 18, marginBottom: 14, border: "1px solid #D4A843" }}>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 6 }}>الإجمالي الكلي للمشروع</div>
            <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 12 }}>{fmt(grand.total)}</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <Tag color="#D4A843" label="من الاستثمار" value={fmt(grand.investment)} big />
              <Tag color="#5B8DEF"  label="من الشخصي"    value={fmt(grand.personal)}   big />
            </div>
            {grand.total > 0 && <SBar inv={grand.investment} total={grand.total} thick />}
          </div>
          {CATEGORIES.map(cat => {
            const t = totals[cat.id];
            if (!t.total) return null;
            return (
              <div key={cat.id} style={{ background: "#1A1D22", borderRadius: 12, padding: 16, marginBottom: 10, border: "1px solid #2A2D35" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700 }}>{cat.icon} {cat.name}</span>
                  <span style={{ fontWeight: 800 }}>{fmt(t.total)}</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <Tag color="#D4A843" label="استثمار" value={fmt(t.investment)} />
                  <Tag color="#5B8DEF"  label="شخصي"    value={fmt(t.personal)} />
                </div>
                <SBar inv={t.investment} total={t.total} />
                <SubTotals entries={state.entries[cat.id] || []} compact />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ========== COMPONENTS ==========
function SBar({ inv, total, thick }) {
  const pct = total > 0 ? (inv / total) * 100 : 0;
  return (
    <div style={{ height: thick ? 10 : 6, background: "#2A2D35", borderRadius: 99, overflow: "hidden", display: "flex" }}>
      <div style={{ width: `${pct}%`, background: "#D4A843", transition: "width .4s" }} />
      <div style={{ flex: 1, background: "#5B8DEF" }} />
    </div>
  );
}

function Tag({ color, label, value, big }) {
  return (
    <div style={{ flex: 1, background: color + "18", borderRadius: 8, padding: big ? "10px 12px" : "6px 10px", border: `1px solid ${color}30` }}>
      <div style={{ fontSize: big ? 11 : 10, color, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: big ? 16 : 13, color }}>{value}</div>
    </div>
  );
}

function CashOverview({ status, onOpen }) {
  return (
    <div onClick={onOpen}
      style={{ background: "#0F1A0F", borderRadius: 14, padding: 16, marginBottom: 14, border: "1px solid #2A5A2A", cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, color: "#5BEF8D", fontWeight: 800 }}>💵 كاش المدة الحالية</div>
          <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>اضغط لتسجيل سحبة جديدة أو مراجعة السجل</div>
        </div>
        <div style={{ color: "#5BEF8D", fontWeight: 900, fontSize: 18 }}>›</div>
      </div>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))" }}>
        {SOURCE_IDS.map(source => {
          const s = status[source];
          const color = s?.last ? (s.remaining >= 0 ? "#5BEF8D" : "#EF5B5B") : "#777";
          return (
            <div key={source} style={{ background: "#111418", borderRadius: 10, padding: "10px 12px", border: "1px solid #222" }}>
              <div style={{ fontSize: 11, color: SRC[source].color, marginBottom: 4 }}>آخر سحب {SRC[source].label}</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{s?.last ? fmt(s.last.amount) : "لم يسجل بعد"}</div>
              <div style={{ fontSize: 11, color: "#666" }}>الباقي</div>
              <div style={{ fontWeight: 900, fontSize: 17, color }}>{s?.last ? fmt(s.remaining) : "—"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CashSourceCard({ source, status }) {
  const last = status?.last;
  const remainingColor = !last ? "#777" : status.remaining >= 0 ? "#5BEF8D" : "#EF5B5B";
  return (
    <div style={{ background: "#111418", borderRadius: 12, padding: 14, border: `1px solid ${SRC[source].color}44` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ color: SRC[source].color, fontWeight: 800, fontSize: 14 }}>كاش {SRC[source].label}</div>
        <div style={{ fontSize: 11, color: "#666" }}>{last ? last.date : "لا يوجد"}</div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <MiniLine label="آخر سحبة" value={last ? fmt(last.amount) : "لم يتم التسجيل"} color={SRC[source].color} />
        <MiniLine label="مصروفات المدة" value={last ? fmt(status.spent) : "—"} color="#E8E2D8" />
        <MiniLine label={status?.remaining < 0 ? "عجز حالي" : "الباقي حاليًا"} value={last ? fmt(status.remaining) : "—"} color={remainingColor} strong />
      </div>
      {last?.note && <div style={{ fontSize: 11, color: "#777", marginTop: 10, lineHeight: 1.5 }}>{last.note}</div>}
    </div>
  );
}

function MiniLine({ label, value, color, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
      <span style={{ color: "#777" }}>{label}</span>
      <span style={{ color, fontWeight: strong ? 900 : 700 }}>{value}</span>
    </div>
  );
}

function CashWithdrawalRow({ withdrawal, onDelete }) {
  const src = SRC[withdrawal.source];
  return (
    <div style={{ background: "#161A1F", borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: "1px solid #222", display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ width: 4, borderRadius: 99, alignSelf: "stretch", background: src.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>سحب كاش {src.label}</div>
        <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
          {withdrawal.date}{withdrawal.note ? ` · ${withdrawal.note}` : ""}
        </div>
      </div>
      <div style={{ fontWeight: 800, fontSize: 15, color: src.color, flexShrink: 0 }}>{fmt(withdrawal.amount)}</div>
      <button onClick={onDelete}
        style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 18, flexShrink: 0 }}>×</button>
    </div>
  );
}

function EntryRow({ entry, onEdit, onDelete }) {
  const src = SRC[entry.source];
  return (
    <div style={{ background: "#161A1F", borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: "1px solid #222", display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ width: 4, borderRadius: 99, alignSelf: "stretch", background: src.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{entry.subcategory}</div>
        <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
          {entry.date} · <span style={{ color: src.color }}>{src.label}</span>
          {entry.note && <> · {entry.note}</>}
        </div>
      </div>
      <div style={{ fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{fmt(entry.amount)}</div>
      <button onClick={onEdit}
        style={{ background: "none", border: "1px solid #333", borderRadius: 6, color: "#888", cursor: "pointer", fontSize: 13, padding: "4px 8px", flexShrink: 0 }}>تعديل</button>
      <button onClick={onDelete}
        style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 18, flexShrink: 0 }}>×</button>
    </div>
  );
}

function SubTotals({ entries, compact }) {
  const bySub = {};
  entries.forEach(e => { bySub[e.subcategory] = (bySub[e.subcategory] || 0) + e.amount; });
  const subs = Object.entries(bySub).sort((a, b) => b[1] - a[1]);
  if (!subs.length) return null;
  return (
    <div style={{ marginBottom: compact ? 0 : 16, marginTop: compact ? 10 : 0 }}>
      {!compact && <div style={{ fontSize: 12, color: "#666", marginBottom: 8, fontWeight: 600 }}>تفاصيل حسب البند الفرعي</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {subs.map(([name, total]) => (
          <div key={name} style={{ background: "#0F1215", borderRadius: 8, padding: compact ? "4px 8px" : "6px 10px", border: "1px solid #222" }}>
            <span style={{ fontSize: 11, color: "#888" }}>{name}: </span>
            <span style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color: "#C4B98A" }}>{fmt(total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, color: "#888", marginBottom: 8, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}


function FullPageMessage({ title, subtitle }) {
  return (
    <div style={{ minHeight: "100vh", background: "#111418", color: "#E8E2D8", fontFamily: "'Segoe UI', Tahoma, sans-serif", direction: "rtl", display: "grid", placeItems: "center", padding: 20 }}>
      <div style={{ background: "#1A1D22", border: "1px solid #2A2D35", borderRadius: 16, padding: 24, width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 8 }}>{title}</div>
        <div style={{ color: "#888", fontSize: 13 }}>{subtitle}</div>
      </div>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const authCall = mode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

      const { error: authError } = await authCall;
      if (authError) throw authError;

      if (mode === "signup") {
        setMessage("تم إنشاء الحساب. لو Supabase طالب تأكيد الإيميل، افتح رسالة التأكيد أولًا.");
      }
    } catch (err) {
      setError(err.message || "حدث خطأ أثناء تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#111418", color: "#E8E2D8", fontFamily: "'Segoe UI', Tahoma, sans-serif", direction: "rtl", display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={submit} style={{ background: "#1A1D22", border: "1px solid #2A2D35", borderRadius: 16, padding: 22, width: "100%", maxWidth: 430 }}>
        <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 6 }}>🏠 مشروع البناء</div>
        <div style={{ color: "#888", fontSize: 13, lineHeight: 1.7, marginBottom: 18 }}>
          سجّل الدخول بنفس الإيميل على الموبايل واللاب عشان تظهر نفس المصاريف من Supabase.
        </div>

        <Field label="الإيميل">
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={iS} />
        </Field>
        <Field label="كلمة المرور">
          <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="6 أحرف على الأقل" style={iS} />
        </Field>

        {error && <div style={{ background: "#1A0D0D", color: "#EF5B5B", border: "1px solid #5B1A1A", borderRadius: 10, padding: 10, fontSize: 12, marginBottom: 12 }}>{error}</div>}
        {message && <div style={{ background: "#0F1A0F", color: "#5BEF8D", border: "1px solid #2A5A2A", borderRadius: 10, padding: 10, fontSize: 12, marginBottom: 12 }}>{message}</div>}

        <button type="submit" disabled={loading}
          style={{ width: "100%", background: "#D4A843", color: "#111", border: "none", borderRadius: 12, padding: 14, fontWeight: 900, fontSize: 16, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
          {loading ? "جاري التنفيذ..." : mode === "login" ? "دخول" : "إنشاء حساب"}
        </button>

        <button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMessage(""); }}
          style={{ width: "100%", background: "transparent", color: "#D4A843", border: "none", marginTop: 12, padding: 10, fontWeight: 700, cursor: "pointer" }}>
          {mode === "login" ? "أول مرة؟ إنشاء حساب" : "عندي حساب بالفعل"}
        </button>
      </form>
    </div>
  );
}

const iS = {
  width: "100%", background: "#111418", border: "1px solid #2A2D35", borderRadius: 10,
  padding: "12px 14px", color: "#E8E2D8", fontSize: 15, boxSizing: "border-box",
  outline: "none", fontFamily: "inherit", direction: "rtl"
};
