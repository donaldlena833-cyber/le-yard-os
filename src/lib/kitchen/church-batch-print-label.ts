import type { ChurchBatchLabel } from "./church-ingredient-batches";

const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

function easternInstant(value: string) {
  const fraction = /\.(\d+)/.exec(value)?.[1].replace(/0+$/, "");
  return eastern.formatToParts(new Date(value)).map((part) =>
    part.type === "second" && fraction ? `${part.value}.${fraction}` : part.value,
  ).join("");
}

function textElement<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, content: string) {
  const element = doc.createElement(tag);
  element.textContent = content;
  return element;
}

export function renderChurchBatchPrintLabel(doc: Document, batch: ChurchBatchLabel) {
  doc.documentElement.lang = "en";
  doc.title = `Batch label · ${batch.batchCode}`;
  Object.assign(doc.body.style, {
    color: "black",
    background: "white",
    font: "12pt/1.35 system-ui, sans-serif",
    margin: "0",
  });

  const label = doc.createElement("main");
  Object.assign(label.style, {
    width: "3.75in",
    maxWidth: "100%",
    boxSizing: "border-box",
    padding: "0.16in",
    border: "1px solid black",
    overflowWrap: "anywhere",
    breakInside: "avoid",
  });

  const heading = textElement(doc, "h1", batch.ingredientKey);
  Object.assign(heading.style, { fontSize: "16pt", margin: "0 0 0.06in" });
  const location = textElement(doc, "p", "Le Yard · 140 Church Street");
  Object.assign(location.style, { fontSize: "9pt", margin: "0 0 0.05in" });
  const code = textElement(doc, "p", `Batch ${batch.batchCode}`);
  Object.assign(code.style, { fontSize: "14pt", fontWeight: "700", margin: "0" });
  const deadline = textElement(doc, "p", `DISCARD BY ${easternInstant(batch.discardAt)}`);
  Object.assign(deadline.style, {
    fontSize: "14pt",
    fontWeight: "700",
    margin: "0.08in 0",
    padding: "0.06in",
    border: "1px solid black",
  });
  label.append(location, heading, code, deadline);

  const facts = doc.createElement("dl");
  facts.style.margin = "0";
  function fact(name: string, detail: string) {
    const term = textElement(doc, "dt", name);
    Object.assign(term.style, { fontWeight: "700", fontSize: "9pt" });
    const value = textElement(doc, "dd", detail);
    Object.assign(value.style, { margin: "0 0 0.06in", whiteSpace: "pre-wrap" });
    facts.append(term, value);
  }
  fact(batch.handledAs === "opened" ? "Opened" : "Prepped", easternInstant(batch.handledAt));
  fact("Supplier lot", batch.supplierLot);
  fact("Supplier SKU and label revision", `${batch.supplierSku} · r${batch.evidenceRevision}`);
  if (batch.sourceBatch) {
    fact("Source batch", batch.sourceBatch.batchCode);
    fact("Source discard deadline", easternInstant(batch.sourceBatch.discardAt));
  }
  fact("Storage", batch.storageRule);
  fact("Recorded by", batch.recordedByName);
  label.append(facts);

  const controls = doc.createElement("footer");
  controls.style.marginTop = "0.16in";
  const button = textElement(doc, "button", "Print batch label");
  button.type = "button";
  controls.append(button);
  doc.body.replaceChildren(label, controls);

  function showExpired() {
    const message = textElement(doc, "p", "Discard time reached. Return to Kitchen to review this batch.");
    doc.body.replaceChildren(message);
  }
  return { button, controls, showExpired };
}

export function openChurchBatchPrintLabel(batch: ChurchBatchLabel) {
  const notExpired = () => Date.now() < Date.parse(batch.discardAt);
  if (batch.voidedAt || batch.disposition || !batch.evidenceCurrent || batch.sourceNeedsReview || !notExpired()) return null;
  let preview: Window | null = null;
  try {
    // The temporary opener allows the same-origin blank document to be populated.
    preview = window.open("", "_blank", "popup,width=500,height=740");
    if (!preview) return null;
    preview.opener = null;
    const target = preview;
    const { button, controls, showExpired } = renderChurchBatchPrintLabel(target.document, batch);
    target.addEventListener("beforeprint", () => {
      if (notExpired()) controls.hidden = true;
      else showExpired();
    });
    target.addEventListener("afterprint", () => { controls.hidden = false; });
    button.addEventListener("click", () => {
      if (notExpired()) target.print();
      else showExpired();
    });
    return target;
  } catch {
    if (preview && !preview.closed) preview.close();
    return null;
  }
}
