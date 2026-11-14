import { request, MODE_TEXT, reasonText, formatTime, el, announce } from "./common.js";

const $ = (id) => document.getElementById(id);
const status = $("status");

function renderRules(rules) {
  const body = $("rules");
  body.replaceChildren();
  const sites = Object.keys(rules).sort((a, b) => a.localeCompare(b));
  for (const site of sites) {
    const select = el("select", { "aria-label": `Popups from ${site}` });
    for (const mode of ["allow", "block", "default"]) {
      const option = el("option", { value: mode, text: mode === "default" ? "Default (cross-site blocked)" : MODE_TEXT[mode].label });
      option.selected = rules[site] === mode;
      select.append(option);
    }
    select.addEventListener("change", () => setRule(site, select.value));
    body.append(
      el(
        "tr",
        {},
        el("td", {}, el("code", { text: site })),
        el("td", {}, select),
        el("td", { class: "actions" }, el("button", { type: "button", class: "secondary", "aria-label": `Remove rule for ${site}`, text: "Remove", onclick: () => setRule(site, "default") })),
      ),
    );
  }
  $("rules-table").hidden = sites.length === 0;
  $("rules-empty").hidden = sites.length > 0;
}

function renderRecent(recent, total) {
  const body = $("recent");
  body.replaceChildren();
  for (const item of recent) {
    body.append(
      el(
        "tr",
        {},
        el("td", { text: formatTime(item.time, true) }),
        el("td", {}, el("code", { text: item.sourceSite })),
        el("td", { class: "origin", text: item.destination, title: item.destination }),
        el("td", { text: reasonText(item.reason) }),
      ),
    );
  }
  body.closest("table").hidden = recent.length === 0;
  $("recent-empty").hidden = recent.length > 0;
  $("total").textContent = total ? `${total} popups blocked since installation.` : "";
}

function render(state) {
  $("enabled").checked = state.enabled;
  $("enabled-text").textContent = state.enabled ? "On" : "Off";
  document.body.classList.toggle("is-off", !state.enabled);
  renderRules(state.rules);
  renderRecent(state.recent, state.blockedTotal);
  $("psl").textContent = `Site boundaries use the Public Suffix List, version ${state.pslVersion}.`;
}

async function refresh() {
  render(await request({ type: "getState" }));
}

async function setRule(site, mode) {
  try {
    await request({ type: "setRule", site, mode });
    announce(status, mode === "default" ? `Removed the rule for ${site}.` : `${MODE_TEXT[mode].label} on ${site}.`);
  } catch (error) {
    announce(status, error.message);
  }
  await refresh();
}

$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("add-site");
  const error = $("add-error");
  error.textContent = "";
  input.removeAttribute("aria-invalid");
  try {
    const result = await request({ type: "setRule", site: input.value, mode: $("add-mode").value });
    input.value = "";
    announce(status, `Saved a rule for ${result.site}.`);
    await refresh();
  } catch (failure) {
    error.textContent = failure.message;
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
});

$("enabled").addEventListener("change", async (event) => {
  await request({ type: "setEnabled", enabled: event.target.checked });
  announce(status, event.target.checked ? "Popup Guard is on." : "Popup Guard is off.");
  await refresh();
});

$("clear-recent").addEventListener("click", async () => {
  await request({ type: "clearRecent" });
  announce(status, "Cleared the blocked popup log.");
  await refresh();
});

chrome.storage.onChanged.addListener(() => refresh().catch(() => {}));
await refresh();
