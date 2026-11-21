'use strict';

// ใส่ LIFF ID ของ Hankan Badminton (ไม่ใช่ความลับ เปิดเผยได้)
const LIFF_ID = "2010086723-ESV925IL";
const STORAGE_KEY = 'hankan-badminton-v3';
const LEGACY_KEYS = ['hankan-badminton-v2'];
const EXT = 'ext';                       // id ของ "คนนอก"
const VAT_RATE = 0.07;
const SENDABLE_CONTEXTS = ['utou', 'group', 'room', 'square_chat'];
const STEP_TITLES = { 1: 'ใครมาบ้าง?', 2: 'ค่าคอร์ท & ลูกแบด', 3: 'หิวต่อไหม? 🍜', 4: 'เรียบร้อย! ใครโอนให้ใคร' };
const SCREEN_ORDER = ['home', '1', '2', '3', '4', 'done'];
const HOUR_PRESETS = [1, 1.5, 2, 3];
const BANKS = [
    ['กสิกรไทย', '#138F2D'], ['ไทยพาณิชย์', '#4E2A84'], ['กรุงเทพ', '#1E4598'], ['กรุงไทย', '#1BA5E1'],
    ['กรุงศรี', '#FEC43B'], ['ทีทีบี', '#0050F0'], ['ออมสิน', '#EB198D'], ['อื่นๆ', '#94A3B8']
];

let state = defaultState();
let uidCounter = 0;
let liffReady = false;
let currentScreen = 'home';
let navDepth = 0;
let openPersonRows = new Set();
let sheetOnClose = null;

/* =========================================================
 * State
 * ======================================================= */
function defaultState() {
    return {
        court:   { price: 180, hours: 2, count: 1, payer: '' },
        shuttle: { tubePrice: '', perTube: 12, used: 0, split: 'hours', payers: [] },
        food:    { items: [], servicePct: '', vat: false, discount: '', payer: '' },
        players: [],
        external: { name: '', acc: emptyAcc() },
        roster: [],
        roundUp: true,
        sent: false,
        updatedAt: Date.now()
    };
}

function emptyAcc() { return { type: 'promptpay', bank: '', number: '' }; }

function newId(prefix) {
    uidCounter++;
    return `${prefix}${Date.now().toString(36)}${uidCounter}${Math.random().toString(36).slice(2, 6)}`;
}

function normAcc(a) {
    return {
        type: a && a.type === 'bank' ? 'bank' : 'promptpay',
        bank: String((a && a.bank) || ''),
        number: String((a && a.number) || '')
    };
}

function normPlayer(p) {
    return {
        id: String((p && p.id) || newId('p')),
        rid: p && p.rid ? String(p.rid) : '',
        name: String((p && p.name) || ''),
        hours: p && p.hours != null && p.hours !== '' ? num(p.hours) : 2,
        acc: normAcc(p && p.acc)
    };
}

function normRoster(r) {
    return { id: String((r && r.id) || newId('r')), name: String((r && r.name) || ''), acc: normAcc(r && r.acc) };
}

function normItem(it) {
    return {
        id: String((it && it.id) || newId('f')),
        name: String((it && it.name) || ''),
        price: it && it.price != null ? it.price : '',
        qty: it && it.qty != null && it.qty !== '' ? it.qty : 1,
        all: !it || it.all !== false,
        eaters: Array.isArray(it && it.eaters) ? it.eaters.map(String) : []
    };
}

function loadState() {
    try {
        let raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) for (const k of LEGACY_KEYS) { raw = localStorage.getItem(k); if (raw) break; }
        if (!raw) return null;
        const s = JSON.parse(raw);
        const d = defaultState();
        const st = {
            court:   { ...d.court, ...(s.court || {}) },
            shuttle: { ...d.shuttle, ...(s.shuttle || {}) },
            food: {
                ...d.food, ...(s.food || {}),
                items: Array.isArray(s.food && s.food.items) ? s.food.items.map(normItem) : []
            },
            players: Array.isArray(s.players) ? s.players.map(normPlayer).filter(p => p.name.trim()) : [],
            external: { name: String((s.external && s.external.name) || ''), acc: normAcc(s.external && s.external.acc) },
            roster: Array.isArray(s.roster) ? s.roster.map(normRoster).filter(r => r.name.trim()) : [],
            roundUp: s.roundUp !== false,
            sent: !!s.sent,
            updatedAt: Number(s.updatedAt) || Date.now()
        };
        // ย้ายจากเวอร์ชันเก่า: คนซื้อลูกคนเดียว → รายชื่อคนซื้อ (หลายคนได้)
        const oldSh = s.shuttle || {};
        if (!Array.isArray(oldSh.payers)) st.shuttle.payers = oldSh.payer ? [String(oldSh.payer)] : [];
        st.shuttle.payers = st.shuttle.payers.map(String);
        delete st.shuttle.payer;
        // ย้ายจากเวอร์ชันเก่า: สร้างก๊วนประจำจากรายชื่อเดิม
        if (!Array.isArray(s.roster)) st.players.forEach(p => syncRoster(p, st));
        return st;
    } catch (e) {
        console.warn('โหลดข้อมูลที่บันทึกไว้ไม่ได้', e);
        return null;
    }
}

function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode ฯลฯ */ }
}

function touch() {
    state.updatedAt = Date.now();
    state.sent = false;
    saveState();
}

function getPath(path) { return path.split('.').reduce((o, k) => o[k], state); }
function setPath(path, val) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], state)[last] = val;
}

/** อัปเดตก๊วนประจำให้ตรงกับข้อมูลของคนในบิล */
function syncRoster(p, st = state) {
    let r = st.roster.find(x => x.id === p.rid)
        || st.roster.find(x => x.name.trim() === p.name.trim());
    if (!r) {
        r = normRoster({ name: p.name });
        st.roster.push(r);
    }
    p.rid = r.id;
    r.name = p.name;
    if (!isBlank(p.acc.number) || isBlank(r.acc.number)) r.acc = { ...p.acc };
    if (st.roster.length > 40) st.roster.splice(0, st.roster.length - 40);
}

/* =========================================================
 * Helpers
 * ======================================================= */
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') e.style.cssText = v;
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k in e && !k.includes('-')) e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c != null && c !== false) e.append(c);
    return e;
}
const icon = (name, cls = '') => el('span', { class: `ms ${cls}`.trim(), 'aria-hidden': 'true', text: name });

function num(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
}
const isBlank = (v) => v == null || String(v).trim() === '';
const toSatang = (baht) => Math.round(baht * 100);
const digits = (s) => String(s || '').replace(/\D/g, '');

function fmt(satang) {
    return (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtShort(satang) {
    return (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
const baht = (satang) => `${fmt(satang)} บ.`;
const fmtHours = (h) => `${Number.isInteger(h) ? h.toFixed(1) : h} ชม.`;

function extName() { return state.external.name.trim() || 'คนนอก'; }

function nameOf(id) {
    if (id === EXT) return extName();
    const p = state.players.find(x => x.id === id);
    return p ? p.name.trim() || '?' : '?';
}

function accOf(id) {
    if (id === EXT) return state.external.acc;
    const p = state.players.find(x => x.id === id);
    return p ? p.acc : null;
}

/** คืนเลขพร้อมเพย์ที่ถูกต้อง (เบอร์ 10 หลัก / บัตร ปชช. 13 หลัก / e-Wallet 15 หลัก) หรือ null */
function validPromptpay(number) {
    const d = digits(number);
    if (d.length === 10 && d.startsWith('0')) return d;
    if (d.length === 13 || d.length === 15) return d;
    return null;
}
function promptpayId(acc) {
    if (!acc || acc.type !== 'promptpay') return null;
    return validPromptpay(acc.number);
}

function prettyPromptpay(n) {
    const d = digits(n);
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 13) return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
    return String(n || '').trim();
}

function accText(acc) {
    if (!acc || isBlank(acc.number)) return 'ยังไม่ได้ระบุบัญชี';
    if (acc.type === 'bank') return `${acc.bank.trim() || 'ธนาคาร'} ${acc.number.trim()}`;
    return `พร้อมเพย์ ${prettyPromptpay(acc.number)}`;
}

function hasAcc(acc) { return !!acc && !isBlank(acc.number); }

/** ตัวอักษรแรกของชื่อ (ข้ามสระหน้า เ แ โ ใ ไ) */
function initialOf(name) {
    const chars = Array.from(String(name || '').trim());
    const c = chars.find(ch => !'เแโใไ'.includes(ch)) || chars[0] || '?';
    return c.toUpperCase();
}
function avatarClass(name) {
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return `av-${h % 8}`;
}
function avatar(name, size = '', isExt = false) {
    return el('span', {
        class: `avatar ${size} ${isExt ? 'ext' : avatarClass(name)}`.trim(),
        role: 'img', 'aria-label': name
    }, isExt ? [icon('person')] : [initialOf(name)]);
}
function avatarOf(id, size = '') {
    return id === EXT ? avatar(extName(), size, true) : avatar(nameOf(id), size);
}

/** แบ่งเงิน (สตางค์) ตามน้ำหนัก แบบ largest remainder ให้ผลรวมตรงเป๊ะ */
function allocate(total, weights) {
    const out = {};
    const sumW = weights.reduce((s, [, w]) => s + w, 0);
    if (total <= 0 || sumW <= 0) return out;
    let assigned = 0;
    const rems = [];
    weights.forEach(([id, w]) => {
        const exact = total * w / sumW;
        const fl = Math.floor(exact);
        out[id] = (out[id] || 0) + fl;
        assigned += fl;
        rems.push([id, exact - fl]);
    });
    rems.sort((a, b) => b[1] - a[1]);
    for (let left = total - assigned, i = 0; left > 0; left--, i = (i + 1) % rems.length) {
        out[rems[i][0]] += 1;
    }
    return out;
}

/** หักลบหนี้: จับคู่คนที่ติดลบมากสุดกับคนที่ได้คืนมากสุด → จำนวนรายการโอนน้อย */
function settle(nets) {
    const cred = Object.entries(nets).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
    const debt = Object.entries(nets).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
        const amt = Math.min(debt[i].v, cred[j].v);
        if (amt > 0) transfers.push({ from: debt[i].id, to: cred[j].id, amount: amt });
        debt[i].v -= amt;
        cred[j].v -= amt;
        if (debt[i].v === 0) i++;
        if (cred[j].v === 0) j++;
    }
    return transfers;
}

function payAmount(satang) {
    return state.roundUp ? Math.ceil(satang / 100) * 100 : satang;
}

function itemQty(it) { return isBlank(it.qty) ? 1 : num(it.qty); }
function foodItemAmount(it) { return toSatang(num(it.price) * itemQty(it)); }

function foodEaters(it) {
    const ids = state.players.map(p => p.id);
    return it.all ? ids : it.eaters.filter(id => ids.includes(id));
}

function foodTotals() {
    const sub = state.food.items.reduce((s, it) => s + foodItemAmount(it), 0);
    const svc = Math.round(sub * num(state.food.servicePct) / 100);
    const vat = state.food.vat ? Math.round((sub + svc) * VAT_RATE) : 0;
    const disc = toSatang(num(state.food.discount));
    return { sub, svc, vat, disc, total: sub + svc + vat - disc };
}

function courtCount() { return isBlank(state.court.count) ? 1 : num(state.court.count); }
function courtTotal() { return toSatang(num(state.court.price) * num(state.court.hours) * courtCount()); }
function shuttleUnit() { const per = num(state.shuttle.perTube); return per > 0 ? toSatang(num(state.shuttle.tubePrice) / per) : 0; }
function shuttleTotal() {
    const per = num(state.shuttle.perTube);
    return per > 0 ? toSatang(num(state.shuttle.tubePrice) / per * num(state.shuttle.used)) : 0;
}
function quickTotal() { return courtTotal() + shuttleTotal() + Math.max(foodTotals().total, 0); }
function totalHours() { return state.players.reduce((s, p) => s + Math.max(num(p.hours), 0), 0); }

/* =========================================================
 * Validation & calculation
 * ======================================================= */
const validPayer = (id) => id === EXT || state.players.some(p => p.id === id);
/** คนที่ช่วยกันซื้อลูก (หารค่าลูกกันเท่าๆ กัน) */
function shuttleBuyers() { return (state.shuttle.payers || []).filter(validPayer); }
function namesText(ids) {
    const names = ids.map(nameOf);
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} และอีก ${names.length - 2} คน`;
}

/** ข้อผิดพลาดของแต่ละขั้น (ใช้กับปุ่ม "ต่อไป") */
function stepErrors(step) {
    const errs = [];
    const players = state.players;
    if (step === 1 || step === 'all') {
        if (players.length === 0) errs.push({ text: 'เพิ่มคนอย่างน้อย 1 คนก่อนนะ', step: 1 });
    }
    if (step === 2 || step === 'all') {
        [[state.court.price, 'ค่าคอร์ท'], [state.court.hours, 'ชั่วโมงที่จอง'], [state.court.count, 'จำนวนคอร์ท'],
         [state.shuttle.tubePrice, 'ราคาลูกแบด'], [state.shuttle.perTube, 'ลูกต่อหลอด'], [state.shuttle.used, 'จำนวนลูกที่ใช้']]
            .forEach(([v, label]) => { if (num(v) < 0) errs.push({ text: `${label}ต้องไม่ติดลบ`, step: 2 }); });
        const playing = players.filter(p => num(p.hours) > 0);
        if (courtTotal() > 0) {
            if (!validPayer(state.court.payer)) errs.push({ text: 'เลือกคนจ่ายค่าคอร์ทก่อนนะ', step: 2 });
            if (playing.length === 0) errs.push({ text: 'ยังไม่มีใครมีชั่วโมงเล่นเลย', step: 1 });
        }
        if (num(state.shuttle.used) > 0 && num(state.shuttle.perTube) <= 0) errs.push({ text: 'ใส่จำนวนลูกต่อหลอดให้มากกว่า 0', step: 2 });
        if (shuttleTotal() > 0) {
            if (shuttleBuyers().length === 0) errs.push({ text: 'เลือกคนซื้อลูกก่อนนะ (เลือกได้หลายคน)', step: 2 });
            if (playing.length === 0 && courtTotal() <= 0) errs.push({ text: 'ยังไม่มีใครมีชั่วโมงเล่นเลย', step: 1 });
        }
    }
    if (step === 3 || step === 'all') {
        const ft = foodTotals();
        state.food.items.forEach((it, i) => {
            const label = it.name.trim() || `เมนูที่ ${i + 1}`;
            if (num(it.price) < 0 || itemQty(it) < 0) errs.push({ text: `"${label}" ราคาหรือจำนวนติดลบ`, step: 3 });
            if (foodItemAmount(it) > 0 && foodEaters(it).length === 0) errs.push({ text: `"${label}" ยังไม่ได้เลือกคนกิน`, step: 3 });
        });
        if (num(state.food.servicePct) < 0 || num(state.food.discount) < 0) errs.push({ text: 'ค่าบริการ/ส่วนลดต้องไม่ติดลบ', step: 3 });
        if (ft.total < 0) errs.push({ text: 'ส่วนลดมากกว่ายอดอาหาร', step: 3 });
        if (ft.total > 0 && !validPayer(state.food.payer)) errs.push({ text: 'เลือกคนจ่ายค่าอาหารก่อนนะ', step: 3 });
    }
    if (step === 'all' && players.length > 0 && quickTotal() === 0) {
        errs.push({ text: 'ยังไม่มีค่าใช้จ่ายให้หาร ใส่ค่าคอร์ท ค่าลูก หรือค่าอาหารก่อน', step: 2 });
    }
    return errs;
}

function compute() {
    const errors = stepErrors('all');
    const warnings = [];
    const players = state.players.map(p => ({ id: p.id, name: p.name.trim() || '?', hours: num(p.hours) }));
    const ids = players.map(p => p.id);

    const seen = {};
    players.forEach(p => { seen[p.name] = (seen[p.name] || 0) + 1; });
    Object.entries(seen).filter(([, c]) => c > 1)
        .forEach(([n]) => warnings.push({ text: `มีชื่อ "${n}" ซ้ำกัน อาจสับสนตอนโอน`, step: 1 }));
    const courtHours = num(state.court.hours);
    if (courtTotal() > 0 && courtHours > 0) {
        players.forEach(p => {
            if (p.hours > courtHours) warnings.push({ text: `${p.name} เล่น ${p.hours} ชม. มากกว่าเวลาที่จอง (${courtHours} ชม.)`, step: 1 });
        });
    }
    if (num(state.shuttle.used) > 0 && num(state.shuttle.tubePrice) <= 0) warnings.push({ text: 'ใส่จำนวนลูกแล้ว แต่ยังไม่ได้ใส่ราคาลูกแบด', step: 2 });

    if (errors.length) return { errors, warnings };

    const playing = players.filter(p => p.hours > 0);
    const lines = {};
    [...ids, EXT].forEach(id => { lines[id] = { court: 0, shuttle: 0, food: 0, paid: 0 }; });

    const cT = courtTotal();
    if (cT > 0) {
        Object.entries(allocate(cT, playing.map(p => [p.id, p.hours]))).forEach(([id, v]) => { lines[id].court += v; });
        lines[state.court.payer].paid += cT;
    }
    const sT = shuttleTotal();
    if (sT > 0) {
        const w = state.shuttle.split === 'equal' ? playing.map(p => [p.id, 1]) : playing.map(p => [p.id, p.hours]);
        Object.entries(allocate(sT, w)).forEach(([id, v]) => { lines[id].shuttle += v; });
        // คนซื้อหลายคน → แต่ละคนออกเงินซื้อลูกเท่าๆ กัน
        Object.entries(allocate(sT, shuttleBuyers().map(id => [id, 1]))).forEach(([id, v]) => { lines[id].paid += v; });
    }
    const ft = foodTotals();
    if (ft.total > 0) {
        // ขั้นที่ 1: แต่ละเมนูหารเท่าระหว่างคนกิน → ยอดก่อน service/VAT/ส่วนลดของแต่ละคน
        const subShare = {};
        state.food.items.forEach(it => {
            const amt = foodItemAmount(it);
            const eaters = foodEaters(it);
            if (amt <= 0 || eaters.length === 0) return;
            Object.entries(allocate(amt, eaters.map(id => [id, 1]))).forEach(([id, v]) => {
                subShare[id] = (subShare[id] || 0) + v;
            });
        });
        // ขั้นที่ 2: กระจายยอดสุทธิ (รวม service/VAT/ส่วนลด) ตามสัดส่วนที่กิน
        Object.entries(allocate(ft.total, Object.entries(subShare))).forEach(([id, v]) => { lines[id].food += v; });
        lines[state.food.payer].paid += ft.total;
    }

    const rows = players.map(p => ({ id: p.id, name: p.name, hours: p.hours, ...lines[p.id] }));
    if (lines[EXT].paid > 0) rows.push({ id: EXT, name: extName(), isExt: true, hours: null, ...lines[EXT] });
    rows.forEach(r => { r.owed = r.court + r.shuttle + r.food; r.net = r.paid - r.owed; });

    const nets = {};
    rows.forEach(r => { if (r.net !== 0) nets[r.id] = r.net; });
    const transfers = settle(nets).map(t => ({ ...t, pay: payAmount(t.amount) }));

    [...new Set(transfers.map(t => t.to))].forEach(id => {
        const acc = accOf(id);
        if (!hasAcc(acc)) warnings.push({ text: `ยังไม่มีบัญชีรับเงินของ ${nameOf(id)}`, personId: id, kind: 'acc' });
        else if (acc.type === 'promptpay' && !promptpayId(acc)) warnings.push({ text: `เลขพร้อมเพย์ของ ${nameOf(id)} ไม่ถูกต้อง จะไม่มี QR ให้สแกน`, personId: id });
        else if (acc.type === 'bank' && digits(acc.number).length < 10) warnings.push({ text: `เลขบัญชีของ ${nameOf(id)} ดูสั้นผิดปกติ`, personId: id });
    });

    return {
        errors, warnings, rows, transfers,
        totals: { court: cT, shuttle: sT, food: Math.max(ft.total, 0), all: cT + sT + Math.max(ft.total, 0) },
        food: ft,
        payers: { court: state.court.payer, shuttle: shuttleBuyers(), food: state.food.payer }
    };
}

/* =========================================================
 * Navigation
 * ======================================================= */
function screenFromHash() {
    const h = location.hash.replace('#', '');
    return SCREEN_ORDER.includes(h) ? h : null;
}

function go(screen, { replace = false } = {}) {
    if (replace) history.replaceState({ screen }, '', `#${screen}`);
    else { history.pushState({ screen }, '', `#${screen}`); navDepth++; }
    show(screen);
}

function goBack() {
    const prev = { 1: 'home', 2: '1', 3: '2', 4: '3', done: 'home' }[currentScreen] || 'home';
    if (navDepth > 0) history.back();
    else go(prev, { replace: true });
}

function show(screen) {
    const isBack = SCREEN_ORDER.indexOf(screen) < SCREEN_ORDER.indexOf(currentScreen);
    currentScreen = screen;
    closeSheet(true);
    document.querySelectorAll('.screen').forEach(s => {
        const on = s.dataset.screen === screen;
        s.classList.toggle('active', on);
        s.classList.toggle('back', on && isBack);
    });
    const isStep = ['1', '2', '3', '4'].includes(screen);
    $('stepBar').classList.toggle('hidden', !isStep);
    $('bottomBar').classList.toggle('hidden', !isStep);
    $('bottomError').classList.add('hidden');
    if (isStep) {
        const n = Number(screen);
        $('stepTitle').textContent = STEP_TITLES[n];
        $('stepCount').textContent = `${n} / 4`;
        const prog = $('progress');
        prog.setAttribute('aria-valuenow', n);
        prog.setAttribute('aria-label', `ขั้นตอนที่ ${n} จาก 4`);
        prog.querySelectorAll('button').forEach((b, i) => b.classList.toggle('done', i < n));
    }
    renderScreen();
    window.scrollTo(0, 0);
}

function renderScreen() {
    switch (currentScreen) {
        case 'home': renderHome(); break;
        case '1': renderStep1(); break;
        case '2': renderStep2(); break;
        case '3': renderStep3(); break;
        case '4': renderStep4(); break;
        case 'done': renderDone(); break;
    }
    renderBottomBar();
}

function nextStep() {
    const n = Number(currentScreen);
    const errs = stepErrors(n);
    if (n === 2 && state.players.length === 0) errs.unshift({ text: 'ยังไม่มีคนในบิล', step: 1 });
    if (errs.length) { showBottomError(errs[0].text); return; }
    go(String(n + 1));
}

function showBottomError(text) {
    const box = $('bottomError');
    box.replaceChildren(icon('warning'), el('span', { text }));
    box.classList.remove('hidden');
    const bar = $('bottomBar');
    bar.classList.remove('shake');
    void bar.offsetWidth;
    bar.classList.add('shake');
}

function renderBottomBar() {
    const step = currentScreen;
    const label = $('bottomLabel'), value = $('bottomValue'), next = $('nextBtn');
    const isSummary = step === '4';
    next.classList.toggle('hidden', isSummary);
    $('sendLineBtn').classList.toggle('hidden', !isSummary);
    $('copyBtn').classList.toggle('hidden', !isSummary);
    document.querySelector('.bottom-info').classList.toggle('hidden', isSummary);
    $('bottomError').classList.add('hidden');
    if (step === '1') {
        label.textContent = 'สรุปผู้เล่น';
        const h = totalHours();
        value.textContent = `${state.players.length} คน · รวม ${Number.isInteger(h) ? h : h.toFixed(1)} ชม.`;
        next.textContent = 'ต่อไป →';
    } else if (step === '2') {
        label.textContent = 'ยอดรวมตอนนี้';
        value.textContent = `ค่าแบดรวม ${baht(courtTotal() + shuttleTotal())}`;
        next.textContent = 'ต่อไป →';
    } else if (step === '3') {
        const ft = foodTotals();
        label.textContent = ft.total ? 'ยอดอาหารสุทธิ' : 'ยอดรวมตอนนี้';
        value.textContent = ft.total ? `อาหารรวม ${baht(Math.max(ft.total, 0))}` : `รวม ${baht(quickTotal())}`;
        next.textContent = 'ดูสรุป →';
    } else if (isSummary) {
        updateLineButton();
    }
}

/* =========================================================
 * Home
 * ======================================================= */
function hasDraft() {
    return state.players.length > 0 && !state.sent;
}

function thaiDate(ts) {
    try { return new Date(ts).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch (e) { return ''; }
}

function renderHome() {
    const draft = hasDraft();
    $('draftBlock').classList.toggle('hidden', !draft);
    if (draft) {
        $('draftMeta').textContent = `${thaiDate(state.updatedAt)} · ${state.players.length} คน`;
        $('draftTotal').textContent = `รวม ${baht(quickTotal())}`;
        $('draftAvatars').replaceChildren(...state.players.slice(0, 3).map(p => avatar(p.name, 'sm')));
    }
    const roster = state.roster;
    $('rosterCount').textContent = roster.length ? `${roster.length} คน` : '';
    $('rosterList').parentElement.classList.toggle('hidden', roster.length === 0);
    $('homeEmpty').classList.toggle('hidden', roster.length > 0);
    $('rosterList').replaceChildren(
        ...roster.map(r => el('button', {
            type: 'button', class: 'roster-item', 'aria-label': `แก้ไข ${r.name}`,
            onclick: () => openPersonSheet({ rosterId: r.id })
        }, [avatar(r.name), el('span', { class: 'label', text: r.name })])),
        el('button', { type: 'button', class: 'roster-item roster-add', onclick: startNewBill },
            [el('span', { class: 'avatar' }, [icon('add')]), el('span', { class: 'label muted', text: 'เพิ่ม' })])
    );
}

function startNewBill() {
    if (hasDraft() && !confirm('เริ่มบิลใหม่? บิลที่ค้างอยู่จะถูกล้าง (รายชื่อก๊วนประจำและบัญชียังอยู่)')) return;
    state.players = [];
    state.food = { ...defaultState().food };
    state.shuttle.used = 0;
    state.shuttle.payers = [];
    state.court.payer = '';
    state.external = { name: '', acc: emptyAcc() };
    openPersonRows = new Set();
    touch();
    go('1');
}

/* =========================================================
 * Step 1 — players
 * ======================================================= */
function renderStep1() {
    let loggedIn = false;
    try { loggedIn = liffReady && liff.isLoggedIn(); } catch (e) { /* ignore */ }

    const chips = [];
    if (loggedIn) {
        chips.push(el('button', { type: 'button', class: 'chip chip-line', onclick: addMe }, [
            el('span', { class: 'line-dot', 'aria-hidden': 'true' }),
            'เพิ่มตัวฉันจาก LINE'
        ]));
        chips[0].firstChild.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#06C755" d="M12 3C6.48 3 2 6.58 2 11c0 2.86 1.88 5.37 4.72 6.78l-.76 2.82c-.1.37.3.67.63.47l3.38-2.03c.66.1 1.34.16 2.03.16 5.52 0 10-3.58 10-8S17.52 3 12 3z"/></svg>';
    }
    state.roster.forEach(r => {
        const inBill = state.players.some(p => p.rid === r.id);
        chips.push(el('button', {
            type: 'button', class: `chip ${inBill ? 'on' : ''}`, 'aria-pressed': String(inBill),
            onclick: () => toggleRosterInBill(r.id)
        }, [icon(inBill ? 'check' : 'add'), r.name]));
    });
    $('quickChips').replaceChildren(...chips);
    $('quickChips').classList.toggle('hidden', chips.length === 0);

    const h = num(state.court.hours) > 0 ? num(state.court.hours) : 2;
    $('setAllHoursBtn').textContent = `ตั้งทุกคน = ${h} ชม.`;
    $('setAllHoursBtn').classList.toggle('hidden', state.players.length < 2);

    $('playerCards').replaceChildren(...state.players.map(personCard));
    $('playersEmpty').classList.toggle('hidden', state.players.length > 0);
}

function personCard(p) {
    const h = num(p.hours);
    const ok = hasAcc(p.acc);
    const status = h === 0
        ? el('span', { class: 'tag-orange', text: 'กินอย่างเดียว' })
        : el('span', { class: 'person-status', text: ok ? (p.acc.type === 'bank' ? 'มีบัญชีธนาคารแล้ว' : 'มีพร้อมเพย์แล้ว') : 'ยังไม่มีบัญชีรับเงิน' });
    const valueEl = el('span', { class: `value ${h === 0 ? 'dim' : ''}`, text: fmtHours(h) });
    const step = (d) => {
        p.hours = Math.max(0, Math.min(12, num(p.hours) + d));
        touch();
        const card = personCard(p);
        cardEl.replaceWith(card);
        renderBottomBar();
    };
    const cardEl = el('article', { class: 'card person-card' }, [
        el('button', { type: 'button', class: 'person-main', 'aria-label': `แก้ไข ${p.name}`, onclick: () => openPersonSheet({ playerId: p.id }) }, [
            avatar(p.name),
            el('span', { class: 'person-text' }, [
                el('span', { class: 'person-name' }, [
                    el('span', { class: 'nm', text: p.name }),
                    icon('credit_card', ok ? 'acc-ok' : 'acc-missing'),
                    ok ? icon('check_circle', 'acc-ok fill') : null
                ]),
                status
            ])
        ]),
        el('div', { class: 'stepper' }, [
            el('button', { type: 'button', 'aria-label': `ลดชั่วโมงของ ${p.name}`, disabled: h <= 0, onclick: () => step(-0.5) }, [icon('remove')]),
            valueEl,
            el('button', { type: 'button', 'aria-label': `เพิ่มชั่วโมงของ ${p.name}`, disabled: h >= 12, onclick: () => step(0.5) }, [icon('add')])
        ])
    ]);
    return cardEl;
}

function addPlayer({ name, rid = '', acc = null }) {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return null;
    const defHours = num(state.court.hours) > 0 ? num(state.court.hours) : 2;
    const p = normPlayer({ name: clean, rid, hours: defHours, acc });
    state.players.push(p);
    syncRoster(p);
    touch();
    return p;
}

function removePlayer(id, { undo = true } = {}) {
    const idx = state.players.findIndex(p => p.id === id);
    if (idx < 0) return;
    const snapshot = JSON.stringify(state);
    const [p] = state.players.splice(idx, 1);
    state.food.items.forEach(it => { it.eaters = it.eaters.filter(x => x !== id); });
    ['court', 'food'].forEach(k => { if (state[k].payer === id) state[k].payer = ''; });
    state.shuttle.payers = (state.shuttle.payers || []).filter(x => x !== id);
    touch();
    renderScreen();
    if (undo) {
        toast(`ลบ ${p.name} แล้ว`, {
            label: 'เลิกทำ',
            fn: () => { state = JSON.parse(snapshot); saveState(); renderScreen(); }
        });
    }
}

function toggleRosterInBill(rid) {
    const p = state.players.find(x => x.rid === rid);
    if (p) { removePlayer(p.id); return; }
    const r = state.roster.find(x => x.id === rid);
    if (!r) return;
    addPlayer({ name: r.name, rid: r.id, acc: r.acc });
    renderScreen();
}

function setAllHours() {
    const h = num(state.court.hours) > 0 ? num(state.court.hours) : 2;
    state.players.forEach(p => { p.hours = h; });
    touch();
    renderScreen();
    toast(`ตั้งทุกคนเป็น ${h} ชม. แล้ว`);
}

async function addMe() {
    try {
        const profile = await liff.getProfile();
        const name = (profile.displayName || '').trim();
        if (!name) throw new Error('no name');
        if (state.players.some(p => p.name.trim() === name)) { toast(`มี "${name}" อยู่แล้ว`); return; }
        const r = state.roster.find(x => x.name.trim() === name);
        addPlayer({ name, rid: r ? r.id : '', acc: r ? r.acc : null });
        renderScreen();
    } catch (e) {
        toast('ดึงชื่อจาก LINE ไม่ได้');
    }
}

/* =========================================================
 * Step 2 — court & shuttles
 * ======================================================= */
function renderStep2() {
    syncBoundInputs($('stepBar').parentElement.querySelector('[data-screen="2"]'));
    renderHoursSeg();
    document.querySelectorAll('[data-screen="2"] [data-stepper]').forEach(renderStepper);
    document.querySelectorAll('#splitSeg button').forEach(b => b.classList.toggle('on', b.dataset.split === state.shuttle.split));
    document.querySelectorAll('[data-screen="2"] .payer-row').forEach(renderPayerRow);
    refreshStep2Live();
}

function renderHoursSeg() {
    const h = num(state.court.hours);
    const preset = HOUR_PRESETS.includes(h);
    const showOther = !preset || $('courtHoursOtherWrap').dataset.forced === '1';
    document.querySelectorAll('#courtHoursSeg button').forEach(b => {
        b.classList.toggle('on', b.dataset.hours === 'other' ? showOther : (!showOther && num(b.dataset.hours) === h));
    });
    $('courtHoursOtherWrap').classList.toggle('hidden', !showOther);
}

function refreshStep2Live() {
    const cT = courtTotal();
    $('courtBadge').textContent = baht(cT);
    $('courtFormula').textContent = cT > 0
        ? `${fmtShort(toSatang(num(state.court.price)))} × ${num(state.court.hours)} ชม. × ${courtCount()} คอร์ท = ${baht(cT)}`
        : '';
    const sT = shuttleTotal();
    $('shuttleBadge').textContent = baht(sT);
    const buyers = shuttleBuyers();
    $('shuttleBuyers').textContent = sT > 0 && buyers.length > 1
        ? `${buyers.length} คนช่วยกันซื้อ · ออกคนละ ${baht(Math.ceil(sT / buyers.length))}`
        : '';
    $('shuttleFormula').textContent = shuttleUnit() > 0
        ? `ลูกละ ${fmt(shuttleUnit())} · รวม ${baht(sT)}`
        : '';
    renderBottomBar();
}

function renderStepper(box) {
    const path = box.dataset.stepper;
    const min = num(box.dataset.min), max = num(box.dataset.max), stepBy = num(box.dataset.step) || 1;
    const input = el('input', {
        type: 'number', class: 'value', inputMode: 'numeric', min, max, step: stepBy,
        value: getPath(path), 'aria-label': box.previousElementSibling ? box.previousElementSibling.textContent : path,
        oninput: (e) => { setPath(path, e.target.value); touch(); refreshLive(); }
    });
    const bump = (d) => {
        const v = Math.max(min, Math.min(max, num(getPath(path)) + d));
        setPath(path, v);
        input.value = v;
        touch();
        refreshLive();
    };
    box.replaceChildren(
        el('button', { type: 'button', 'aria-label': 'ลด', onclick: () => bump(-stepBy) }, [icon('remove')]),
        input,
        el('button', { type: 'button', 'aria-label': 'เพิ่ม', onclick: () => bump(stepBy) }, [icon('add')])
    );
}

/** แถว avatar สำหรับเลือกคนจ่าย (แทน dropdown) */
function renderPayerRow(row) {
    const path = row.dataset.payer;
    const multi = row.dataset.multi === '1';   // เลือกได้หลายคน (เช่น หารกันซื้อลูก)
    const cur = getPath(path);
    if (multi) {
        const clean = (Array.isArray(cur) ? cur : []).filter(validPayer);
        if (!Array.isArray(cur) || clean.length !== cur.length) setPath(path, clean);
    } else if (cur && !validPayer(cur)) setPath(path, '');
    const isOn = (id) => multi ? getPath(path).includes(id) : getPath(path) === id;
    const select = (id) => {
        if (multi) {
            const set = new Set(getPath(path));
            if (set.has(id)) set.delete(id); else set.add(id);
            setPath(path, [...set]);
        } else {
            setPath(path, id);
        }
        touch();
        renderPayerRow(row);
        refreshLive();
    };
    const make = (id, name, isExt) => {
        const on = isOn(id);
        return el('button', {
            type: 'button', class: `payer ${on ? 'on' : ''}`, 'aria-pressed': String(on),
            'aria-label': `${name}${on ? ' (เลือกอยู่)' : ''}`,
            onclick: () => {
                // คนนอก: ต้องมีชื่อก่อน / ถ้าเลือกอยู่แล้วในโหมดเลือกคนเดียว แตะเพื่อแก้ไข
                if (isExt && (isBlank(state.external.name) || (on && !multi))) {
                    openExternalSheet(() => {
                        if (!isOn(EXT)) select(EXT); else { touch(); renderPayerRow(row); refreshLive(); }
                    });
                    return;
                }
                select(id);
            }
        }, [
            el('span', { class: 'avatar-wrap', style: 'position:relative' }, [
                isExt ? avatar(name, '', true) : avatar(name),
                el('span', { class: 'badge', 'aria-hidden': 'true' }, [icon('check')])
            ]),
            el('span', { class: 'label', text: name })
        ]);
    };
    row.replaceChildren(
        ...state.players.map(p => make(p.id, p.name, false)),
        make(EXT, isBlank(state.external.name) ? 'คนนอก' : state.external.name.trim(), true)
    );
    // badge ต้องอยู่ใน avatar เพื่อวางมุมขวาล่าง
    row.querySelectorAll('.avatar-wrap').forEach(w => {
        const av = w.querySelector('.avatar'); const bd = w.querySelector('.badge');
        av.append(bd);
    });
}

/* =========================================================
 * Step 3 — food
 * ======================================================= */
function renderStep3() {
    const items = state.food.items;
    $('skipFoodBtn').classList.toggle('hidden', items.length > 0);
    $('foodExtras').classList.toggle('hidden', items.length === 0);
    $('foodCards').replaceChildren(...items.map(foodCard));
    if (items.length === 0) {
        $('foodCards').append(el('div', { class: 'empty' }, [
            el('div', { class: 'empty-emoji', text: '🍜' }),
            el('p', { class: 'muted', text: 'ไปกินต่อกันไหม? เพิ่มเมนูแล้วเลือกได้ว่าใครกินอะไร' })
        ]));
    }
    syncBoundInputs(document.querySelector('[data-screen="3"]'));
    const svcOn = num(state.food.servicePct) > 0 || $('svcPctWrap').dataset.forced === '1';
    $('svcToggle').checked = svcOn;
    $('svcPctWrap').classList.toggle('hidden', !svcOn);
    document.querySelectorAll('[data-screen="3"] .payer-row').forEach(renderPayerRow);
    refreshStep3Live();
}

function eatersLabel(it) {
    const eaters = foodEaters(it);
    if (state.players.length > 0 && eaters.length === state.players.length) return 'ทุกคน';
    if (eaters.length === 0) return 'ยังไม่ได้เลือกคนกิน';
    if (eaters.length <= 2) return eaters.map(nameOf).join(', ');
    return `${eaters.length} คน`;
}

function foodCard(it) {
    const eaters = foodEaters(it);
    const amt = foodItemAmount(it);
    const noEaters = eaters.length === 0 && amt > 0;
    return el('article', { class: 'card food-card' }, [
        el('button', { type: 'button', class: 'food-top', 'aria-label': `แก้ไข ${it.name || 'เมนู'}`, onclick: () => openFoodSheet(it.id) }, [
            el('span', {}, [
                el('span', { class: 'nm', text: it.name.trim() || 'ไม่มีชื่อเมนู' }),
                el('br'),
                el('span', { class: 'sub tnum', text: `${fmtShort(toSatang(num(it.price)))} บ. × ${itemQty(it)}` })
            ]),
            el('span', { class: 'amt tnum', text: baht(amt) })
        ]),
        el('button', { type: 'button', class: `eaters-btn ${noEaters ? 'warn' : ''}`, onclick: () => openEatersSheet(it.id) }, [
            el('span', { class: 'avatar-stack' }, eaters.slice(0, 4).map(id => avatar(nameOf(id), 'sm'))),
            el('span', { class: 'grow', text: eatersLabel(it) }),
            icon('expand_more')
        ])
    ]);
}

function refreshStep3Live() {
    const ft = foodTotals();
    const rows = [
        ['รายการ', fmt(ft.sub)],
        ft.svc ? [`Service ${num(state.food.servicePct)}%`, fmt(ft.svc)] : null,
        ft.vat ? ['VAT 7%', fmt(ft.vat)] : null,
        ft.disc ? ['ส่วนลด', `−${fmt(ft.disc)}`, 'neg'] : null
    ].filter(Boolean);
    $('foodReceipt').replaceChildren(
        ...rows.map(([k, v, cls]) => el('div', { class: `receipt-row ${cls || ''}` }, [el('span', { text: k }), el('strong', { text: v })])),
        el('div', { class: 'receipt-row total' }, [el('span', { text: 'รวม' }), el('strong', { text: baht(ft.total) })])
    );
    renderBottomBar();
}

/* =========================================================
 * Step 4 — summary
 * ======================================================= */
function renderStep4() {
    const r = compute();
    const box = $('messages');
    const alerts = [];
    r.errors.forEach(e => alerts.push(alertEl('err', e.text, e.step ? { label: 'ไปแก้', fn: () => go(String(e.step)) } : null)));
    (r.warnings || []).filter(w => w.kind !== 'acc').forEach(w => {
        let action = null;
        if (w.personId) action = { label: 'แก้ไข', fn: () => openAccountFor(w.personId) };
        else if (w.step) action = { label: 'ไปแก้', fn: () => go(String(w.step)) };
        alerts.push(alertEl('warn', w.text, action));
    });
    box.replaceChildren(...alerts);
    box.classList.toggle('hidden', alerts.length === 0);

    const ok = r.errors.length === 0;
    $('summaryBody').classList.toggle('hidden', !ok);
    window.__lastResult = ok ? r : null;
    updateLineButton();
    if (!ok) return;

    const { totals, rows, transfers } = r;
    $('grandTotal').textContent = baht(totals.all);
    const parts = [['court', 'คอร์ท', totals.court], ['shuttle', 'ลูก', totals.shuttle], ['food', 'อาหาร', totals.food]].filter(x => x[2] > 0);
    $('stackBar').replaceChildren(...parts.map(([k, , v]) => el('span', { class: `c-${k}`, style: `width:${(v / totals.all * 100).toFixed(2)}%` })));
    $('legend').replaceChildren(...parts.map(([k, label, v]) => el('span', {}, [el('i', { class: `c-${k}` }), `${label} ${fmtShort(v)}`])));

    $('transferCount').textContent = transfers.length ? `${transfers.length} รายการ` : '';
    if (transfers.length === 0) {
        $('transferCards').replaceChildren(el('div', { class: 'card empty' }, [
            el('div', { class: 'empty-emoji', text: '🎉' }),
            el('strong', { text: 'เคลียร์แล้ว ไม่มีใครต้องโอน' })
        ]));
    } else {
        $('transferCards').replaceChildren(...transfers.map(transferCard));
    }

    $('personList').replaceChildren(...rows.map(personRow));
    const rounded = state.roundUp && transfers.some(t => t.pay !== t.amount);
    $('roundNote').textContent = rounded ? '* ปัดยอดโอนขึ้นเป็นบาทเต็ม ผู้รับอาจได้เกินไม่กี่สตางค์' : '';
    $('summaryText').value = buildSummaryText(r);
}

function alertEl(kind, text, action) {
    return el('div', { class: `alert ${kind}` }, [
        icon('warning'),
        el('span', { class: 'grow', text }),
        action ? el('button', { type: 'button', onclick: action.fn, text: action.label }) : null
    ]);
}

function transferCard(t) {
    const acc = accOf(t.to);
    const pp = promptpayId(acc);
    let bottom;
    if (!hasAcc(acc)) {
        bottom = el('div', { class: 'inline-warn' }, [
            icon('warning'),
            el('span', { class: 'grow', text: `ยังไม่มีบัญชีรับเงินของ ${nameOf(t.to)}` }),
            el('button', { type: 'button', text: 'เพิ่มเลย', onclick: () => openAccountFor(t.to) })
        ]);
    } else {
        bottom = el('div', { class: 'transfer-bottom' }, [
            el('span', { class: 'acc', text: accText(acc) }),
            pp ? el('button', { type: 'button', class: 'btn-qr', onclick: () => openQrSheet(t) }, [icon('qr_code_2'), 'QR']) : null
        ]);
    }
    return el('article', { class: 'card transfer' }, [
        el('div', { class: 'transfer-top' }, [
            el('div', { class: 'transfer-people' }, [
                avatarOf(t.from, 'md'), el('span', { class: 'nm', text: nameOf(t.from) }),
                icon('arrow_forward'),
                avatarOf(t.to, 'md'), el('span', { class: 'nm', text: nameOf(t.to) })
            ]),
            el('span', { class: 'transfer-amt tnum', text: `${fmtShort(t.pay)} บ.` })
        ]),
        bottom
    ]);
}

function personRow(x) {
    let badge;
    if (x.net > 0) badge = el('span', { class: 'badge-pos', text: `รับคืน ${fmt(x.net)}` });
    else if (x.net < 0) badge = el('span', { class: 'badge-neg', text: `ต้องโอน ${fmt(-x.net)}` });
    else badge = el('span', { class: 'badge-zero', text: 'เคลียร์แล้ว' });

    const details = [];
    if (x.court) details.push([`คอร์ท${x.hours != null ? ` (${fmtHours(x.hours)})` : ''}`, baht(x.court)]);
    if (x.shuttle) details.push(['ลูกแบด', baht(x.shuttle)]);
    if (x.food) details.push(['อาหาร', baht(x.food)]);
    const paid = [];
    const t = window.__lastResult && window.__lastResult.totals;
    if (state.court.payer === x.id && courtTotal()) paid.push(['สำรองจ่ายค่าคอร์ท', `−${baht(courtTotal())}`]);
    const buyers = shuttleBuyers();
    if (buyers.includes(x.id) && shuttleTotal()) {
        const share = allocate(shuttleTotal(), buyers.map(id => [id, 1]))[x.id] || 0;
        paid.push([buyers.length > 1 ? `ร่วมซื้อลูก (${buyers.length} คน)` : 'สำรองจ่ายค่าลูก', `−${baht(share)}`]);
    }
    if (state.food.payer === x.id && t && t.food) paid.push(['สำรองจ่ายค่าอาหาร', `−${baht(t.food)}`]);

    const wrap = el('div', { class: `person-row ${openPersonRows.has(x.id) ? 'open' : ''}` });
    const toggle = () => {
        wrap.classList.toggle('open');
        if (wrap.classList.contains('open')) openPersonRows.add(x.id); else openPersonRows.delete(x.id);
        btn.setAttribute('aria-expanded', String(wrap.classList.contains('open')));
    };
    const btn = el('button', { type: 'button', onclick: toggle, 'aria-expanded': String(openPersonRows.has(x.id)) }, [
        x.isExt ? avatar(x.name, '', true) : avatar(x.name),
        el('span', { class: 'grow' }, [
            el('span', { class: 'nm', text: x.isExt ? `${x.name} (คนนอก)` : x.name }),
            el('span', { class: 'muted small tnum', text: `ต้องจ่าย ${fmt(x.owed)}` })
        ]),
        badge,
        icon('expand_more', 'chev')
    ]);
    wrap.append(btn, el('div', { class: 'person-detail' }, [
        ...details.map(([k, v]) => el('div', { class: 'detail-row' }, [el('span', { text: k }), el('strong', { text: v })])),
        ...paid.map(([k, v]) => el('div', { class: 'detail-row paid' }, [el('span', { text: k }), el('strong', { text: v })]))
    ]));
    return wrap;
}

function buildSummaryText(r) {
    const { totals, rows, transfers } = r;
    const line = '----------------------';
    let s = `🏸 สรุปค่าใช้จ่าย (${thaiDate(Date.now())})\n`;
    if (totals.court) s += `ค่าคอร์ท: ${baht(totals.court)} (จ่ายโดย ${nameOf(r.payers.court)})\n`;
    if (totals.shuttle) s += `ค่าลูก: ${baht(totals.shuttle)} (ซื้อโดย ${namesText(r.payers.shuttle)})\n`;
    if (totals.food) s += `ค่าอาหาร: ${baht(totals.food)} (จ่ายโดย ${nameOf(r.payers.food)})\n`;
    s += `รวม: ${baht(totals.all)}\n${line}\n👤 ค่าใช้จ่ายรายคน\n`;
    rows.filter(x => x.owed > 0).forEach(x => { s += `- ${x.name}: ${baht(x.owed)}\n`; });
    s += `${line}\n💸 ใครโอนให้ใคร\n`;
    if (transfers.length === 0) s += 'ไม่มีใครต้องโอน 🎉\n';
    transfers.forEach(t => { s += `- ${nameOf(t.from)} → ${nameOf(t.to)}: ${baht(t.pay)}\n`; });
    const receivers = [...new Set(transfers.map(t => t.to))];
    if (receivers.length) {
        s += `${line}\n🏦 บัญชีรับเงิน\n`;
        receivers.forEach(id => { s += `- ${nameOf(id)}: ${accText(accOf(id))}\n`; });
    }
    if (state.roundUp && transfers.some(t => t.pay !== t.amount)) s += '(ยอดโอนปัดขึ้นเป็นบาทเต็ม)\n';
    return s.trim();
}

/* =========================================================
 * Done
 * ======================================================= */
function renderDone() {
    $('doneMeta').textContent = `${state.players.length} คน · รวม ${baht(quickTotal())}`;
    let inClient = false;
    try { inClient = liffReady && liff.isInClient(); } catch (e) { /* ignore */ }
    $('closeLiffBtn').classList.toggle('hidden', !inClient);
}

/* =========================================================
 * Bottom sheets
 * ======================================================= */
function openSheet({ title, sub = '', avatarNode = null, body = [], foot = [], onClose = null }) {
    $('sheetTitle').textContent = title;
    $('sheetSub').textContent = sub;
    $('sheetSub').classList.toggle('hidden', !sub);
    $('sheetAvatar').replaceChildren(...(avatarNode ? [avatarNode] : []));
    $('sheetBody').replaceChildren(...body);
    $('sheetFoot').replaceChildren(...foot);
    sheetOnClose = onClose;
    $('sheetBackdrop').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const first = $('sheetBody').querySelector('input:not([type=checkbox])');
    if (first && !first.value) setTimeout(() => first.focus(), 280);
}

function closeSheet(silent = false) {
    if ($('sheetBackdrop').classList.contains('hidden')) return;
    $('sheetBackdrop').classList.add('hidden');
    document.body.style.overflow = '';
    const cb = sheetOnClose;
    sheetOnClose = null;
    if (cb && !silent) cb();
}

/** ฟอร์มบัญชีรับเงิน ใช้ร่วมกันทุก sheet — แก้ไขบน draft แล้วค่อย save */
function accountForm(acc) {
    const errEl = el('span', { class: 'field-error hidden' });
    const help = el('span', { class: 'field-help' });
    const numInput = el('input', {
        type: 'tel', class: 'input input-lg tnum', maxLength: 30, value: acc.number, autocomplete: 'off',
        oninput: (e) => { acc.number = e.target.value; validate(false); }
    });
    const qr = el('div', { class: 'qr-preview hidden' });
    const bankGrid = el('div', { class: 'bank-grid' });
    const otherBank = el('input', {
        type: 'text', class: 'input', maxLength: 40, placeholder: 'ชื่อธนาคาร',
        value: BANKS.some(([b]) => b === acc.bank) ? '' : acc.bank,
        oninput: (e) => { acc.bank = e.target.value; }
    });
    const otherWrap = el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'ธนาคารอื่น' }), otherBank]);
    const bankSection = el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'ธนาคาร' }), bankGrid, otherWrap]);
    const label = el('span', { class: 'field-label strong' });
    const seg = el('div', { class: 'seg seg-2' }, [
        el('button', { type: 'button', text: 'พร้อมเพย์', dataset: { type: 'promptpay' } }),
        el('button', { type: 'button', text: 'บัญชีธนาคาร', dataset: { type: 'bank' } })
    ]);
    seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        acc.type = b.dataset.type;
        paint();
    });

    function paintBanks() {
        const isOther = !isBlank(acc.bank) && !BANKS.some(([b]) => b === acc.bank) || acc.bank === 'อื่นๆ';
        bankGrid.replaceChildren(...BANKS.map(([name, color]) => {
            const on = name === 'อื่นๆ' ? isOther : acc.bank === name;
            return el('button', {
                type: 'button', class: `bank-chip ${on ? 'on' : ''}`, 'aria-pressed': String(on),
                onclick: () => { acc.bank = name === 'อื่นๆ' ? (otherBank.value || 'อื่นๆ') : name; paintBanks(); }
            }, [el('span', { class: 'dot', style: `background:${color}` }), name]);
        }));
        otherWrap.classList.toggle('hidden', !isOther);
    }

    function validate(strict) {
        let error = '';
        if (acc.type === 'promptpay' && !isBlank(acc.number) && !validPromptpay(acc.number)) {
            error = 'เลขพร้อมเพย์ไม่ถูกต้อง (เบอร์ 10 หลัก หรือเลขบัตร 13 หลัก)';
        }
        const show = error && (strict || digits(acc.number).length >= 10);
        errEl.textContent = error;
        errEl.classList.toggle('hidden', !show);
        numInput.classList.toggle('invalid', !!show);
        const pp = acc.type === 'promptpay' ? validPromptpay(acc.number) : null;
        qr.classList.toggle('hidden', !pp);
        if (pp) {
            qr.replaceChildren(
                icon('qr_code_2'),
                el('span', { class: 'grow' }, [el('strong', { text: 'สร้าง QR ได้' }), el('span', { class: 'muted small', text: `พร้อมเพย์ ${prettyPromptpay(pp)}` })]),
                icon('check_circle', 'acc-ok fill')
            );
        }
        return !error;
    }

    function paint() {
        seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.type === acc.type));
        const isBank = acc.type === 'bank';
        label.textContent = isBank ? 'เลขบัญชีธนาคาร' : 'เบอร์พร้อมเพย์ / เลขบัตรประชาชน';
        numInput.placeholder = isBank ? '123-4-56789-0' : '081-234-5678';
        help.textContent = isBank ? 'ใส่ชื่อบัญชีให้ตรงกับชื่อในบิล เพื่อนจะได้โอนถูก' : 'เบอร์ 10 หลัก หรือเลขบัตร 13 หลัก · ใส่แล้วบิลจะมี QR ใส่ยอดให้อัตโนมัติ';
        bankSection.classList.toggle('hidden', !isBank);
        if (isBank) paintBanks();
        validate(false);
    }
    paint();

    return {
        nodes: [seg, el('label', { class: 'field' }, [label, numInput, errEl, help]), bankSection, qr],
        validate: () => validate(true)
    };
}

function openPersonSheet({ playerId = null, rosterId = null }) {
    const player = playerId ? state.players.find(p => p.id === playerId) : null;
    const roster = rosterId ? state.roster.find(r => r.id === rosterId) : null;
    const target = player || roster;
    if (!target) return;
    const draft = { name: target.name, acc: { ...target.acc } };
    const nameErr = el('span', { class: 'field-error hidden', text: 'ใส่ชื่อก่อนนะ' });
    const nameInput = el('input', {
        type: 'text', class: 'input', maxLength: 40, value: draft.name,
        oninput: (e) => { draft.name = e.target.value; }
    });
    const form = accountForm(draft.acc);

    const save = () => {
        const name = draft.name.trim();
        nameErr.classList.toggle('hidden', !!name);
        if (!name || !form.validate()) return;
        if (player) {
            player.name = name;
            player.acc = { ...draft.acc };
            syncRoster(player);
        } else {
            roster.name = name;
            roster.acc = { ...draft.acc };
            state.players.filter(p => p.rid === roster.id).forEach(p => { p.name = name; p.acc = { ...draft.acc }; });
        }
        touch();
        closeSheet(true);
        renderScreen();
        toast('บันทึกแล้ว');
    };

    const del = player
        ? el('button', { type: 'button', class: 'btn btn-danger-soft', onclick: () => { closeSheet(true); removePlayer(player.id); } }, [icon('delete'), 'ลบออกจากบิล'])
        : el('button', {
            type: 'button', class: 'btn btn-danger-soft', onclick: () => {
                state.roster = state.roster.filter(r => r.id !== roster.id);
                state.players.forEach(p => { if (p.rid === roster.id) p.rid = ''; });
                saveState();
                closeSheet(true);
                renderScreen();
                toast(`ลบ ${roster.name} ออกจากก๊วนประจำแล้ว`);
            }
        }, [icon('delete'), 'ลบออกจากก๊วน']);

    openSheet({
        title: `บัญชีรับเงินของ ${target.name}`,
        avatarNode: avatar(target.name, 'md'),
        body: [el('label', { class: 'field' }, [el('span', { class: 'field-label strong', text: 'ชื่อ' }), nameInput, nameErr]), ...form.nodes],
        foot: [del, el('button', { type: 'button', class: 'btn btn-primary', style: 'flex:1', text: 'บันทึก', onclick: save })]
    });
}

function openExternalSheet(onSaved) {
    const draft = { name: state.external.name, acc: { ...state.external.acc } };
    const nameErr = el('span', { class: 'field-error hidden', text: 'ใส่ชื่อคนนอกก่อนนะ' });
    const form = accountForm(draft.acc);
    openSheet({
        title: 'คนนอก (ไม่ได้เล่น/ไม่ได้กิน)',
        sub: 'คนที่สำรองจ่ายให้ แต่ไม่ต้องหารด้วย',
        avatarNode: avatar('คนนอก', 'md', true),
        body: [
            el('label', { class: 'field' }, [
                el('span', { class: 'field-label strong', text: 'ชื่อ' }),
                el('input', { type: 'text', class: 'input', maxLength: 40, value: draft.name, placeholder: 'เช่น พี่ต้น', oninput: (e) => { draft.name = e.target.value; } }),
                nameErr
            ]),
            ...form.nodes
        ],
        foot: [el('button', {
            type: 'button', class: 'btn btn-primary btn-block', text: 'บันทึกและเลือกคนนี้',
            onclick: () => {
                nameErr.classList.toggle('hidden', !isBlank(draft.name));
                if (isBlank(draft.name) || !form.validate()) return;
                state.external = { name: draft.name.trim(), acc: { ...draft.acc } };
                touch();
                closeSheet(true);
                onSaved && onSaved();
            }
        })]
    });
}

function openAccountFor(id) {
    if (id === EXT) openExternalSheet(() => renderScreen());
    else openPersonSheet({ playerId: id });
}

function openEatersSheet(itemId) {
    const it = state.food.items.find(x => x.id === itemId);
    if (!it) return;
    const amt = foodItemAmount(it);
    const footInfo = el('strong', { class: 'tnum' });
    const allSwitch = el('input', { type: 'checkbox', class: 'switch', 'aria-label': 'ทุกคน' });
    const list = el('div');

    const paint = () => {
        const eaters = foodEaters(it);
        allSwitch.checked = it.all;
        list.replaceChildren(...state.players.map(p => {
            const cb = el('input', {
                type: 'checkbox', checked: eaters.includes(p.id),
                onchange: (e) => {
                    const set = new Set(foodEaters(it));
                    if (e.target.checked) set.add(p.id); else set.delete(p.id);
                    it.all = state.players.every(x => set.has(x.id));
                    it.eaters = it.all ? [] : [...set];
                    touch();
                    paint();
                }
            });
            return el('label', { class: 'check-row' }, [avatar(p.name, 'md'), el('span', { class: 'grow', text: p.name }), cb, el('span', { class: 'check-dot' }, [icon('check')])]);
        }));
        const n = eaters.length;
        footInfo.textContent = n ? `หารคนละ ${baht(Math.ceil(amt / n))}` : 'ยังไม่ได้เลือกคนกิน';
    };
    allSwitch.addEventListener('change', () => {
        it.all = allSwitch.checked;
        it.eaters = it.all ? [] : [];
        touch();
        paint();
    });
    paint();

    openSheet({
        title: `ใครกิน ${it.name.trim() || 'เมนูนี้'}?`,
        sub: `ยอดเมนู ${baht(amt)} (${fmtShort(toSatang(num(it.price)))} บ. × ${itemQty(it)})`,
        body: [
            el('div', { class: 'all-row' }, [el('span', {}, [icon('group'), 'ทุกคน']), allSwitch]),
            list
        ],
        foot: [
            el('div', { class: 'grow' }, [el('span', { class: 'muted small', text: 'แชร์ค่าอาหาร' }), footInfo]),
            el('button', { type: 'button', class: 'btn btn-primary', text: 'เสร็จ', onclick: () => closeSheet() })
        ],
        onClose: () => renderScreen()
    });
}

function openFoodSheet(itemId = null) {
    const existing = itemId ? state.food.items.find(x => x.id === itemId) : null;
    const draft = existing ? { ...existing } : normItem({});
    const err = el('span', { class: 'field-error hidden' });
    const total = el('strong', { class: 'tnum' });
    const paintTotal = () => { total.textContent = baht(foodItemAmount(draft)); };
    const qtyBox = el('div', { class: 'stepper' });
    const qtyInput = el('input', {
        type: 'number', class: 'value', inputMode: 'numeric', min: 1, step: 1, value: draft.qty, 'aria-label': 'จำนวน',
        oninput: (e) => { draft.qty = e.target.value; paintTotal(); }
    });
    const bump = (d) => { draft.qty = Math.max(1, num(draft.qty) + d); qtyInput.value = draft.qty; paintTotal(); };
    qtyBox.append(
        el('button', { type: 'button', 'aria-label': 'ลดจำนวน', onclick: () => bump(-1) }, [icon('remove')]),
        qtyInput,
        el('button', { type: 'button', 'aria-label': 'เพิ่มจำนวน', onclick: () => bump(1) }, [icon('add')])
    );
    paintTotal();

    const save = () => {
        if (num(draft.price) <= 0) { err.textContent = 'ใส่ราคาก่อนนะ'; err.classList.remove('hidden'); return; }
        if (num(draft.qty) <= 0) draft.qty = 1;
        draft.name = draft.name.trim();
        if (existing) Object.assign(existing, draft);
        else state.food.items.push(draft);
        touch();
        closeSheet(true);
        renderScreen();
    };

    const foot = [];
    if (existing) {
        foot.push(el('button', {
            type: 'button', class: 'btn btn-danger-soft', 'aria-label': 'ลบเมนู',
            onclick: () => {
                const snapshot = JSON.stringify(state.food.items);
                state.food.items = state.food.items.filter(x => x.id !== existing.id);
                touch();
                closeSheet(true);
                renderScreen();
                toast('ลบเมนูแล้ว', { label: 'เลิกทำ', fn: () => { state.food.items = JSON.parse(snapshot); saveState(); renderScreen(); } });
            }
        }, [icon('delete')]));
    }
    foot.push(el('button', { type: 'button', class: 'btn btn-primary', style: 'flex:1', onclick: save }, [existing ? 'บันทึก' : 'เพิ่มเมนู']));

    openSheet({
        title: existing ? 'แก้ไขเมนู' : 'เพิ่มเมนู',
        sub: existing ? '' : 'ค่าเริ่มต้นคือทุกคนกิน เลือกคนกินทีหลังได้',
        body: [
            el('label', { class: 'field' }, [
                el('span', { class: 'field-label strong', text: 'ชื่อเมนู' }),
                el('input', { type: 'text', class: 'input', maxLength: 40, value: draft.name, placeholder: 'เช่น ข้าวผัดกะเพรา', enterKeyHint: 'next', oninput: (e) => { draft.name = e.target.value; } })
            ]),
            el('div', { class: 'grid-2' }, [
                el('label', { class: 'field' }, [
                    el('span', { class: 'field-label strong', text: 'ราคาต่อจาน' }),
                    el('span', { class: 'input-wrap' }, [
                        el('input', { type: 'number', class: 'input input-num', inputMode: 'decimal', min: 0, value: draft.price, placeholder: '0', oninput: (e) => { draft.price = e.target.value; err.classList.add('hidden'); paintTotal(); } }),
                        el('span', { class: 'suffix', text: 'บ.' })
                    ])
                ]),
                el('div', { class: 'field' }, [el('span', { class: 'field-label strong', text: 'จำนวน' }), qtyBox])
            ]),
            err,
            el('div', { class: 'row-between' }, [el('span', { class: 'muted', text: 'รวมเมนูนี้' }), total])
        ],
        foot
    });
}

function openQrSheet(t) {
    const acc = accOf(t.to);
    const pp = promptpayId(acc);
    if (!pp) return;
    openSheet({
        title: `${nameOf(t.from)} → ${nameOf(t.to)}`,
        sub: 'สแกนด้วยแอปธนาคาร ยอดเงินใส่ให้แล้ว',
        body: [el('div', { class: 'qr-big' }, [
            el('img', { src: qrUrl(pp, t.pay), alt: `QR พร้อมเพย์ ${baht(t.pay)}`, width: 240, height: 240 }),
            el('div', { class: 'amt tnum', text: baht(t.pay) }),
            el('div', { class: 'muted', text: accText(acc) })
        ])],
        foot: [el('button', {
            type: 'button', class: 'btn btn-soft btn-block',
            onclick: () => copyToClipboard(pp, 'ก๊อปปี้เลขพร้อมเพย์แล้ว')
        }, [icon('content_copy'), 'ก๊อปปี้เลขพร้อมเพย์'])]
    });
}

function openSettingsSheet() {
    const round = el('input', {
        type: 'checkbox', class: 'switch', checked: state.roundUp, id: 'roundSwitch',
        onchange: (e) => { state.roundUp = e.target.checked; saveState(); }
    });
    let armed = false;
    const resetBtn = el('button', { type: 'button', class: 'btn btn-danger-soft btn-block' }, [icon('delete'), 'ล้างข้อมูลทั้งหมด']);
    resetBtn.addEventListener('click', () => {
        if (!armed) { armed = true; resetBtn.lastChild.textContent = 'แตะอีกครั้งเพื่อยืนยัน (ลบรายชื่อและบัญชีด้วย)'; return; }
        try { localStorage.removeItem(STORAGE_KEY); LEGACY_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
        state = defaultState();
        closeSheet(true);
        go('home', { replace: true });
        toast('ล้างข้อมูลแล้ว');
    });
    openSheet({
        title: 'ตั้งค่า',
        body: [
            el('label', { class: 'row-between settings-row', for: 'roundSwitch' }, [
                el('span', { class: 'grow' }, [el('strong', { text: 'ปัดยอดโอนขึ้นเป็นบาทเต็ม' }), el('span', { class: 'muted small', text: 'ไม่ต้องโอนเศษสตางค์' })]),
                round
            ]),
            el('div', { class: 'divider' }),
            el('button', { type: 'button', class: 'btn btn-soft btn-block', onclick: () => { closeSheet(true); startNewBill(); } }, [icon('receipt_long'), 'เริ่มบิลใหม่']),
            resetBtn,
            el('p', { class: 'muted small', text: 'ข้อมูลทั้งหมดเก็บไว้ในเครื่องนี้เท่านั้น ไม่ได้ส่งขึ้นเซิร์ฟเวอร์' })
        ],
        onClose: () => renderScreen()
    });
}

/* =========================================================
 * Flex Message
 * ======================================================= */
const FT = (text, o = {}) => ({ type: 'text', text: String(text || '-'), size: 'sm', color: '#334155', wrap: true, ...o });
const FROW = (l, r, o = {}, lo = {}) => ({
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [FT(l, { flex: 3, color: '#63738A', ...lo }), FT(r, { flex: 2, align: 'end', weight: 'bold', color: '#0F172A', ...o })]
});
const FSEP = { type: 'separator', margin: 'md', color: '#E2E8F0' };
const qrUrl = (ppId, satang) =>
    satang ? `https://promptpay.io/${ppId}/${(satang / 100).toFixed(2)}.png` : `https://promptpay.io/${ppId}.png`;

function billTitle(totals) {
    const parts = [];
    if (totals.court || totals.shuttle) parts.push('ค่าแบด');
    if (totals.food) parts.push('ค่าอาหาร');
    return `🏸 บิล${parts.join(' + ')}`;
}

function buildFlexMessage(r) {
    const { totals, rows, transfers } = r;
    const rounded = state.roundUp && transfers.some(t => t.pay !== t.amount);
    const meta = `${thaiDate(Date.now())} · ${state.players.length} คน`;

    const body = [
        { type: 'box', layout: 'horizontal', contents: [
            FT('ยอดรวม', { color: '#63738A', gravity: 'center', flex: 2 }),
            FT(baht(totals.all), { size: 'xl', weight: 'bold', color: '#0F172A', align: 'end', flex: 5 })
        ] },
        FSEP
    ];
    if (totals.court) body.push(FROW(`คอร์ท (${nameOf(r.payers.court)} จ่าย)`, fmt(totals.court)));
    if (totals.shuttle) body.push(FROW(`ลูก (${namesText(r.payers.shuttle)} ซื้อ)`, fmt(totals.shuttle)));
    if (totals.food) body.push(FROW(`อาหาร (${nameOf(r.payers.food)} จ่าย)`, fmt(totals.food)));

    body.push(FSEP, FT('ยอดต่อคน', { size: 'xs', color: '#63738A', margin: 'md' }));
    rows.filter(x => x.owed > 0).forEach(x => body.push(FROW(x.name, fmt(x.owed), { color: '#334155' }, { color: '#0F172A' })));

    const transferBox = {
        type: 'box', layout: 'vertical', spacing: 'sm', backgroundColor: '#F6F7F9', paddingAll: 'lg',
        contents: [FT('ใครโอนให้ใคร', { size: 'xs', color: '#63738A' })]
    };
    if (transfers.length === 0) transferBox.contents.push(FT('ไม่มีใครต้องโอน 🎉', { weight: 'bold' }));
    transfers.forEach(t => transferBox.contents.push(
        FROW(`${nameOf(t.from)} → ${nameOf(t.to)}`, `${fmtShort(t.pay)} บ.`, { color: '#9D4300' }, { color: '#0F172A', weight: 'bold' })
    ));
    if (transfers.length) transferBox.contents.push(FT('เลื่อนขวาเพื่อดู QR รายคน 👉', { size: 'xxs', color: '#94A3B8', margin: 'md' }));
    if (rounded) transferBox.contents.push(FT('* ปัดยอดโอนขึ้นเป็นบาทเต็ม', { size: 'xxs', color: '#94A3B8' }));

    const bubbles = [{
        type: 'bubble', size: 'mega',
        header: {
            type: 'box', layout: 'vertical', backgroundColor: '#15803D', paddingAll: 'lg', spacing: 'xs',
            contents: [
                FT(meta, { size: 'xs', color: '#DCFCE7' }),
                FT(billTitle(totals), { size: 'lg', weight: 'bold', color: '#FFFFFF' })
            ]
        },
        body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
        footer: transferBox,
        styles: { footer: { separator: false } }
    }];

    const accLines = (id) => {
        const acc = accOf(id);
        const out = [FT(accText(acc), { weight: 'bold', align: 'center', color: '#0F172A' })];
        if (acc && acc.type === 'bank' && hasAcc(acc)) out.push(FT(`ชื่อบัญชี: ${nameOf(id)}`, { size: 'xs', color: '#63738A', align: 'center' }));
        return out;
    };
    const personHeader = (text) => ({
        type: 'box', layout: 'vertical', backgroundColor: '#DCFCE7', paddingAll: 'lg',
        contents: [FT(text, { weight: 'bold', size: 'md', color: '#166534', align: 'center' })]
    });

    if (transfers.length > 0 && transfers.length <= 11) {
        // หนึ่ง bubble ต่อหนึ่งรายการโอน → QR มียอดของคนนั้นๆ พอดี
        transfers.forEach(t => {
            const ppId = promptpayId(accOf(t.to));
            const b = {
                type: 'bubble', size: 'mega',
                header: personHeader(`${nameOf(t.from)} → ${nameOf(t.to)}`),
                body: {
                    type: 'box', layout: 'vertical', spacing: 'sm', contents: [
                        FT(baht(t.pay), { size: 'xxl', weight: 'bold', color: '#C45600', align: 'center' }),
                        FSEP,
                        ...accLines(t.to),
                        FT(ppId ? 'สแกนได้เลย ยอดใส่ให้แล้ว' : 'โอนเข้าบัญชีด้านบนได้เลย', { size: 'xs', color: '#63738A', align: 'center' })
                    ]
                }
            };
            if (ppId) b.hero = { type: 'image', url: qrUrl(ppId, t.pay), size: 'full', aspectRatio: '1:1', aspectMode: 'fit' };
            bubbles.push(b);
        });
    } else if (transfers.length > 11) {
        // รายการเยอะเกิน carousel (สูงสุด 12) → รวมเป็นหนึ่ง bubble ต่อผู้รับ, QR ไม่ใส่ยอด
        [...new Set(transfers.map(t => t.to))].slice(0, 11).forEach(to => {
            const ppId = promptpayId(accOf(to));
            const b = {
                type: 'bubble', size: 'mega',
                header: personHeader(`โอนให้ ${nameOf(to)}`),
                body: {
                    type: 'box', layout: 'vertical', spacing: 'sm', contents: [
                        ...transfers.filter(t => t.to === to).map(t => FROW(nameOf(t.from), `${fmtShort(t.pay)} บ.`, { color: '#C45600' })),
                        FSEP,
                        ...accLines(to),
                        ...(ppId ? [FT('สแกน QR แล้วใส่ยอดของตัวเอง', { size: 'xs', color: '#63738A', align: 'center' })] : [])
                    ]
                }
            };
            if (ppId) b.hero = { type: 'image', url: qrUrl(ppId, 0), size: 'full', aspectRatio: '1:1', aspectMode: 'fit' };
            bubbles.push(b);
        });
    }

    return {
        type: 'flex',
        altText: `${billTitle(totals)} รวม ${baht(totals.all)}`.slice(0, 400),
        contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }
    };
}

/* =========================================================
 * LINE
 * ======================================================= */
function lineMode() {
    if (!liffReady) return 'none';
    try {
        if (liff.isInClient()) {
            const ctx = liff.getContext();
            if (ctx && SENDABLE_CONTEXTS.includes(ctx.type)) return 'send';
        }
        if (!liff.isLoggedIn()) return 'login';
        if (liff.isApiAvailable('shareTargetPicker')) return 'picker';
    } catch (e) {
        console.error(e);
    }
    return 'none';
}

function updateLineButton() {
    const btn = $('sendLineBtn');
    const mode = lineMode();
    const ok = !!window.__lastResult;
    const labels = {
        send: 'ส่งเข้ากลุ่ม LINE',
        picker: 'เลือกกลุ่ม LINE เพื่อส่ง',
        login: 'เข้าสู่ระบบ LINE เพื่อส่ง',
        none: 'ก๊อปปี้ข้อความไปส่งเอง'
    };
    $('sendLineLabel').textContent = labels[mode];
    btn.dataset.mode = mode;
    btn.disabled = !ok;
    $('copyBtn').disabled = !ok;
    $('copyBtn').classList.toggle('hidden', currentScreen !== '4' || mode === 'none');
}

async function sendToLine() {
    renderStep4();   // คำนวณใหม่ทุกครั้งก่อนส่ง
    const r = window.__lastResult;
    if (!r) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }

    const mode = lineMode();
    if (mode === 'none') { copyText(); return; }
    if (mode === 'login') {
        saveState();
        liff.login({ redirectUri: location.href });
        return;
    }
    const msg = buildFlexMessage(r);
    const btn = $('sendLineBtn');
    btn.disabled = true;
    $('sendLineLabel').textContent = 'กำลังส่ง…';
    try {
        if (mode === 'send') {
            try {
                await liff.sendMessages([msg]);
                markSent();
                return;
            } catch (err) {
                console.warn('sendMessages ไม่สำเร็จ ลองใช้ shareTargetPicker', err);
                if (!liff.isApiAvailable('shareTargetPicker')) throw err;
            }
        }
        if (liff.isApiAvailable('shareTargetPicker')) {
            const res = await liff.shareTargetPicker([msg], { isMultiple: true });
            if (res) markSent(); else toast('ยกเลิกการส่ง');
            return;
        }
        throw new Error('หน้านี้ไม่รองรับการส่งข้อความ');
    } catch (err) {
        const box = $('messages');
        box.replaceChildren(
            alertEl('err', `ส่งเข้า LINE ไม่สำเร็จ: ${err && err.message ? err.message : err}`),
            alertEl('warn', 'เช็คใน LINE Developers ว่าเปิด scope "chat_message.write" และ Share Target Picker แล้ว หรือกดปุ่มก๊อปปี้ข้อความแทน')
        );
        box.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
        updateLineButton();
    }
}

function markSent() {
    state.sent = true;
    saveState();
    go('done');
}

async function copyToClipboard(text, okMsg = '✅ ก๊อปปี้แล้ว!') {
    try {
        await navigator.clipboard.writeText(text);
        toast(okMsg);
    } catch (e) {
        // fallback สำหรับ in-app browser ที่ไม่ให้ใช้ Clipboard API
        const ta = el('textarea', { value: text, style: 'position:fixed;top:0;left:0;opacity:0' });
        document.body.append(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        ta.remove();
        toast(ok ? okMsg : 'ก๊อปปี้อัตโนมัติไม่ได้ ลองกดค้างเพื่อคัดลอกเอง');
    }
}

function copyText() {
    renderStep4();
    if (!window.__lastResult) return;
    copyToClipboard($('summaryText').value, '✅ ก๊อปปี้ข้อความสรุปแล้ว ไปวางในแชทได้เลย');
}

/* =========================================================
 * Toast
 * ======================================================= */
let toastTimer = null;
function toast(text, action = null) {
    const t = $('toast');
    t.replaceChildren(el('span', { text }));
    if (action) {
        t.append(el('button', {
            type: 'button', text: action.label,
            onclick: () => { t.classList.add('hidden'); action.fn(); }
        }));
    }
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), action ? 5000 : 2500);
}

/* =========================================================
 * Bound inputs (data-bind)
 * ======================================================= */
function syncBoundInputs(root) {
    if (!root) return;
    root.querySelectorAll('[data-bind]').forEach(input => {
        if (document.activeElement === input) return;
        const v = getPath(input.dataset.bind);
        if (input.type === 'checkbox') input.checked = !!v;
        else input.value = v == null ? '' : v;
    });
}

function refreshLive() {
    if (currentScreen === '2') refreshStep2Live();
    else if (currentScreen === '3') refreshStep3Live();
    else renderBottomBar();
}

function bindInputs() {
    document.querySelectorAll('[data-bind]').forEach(input => {
        const path = input.dataset.bind;
        const isCheck = input.type === 'checkbox';
        input.addEventListener(isCheck ? 'change' : 'input', () => {
            setPath(path, isCheck ? input.checked : input.value);
            if (path === 'court.hours') renderHoursSeg();
            touch();
            refreshLive();
        });
    });

    $('courtHoursSeg').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const wrap = $('courtHoursOtherWrap');
        if (b.dataset.hours === 'other') {
            wrap.dataset.forced = '1';
            renderHoursSeg();
            $('courtHoursInput').value = state.court.hours;
            $('courtHoursInput').focus();
        } else {
            wrap.dataset.forced = '';
            state.court.hours = num(b.dataset.hours);
            $('courtHoursInput').value = state.court.hours;
            touch();
            renderHoursSeg();
            refreshStep2Live();
        }
    });
    $('splitSeg').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        state.shuttle.split = b.dataset.split;
        touch();
        document.querySelectorAll('#splitSeg button').forEach(x => x.classList.toggle('on', x === b));
    });
    $('svcToggle').addEventListener('change', (e) => {
        const wrap = $('svcPctWrap');
        if (e.target.checked) {
            wrap.dataset.forced = '1';
            if (num(state.food.servicePct) <= 0) state.food.servicePct = 10;
        } else {
            wrap.dataset.forced = '';
            state.food.servicePct = '';
        }
        touch();
        renderStep3();
    });
}

/* =========================================================
 * Init
 * ======================================================= */
async function initLiff() {
    if (typeof liff === 'undefined') {
        console.warn('โหลด LIFF SDK ไม่สำเร็จ');
        return;
    }
    try {
        await liff.init({ liffId: LIFF_ID });
        liffReady = true;
    } catch (err) {
        console.error('LIFF Initialization failed', err);
        liffReady = false;
    }
    renderScreen();   // อัปเดตปุ่ม LINE / "เพิ่มตัวฉัน"
}

document.addEventListener('DOMContentLoaded', () => {
    const saved = loadState();
    if (saved) state = saved;

    bindInputs();

    // ปุ่มทั่วไปผ่าน data-action
    document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        const a = b.dataset.action;
        const actions = {
            'new-bill': startNewBill,
            'resume': () => go(state.players.length ? '1' : 'home'),
            'open-settings': openSettingsSheet,
            'back': goBack,
            'next': nextStep,
            'set-all-hours': setAllHours,
            'skip-food': () => go('4'),
            'add-food': () => openFoodSheet(),
            'send-line': sendToLine,
            'copy': copyText,
            'close-sheet': () => closeSheet(),
            'close-liff': () => { try { liff.closeWindow(); } catch (err) { go('home'); } }
        };
        if (actions[a]) actions[a]();
    });
    $('progress').addEventListener('click', (e) => {
        const b = e.target.closest('[data-goto]');
        if (!b || b.dataset.goto === currentScreen) return;
        if (state.players.length === 0 && b.dataset.goto !== '1') { showBottomError('เพิ่มคนอย่างน้อย 1 คนก่อนนะ'); return; }
        go(b.dataset.goto);
    });
    $('sheetBackdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSheet(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
    $('addPlayerForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('newPlayerName');
        const name = input.value.trim();
        if (!name) return;
        if (state.players.some(p => p.name.trim() === name)) { toast(`มี "${name}" อยู่แล้ว`); return; }
        const r = state.roster.find(x => x.name.trim() === name);
        addPlayer({ name, rid: r ? r.id : '', acc: r ? r.acc : null });
        input.value = '';
        renderScreen();
        input.focus();
    });

    window.addEventListener('popstate', (e) => {
        navDepth = Math.max(0, navDepth - 1);
        if (!$('sheetBackdrop').classList.contains('hidden')) { closeSheet(); }
        show((e.state && e.state.screen) || screenFromHash() || 'home');
    });

    // หน้าเริ่มต้น: กลับไปขั้นที่ค้างไว้ (เช่นหลัง liff.login redirect) ถ้ามีบิลค้าง
    let start = screenFromHash() || 'home';
    if (start !== 'home' && start !== 'done' && state.players.length === 0) start = 'home';
    if (start === 'done') start = 'home';
    history.replaceState({ screen: start }, '', `#${start}`);
    show(start);

    initLiff();   // ไม่ block UI ระหว่างรอ LINE
});
