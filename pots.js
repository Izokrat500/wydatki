// --- Skarbonki: pieniądze przydzielone do kategorii; przydział nie zmienia Bilansu ---

let savingsView = "pots"; // co pokazuje karta Net worth: "pots", "entries" albo "networth"
let openPotId = null; // skarbonka otwarta w panelu szczegółów

function formatSignedMoney(grosze) {
  return (grosze < 0 ? "−" : "") + formatMoney(Math.abs(grosze));
}

function potsBudgetSnapshot() {
  return JSON.parse(JSON.stringify({ pots: data.pots, potTransfers: data.potTransfers, budget: data.budget }));
}

function restorePotsBudget(snapshot) {
  data.pots = snapshot.pots;
  data.potTransfers = snapshot.potTransfers;
  data.budget = snapshot.budget;
}

// Zmiana z zabezpieczeniem: przy błędzie zapisu wraca poprzedni stan.
function commitPots(change, message) {
  const before = potsBudgetSnapshot();
  change();
  if (!saveData()) {
    restorePotsBudget(before);
    showToast(t("error.saveEntry"));
    return false;
  }
  renderPots();
  renderPotHint();
  if (message) {
    showToast(message, () => {
      restorePotsBudget(before);
      if (saveData()) {
        renderPots();
        renderPotHint();
        renderSummary();
      }
    });
  }
  renderSummary();
  return true;
}

function potFor(category) {
  return data.pots.find((pot) => pot.category === category) || null;
}

function potAdded(pot) {
  return data.potTransfers
    .filter((transfer) => transfer.potId === pot.id)
    .reduce((sum, transfer) => sum + transfer.grosze, pot.start);
}

// Wydatki liczą się od dnia założenia skarbonki, bez resetu co miesiąc.
function potSpent(pot) {
  return data.transactions
    .filter((entry) => entry.category === pot.category && entry.date >= pot.startDate)
    .reduce((sum, entry) => sum + entry.grosze, 0);
}

function potLeft(pot) {
  return potAdded(pot) - potSpent(pot);
}

function positiveInPots() {
  return data.pots.reduce((sum, pot) => sum + Math.max(potLeft(pot), 0), 0);
}

function potStartAmounts() {
  return data.pots.reduce((sum, pot) => sum + pot.start, 0);
}

// Start to zdjęcie stanu z chwili zapisu: kwota wpisana przez użytkownika już uwzględnia
// wszystko, co było wcześniej, więc liczą się tylko wpisy dodane później.
// Wpis dodany później, ale z datą sprzed startu, też jest już w tej kwocie.
function countsForBudget(entry) {
  const { start, createdAt } = data.budget;
  if (entry.date < start) return false;
  return createdAt ? entry.id > createdAt : true; // starty zapisane przed tą zmianą nie mają createdAt
}

// Wolne = kwota ze startu + zmiany od startu - to, co od startu przybyło w skarbonkach.
// Skarbonka na minusie to pieniądze dopłacone z głównego konta, więc liczy się jako 0.
function budgetNumbers() {
  if (!data.budget) return null;
  const { opening, potsBase = 0, startsBase = 0 } = data.budget;
  const since = (list) => list.filter(countsForBudget).reduce((sum, entry) => sum + entry.grosze, 0);
  const flows = since(data.incomes) - since(data.transactions) - since(data.savings);
  const inPots = positiveInPots();
  const free = opening + flows + (potStartAmounts() - startsBase) - (inPots - potsBase);
  return { total: free + inPots, inPots, free };
}

// --- Widok karty Net worth ---

function updateSavingsView() {
  const isSavingsTab = entryKind === "savings" && activeTab === "odkladam";
  const showPots = isSavingsTab && savingsView === "pots";
  const showNetWorth = isSavingsTab && savingsView === "networth";
  $("savings-switch").hidden = !isSavingsTab;
  $("pots-view").hidden = !showPots;
  $("networth-view").hidden = !showNetWorth;
  $("entry-content").hidden = showPots || showNetWorth;
  $("savings-view-pots").setAttribute("aria-pressed", String(savingsView === "pots"));
  $("savings-view-entries").setAttribute("aria-pressed", String(savingsView === "entries"));
  $("savings-view-networth").setAttribute("aria-pressed", String(showNetWorth));
}

function potCard(pot) {
  const left = potLeft(pot);
  const added = potAdded(pot);
  const card = element("button", "card pot-card");
  card.type = "button";
  const head = element("span", "pot-head");
  const amounts = element("span", "pot-amounts");
  const leftEl = element("strong", left < 0 ? "pot-left negative" : "pot-left", formatSignedMoney(left));
  amounts.append(leftEl, element("span", "pot-of", t("pots.of", { amount: formatMoney(Math.max(added, 0)) })));
  head.append(avatar(pot.category), element("span", "pot-name", displayName(pot.category)), amounts);
  const track = element("span", "where-track pot-track");
  const fill = element("span", "where-fill");
  fill.style.width = `${added > 0 ? Math.max(0, Math.min(100, (left / added) * 100)) : 0}%`;
  track.append(fill);
  card.append(head, track);
  card.addEventListener("click", () => openPotDetail(pot.id));
  return card;
}

function renderPots() {
  const hasPots = data.pots.length > 0;
  $("pots-empty").hidden = hasPots;
  $("pots-main").hidden = !hasPots;

  const list = $("pots-list");
  list.replaceChildren();
  for (const pot of data.pots) list.append(potCard(pot));
  if (openPotId !== null && !$("pot-detail-sheet").hidden) renderPotDetail();
}

// Przy dodawaniu wydatku widać, ile zostanie w skarbonce tej kategorii.
function renderPotHint() {
  const hint = $("pot-hint");
  const pot = entryKind === "expense" && selectedCategory ? potFor(selectedCategory) : null;
  hint.hidden = !pot;
  if (!pot) return;
  const left = potLeft(pot);
  const amount = parseAmount($("amount").value);
  hint.textContent = amount === null
    ? t("pots.hintLeft", { left: formatSignedMoney(left) })
    : t("pots.hintAfter", { after: formatSignedMoney(left - amount) });
  hint.classList.toggle("negative", amount !== null ? left - amount < 0 : left < 0);
}

// --- Start skarbonek ---

function openBudgetSheet() {
  const numbers = budgetNumbers();
  $("budget-amount").value = numbers && numbers.free > 0 ? amountForEditing(numbers.free) : "";
  $("budget-error").hidden = true;
  fitAmountField($("budget-amount"), $("budget-amount-sizer"));
  openSheet("budget-sheet", "budget-backdrop");
}

function closeBudgetSheet() {
  closeSheet("budget-sheet", "budget-backdrop", `nav-${activeTab}`);
}

function saveBudget(event) {
  event.preventDefault();
  const text = $("budget-amount").value.trim();
  const opening = text === "" || text === "0" ? 0 : parseAmount(text);
  if (opening === null) {
    $("budget-error").textContent = t("error.amount");
    $("budget-error").hidden = false;
    return;
  }
  closeBudgetSheet();
  commitPots(() => {
    data.budget = {
      start: todayString(),
      opening,
      createdAt: Date.now(),
      potsBase: positiveInPots(),
      startsBase: potStartAmounts(),
    };
  });
}

// --- Nowa skarbonka ---

function openPotNewSheet() {
  $("pot-new-name").value = "";
  $("pot-new-start").value = "";
  $("pot-new-start-block").hidden = true;
  $("pot-new-has-money").hidden = false;
  $("pot-new-error").hidden = true;
  fitAmountField($("pot-new-start"), $("pot-new-start-sizer"));
  renderPotNewChips();
  openSheet("pot-new-sheet", "pot-new-backdrop");
}

function closePotNewSheet() {
  closeSheet("pot-new-sheet", "pot-new-backdrop", `nav-${activeTab}`);
}

function renderPotNewChips() {
  const box = $("pot-new-chips");
  const typed = $("pot-new-name").value.trim().toLowerCase();
  box.replaceChildren();
  for (const name of data.categories.filter((category) => !potFor(category))) {
    const chip = element("button", "edit-chip");
    chip.type = "button";
    chip.setAttribute("aria-pressed", String(displayName(name).toLowerCase() === typed || name.toLowerCase() === typed));
    chip.append(avatar(name), element("span", "", displayName(name)));
    chip.addEventListener("click", () => {
      $("pot-new-name").value = displayName(name);
      renderPotNewChips();
    });
    box.append(chip);
  }
}

function savePotNew(event) {
  event.preventDefault();
  const showError = (message) => {
    $("pot-new-error").textContent = message;
    $("pot-new-error").hidden = false;
  };
  const typed = capitalizeFirst($("pot-new-name").value.trim());
  if (!typed) return showError(t("pots.needName"));
  const lower = typed.toLowerCase();
  const existing = data.categories.find((c) => c.toLowerCase() === lower || displayName(c).toLowerCase() === lower);
  const category = existing || typed;
  if (potFor(category)) return showError(t("pots.alreadyExists", { name: displayName(category) }));

  const startText = $("pot-new-start").value.trim();
  const start = startText === "" || startText === "0" ? 0 : parseAmount(startText);
  if (start === null) return showError(t("error.amount"));

  closePotNewSheet();
  const addedCategory = !existing;
  if (addedCategory) data.categories.push(category);
  const saved = commitPots(() => {
    data.pots.push({ id: Date.now(), category, start, startDate: todayString() });
  });
  if (!saved && addedCategory) data.categories.pop();
  renderCategories();
}

// --- Podział zarobków ---

function openSplitSheet() {
  const box = $("split-rows");
  box.replaceChildren();
  for (const pot of data.pots) {
    const row = element("label", "split-row");
    const input = element("input", "split-input");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.maxLength = 12;
    input.placeholder = "0";
    input.dataset.potId = pot.id;
    input.setAttribute("aria-label", displayName(pot.category));
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d.,]/g, "");
      updateSplitSave();
    });
    const field = element("span", "split-field");
    field.append(input, element("span", "split-currency", "PLN"));
    const name = element("span", "split-name", displayName(pot.category));
    row.append(avatar(pot.category), name, field);
    box.append(row);
  }
  $("split-error").hidden = true;
  updateSplitSave();
  openSheet("split-sheet", "split-backdrop");
}

function closeSplitSheet() {
  closeSheet("split-sheet", "split-backdrop", `nav-${activeTab}`);
}

function splitAmounts() {
  return [...document.querySelectorAll(".split-input")].map((input) => ({
    potId: Number(input.dataset.potId),
    text: input.value.trim(),
    grosze: parseAmount(input.value.trim()),
  }));
}

function updateSplitSave() {
  $("split-save").classList.toggle("ready", splitAmounts().some((row) => row.grosze !== null));
}

function saveSplit(event) {
  event.preventDefault();
  const rows = splitAmounts().filter((row) => row.text !== "");
  if (rows.some((row) => row.grosze === null)) {
    $("split-error").textContent = t("error.amount");
    $("split-error").hidden = false;
    return;
  }
  if (rows.length === 0) {
    closeSplitSheet();
    return;
  }
  const date = todayString();
  const sum = rows.reduce((total, row) => total + row.grosze, 0);
  closeSplitSheet();
  commitPots(() => {
    rows.forEach((row, index) => {
      data.potTransfers.push({ id: Date.now() + index, potId: row.potId, grosze: row.grosze, date });
    });
  }, t("pots.split", { amount: formatMoney(sum) }));
}

// --- Szczegóły skarbonki ---

function openPotDetail(id) {
  openPotId = id;
  $("pot-detail-amount").value = "";
  $("pot-detail-error").hidden = true;
  fitAmountField($("pot-detail-amount"), $("pot-detail-sizer"));
  renderPotDetail();
  openSheet("pot-detail-sheet", "pot-detail-backdrop");
}

function closePotDetail() {
  closeSheet("pot-detail-sheet", "pot-detail-backdrop", `nav-${activeTab}`);
  openPotId = null;
}

function renderPotDetail() {
  const pot = data.pots.find((item) => item.id === openPotId);
  if (!pot) return;
  const left = potLeft(pot);
  $("pot-detail-title").textContent = displayName(pot.category);
  $("pot-detail-left").textContent = (left < 0 ? "−" : "") + formatNumber(Math.abs(left));
  $("pot-detail-left").classList.toggle("negative", left < 0);
  $("pot-detail-stats").textContent = t("pots.stats", { added: formatMoney(potAdded(pot)), spent: formatMoney(potSpent(pot)), date: formatDate(pot.startDate) });

  const list = $("pot-detail-history");
  list.replaceChildren();
  const transfers = data.potTransfers
    .filter((transfer) => transfer.potId === pot.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  for (const transfer of transfers) {
    const row = element("div", "pot-history-row");
    const amount = (transfer.grosze > 0 ? "+" : "−") + formatMoney(Math.abs(transfer.grosze));
    const remove = element("button", "pot-history-remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", t("pots.removeTransfer", { amount }));
    remove.addEventListener("click", () => {
      commitPots(() => {
        data.potTransfers = data.potTransfers.filter((item) => item.id !== transfer.id);
      }, t("pots.transferRemoved", { amount }));
    });
    row.append(element("span", "pot-history-date", formatDate(transfer.date)), element("span", "pot-history-amount", amount), remove);
    list.append(row);
  }
  if (pot.start > 0) {
    const row = element("div", "pot-history-row");
    row.append(element("span", "pot-history-date", t("pots.startRow")), element("span", "pot-history-amount", formatMoney(pot.start)));
    list.append(row);
  }
}

function changePot(direction) {
  const grosze = parseAmount($("pot-detail-amount").value);
  if (grosze === null) {
    $("pot-detail-error").textContent = t("error.amount");
    $("pot-detail-error").hidden = false;
    return;
  }
  const id = openPotId;
  $("pot-detail-amount").value = "";
  fitAmountField($("pot-detail-amount"), $("pot-detail-sizer"));
  $("pot-detail-error").hidden = true;
  commitPots(() => {
    data.potTransfers.push({ id: Date.now(), potId: id, grosze: direction * grosze, date: todayString() });
  });
}

function deletePot() {
  const pot = data.pots.find((item) => item.id === openPotId);
  if (!pot) return;
  closePotDetail();
  commitPots(() => {
    // Stan początkowy zostaje wśród pieniędzy, więc zawartość skarbonki wraca do Wolne.
    if (data.budget) data.budget.opening += pot.start;
    data.pots = data.pots.filter((item) => item.id !== pot.id);
    data.potTransfers = data.potTransfers.filter((transfer) => transfer.potId !== pot.id);
  }, t("pots.deleted", { name: displayName(pot.category) }));
}

function closePotSheets() {
  closeBudgetSheet();
  closePotNewSheet();
  closeSplitSheet();
  closeAssetSheet();
  if (!$("pot-detail-sheet").hidden) closePotDetail();
}

// --- Dane z kopii ---

function cleanPotsFromBackup(source) {
  const pots = (Array.isArray(source.pots) ? source.pots : []).map((pot) => {
    if (!Number.isFinite(pot.id) || typeof pot.category !== "string" || !pot.category) throw new Error("Zła skarbonka");
    if (!Number.isSafeInteger(pot.start) || pot.start < 0 || !isValidDate(pot.startDate)) throw new Error("Zła skarbonka");
    return { id: pot.id, category: pot.category, start: pot.start, startDate: pot.startDate };
  });
  const ids = new Set(pots.map((pot) => pot.id));
  const potTransfers = (Array.isArray(source.potTransfers) ? source.potTransfers : []).map((transfer) => {
    if (!ids.has(transfer.potId) || !Number.isSafeInteger(transfer.grosze) || !isValidDate(transfer.date)) throw new Error("Zły przelew");
    return { id: Number.isFinite(transfer.id) ? transfer.id : Date.now(), potId: transfer.potId, grosze: transfer.grosze, date: transfer.date };
  });
  let budget = null;
  if (source.budget) {
    if (!isValidDate(source.budget.start) || !Number.isSafeInteger(source.budget.opening)) throw new Error("Zły start");
    budget = { start: source.budget.start, opening: source.budget.opening };
    for (const field of ["createdAt", "potsBase", "startsBase"]) {
      if (Number.isSafeInteger(source.budget[field])) budget[field] = source.budget[field];
    }
  }
  return { pots, potTransfers, budget };
}

// --- Zdarzenia ---

function setupPots() {
  $("savings-view-pots").addEventListener("click", () => {
    savingsView = "pots";
    updateSavingsView();
  });
  $("savings-view-entries").addEventListener("click", () => {
    savingsView = "entries";
    updateSavingsView();
  });
  $("savings-view-networth").addEventListener("click", () => {
    savingsView = "networth";
    updateSavingsView();
  });
  $("pots-first").addEventListener("click", openPotNewSheet);
  $("pots-new").addEventListener("click", openPotNewSheet);
  $("pots-transfer").addEventListener("click", openSplitSheet);

  $("budget-backdrop").addEventListener("click", closeBudgetSheet);
  $("budget-sheet").addEventListener("submit", saveBudget);
  $("budget-amount").addEventListener("input", () => fitAmountField($("budget-amount"), $("budget-amount-sizer")));

  $("pot-new-backdrop").addEventListener("click", closePotNewSheet);
  $("pot-new-sheet").addEventListener("submit", savePotNew);
  $("pot-new-name").addEventListener("input", () => {
    capitalizeInput($("pot-new-name"));
    renderPotNewChips();
  });
  $("pot-new-start").addEventListener("input", () => fitAmountField($("pot-new-start"), $("pot-new-start-sizer")));
  $("pot-new-has-money").addEventListener("click", () => {
    $("pot-new-has-money").hidden = true;
    $("pot-new-start-block").hidden = false;
    $("pot-new-start").focus({ preventScroll: true });
  });

  $("split-backdrop").addEventListener("click", closeSplitSheet);
  $("split-sheet").addEventListener("submit", saveSplit);

  $("pot-detail-backdrop").addEventListener("click", closePotDetail);
  $("pot-detail-amount").addEventListener("input", () => fitAmountField($("pot-detail-amount"), $("pot-detail-sizer")));
  $("pot-detail-add").addEventListener("click", () => changePot(1));
  $("pot-detail-take").addEventListener("click", () => changePot(-1));
  $("pot-detail-delete").addEventListener("click", deletePot);
}
