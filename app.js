// --- Dane: wszystko jest zapisywane w pamięci telefonu (localStorage) ---

const STORAGE_KEY = "wydatki.v1";
const DEFAULT_CATEGORIES = ["Jedzenie", "Rozrywka", "Transport", "Ubrania", "Pielęgnacja", "Edukacja", "Inne", "Subskrypcje"];
const DEFAULT_INCOME_CATEGORIES = ["Pensja", "Premia", "Zlecenie", "Zwrot", "Sprzedaż", "Inne"];
const DEFAULT_SAVINGS_CATEGORIES = ["Trading 212", "Konto oszczędnościowe", "Inne"];
const RECENT_LIMIT = 20;
const NOTE_SUGGESTIONS_LIMIT = 4;
const CALENDAR_SWIPE_PX = 40;
const SHEET_CLOSE_MS = 160;
const FALLBACK_CATEGORY = "Inne"; // tu trafiają wydatki z usuniętej kategorii
const DELETE_OFFSET = -96; // przesunięcie palca, przy którym "Usuń" zostaje wysunięte
const TOAST_MS = 6000;
const SWIPE_HINT_KEY = STORAGE_KEY + ".swipeHint";
const SWIPE_HINT_MAX = 3; // ile razy lista sama pokazuje gest
const SWIPE_HINT_LEARNED = 99;
const DRAG_SCROLL_EDGE = 32; // tak blisko krawędzi listy zaczyna się jej przewijanie
const DRAG_SCROLL_SPEED = 5;
const BACKUP_APP = "moje-wydatki";
const BACKUP_VERSION = 1;
const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
const LAST_BACKUP_KEY = STORAGE_KEY + ".lastBackup";
const BACKUP_REMINDER_KEY = STORAGE_KEY + ".backupReminder";
const BEFORE_IMPORT_KEY = STORAGE_KEY + ".przedWczytaniem";
const BACKUP_DUE_DAYS = 30; // po tylu dniach przypominamy o nowej kopii
const BACKUP_FIRST_AFTER_ENTRIES = 10; // przy tylu wpisach przypominamy o pierwszej kopii
const BACKUP_REMINDER_EVERY_DAYS = 7; // nie przypominamy częściej niż co tydzień
const DAY_MS = 24 * 60 * 60 * 1000;

const ICON_CHOICES = {
  expense: ["🍔", "🛒", "☕", "🍺", "🚗", "⛽", "🏠", "💡", "📱", "🎬", "📺", "✈️", "👕", "🧴", "💊", "🎓", "🏋️", "✨"],
  income: ["💼", "💰", "🎁", "🧾", "📈", "🏦", "🏷️", "🤝", "💸", "🏠", "🎓", "✨"],
  savings: ["📈", "🏦", "💰", "🐷", "🏠", "🚗", "✈️", "🎓", "🛟", "💎", "🎯", "✨"],
};

// Ikona dobierana po początku słowa w nazwie, np. "kawa" daje ☕.
const ICON_RULES = [
  [/trading|etf|xtb|revolut/, "📈"],
  [/konto|account|lokat|savings/, "🏦"],
  [/food|grocer/, "🛒"],
  [/coffee/, "☕"],
  [/fuel/, "⛽"],
  [/rent|home/, "🏠"],
  [/clothes/, "👕"],
  [/salary|work|job/, "💼"],
  [/jedzen|spożyw|zakup|lidl|biedron/, "🛒"],
  [/restaur|obiad|pizza|burger|fast/, "🍔"],
  [/kaw|cafe/, "☕"],
  [/piw|alkohol|bar\b|impre/, "🍺"],
  [/paliw|benzyn|tankow/, "⛽"],
  [/transport|auto|samoch|uber|bolt|taxi|taks/, "🚗"],
  [/miesz|czynsz|wynaj|dom\b/, "🏠"],
  [/rachun|prąd|gaz\b|woda|media/, "💡"],
  [/telefon|internet/, "📱"],
  [/rozryw|kino|film/, "🎬"],
  [/subskr|abonam|netflix|spotify/, "📺"],
  [/pielęgn|kosmet|fryzjer/, "🧴"],
  [/eduk/, "🎓"],
  [/gry|gra\b|konsol/, "🎮"],
  [/podróż|wakac|urlop|lot\b|bilet/, "✈️"],
  [/ubra|ciuch|buty|butów|moda/, "👕"],
  [/zdrow|lek|apte|dentyst|lekarz/, "💊"],
  [/siłown|sport|fitnes|trening/, "🏋️"],
  [/prezent|premi|nagrod/, "🎁"],
  [/pies|psa|kot\b|kota|zwierz/, "🐾"],
  [/pensj|wypłat|praca|etat/, "💼"],
  [/zlecen|faktur|freelanc/, "🧾"],
  [/zwrot|podat/, "🏦"],
  [/sprzeda|vinted|olx|allegro/, "🏷️"],
  [/inwest|akcj|krypto|oszczęd|dywiden/, "📈"],
  [/szkoł|kurs|nauk|stud|książ/, "🎓"],
  [/napiw/, "💸"],
  [/inne/, "✨"],
];

function capitalizeFirst(text) {
  const [first = "", ...rest] = text;
  return first.toLocaleUpperCase("pl-PL") + rest.join("");
}

function capitalizeInput(input) {
  const capitalized = capitalizeFirst(input.value);
  if (capitalized !== input.value) input.value = capitalized;
}

// Starsze zapisy nie mają wpływów ani ikon, a opisy mogły być pisane małą literą.
function normalizeData(data) {
  data.incomeCategories = data.incomeCategories || [...DEFAULT_INCOME_CATEGORIES];
  data.incomes = data.incomes || [];
  data.savingsCategories = data.savingsCategories || [...DEFAULT_SAVINGS_CATEGORIES];
  data.savings = data.savings || [];
  data.pots = data.pots || [];
  data.potTransfers = data.potTransfers || [];
  data.budget = data.budget || null;
  data.netWorth = data.netWorth || [];
  data.icons = data.icons || {};
  for (const transaction of [...data.transactions, ...data.incomes, ...data.savings]) {
    if (transaction.note) transaction.note = capitalizeFirst(transaction.note);
  }
  return data;
}

function loadData() {
  const empty = normalizeData({ categories: [...DEFAULT_CATEGORIES], transactions: [] });
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw);
    if (Array.isArray(data.categories) && Array.isArray(data.transactions)) return normalizeData(data);
    throw new Error("Nieprawidłowy format danych");
  } catch {
    // Uszkodzonych danych nie kasujemy: zostają w kopii zapasowej.
    try { if (raw) localStorage.setItem(STORAGE_KEY + ".backup", raw); } catch {}
    return empty;
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

const data = loadData();

function ledger(kind) {
  if (kind === "income") return { categories: data.incomeCategories, transactions: data.incomes };
  if (kind === "savings") return { categories: data.savingsCategories, transactions: data.savings };
  return { categories: data.categories, transactions: data.transactions };
}

function allEntries() {
  return [...data.transactions, ...data.incomes, ...data.savings];
}

// --- Stan ekranu ---

const now = new Date();
let activeTab = "wydatki";
let entryKind = "expense"; // co dodajemy na ekranie: wydatek albo wpływ
let selectedCategory = null;
const drafts = { expense: null, income: null, savings: null }; // niedokończony wpis każdej zakładki
let newCategoryIcon = null;
let newCategoryIconPicked = false;
let selectedDate = dateToString(now);
let lastKnownToday = selectedDate;
let calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
let calendarSwipeStartX = null;
let calendarValue = selectedDate; // data zaznaczona w otwartym kalendarzu
let calendarOnPick = null;
let calendarFocusId = "date-toggle";
let editing = null; // edytowany wpis: { transaction, kind, category, date }
let pendingImport = null; // kopia wybrana z pliku, czeka na potwierdzenie
let summaryMode = "month";
let summaryMonth = now.getMonth();
let summaryYear = now.getFullYear();
let periodSheetYear = summaryYear; // rok oglądany w panelu wyboru miesiąca
let summaryView = "expense"; // którą listę pokazuje podsumowanie
const hiddenCategories = { expense: new Set(), income: new Set(), savings: new Set() }; // odznaczone w filtrze
const expandedCategories = { expense: new Set(), income: new Set(), savings: new Set() }; // rozwinięte w podsumowaniu
const expandedMonths = new Set(); // miesiące rozwinięte w widoku rocznym
let okMessageTimer = null;
let toastTimer = null;
let toastUndo = null;
let openCategoryItem = null; // wiersz z odsłoniętym przyciskiem "Usuń"

const $ = (id) => document.getElementById(id);

// --- Pomocnicze ---

function dateToString(d) {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function todayString() {
  return dateToString(new Date());
}

// Kwoty trzymamy w groszach, żeby sumy zawsze wychodziły dokładnie.
function parseAmount(text) {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  const match = clean.match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const grosze = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return grosze > 0 ? grosze : null;
}

function formatNumber(grosze) {
  return (grosze / 100).toLocaleString(numberLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(grosze) {
  return formatNumber(grosze) + " PLN";
}

// Format "2 Lis 2026"
function formatDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return `${day} ${MONTHS_SHORT[month - 1]} ${year}`;
}

function dayLabel(dateString) {
  if (dateString === todayString()) return t("today");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateString === dateToString(yesterday)) return t("yesterday");
  return formatDate(dateString);
}

function guessIcon(name) {
  const words = name.toLowerCase().split(/\s+/);
  const rule = ICON_RULES.find(([pattern]) => words.some((word) => word.search(pattern) === 0));
  return rule ? rule[1] : null;
}

function iconFor(name) {
  return data.icons[name] || guessIcon(name) || [...name][0].toUpperCase();
}

function avatar(name) {
  const el = element("span", "avatar", iconFor(name));
  el.setAttribute("aria-hidden", "true");
  return el;
}

function sortNewestFirst(a, b) {
  return b.date.localeCompare(a.date) || b.id - a.id;
}

function sumOf(transactions) {
  return transactions.reduce((sum, t) => sum + t.grosze, 0);
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// --- Zakładki ---

const TABS = ["wydatki", "wplywy", "podsumowanie", "wykresy", "odkladam", "kalkulatory"]; // kolejność przesuwania palcem
const NAV_ITEMS = { wpisy: ["wydatki", "wplywy"], bilans: ["podsumowanie", "wykresy"], odkladam: ["odkladam"], kalkulatory: ["kalkulatory"] };
const ENTRY_TABS = { wydatki: "expense", wplywy: "income", odkladam: "savings" };

function navItemFor(tab) {
  return Object.keys(NAV_ITEMS).find((item) => NAV_ITEMS[item].includes(tab));
}

function activeNavId() {
  return `nav-${navItemFor(activeTab)}`;
}

function showTab(name) {
  if (name === "odkladam" && activeTab !== "odkladam") savingsView = "entries"; // po wejściu zawsze najpierw Wpłaty
  $("tab-transakcje").hidden = !ENTRY_TABS[name];
  $("tab-podsumowanie").hidden = name !== "podsumowanie";
  $("tab-wykresy").hidden = name !== "wykresy";
  $("tab-kalkulatory").hidden = name !== "kalkulatory";
  $("filter-open").hidden = name !== "podsumowanie";
  for (const [item, tabs] of Object.entries(NAV_ITEMS)) {
    const button = $("nav-" + item);
    if (tabs.includes(name)) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    if (tabs.length < 2) continue;
    $("switch-" + item).hidden = !tabs.includes(name);
    for (const tab of tabs) $("sub-" + tab).setAttribute("aria-pressed", String(tab === name));
  }
  activeTab = name;
  updateTabIndicator();
  document.body.dataset.mode = ENTRY_TABS[name] || "expense";
  setCategoryPanel(false);
  window.scrollTo(0, 0);
  if (ENTRY_TABS[name]) setEntryKind(ENTRY_TABS[name]);
  updateSavingsView();
  if (name === "podsumowanie") renderSummary();
  if (name === "wykresy") renderCharts();
  if (name === "kalkulatory") renderCalculators();
}

// Podświetlenie przesuwa się pod aktywną zakładkę i przyjmuje jej szerokość.
function updateTabIndicator() {
  const button = $(activeNavId());
  const bar = $("tabbar-switch");
  bar.style.setProperty("--tab-x", `${button.offsetLeft}px`);
  bar.style.setProperty("--tab-width", `${button.offsetWidth}px`);
  requestAnimationFrame(() => bar.classList.add("animated"));
}

// Wydatki i wpływy używają tego samego ekranu; każdy pamięta swój niedokończony wpis.
function setEntryKind(kind) {
  if (kind === entryKind) return;
  drafts[entryKind] = { amount: $("amount").value, note: $("note").value, category: selectedCategory };
  const draft = drafts[kind] || { amount: "", note: "", category: null };
  entryKind = kind;
  $("amount").value = draft.amount;
  $("note").value = draft.note;
  selectedCategory = draft.category;
  $("form-error").hidden = true;
  $("form-ok").hidden = true;
  renderEntryTexts();
  updateAmountField();
  renderCategories();
  renderRecent();

  const section = $("tab-transakcje");
  section.classList.remove("tab");
  section.getBoundingClientRect(); // restart animacji pojawiania się
  section.classList.add("tab");
}

function renderEntryTexts() {
  const text = kindText(entryKind);
  $("note").placeholder = text.notePlaceholder;
  $("category-new").textContent = text.newCategory;
  $("recent-title").textContent = text.recent;
}

// --- Ekran dodawania ---

function renderCategories() {
  $("category-value").textContent = selectedCategory ? displayName(selectedCategory) : kindText(entryKind).categoryPlaceholder;
  $("category-toggle").classList.toggle("placeholder", !selectedCategory);

  const box = $("category-options");
  box.replaceChildren();
  openCategoryItem = null;
  for (const name of ledger(entryKind).categories) box.append(categoryItem(name));
  $("note-block").hidden = !selectedCategory;
  renderNoteSuggestions();
  renderPotHint();
  updateSaveButton();
}

// Najczęściej wpisywane opisy w tej kategorii, np. Lidl albo Biedronka w Jedzeniu.
function noteSuggestions(category) {
  const counts = new Map();
  for (const transaction of [...ledger(entryKind).transactions].sort(sortNewestFirst)) {
    if (transaction.category !== category || !transaction.note) continue;
    const key = transaction.note.toLowerCase();
    const entry = counts.get(key) || { note: transaction.note, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, NOTE_SUGGESTIONS_LIMIT)
    .map((entry) => entry.note);
}

function renderNoteSuggestions() {
  const box = $("note-suggestions");
  box.replaceChildren();
  if (!selectedCategory) return;
  const current = $("note").value.trim().toLowerCase();
  for (const note of noteSuggestions(selectedCategory)) {
    const chip = element("button", "chip", note);
    const active = note.toLowerCase() === current;
    chip.type = "button";
    chip.setAttribute("aria-pressed", String(active));
    chip.addEventListener("click", () => {
      $("note").value = active ? "" : note;
      renderNoteSuggestions();
    });
    box.append(chip);
  }
}

// Wiersz listy: kliknięcie wybiera kategorię, przesunięcie w lewo pozwala ją usunąć.
function categoryItem(name) {
  const item = element("div", "category-item");
  const option = element("button", "category-option");
  const label = element("span", "category-option-label");
  label.append(avatar(name), element("span", "", displayName(name)));
  option.append(label);
  option.type = "button";
  option.setAttribute("aria-pressed", String(name === selectedCategory));

  const remove = element("button", "category-delete", t("deleteWord"));
  remove.type = "button";
  remove.setAttribute("aria-label", t("deleteCategoryAria", { name: displayName(name) }));
  remove.addEventListener("focus", () => openItem(item));
  remove.addEventListener("click", () => removeCategoryWithAnimation(item, name));

  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let offset = 0;
  let activePointer = null;
  let dragging = false;
  let swiped = false;

  option.addEventListener("pointerdown", (event) => {
    activePointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startOffset = item === openCategoryItem ? DELETE_OFFSET : 0;
    offset = startOffset;
    dragging = false;
    swiped = false;
  });

  option.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointer) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      dragging = true;
      option.setPointerCapture(event.pointerId);
      item.classList.add("dragging");
      item.classList.remove("hint");
      if (openCategoryItem !== item) closeOpenItem();
    }
    offset = Math.min(0, startOffset + dx);
    item.style.setProperty("--reveal", `${-offset}px`);
  });

  option.addEventListener("pointerup", (event) => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    if (!dragging) return;
    swiped = true;
    item.classList.remove("dragging");
    rememberSwipeLearned();
    if (offset < -item.offsetWidth * 0.6) removeCategoryWithAnimation(item, name);
    else if (offset < DELETE_OFFSET / 2) openItem(item);
    else closeItem(item);
  });

  option.addEventListener("pointercancel", () => {
    activePointer = null;
    item.classList.remove("dragging");
    if (dragging) closeItem(item);
  });

  option.addEventListener("click", () => {
    if (swiped) {
      swiped = false;
      return;
    }
    if (openCategoryItem) {
      closeOpenItem();
      return;
    }
    selectedCategory = name;
    renderCategories();
    setCategoryPanel(false);
    $("category-toggle").focus();
  });

  const grip = element("button", "category-grip");
  grip.type = "button";
  grip.setAttribute("aria-label", t("moveAria", { name: displayName(name) }));
  grip.dataset.category = name;
  grip.addEventListener("pointerdown", (event) => startCategoryDrag(event, item, grip));
  grip.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const { categories } = ledger(entryKind);
    const from = categories.indexOf(name);
    moveCategory(from, from + (event.key === "ArrowUp" ? -1 : 1));
    const moved = [...document.querySelectorAll(".category-grip")].find((g) => g.dataset.category === name);
    if (moved) moved.focus();
  });

  item.append(option, grip, remove);
  return item;
}

function moveCategory(from, to) {
  const { categories } = ledger(entryKind);
  if (to < 0 || to >= categories.length || from === to) return;
  const before = [...categories];
  categories.splice(to, 0, categories.splice(from, 1)[0]);
  if (!saveData()) {
    categories.splice(0, categories.length, ...before);
    showToast(t("error.order"));
  }
  renderCategories();
}

// Przeciąganie uchwytu: wiersz podąża za palcem, a pozostałe robią mu miejsce.
function startCategoryDrag(event, item, grip) {
  event.preventDefault();
  const box = $("category-options");
  const items = [...box.children];
  const from = items.indexOf(item);
  const centers = items.map((el) => el.offsetTop + el.offsetHeight / 2);
  const shift = item.offsetHeight;
  const startScroll = box.scrollTop;
  const startY = event.clientY;
  let pointerY = startY;
  let target = from;
  let dragging = true;

  closeOpenItem();
  grip.setPointerCapture(event.pointerId);
  item.classList.add("lifted");

  const update = () => {
    const raw = pointerY - startY + box.scrollTop - startScroll;
    // +1: wiersz musi minąć środek ostatniego, żeby dało się go postawić na samym końcu.
    const offset = Math.max(centers[0] - centers[from], Math.min(centers[centers.length - 1] - centers[from] + 1, raw));
    const center = centers[from] + offset;
    item.style.transform = `translateY(${offset}px)`;
    target = items.filter((el, i) => i !== from && centers[i] < center).length;
    items.forEach((el, i) => {
      if (i === from) return;
      let move = 0;
      if (i > from && i <= target) move = -shift;
      if (i < from && i >= target) move = shift;
      el.style.transform = move ? `translateY(${move}px)` : "";
    });
  };

  // Przy krawędzi listy przewijamy ją, żeby dało się przenieść wiersz na sam koniec.
  const autoScroll = () => {
    if (!dragging) return;
    const bounds = box.getBoundingClientRect();
    if (pointerY < bounds.top + DRAG_SCROLL_EDGE) box.scrollTop -= DRAG_SCROLL_SPEED;
    else if (pointerY > bounds.bottom - DRAG_SCROLL_EDGE) box.scrollTop += DRAG_SCROLL_SPEED;
    update();
    requestAnimationFrame(autoScroll);
  };
  requestAnimationFrame(autoScroll);

  const onMove = (moveEvent) => {
    pointerY = moveEvent.clientY;
    update();
  };
  const finish = (commit) => {
    dragging = false;
    grip.removeEventListener("pointermove", onMove);
    grip.removeEventListener("pointerup", onUp);
    grip.removeEventListener("pointercancel", onCancel);
    item.classList.remove("lifted");
    for (const el of items) el.style.transform = "";
    if (commit) moveCategory(from, target);
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  grip.addEventListener("pointermove", onMove);
  grip.addEventListener("pointerup", onUp);
  grip.addEventListener("pointercancel", onCancel);
}

function openItem(item) {
  if (openCategoryItem !== item) closeOpenItem();
  openCategoryItem = item;
  item.style.setProperty("--reveal", `${-DELETE_OFFSET}px`);
}

function closeItem(item) {
  item.style.removeProperty("--reveal");
  if (openCategoryItem === item) openCategoryItem = null;
}

function closeOpenItem() {
  if (openCategoryItem) closeItem(openCategoryItem);
}

function transactionsIn(name, kind = entryKind) {
  return ledger(kind).transactions.filter((t) => t.category === name);
}

function removeCategoryWithAnimation(item, name) {
  // Kategoria skarbonki musi zostać, bo od niej zależy stan skarbonki.
  if (entryKind === "expense" && potFor(name)) {
    closeItem(item);
    showToast(t("pots.categoryHasPot", { name: displayName(name) }));
    return;
  }
  // Wpisów z "Inne" nie ma już gdzie przenieść.
  if (name === FALLBACK_CATEGORY && transactionsIn(name).length > 0) {
    closeItem(item);
    showToast(t("mustStay", { name: displayName(name) }));
    return;
  }
  item.style.height = `${item.offsetHeight}px`;
  item.getBoundingClientRect(); // przeglądarka musi poznać wysokość, zanim zacznie animację
  item.classList.add("removing");
  item.style.height = "0";
  setTimeout(() => deleteCategory(name), 180);
}

function deleteCategory(name) {
  const kind = entryKind;
  const { categories } = ledger(kind);
  const index = categories.indexOf(name);
  const moved = transactionsIn(name, kind);
  const addedFallback = moved.length > 0 && !categories.includes(FALLBACK_CATEGORY);

  categories.splice(index, 1);
  if (addedFallback) categories.push(FALLBACK_CATEGORY);
  for (const transaction of moved) transaction.category = FALLBACK_CATEGORY;

  const undo = () => {
    for (const transaction of moved) transaction.category = name;
    if (addedFallback && transactionsIn(FALLBACK_CATEGORY, kind).length === 0) {
      categories.splice(categories.indexOf(FALLBACK_CATEGORY), 1);
    }
    categories.splice(Math.min(index, categories.length), 0, name);
  };

  if (!saveData()) {
    undo();
    renderCategories();
    showToast(t("error.deleteCategory"));
    return;
  }

  if (selectedCategory === name) selectedCategory = null;
  hiddenCategories[kind].delete(name);
  expandedCategories[kind].delete(name);
  refreshAfterCategoryChange();

  const movedNote = moved.length > 0 ? t("entriesMoved", { name: displayName(FALLBACK_CATEGORY) }) : "";
  showToast(t("categoryDeleted", { name: displayName(name), moved: movedNote }), () => {
    undo();
    if (saveData()) refreshAfterCategoryChange();
  });
}

function refreshAfterCategoryChange() {
  renderCategories();
  renderRecent();
  renderSummary();
}

function showToast(message, onUndo, actionLabel = t("undo")) {
  toastUndo = onUndo || null;
  $("toast-text").textContent = message;
  $("toast-undo").textContent = actionLabel;
  $("toast-undo").hidden = !onUndo;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastUndo = null;
  $("toast").hidden = true;
}

// Lista sama pokazuje gest przesunięcia, dopóki użytkownik go nie pozna.
function swipeHintCount() {
  try {
    return Number(localStorage.getItem(SWIPE_HINT_KEY)) || 0;
  } catch {
    return SWIPE_HINT_LEARNED;
  }
}

function setSwipeHintCount(count) {
  try { localStorage.setItem(SWIPE_HINT_KEY, String(count)); } catch {}
}

function rememberSwipeLearned() {
  setSwipeHintCount(SWIPE_HINT_LEARNED);
}

function playSwipeHint() {
  const count = swipeHintCount();
  const first = document.querySelector(".category-item");
  if (count >= SWIPE_HINT_MAX || !first) return;
  setSwipeHintCount(count + 1);
  first.classList.add("hint");
  first.addEventListener("animationend", () => first.classList.remove("hint"), { once: true });
}

function updateSaveButton() {
  const ready = parseAmount($("amount").value) !== null && selectedCategory;
  $("save-button").classList.toggle("ready", Boolean(ready));
}

function setCategoryPanel(open) {
  $("category-panel").hidden = !open;
  $("category-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    playSwipeHint();
  } else {
    closeOpenItem();
  }
}

// --- Kalendarz ---

function updateDateLabel() {
  $("date-value").textContent = formatDate(selectedDate);
}

function yesterdayString() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return dateToString(yesterday);
}

function isCurrentMonthOrLater(month) {
  const today = new Date();
  return month >= new Date(today.getFullYear(), today.getMonth(), 1);
}

function renderCalendar(animationClass) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const today = todayString();

  $("calendar-title").textContent = `${MONTHS[month]} ${year}`;
  $("calendar-next").disabled = isCurrentMonthOrLater(calendarMonth);
  $("calendar-today").setAttribute("aria-pressed", String(calendarValue === today));
  $("calendar-yesterday").setAttribute("aria-pressed", String(calendarValue === yesterdayString()));

  const grid = $("calendar-grid");
  grid.replaceChildren();
  // Tydzień zaczyna się od poniedziałku; puste pola wyrównują pierwszy dzień miesiąca.
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
  for (let i = 0; i < leadingBlanks; i++) grid.append(element("span"));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateString = dateToString(new Date(year, month, day));
    const button = element("button", "calendar-day", String(day));
    button.type = "button";
    button.setAttribute("aria-label", formatDate(dateString));
    button.setAttribute("aria-pressed", String(dateString === calendarValue));
    button.classList.toggle("today", dateString === today);
    button.disabled = dateString > today; // wydatek nie może być z przyszłości
    button.addEventListener("click", () => pickDate(dateString));
    grid.append(button);
  }

  grid.classList.remove("slide-next", "slide-prev");
  if (animationClass) {
    grid.getBoundingClientRect(); // restart animacji przy kolejnym przejściu
    grid.classList.add(animationClass);
  }
}

function shiftCalendarMonth(delta) {
  const next = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + delta, 1);
  if (delta > 0 && isCurrentMonthOrLater(calendarMonth)) return;
  calendarMonth = next;
  renderCalendar(delta > 0 ? "slide-next" : "slide-prev");
}

function openSheet(sheetId, backdropId) {
  for (const id of [sheetId, backdropId]) {
    $(id).classList.remove("closing");
    $(id).hidden = false;
  }
}

function closeSheet(sheetId, backdropId, focusId) {
  if ($(sheetId).hidden || $(sheetId).classList.contains("closing")) return;
  for (const id of [sheetId, backdropId]) $(id).classList.add("closing");
  setTimeout(() => {
    for (const id of [sheetId, backdropId]) {
      $(id).hidden = true;
      $(id).classList.remove("closing");
    }
  }, SHEET_CLOSE_MS);
  $(focusId).focus({ preventScroll: true });
}

function openCalendar(value, onPick, focusId, kind) {
  calendarValue = value;
  calendarOnPick = onPick;
  calendarFocusId = focusId;
  const [year, month] = value.split("-").map(Number);
  calendarMonth = new Date(year, month - 1, 1);
  $("calendar-sheet").dataset.mode = kind;
  renderCalendar();
  openSheet("calendar-sheet", "calendar-backdrop");
  const focusTarget = document.querySelector('.calendar-day[aria-pressed="true"]') || $("calendar-prev");
  focusTarget.focus({ preventScroll: true });
}

function openEntryCalendar() {
  openCalendar(selectedDate, (date) => {
    selectedDate = date;
    updateDateLabel();
  }, "date-toggle", entryKind);
}

function closeCalendar() {
  closeSheet("calendar-sheet", "calendar-backdrop", calendarFocusId);
}

function pickDate(dateString) {
  calendarValue = dateString;
  calendarOnPick(dateString);
  renderCalendar();
  closeCalendar();
}

// Aplikacja na telefonie długo czeka w tle: następnego dnia "dziś" musi się przestawić.
function refreshToday() {
  const today = todayString();
  if (today === lastKnownToday) return;
  if (selectedDate === lastKnownToday) selectedDate = today;
  lastKnownToday = today;
  updateDateLabel();
  renderRecent();
}

// Pole kwoty rośnie razem z tekstem, dzięki czemu PLN stoi tuż za liczbą.
function fitAmountField(input, sizer) {
  input.value = input.value.replace(/[^\d.,]/g, "");
  sizer.dataset.value = input.value || input.placeholder;
  sizer.classList.toggle("long", input.value.length > 8);
}

function updateAmountField() {
  fitAmountField($("amount"), $("amount-sizer"));
  renderPotHint();
  updateSaveButton();
}

// --- Panel nowej kategorii ---

function openCategorySheet() {
  setCategoryPanel(false);
  newCategoryIcon = null;
  newCategoryIconPicked = false;
  $("new-category").value = "";
  $("category-sheet-title").textContent = kindText(entryKind).sheetTitle;
  renderCategorySheet();
  openSheet("category-sheet", "category-backdrop");
  $("new-category").focus({ preventScroll: true });
}

function closeCategorySheet() {
  closeSheet("category-sheet", "category-backdrop", "category-toggle");
}

function renderCategorySheet() {
  const name = capitalizeFirst($("new-category").value.trim());
  if (!newCategoryIconPicked) newCategoryIcon = name ? guessIcon(name) : null;

  const preview = $("category-preview");
  preview.textContent = newCategoryIcon || [...name][0] || "✨";
  preview.classList.toggle("empty", !name && !newCategoryIcon);
  $("new-category-save").classList.toggle("ready", Boolean(name));

  const grid = $("icon-grid");
  grid.replaceChildren();
  for (const icon of ICON_CHOICES[entryKind]) {
    const button = element("button", "icon-choice", icon);
    button.type = "button";
    button.setAttribute("aria-label", `Ikona ${icon}`);
    button.setAttribute("aria-pressed", String(icon === newCategoryIcon));
    button.addEventListener("click", () => {
      newCategoryIcon = icon;
      newCategoryIconPicked = true;
      renderCategorySheet();
      preview.classList.remove("pop");
      preview.getBoundingClientRect(); // restart animacji
      preview.classList.add("pop");
    });
    grid.append(button);
  }
}

function addCategory(event) {
  event.preventDefault();
  const name = capitalizeFirst($("new-category").value.trim());
  if (!name) {
    $("new-category").focus();
    return;
  }
  const { categories } = ledger(entryKind);
  const lowerName = name.toLowerCase();
  const existing = categories.find((c) => c.toLowerCase() === lowerName || displayName(c).toLowerCase() === lowerName);
  if (existing) {
    selectedCategory = existing;
  } else {
    const previousIcon = data.icons[name];
    categories.push(name);
    if (newCategoryIcon) data.icons[name] = newCategoryIcon;
    else delete data.icons[name];
    if (!saveData()) {
      categories.pop();
      if (previousIcon) data.icons[name] = previousIcon;
      showToast(t("error.saveCategory"));
      return;
    }
    selectedCategory = name;
  }
  renderCategories();
  renderRecent();
  renderSummary();
  closeCategorySheet();
}

function showSavedMessage(message) {
  $("form-ok").textContent = message;
  $("form-ok").hidden = false;
  clearTimeout(okMessageTimer);
  okMessageTimer = setTimeout(() => { $("form-ok").hidden = true; }, 3000);

  // Krótki błysk plazmy potwierdza zapis.
  const line = document.querySelector(".amount-line");
  line.classList.add("saved");
  setTimeout(() => line.classList.remove("saved"), 700);
}

function showFormError(message) {
  $("form-ok").hidden = true;
  $("form-error").textContent = message;
  $("form-error").hidden = false;
}

function submitExpense(event) {
  event.preventDefault();
  $("form-error").hidden = true;
  $("form-ok").hidden = true;

  setCategoryPanel(false);
  const grosze = parseAmount($("amount").value);
  if (grosze === null) return showFormError(t("error.amount"));
  if (!selectedCategory) return showFormError(kindText(entryKind).pickCategory);

  const note = capitalizeFirst($("note").value.trim());
  const { transactions } = ledger(entryKind);
  const transaction = { id: Date.now(), grosze, category: selectedCategory, date: selectedDate };
  if (note) transaction.note = note;
  transactions.push(transaction);
  if (!saveData()) {
    transactions.pop();
    return showFormError(t("error.saveEntry"));
  }

  showSavedMessage(t("saved", { amount: formatMoney(grosze), what: note || displayName(selectedCategory) }));
  $("amount").value = "";
  $("note").value = "";
  selectedCategory = null;
  updateAmountField();
  renderCategories();
  renderRecent();
}

function deleteTransaction(transaction, kind) {
  const { transactions } = ledger(kind);
  const index = transactions.indexOf(transaction);
  transactions.splice(index, 1);
  if (!saveData()) {
    transactions.splice(index, 0, transaction);
    showToast(t("error.deleteEntry"));
    return;
  }
  refreshEntries();
  showToast(t("entryDeleted", { what: transaction.note || displayName(transaction.category), amount: formatMoney(transaction.grosze) }), () => {
    transactions.splice(Math.min(index, transactions.length), 0, transaction);
    if (saveData()) refreshEntries();
  });
}

function refreshEntries() {
  renderCategories();
  renderRecent();
  renderSummary();
}

// Jeden wiersz wpisu: na pierwszym planie opis, a pod nim mniejsza kategoria (lista)
// albo data (podsumowanie, gdzie kategoria jest już w nagłówku). Wpływy mają znak "+".
// Stuknięcie w wiersz otwiera edycję.
function transactionRow(transaction, showCategory, kind) {
  const row = element("button", "tx");
  row.type = "button";
  const main = element("span", "tx-main");
  if (showCategory) {
    row.append(avatar(transaction.category));
    main.append(element("span", "tx-title", transaction.note || displayName(transaction.category)));
    if (transaction.note) main.append(element("span", "tx-sub", displayName(transaction.category)));
  } else {
    if (transaction.note) main.append(element("span", "tx-title", transaction.note));
    main.append(element("span", "tx-sub", formatDate(transaction.date)));
  }

  // Plus zostaje tylko na liście karty Zarobki; w Bilansie kwoty są bez znaku.
  const amountText = (kind === "income" && showCategory ? "+" : "") + formatMoney(transaction.grosze);
  const amount = element("span", "tx-amount", amountText);
  amount.classList.toggle("income", kind === "income");
  amount.classList.toggle("savings", kind === "savings");
  row.append(main, amount);
  row.setAttribute("aria-label", t("entryAria", { what: kindText(kind).one, name: transaction.note || displayName(transaction.category), amount: amountText }));
  row.addEventListener("click", () => openEditSheet(transaction, kind));
  return row;
}

function renderSavingsOverview() {
  const total = sumOf(data.savings);
  const box = $("savings-overview");
  box.hidden = entryKind !== "savings" || total === 0;
  if (box.hidden) return;
  $("savings-total").textContent = formatNumber(total);

  const totals = new Map();
  for (const { category, grosze } of data.savings) totals.set(category, (totals.get(category) || 0) + grosze);
  const places = $("savings-places");
  places.replaceChildren();
  for (const [name, value] of [...totals.entries()].sort((a, b) => b[1] - a[1])) {
    const row = element("div", "where-row");
    const head = element("div", "where-head");
    head.append(
      avatar(name),
      element("span", "where-name", displayName(name)),
      element("span", "where-percent", `${Math.round((value / total) * 100)}%`),
      element("span", "where-value", formatMoney(value)),
    );
    const track = element("div", "where-track");
    const fill = element("span", "where-fill");
    fill.style.width = `${Math.max(1, (value / total) * 100)}%`;
    track.append(fill);
    row.append(head, track);
    places.append(row);
  }
}

function renderRecent() {
  renderSavingsOverview();
  renderPots();
  renderNetWorth();
  const list = $("recent-list");
  list.replaceChildren();
  const recent = [...ledger(entryKind).transactions].sort(sortNewestFirst).slice(0, RECENT_LIMIT);
  if (recent.length === 0) {
    list.append(element("p", "empty", kindText(entryKind).empty));
    return;
  }
  let currentDate = null;
  let card = null;
  for (const transaction of recent) {
    if (transaction.date !== currentDate) {
      currentDate = transaction.date;
      card = element("div", "card list-card");
      list.append(element("div", "day-label", dayLabel(currentDate)), card);
    }
    card.append(transactionRow(transaction, true, entryKind));
  }
}

// --- Zakładka Podsumowanie ---

function renderPeriodControls() {
  for (const id of ["mode-month", "charts-mode-month"]) {
    $(id).setAttribute("aria-pressed", String(summaryMode === "month"));
  }
  for (const id of ["mode-year", "charts-mode-year"]) {
    $(id).setAttribute("aria-pressed", String(summaryMode === "year"));
  }
}

// Podsumowanie i Wykresy pokazują ten sam wybrany okres.
function refreshPeriodViews() {
  renderSummary();
  if (activeTab === "wykresy") renderCharts();
}

// Lata, w których coś wpisano, oraz bieżący i wybrany rok, od najnowszego.
function availableYears() {
  const years = allEntries().map((entry) => Number(entry.date.slice(0, 4)));
  years.push(new Date().getFullYear(), summaryYear);
  return [...new Set(years)].sort((a, b) => b - a);
}

// --- Panel wyboru miesiąca lub roku ---

function openPeriodSheet(mode) {
  summaryMode = mode;
  periodSheetYear = summaryYear;
  refreshPeriodViews();
  renderPeriodSheet();
  openSheet("period-sheet", "period-backdrop");
  $("period-title").focus({ preventScroll: true });
}

function closePeriodSheet() {
  const prefix = activeTab === "wykresy" ? "charts-mode-" : "mode-";
  closeSheet("period-sheet", "period-backdrop", prefix + summaryMode);
}

function periodOption(label, selected, disabled, hasEntries, onPick) {
  const button = element("button", "period-option", label);
  button.type = "button";
  button.setAttribute("aria-pressed", String(selected));
  button.disabled = disabled;
  button.classList.toggle("has-entries", hasEntries);
  button.addEventListener("click", onPick);
  return button;
}

function renderPeriodSheet() {
  const today = new Date();
  const isMonth = summaryMode === "month";
  const years = availableYears();
  const used = new Set(allEntries().map((entry) => entry.date.slice(0, 7)));
  const grid = $("period-grid");

  $("period-title").textContent = t(isMonth ? "pickMonth" : "pickYear");
  $("period-year-row").hidden = !isMonth;
  grid.replaceChildren();

  if (!isMonth) {
    for (const year of years) {
      const hasEntries = [...used].some((key) => key.startsWith(`${year}-`));
      grid.append(periodOption(String(year), year === summaryYear, false, hasEntries, () => {
        summaryYear = year;
        // Po zmianie roku miesiąc nie może wskazywać przyszłości.
        if (year === today.getFullYear()) summaryMonth = Math.min(summaryMonth, today.getMonth());
        closePeriodSheet();
        refreshPeriodViews();
      }));
    }
    return;
  }

  $("period-year").textContent = String(periodSheetYear);
  $("period-year-prev").disabled = periodSheetYear <= years[years.length - 1];
  $("period-year-next").disabled = periodSheetYear >= today.getFullYear();
  MONTHS.forEach((name, month) => {
    const key = `${periodSheetYear}-${String(month + 1).padStart(2, "0")}`;
    const isFuture = periodSheetYear === today.getFullYear() && month > today.getMonth();
    const selected = month === summaryMonth && periodSheetYear === summaryYear;
    grid.append(periodOption(name, selected, isFuture, used.has(key), () => {
      summaryMonth = month;
      summaryYear = periodSheetYear;
      closePeriodSheet();
      refreshPeriodViews();
    }));
  });
}

function transactionsInPeriod(kind) {
  const prefix = summaryMode === "month"
    ? `${summaryYear}-${String(summaryMonth + 1).padStart(2, "0")}`
    : String(summaryYear);
  return ledger(kind).transactions.filter((t) => t.date.startsWith(prefix));
}

function periodLabel() {
  return summaryMode === "month"
    ? `${MONTHS[summaryMonth]} ${summaryYear}`
    : t("yearLabel", { year: summaryYear });
}

// Bilans okresu: zarobki minus wydatki i wpłaty, a pasek pokazuje, na co poszły zarobki.
function renderBalance(incomeTotal, expenseTotal, savedTotal) {
  const net = incomeTotal - expenseTotal - savedTotal;
  const sign = net < 0 ? "−" : "";
  $("total-label").textContent = t("balanceLabel", { period: periodLabel() });
  $("total-amount").textContent = sign + formatNumber(Math.abs(net));

  let note = t("balance.empty");
  if (incomeTotal === 0 && expenseTotal + savedTotal > 0) note = t("balance.noIncome");
  else if (net < 0) note = t(savedTotal > 0 ? "balance.overSaved" : "balance.over", { amount: formatMoney(-net) });
  else if (incomeTotal > 0) note = t("balance.left", { percent: Math.round((net / incomeTotal) * 100) });
  $("balance-note").textContent = note;

  $("balance-bar").hidden = incomeTotal === 0;
  const base = Math.max(incomeTotal, expenseTotal + savedTotal, 1);
  $("balance-fill").style.width = `${(expenseTotal / base) * 100}%`;
  $("balance-saved").style.width = `${(savedTotal / base) * 100}%`;

  // Kafelki liczą tylko kategorie zaznaczone w filtrze; bilans wyżej zawsze obejmuje wszystko.
  $("income-total").textContent = formatNumber(selectedTotal("income"));
  $("expense-total").textContent = formatNumber(selectedTotal("expense"));
  $("savings-sum").textContent = formatNumber(selectedTotal("savings"));
  for (const kind of ["income", "expense", "savings"]) {
    $(`view-${kind}`).setAttribute("aria-pressed", String(summaryView === kind));
    $(`view-${kind}`).classList.toggle("filtered", hiddenCategories[kind].size > 0);
  }
}

function selectedTotal(kind) {
  const hidden = hiddenCategories[kind];
  return sumOf(transactionsInPeriod(kind).filter((entry) => !hidden.has(entry.category)));
}

function renderSummary() {
  renderPeriodControls();
  renderBalance(sumOf(transactionsInPeriod("income")), sumOf(transactionsInPeriod("expense")), sumOf(transactionsInPeriod("savings")));

  const view = summaryView;
  const text = kindText(view);
  const hidden = hiddenCategories[view];
  const { categories } = ledger(view);
  const inPeriod = transactionsInPeriod(view);
  const groups = categories
    .filter((name) => !hidden.has(name))
    .map((name) => {
      const transactions = inPeriod.filter((t) => t.category === name).sort(sortNewestFirst);
      return { name, transactions, total: sumOf(transactions) };
    })
    .sort((a, b) => b.total - a.total);

  const filtered = hidden.size > 0;
  const visibleTotal = groups.reduce((sum, g) => sum + g.total, 0);
  $("filter-open").textContent = filtered
    ? `${t("filter")} (${categories.length - hidden.size}/${categories.length})`
    : t("filter");
  $("filter-open").classList.toggle("active", filtered);
  $("filtered-note").hidden = !filtered;
  $("filtered-note").textContent = t("selectedSum", { label: text.filterSelected });

  const list = $("summary-list");
  list.dataset.mode = view;
  list.replaceChildren();
  if (groups.length === 0) {
    list.append(element("p", "empty", text.filterNone));
    return;
  }
  for (const group of groups) {
    list.append(categoryCard(group, visibleTotal, view));
  }
}

// Kategoria z sumą i paskiem udziału; kliknięcie rozwija jej transakcje.
function categoryCard(group, periodTotal, kind) {
  const card = element("div", "card category-group");
  const isEmpty = group.transactions.length === 0;
  const expandedSet = expandedCategories[kind];
  const expanded = expandedSet.has(group.name) && !isEmpty;

  const row = element("button", "category-row");
  row.type = "button";
  row.disabled = isEmpty;
  row.setAttribute("aria-expanded", String(expanded));
  row.addEventListener("click", () => {
    if (expanded) expandedSet.delete(group.name);
    else expandedSet.add(group.name);
    renderSummary();
  });

  const info = element("span", "category-info");
  info.append(
    element("span", "category-name", displayName(group.name)),
    element("span", "category-count", countLabel(group.transactions.length, kind)),
  );
  const head = element("span", "category-head");
  const isIncome = kind === "income" && !isEmpty;
  const sum = element("span", "category-sum", formatMoney(group.total));
  sum.classList.toggle("income", isIncome);
  sum.classList.toggle("savings", kind === "savings" && !isEmpty);
  head.append(avatar(group.name), info, sum);
  row.append(head);

  if (!isEmpty) {
    const bar = element("span", "share-bar");
    bar.style.display = "block";
    const fill = element("span");
    fill.style.width = `${(group.total / periodTotal) * 100}%`;
    bar.append(fill);
    row.append(bar);
  }
  card.append(row);

  if (expanded) {
    const details = element("div", "category-transactions");
    if (summaryMode === "year") appendYearMonths(details, group, kind);
    else for (const transaction of group.transactions) details.append(transactionRow(transaction, false, kind));
    card.append(details);
  }
  return card;
}

// Widok roczny: najpierw miesiące, a wydatki dopiero po stuknięciu w miesiąc.
function appendYearMonths(details, group, kind) {
  const months = new Map();
  for (const transaction of group.transactions) {
    const month = transaction.date.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(transaction);
  }
  for (const [month, transactions] of [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const key = `${kind}|${group.name}|${month}`;
    const expanded = expandedMonths.has(key);
    const row = element("button", "month-row");
    row.type = "button";
    row.setAttribute("aria-expanded", String(expanded));
    const info = element("span", "category-info");
    info.append(
      element("span", "month-name", MONTHS[Number(month.slice(5)) - 1]),
      element("span", "category-count", countLabel(transactions.length, kind)),
    );
    const sum = element("span", "month-sum", formatMoney(sumOf(transactions)));
    sum.classList.toggle("income", kind === "income");
    sum.classList.toggle("savings", kind === "savings");
    row.append(info, sum);
    row.addEventListener("click", () => {
      if (expanded) expandedMonths.delete(key);
      else expandedMonths.add(key);
      renderSummary();
    });
    details.append(row);
    if (expanded) {
      const entries = element("div", "month-transactions");
      for (const transaction of transactions) entries.append(transactionRow(transaction, false, kind));
      details.append(entries);
    }
  }
}

// --- Filtr kategorii ---

function renderFilterOptions() {
  const box = $("filter-options");
  const hidden = hiddenCategories[summaryView];
  $("filter-title").textContent = kindText(summaryView).filterTitle;
  box.replaceChildren();
  for (const name of ledger(summaryView).categories) {
    const label = element("label", "filter-option");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.checked = !hidden.has(name);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) hidden.delete(name);
      else hidden.add(name);
      renderSummary();
    });
    label.append(checkbox, element("span", "", displayName(name)));
    box.append(label);
  }
}

function openFilter() {
  renderFilterOptions();
  $("filter-panel").hidden = false;
  $("filter-backdrop").hidden = false;
  $("filter-close").focus();
}

function closeFilter() {
  if ($("filter-panel").hidden) return;
  $("filter-panel").hidden = true;
  $("filter-backdrop").hidden = true;
  $("filter-open").focus();
}

// --- Panel edycji wpisu ---

function amountForEditing(grosze) {
  const text = (grosze / 100).toFixed(2).replace(/\.00$/, "");
  return language === "pl" ? text.replace(".", ",") : text;
}

function openEditSheet(transaction, kind) {
  editing = { transaction, kind, category: transaction.category, date: transaction.date };
  const text = kindText(kind);
  $("edit-sheet").dataset.mode = kind;
  $("edit-title").textContent = t("editEntry", { what: text.one });
  $("edit-delete").textContent = t("deleteEntry", { what: text.one });
  $("edit-amount").value = amountForEditing(transaction.grosze);
  $("edit-note").value = transaction.note || "";
  $("edit-note").placeholder = text.notePlaceholder;
  $("edit-error").hidden = true;
  fitAmountField($("edit-amount"), $("edit-amount-sizer"));
  renderEditDate();
  renderEditCategories();
  updateEditSaveButton();
  openSheet("edit-sheet", "edit-backdrop");
  $("edit-title").focus({ preventScroll: true });
  const chosen = document.querySelector('.edit-chip[aria-pressed="true"]');
  if (chosen) chosen.scrollIntoView({ block: "nearest", inline: "center" });
}

function closeEditSheet() {
  closeSheet("edit-sheet", "edit-backdrop", activeNavId());
  editing = null;
}

function renderEditDate() {
  $("edit-date-value").textContent = formatDate(editing.date);
}

function renderEditCategories() {
  const box = $("edit-categories");
  const left = box.scrollLeft;
  box.replaceChildren();
  for (const name of ledger(editing.kind).categories) {
    const chip = element("button", "edit-chip");
    chip.type = "button";
    chip.setAttribute("aria-pressed", String(name === editing.category));
    chip.append(avatar(name), element("span", "", displayName(name)));
    chip.addEventListener("click", () => {
      editing.category = name;
      renderEditCategories();
      updateEditSaveButton();
    });
    box.append(chip);
  }
  box.scrollLeft = left;
}

function editHasChanges() {
  const { transaction, category, date } = editing;
  return parseAmount($("edit-amount").value) !== transaction.grosze
    || category !== transaction.category
    || date !== transaction.date
    || capitalizeFirst($("edit-note").value.trim()) !== (transaction.note || "");
}

function updateEditSaveButton() {
  const valid = parseAmount($("edit-amount").value) !== null;
  $("edit-save").classList.toggle("ready", valid && editHasChanges());
}

function saveEdit(event) {
  event.preventDefault();
  const grosze = parseAmount($("edit-amount").value);
  if (grosze === null) {
    $("edit-error").textContent = t("error.amount");
    $("edit-error").hidden = false;
    return;
  }
  if (!editHasChanges()) {
    closeEditSheet();
    return;
  }

  const { transaction, category, date } = editing;
  const before = { ...transaction };
  const restore = () => {
    delete transaction.note;
    Object.assign(transaction, before);
  };
  const note = capitalizeFirst($("edit-note").value.trim());
  Object.assign(transaction, { grosze, category, date });
  if (note) transaction.note = note;
  else delete transaction.note;

  if (!saveData()) {
    restore();
    $("edit-error").textContent = t("error.saveEdit");
    $("edit-error").hidden = false;
    return;
  }
  closeEditSheet();
  refreshEntries();
  showToast(t("changesSaved"), () => {
    restore();
    if (saveData()) refreshEntries();
  });
}

function deleteEditedTransaction() {
  const { transaction, kind } = editing;
  closeEditSheet();
  deleteTransaction(transaction, kind);
}

// --- Kopia danych ---

function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function dataCounts(source) {
  return {
    expenses: source.transactions.length,
    incomes: source.incomes.length,
    savings: source.savings.length,
  };
}

function isBackupDue() {
  const { expenses, incomes, savings } = dataCounts(data);
  const total = expenses + incomes + savings;
  if (total === 0) return false;
  const last = Number(readLocal(LAST_BACKUP_KEY));
  if (!last) return total >= BACKUP_FIRST_AFTER_ENTRIES;
  return Date.now() - last >= BACKUP_DUE_DAYS * DAY_MS;
}

function updateBackupIndicator() {
  const due = isBackupDue();
  for (const button of document.querySelectorAll(".settings-open")) button.classList.toggle("due", due);
  $("backup-open").classList.toggle("due", due);
}

// Przypomnienie pojawia się najwyżej raz w tygodniu, żeby nie przeszkadzać.
function maybeRemindBackup() {
  if (!isBackupDue()) return;
  const reminded = Number(readLocal(BACKUP_REMINDER_KEY));
  if (Date.now() - reminded < BACKUP_REMINDER_EVERY_DAYS * DAY_MS) return;
  writeLocal(BACKUP_REMINDER_KEY, String(Date.now()));
  showToast(t("backup.remind"), openBackupSheet, t("backup.remindAction"));
}

function backupStatusText() {
  const last = Number(readLocal(LAST_BACKUP_KEY));
  return last ? t("backup.last", { date: formatDate(dateToString(new Date(last))) }) : t("backup.none");
}

function countsText(counts) {
  const parts = [countLabel(counts.expenses, "expense"), countLabel(counts.incomes, "income")];
  if (counts.savings > 0) parts.push(countLabel(counts.savings, "savings"));
  return parts.join(", ");
}

function renderBackupSheet() {
  const last = Number(readLocal(LAST_BACKUP_KEY));
  const due = isBackupDue();
  const { expenses, incomes, savings } = dataCounts(data);
  $("backup-title").textContent = t(last && !due ? "backup.safe" : "backup.unsafe");
  $("backup-status").textContent = backupStatusText();
  $("backup-count-expenses").textContent = expenses;
  $("backup-count-incomes").textContent = incomes;
  $("backup-count-savings").textContent = savings;
  $("backup-actions").hidden = Boolean(pendingImport);
  $("backup-confirm").hidden = !pendingImport;
  if (pendingImport) {
    const date = pendingImport.date ? t("backup.from", { date: formatDate(pendingImport.date) }) : "";
    $("backup-confirm-text").textContent = t("backup.confirm", { date, counts: countsText(dataCounts(pendingImport.data)) });
  }
}

function openBackupSheet() {
  pendingImport = null;
  $("backup-error").hidden = true;
  renderBackupSheet();
  openSheet("backup-sheet", "backup-backdrop");
  $("backup-title").focus({ preventScroll: true });
}

function closeBackupSheet() {
  closeSheet("backup-sheet", "backup-backdrop", activeNavId());
  pendingImport = null;
}

function showBackupError(message) {
  $("backup-error").textContent = message;
  $("backup-error").hidden = false;
}

// Na telefonie plik idzie przez systemowe "Udostępnij" (Pliki, iCloud, Dysk Google),
// a tam, gdzie to niedostępne, jest zwyczajnie pobierany.
async function deliverBackupFile(json, name) {
  const file = new File([json], name, { type: "application/json" });
  const isPhone = window.matchMedia("(pointer: coarse)").matches;
  if (isPhone && navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return;
  }
  const url = URL.createObjectURL(file);
  const link = element("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function saveBackup() {
  $("backup-error").hidden = true;
  const payload = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
  try {
    await deliverBackupFile(JSON.stringify(payload, null, 2), `moje-wydatki-kopia-${todayString()}.json`);
  } catch (error) {
    if (error.name !== "AbortError") showBackupError(t("backup.saveError"));
    return;
  }
  writeLocal(LAST_BACKUP_KEY, String(Date.now()));
  updateBackupIndicator();
  renderBackupSheet();
  const icon = $("backup-icon");
  icon.classList.remove("pop");
  icon.getBoundingClientRect(); // restart animacji
  icon.classList.add("pop");
}

function isValidDate(text) {
  return typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text);
}

function cleanEntries(list) {
  if (!Array.isArray(list)) throw new Error("Brak listy wpisów");
  return list.map((entry) => {
    if (!Number.isSafeInteger(entry.grosze) || entry.grosze <= 0) throw new Error("Zła kwota");
    if (typeof entry.category !== "string" || !entry.category) throw new Error("Zła kategoria");
    if (!isValidDate(entry.date)) throw new Error("Zła data");
    const clean = {
      id: Number.isFinite(entry.id) ? entry.id : Date.now(),
      grosze: entry.grosze,
      category: entry.category,
      date: entry.date,
    };
    if (typeof entry.note === "string" && entry.note) clean.note = entry.note;
    return clean;
  });
}

// Każda kategoria użyta we wpisach musi być na liście, inaczej wpisy zniknęłyby z sum.
function cleanCategories(list, entries) {
  const names = Array.isArray(list) ? list.filter((name) => typeof name === "string" && name) : [];
  for (const { category } of entries) {
    if (!names.includes(category)) names.push(category);
  }
  return names;
}

// Z pliku bierzemy tylko znane pola i sprawdzamy każdy wpis.
function parseBackup(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.app !== BACKUP_APP || !parsed.data) throw new Error("To nie jest kopia");
  const source = parsed.data;
  const transactions = cleanEntries(source.transactions);
  const incomes = cleanEntries(source.incomes);
  // Kopie sprzed wprowadzenia karty Odkładam nie mają wpłat.
  const savings = cleanEntries(source.savings || []);
  const icons = source.icons && typeof source.icons === "object" ? source.icons : {};
  const exportedAt = new Date(parsed.exportedAt);
  return {
    date: Number.isNaN(exportedAt.getTime()) ? null : dateToString(exportedAt),
    data: normalizeData({
      categories: cleanCategories(source.categories, transactions),
      transactions,
      incomeCategories: cleanCategories(source.incomeCategories, incomes),
      incomes,
      savingsCategories: source.savingsCategories || savings.length > 0
        ? cleanCategories(source.savingsCategories, savings)
        : undefined,
      savings,
      ...cleanPotsFromBackup(source),
      netWorth: cleanNetWorthFromBackup(source),
      icons: Object.fromEntries(Object.entries(icons).filter(([, icon]) => typeof icon === "string")),
    }),
  };
}

async function chooseBackupFile(event) {
  const [file] = event.target.files;
  event.target.value = ""; // ten sam plik można wybrać ponownie
  if (!file) return;
  $("backup-error").hidden = true;
  if (file.size > BACKUP_MAX_BYTES) {
    showBackupError(t("backup.tooBig"));
    return;
  }
  try {
    pendingImport = parseBackup(await file.text());
  } catch {
    pendingImport = null;
    showBackupError(t("backup.invalid"));
    return;
  }
  renderBackupSheet();
}

function replaceAllData(next) {
  for (const key of Object.keys(data)) delete data[key];
  Object.assign(data, next);
  selectedCategory = null;
  drafts.expense = null;
  drafts.income = null;
  drafts.savings = null;
  for (const kind of ["expense", "income", "savings"]) {
    hiddenCategories[kind].clear();
    expandedCategories[kind].clear();
  }
  expandedMonths.clear();
  $("note").value = "";
}

function confirmImport() {
  const before = JSON.parse(JSON.stringify(data));
  const beforeText = JSON.stringify(before);
  // Stan sprzed wczytania zostaje też w pamięci telefonu, na wszelki wypadek.
  writeLocal(BEFORE_IMPORT_KEY, beforeText);
  replaceAllData(pendingImport.data);
  if (!saveData()) {
    replaceAllData(before);
    pendingImport = null;
    renderBackupSheet();
    showBackupError(t("backup.loadError"));
    refreshEntries();
    return;
  }
  const counts = dataCounts(data);
  closeBackupSheet();
  refreshEntries();
  updateBackupIndicator();
  showToast(t("backup.loaded", { counts: countsText(counts) }), () => {
    replaceAllData(before);
    if (saveData()) refreshEntries();
    updateBackupIndicator();
  });
}

// --- Ustawienia ---

function renderSettings() {
  for (const button of document.querySelectorAll(".language-option")) {
    button.setAttribute("aria-pressed", String(button.dataset.language === language));
  }
  $("settings-backup-status").textContent = backupStatusText();
}

function openSettings() {
  renderSettings();
  $("settings-panel").hidden = false;
  $("settings-backdrop").hidden = false;
  $("settings-title").focus({ preventScroll: true });
}

function closeSettings() {
  if ($("settings-panel").hidden) return;
  $("settings-panel").hidden = true;
  $("settings-backdrop").hidden = true;
}

// Zmiana języka od razu przerysowuje cały ekran; dane pozostają bez zmian.
function setLanguage(next) {
  if (next === language) return;
  saveLanguage(next);
  applyStaticTexts();
  renderEntryTexts();
  fitAmountField($("amount"), $("amount-sizer"));
  updateDateLabel();
  renderCategories();
  renderRecent();
  renderSummary();
  if (activeTab === "wykresy") renderCharts();
  if (activeTab === "kalkulatory") renderCalculators();
  renderSettings();
  updateTabIndicator();
}

// --- Przesuwanie palcem między kartami ---

// Tam poziomy ruch palca robi już coś innego: wybór punktu na wykresie, usuwanie kategorii, pisanie.
const TAB_SWIPE_IGNORE = ".chart-hit-scrub, #category-panel, input";
const TAB_SWIPE_LOCK_PX = 10;
const TAB_SWIPE_FLICK_PX = 40;
const TAB_SWIPE_FLICK_MS = 250;
const TAB_SWIPE_MS = 180;

function setupTabSwipe() {
  const main = document.querySelector("main");
  let start = null;
  let animating = false;

  const neighbour = (dx) => TABS[TABS.indexOf(activeTab) + (dx < 0 ? 1 : -1)];

  const settleBack = () => {
    main.classList.remove("swiping");
    main.style.transform = "";
  };

  // Stary ekran wyjeżdża, nowy wjeżdża z drugiej strony.
  const slideTo = (tab, direction) => {
    animating = true;
    main.classList.remove("swiping");
    main.style.transform = `translateX(${direction * 100}%)`;
    setTimeout(() => {
      main.classList.add("swiping");
      if (document.activeElement) document.activeElement.blur();
      showTab(tab);
      main.style.transform = `translateX(${-direction * 100}%)`;
      main.getBoundingClientRect(); // przeglądarka musi poznać pozycję startową
      main.classList.remove("swiping");
      main.style.transform = "";
      setTimeout(() => { animating = false; }, TAB_SWIPE_MS);
    }, TAB_SWIPE_MS);
  };

  main.addEventListener("touchstart", (event) => {
    start = null;
    if (animating || event.touches.length !== 1 || event.target.closest(TAB_SWIPE_IGNORE)) return;
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY, time: Date.now(), locked: false };
  }, { passive: true });

  main.addEventListener("touchmove", (event) => {
    if (!start) return;
    if (event.touches.length !== 1) {
      if (start.locked) settleBack();
      start = null;
      return;
    }
    const dx = event.touches[0].clientX - start.x;
    const dy = event.touches[0].clientY - start.y;
    if (!start.locked) {
      if (Math.abs(dx) < TAB_SWIPE_LOCK_PX && Math.abs(dy) < TAB_SWIPE_LOCK_PX) return;
      // Ruch bardziej pionowy niż poziomy to zwykłe przewijanie.
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) {
        start = null;
        return;
      }
      start.locked = true;
      main.classList.add("swiping");
      hideChartTooltip();
    }
    event.preventDefault();
    // Na brzegu nie ma dokąd przejść, więc ekran tylko delikatnie stawia opór.
    main.style.transform = `translateX(${neighbour(dx) ? dx : dx * 0.25}px)`;
  }, { passive: false });

  main.addEventListener("touchend", (event) => {
    if (!start || !start.locked) {
      start = null;
      return;
    }
    const dx = event.changedTouches[0].clientX - start.x;
    const isFlick = Math.abs(dx) > TAB_SWIPE_FLICK_PX && Date.now() - start.time < TAB_SWIPE_FLICK_MS;
    const farEnough = Math.abs(dx) > main.offsetWidth * 0.25;
    const tab = neighbour(dx);
    start = null;
    if (tab && (farEnough || isFlick)) slideTo(tab, dx < 0 ? -1 : 1);
    else settleBack();
  });

  main.addEventListener("touchcancel", () => {
    if (start && start.locked) settleBack();
    start = null;
  });
}

// --- Start aplikacji ---

for (const [item, tabs] of Object.entries(NAV_ITEMS)) {
  $("nav-" + item).addEventListener("click", () => showTab(tabs[0]));
  if (tabs.length > 1) for (const tab of tabs) $("sub-" + tab).addEventListener("click", () => showTab(tab));
}
$("expense-form").addEventListener("submit", submitExpense);
$("amount").addEventListener("input", updateAmountField);
$("category-toggle").addEventListener("click", () => {
  setCategoryPanel($("category-panel").hidden);
});
$("category-new").addEventListener("click", openCategorySheet);
$("category-backdrop").addEventListener("click", closeCategorySheet);
$("category-sheet").addEventListener("submit", addCategory);
$("new-category").addEventListener("input", () => {
  capitalizeInput($("new-category"));
  renderCategorySheet();
});
document.addEventListener("click", (event) => {
  const inside = ["category-toggle", "category-panel", "toast"].some((id) => $(id).contains(event.target));
  if (!inside) setCategoryPanel(false);
});
$("toast-undo").addEventListener("click", () => {
  const undo = toastUndo;
  hideToast();
  if (undo) undo();
});
$("note").addEventListener("input", () => {
  capitalizeInput($("note"));
  renderNoteSuggestions();
});

$("date-toggle").addEventListener("click", openEntryCalendar);
$("edit-backdrop").addEventListener("click", closeEditSheet);
$("edit-sheet").addEventListener("submit", saveEdit);
$("edit-delete").addEventListener("click", deleteEditedTransaction);
$("edit-date").addEventListener("click", () => {
  openCalendar(editing.date, (date) => {
    editing.date = date;
    renderEditDate();
    updateEditSaveButton();
  }, "edit-date", editing.kind);
});
$("edit-amount").addEventListener("input", () => {
  fitAmountField($("edit-amount"), $("edit-amount-sizer"));
  $("edit-error").hidden = true;
  updateEditSaveButton();
});
$("edit-note").addEventListener("input", () => {
  capitalizeInput($("edit-note"));
  updateEditSaveButton();
});
for (const button of document.querySelectorAll(".settings-open")) button.addEventListener("click", openSettings);
for (const button of document.querySelectorAll(".language-option")) {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
}
$("settings-close").addEventListener("click", closeSettings);
$("settings-backdrop").addEventListener("click", closeSettings);
$("backup-open").addEventListener("click", () => {
  closeSettings();
  openBackupSheet();
});
$("backup-backdrop").addEventListener("click", closeBackupSheet);
$("backup-save").addEventListener("click", saveBackup);
$("backup-load").addEventListener("click", () => $("backup-file").click());
$("backup-file").addEventListener("change", chooseBackupFile);
$("backup-confirm-yes").addEventListener("click", confirmImport);
$("backup-confirm-no").addEventListener("click", () => {
  pendingImport = null;
  renderBackupSheet();
});
$("calendar-backdrop").addEventListener("click", closeCalendar);
$("calendar-prev").addEventListener("click", () => shiftCalendarMonth(-1));
$("calendar-next").addEventListener("click", () => shiftCalendarMonth(1));
$("calendar-today").addEventListener("click", () => pickDate(todayString()));
$("calendar-yesterday").addEventListener("click", () => pickDate(yesterdayString()));
$("calendar-grid").addEventListener("pointerdown", (event) => { calendarSwipeStartX = event.clientX; });
$("calendar-grid").addEventListener("pointerup", (event) => {
  if (calendarSwipeStartX === null) return;
  const dx = event.clientX - calendarSwipeStartX;
  calendarSwipeStartX = null;
  if (Math.abs(dx) >= CALENDAR_SWIPE_PX) shiftCalendarMonth(dx < 0 ? 1 : -1);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshToday();
});
window.addEventListener("resize", updateTabIndicator);
// iPhone ignoruje zakaz powiększania z nagłówka strony, więc blokujemy też sam gest.
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

// Klawiatura telefonu zasłania dół ekranu, więc panele unoszą się nad nią.
if (window.visualViewport) {
  const updateKeyboardOffset = () => {
    const viewport = window.visualViewport;
    const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty("--keyboard", `${offset}px`);
  };
  window.visualViewport.addEventListener("resize", updateKeyboardOffset);
  window.visualViewport.addEventListener("scroll", updateKeyboardOffset);
}

$("mode-month").addEventListener("click", () => openPeriodSheet("month"));
$("mode-year").addEventListener("click", () => openPeriodSheet("year"));
$("charts-mode-month").addEventListener("click", () => openPeriodSheet("month"));
$("charts-mode-year").addEventListener("click", () => openPeriodSheet("year"));
$("period-backdrop").addEventListener("click", closePeriodSheet);
$("period-year-prev").addEventListener("click", () => { periodSheetYear -= 1; renderPeriodSheet(); });
$("period-year-next").addEventListener("click", () => { periodSheetYear += 1; renderPeriodSheet(); });

$("view-income").addEventListener("click", () => { summaryView = "income"; renderSummary(); });
$("view-expense").addEventListener("click", () => { summaryView = "expense"; renderSummary(); });
$("view-savings").addEventListener("click", () => { summaryView = "savings"; renderSummary(); });

$("filter-open").addEventListener("click", openFilter);
$("filter-close").addEventListener("click", closeFilter);
$("filter-backdrop").addEventListener("click", closeFilter);
$("filter-clear").addEventListener("click", () => {
  hiddenCategories[summaryView].clear();
  renderFilterOptions();
  renderSummary();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    // Kalendarz może leżeć na panelu edycji: Esc zamyka najpierw tylko jego.
    if (!$("calendar-sheet").hidden) {
      closeCalendar();
      return;
    }
    closeFilter();
    closeSettings();
    closePotSheets();
    setCategoryPanel(false);
    closeCategorySheet();
    closePeriodSheet();
    if (editing) closeEditSheet();
    closeBackupSheet();
  }
});

applyStaticTexts();
setupPots();
setupNetWorth();
setupCalculators();
updateDateLabel();
renderEntryTexts();
renderCategories();
renderRecent();
showTab("wydatki");
setupTabSwipe();
updateBackupIndicator();
maybeRemindBackup();

// Tryb offline i prośba, żeby telefon nie czyścił danych aplikacji.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
