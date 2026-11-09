// --- Net worth: lista majątku i długów, liczona wyłącznie w tym widoku ---

let editingAssetId = null; // pozycja otwarta w panelu, null przy nowej
let assetIsDebt = false; // rodzaj pozycji wybrany w panelu

// Ikony nazw typowych dla majątku; reszta korzysta ze zwykłych ikon kategorii.
const ASSET_ICONS = [
  [/^(gotówk|cash)/i, "💵"],
  [/^(nieruchomo|property|działk)/i, "🏘️"],
  [/^(kredyt|loan|mortgage|hipotek)/i, "🏦"],
  [/^(pożycz)/i, "🤝"],
  [/^(kart|credit)/i, "💳"],
  [/^(rat|instal)/i, "🧾"],
];

function assetAvatar(name) {
  const rule = data.icons[name] ? null : ASSET_ICONS.find(([pattern]) => pattern.test(name));
  if (!rule) return avatar(name);
  const el = element("span", "avatar", rule[1]);
  el.setAttribute("aria-hidden", "true");
  return el;
}

function assetsTotal(isDebt) {
  return data.netWorth.filter((item) => item.debt === isDebt).reduce((sum, item) => sum + item.grosze, 0);
}

// Zmiana z zabezpieczeniem: przy błędzie zapisu wraca poprzedni stan.
function commitNetWorth(change, message) {
  const before = data.netWorth.map((item) => ({ ...item }));
  change();
  if (!saveData()) {
    data.netWorth = before;
    showToast(t("error.saveEntry"));
    return;
  }
  renderNetWorth();
  if (message) {
    showToast(message, () => {
      data.netWorth = before;
      if (saveData()) renderNetWorth();
    });
  }
}

function assetCard(item) {
  const card = element("button", "card pot-card");
  card.type = "button";
  const head = element("span", "pot-head");
  const amounts = element("span", "pot-amounts");
  amounts.append(
    element("strong", item.debt ? "pot-left negative" : "pot-left", formatSignedMoney(item.debt ? -item.grosze : item.grosze)),
    element("span", "pot-of", formatDate(item.date)),
  );
  head.append(assetAvatar(item.name), element("span", "pot-name", item.name), amounts);
  card.append(head);
  card.addEventListener("click", () => openAssetSheet(item));
  return card;
}

function renderNetWorth() {
  const hasItems = data.netWorth.length > 0;
  $("networth-empty").hidden = hasItems;
  $("networth-main").hidden = !hasItems;
  if (!hasItems) return;

  const assets = assetsTotal(false);
  const debts = assetsTotal(true);
  const total = assets - debts;
  $("networth-total").textContent = (total < 0 ? "−" : "") + formatNumber(Math.abs(total));
  $("networth-total").classList.toggle("negative", total < 0);
  $("networth-sub").textContent = t("networth.sub", { assets: formatMoney(assets), debts: formatMoney(debts) });

  const list = $("networth-list");
  list.replaceChildren();
  const showHeadings = data.netWorth.some((item) => item.debt);
  for (const isDebt of [false, true]) {
    const items = data.netWorth.filter((item) => item.debt === isDebt).sort((a, b) => b.grosze - a.grosze || a.id - b.id);
    if (items.length === 0) continue;
    if (showHeadings) list.append(element("p", "networth-heading", t(isDebt ? "networth.debts" : "networth.assets")));
    for (const item of items) list.append(assetCard(item));
  }
}

// --- Panel pozycji ---

function renderAssetKind() {
  $("asset-kind-have").setAttribute("aria-pressed", String(!assetIsDebt));
  $("asset-kind-owe").setAttribute("aria-pressed", String(assetIsDebt));
  renderAssetChips();
}

function renderAssetChips() {
  const box = $("asset-chips");
  const typed = $("asset-name").value.trim().toLowerCase();
  box.replaceChildren();
  for (const name of t(assetIsDebt ? "networth.debtNames" : "networth.assetNames").split("|")) {
    const chip = element("button", "edit-chip");
    chip.type = "button";
    chip.setAttribute("aria-pressed", String(name.toLowerCase() === typed));
    chip.append(assetAvatar(name), element("span", "", name));
    chip.addEventListener("click", () => {
      $("asset-name").value = name;
      renderAssetChips();
    });
    box.append(chip);
  }
}

function openAssetSheet(item = null) {
  editingAssetId = item ? item.id : null;
  assetIsDebt = item ? item.debt : false;
  $("asset-title").textContent = t(item ? "networth.editTitle" : "networth.newTitle");
  $("asset-name").value = item ? item.name : "";
  $("asset-amount").value = item ? amountForEditing(item.grosze) : "";
  $("asset-error").hidden = true;
  $("asset-delete").hidden = !item;
  fitAmountField($("asset-amount"), $("asset-amount-sizer"));
  renderAssetKind();
  openSheet("asset-sheet", "asset-backdrop");
}

function closeAssetSheet() {
  closeSheet("asset-sheet", "asset-backdrop", `nav-${activeTab}`);
}

function saveAsset(event) {
  event.preventDefault();
  const showError = (message) => {
    $("asset-error").textContent = message;
    $("asset-error").hidden = false;
  };
  const name = capitalizeFirst($("asset-name").value.trim());
  if (!name) return showError(t("networth.needName"));
  const grosze = parseAmount($("asset-amount").value.trim());
  if (grosze === null) return showError(t("error.amount"));

  const id = editingAssetId;
  closeAssetSheet();
  commitNetWorth(() => {
    const item = data.netWorth.find((entry) => entry.id === id);
    if (!item) {
      data.netWorth.push({ id: Date.now(), name, grosze, debt: assetIsDebt, date: todayString() });
      return;
    }
    if (item.grosze !== grosze) item.date = todayString(); // data mówi, kiedy kwota była aktualna
    Object.assign(item, { name, grosze, debt: assetIsDebt });
  });
}

function deleteAsset() {
  const item = data.netWorth.find((entry) => entry.id === editingAssetId);
  if (!item) return;
  closeAssetSheet();
  commitNetWorth(() => {
    data.netWorth = data.netWorth.filter((entry) => entry.id !== item.id);
  }, t("networth.deleted", { name: item.name }));
}

// --- Dane z kopii ---

function cleanNetWorthFromBackup(source) {
  return (Array.isArray(source.netWorth) ? source.netWorth : []).map((item) => {
    if (!Number.isFinite(item.id) || typeof item.name !== "string" || !item.name) throw new Error("Zła pozycja");
    if (!Number.isSafeInteger(item.grosze) || item.grosze <= 0 || !isValidDate(item.date)) throw new Error("Zła pozycja");
    return { id: item.id, name: item.name, grosze: item.grosze, debt: item.debt === true, date: item.date };
  });
}

// --- Zdarzenia ---

function setupNetWorth() {
  $("networth-first").addEventListener("click", () => openAssetSheet());
  $("networth-add").addEventListener("click", () => openAssetSheet());
  $("asset-backdrop").addEventListener("click", closeAssetSheet);
  $("asset-sheet").addEventListener("submit", saveAsset);
  $("asset-delete").addEventListener("click", deleteAsset);
  $("asset-amount").addEventListener("input", () => fitAmountField($("asset-amount"), $("asset-amount-sizer")));
  $("asset-name").addEventListener("input", () => {
    capitalizeInput($("asset-name"));
    renderAssetChips();
  });
  for (const [id, isDebt] of [["asset-kind-have", false], ["asset-kind-owe", true]]) {
    $(id).addEventListener("click", () => {
      assetIsDebt = isDebt;
      renderAssetKind();
    });
  }
}
