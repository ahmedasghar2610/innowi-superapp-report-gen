"use client";

// COPIED from innowi-superapp-web/src/features/site-builder/components/editor/ContentPanel.tsx by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
import { useRef, useState } from "react";
import type { FeedbackTarget, Selection, TriggerCandidate } from "./types";

type Props = {
  selection: Selection | null;
  assetPrefix: string;
  uploading: boolean;
  onUploadImage: (file: File) => void;
  onImageSrc: (url: string) => void;
  onAlt: (alt: string) => void;
  onHref: (href: string) => void;
  onNewTab: (on: boolean) => void;
  newTab: boolean;
  onVideoSrc: (src: string) => void;
  onEmbedHtml: (html: string) => void;
  embedHtml: string;
  onDone: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSelectParent: () => void;
  /** Generic data-sb-* attribute setter, shared by the "Opens" field and the
   * Popup/Toast/Snackbar Behavior section below (empty value removes it). */
  onSetAttr: (attr: string, value: string) => void;
  /** Every Popup/Toast/Snackbar panel on the page, for the "Opens" dropdown. */
  feedbackTargets: FeedbackTarget[];
  /** Buttons/links/forms on the page, for a Toast/Snackbar's click/submit trigger target. */
  triggerCandidates: TriggerCandidate[];
  /** Sets (or, given null/empty, clears back to automatic) a Toast/Snackbar's icon text. */
  onSetFeedbackIcon: (text: string | null) => void;
  /** Points a Toast/Snackbar's click/submit trigger at a candidate (by its TriggerCandidate id; "" clears). */
  onSetTriggerTarget: (candidateId: string) => void;
  /** Whether the selected Popup/Toast/Snackbar is currently being previewed. */
  previewing: boolean;
  onPreview: () => void;
};

function toYouTubeEmbed(url: string): string {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}

export default function ContentPanel({
  selection,
  assetPrefix,
  uploading,
  onUploadImage,
  onImageSrc,
  onAlt,
  onHref,
  onNewTab,
  newTab,
  onVideoSrc,
  onEmbedHtml,
  embedHtml,
  onDone,
  onRemove,
  onDuplicate,
  onSelectParent,
  onSetAttr,
  feedbackTargets,
  triggerCandidates,
  onSetFeedbackIcon,
  onSetTriggerTarget,
  previewing,
  onPreview,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Raw HTML is an advanced escape hatch; cloned markup (Elementor, Divi…) is
  // noisy, so keep it collapsed unless the user asks for it.
  const [showHtml, setShowHtml] = useState(false);

  if (!selection) {
    return (
      <div className="sbve-section">
        <p className="sbve-hint" style={{ margin: 0 }}>
          Click any text on the page to edit it in place. Click an image to replace it. Use the Widgets panel to add new blocks, and
          Layers to reorder them.
        </p>
      </div>
    );
  }

  const unprefixed = (src: string) => (assetPrefix && src.startsWith(assetPrefix) ? src.slice(assetPrefix.length) : src);

  return (
    <div className="sbve-panel-body">
      <div className="sbve-section">
        <span className="sbve-chip">{selection.label}</span> <span className="sbve-chip">&lt;{selection.tag}&gt;</span>
        {selection.text && selection.kind !== "image" ? <p className="sbve-hint">“{selection.text.slice(0, 80)}”</p> : null}
        {selection.locked ? (
          <p className="sbve-hint" style={{ color: "#1d4ed8" }}>
            🔗 Comes from the merchant&apos;s Profile in the Super App. A change here is saved on this website
            only — the Profile is not changed. If the Profile field is edited later, its value replaces yours.
          </p>
        ) : null}

        {selection.kind === "image" ? (
          <>
            {selection.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="sbve-thumb" src={selection.src} alt="" />
            ) : null}
            <label className="sbve-label">Replace image</label>
            <div className="sbve-row" style={{ marginTop: 0 }}>
              <button type="button" className="sbve-btn small primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload file"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadImage(file);
                  e.target.value = "";
                }}
              />
            </div>
            <label className="sbve-label" htmlFor="sbve-img-src">Image URL</label>
            <input
              id="sbve-img-src"
              className="sbve-input"
              key={`src-${selection.id}-${selection.src}`}
              defaultValue={unprefixed(selection.src || "")}
              onKeyDown={(e) => {
                if (e.key === "Enter") onImageSrc((e.target as HTMLInputElement).value.trim());
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== unprefixed(selection.src || "")) onImageSrc(v);
              }}
            />
            <label className="sbve-label" htmlFor="sbve-img-alt">Alt text</label>
            <input id="sbve-img-alt" className="sbve-input" value={selection.alt || ""} onChange={(e) => onAlt(e.target.value)} />
          </>
        ) : null}

        {selection.kind === "link" ? (
          <>
            <label className="sbve-label" htmlFor="sbve-href">Link URL</label>
            <input id="sbve-href" className="sbve-input" value={selection.href || ""} onChange={(e) => onHref(e.target.value)} placeholder="/contact or https://…" />
            <label className="sbve-toggle" style={{ color: "inherit", marginTop: 8 }}>
              <input type="checkbox" checked={newTab} onChange={(e) => onNewTab(e.target.checked)} /> Open in new tab
            </label>
            <p className="sbve-hint">Edit the link text directly on the page.</p>

            {feedbackTargets.length > 0 ? (
              <>
                <label className="sbve-label" htmlFor="sbve-opens" style={{ marginTop: 12 }}>Opens (instead of navigating)</label>
                <select
                  id="sbve-opens"
                  className="sbve-input"
                  value={selection.opensTarget || ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    onSetAttr("data-sb-toggle", id ? `#${id}` : "");
                    onSetAttr("data-sb-toggle-class", id ? "sb-open" : "");
                  }}
                >
                  <option value="">— Nothing, use the link above —</option>
                  {feedbackTargets.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
                <p className="sbve-hint">Clicking this will open that Popup/Toast/Snackbar instead of following the link.</p>
              </>
            ) : null}
          </>
        ) : null}

        {selection.feedback ? (
          <FeedbackBehaviorFields
            feedback={selection.feedback}
            onSetAttr={onSetAttr}
            triggerCandidates={triggerCandidates}
            onSetIcon={onSetFeedbackIcon}
            onSetTriggerTarget={onSetTriggerTarget}
            previewing={previewing}
            onPreview={onPreview}
          />
        ) : null}

        {selection.kind === "video" ? (
          <>
            <label className="sbve-label" htmlFor="sbve-video">Video URL</label>
            <input
              id="sbve-video"
              className="sbve-input"
              key={`video-${selection.id}-${selection.src}`}
              defaultValue={selection.src || ""}
              placeholder="YouTube / Vimeo link or .mp4"
              onKeyDown={(e) => {
                if (e.key === "Enter") onVideoSrc(toYouTubeEmbed((e.target as HTMLInputElement).value.trim()));
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== selection.src) onVideoSrc(toYouTubeEmbed(v));
              }}
            />
            <p className="sbve-hint">Paste a normal YouTube or Vimeo link; it is converted to an embed.</p>
          </>
        ) : null}

        {selection.kind === "text" ? <p className="sbve-hint">Type directly on the page. Paste inserts plain text. Press Enter for a line break.</p> : null}

        {selection.widget === "embed" ? (
          <>
            <label className="sbve-label" htmlFor="sbve-embed">HTML</label>
            <textarea
              id="sbve-embed"
              className="sbve-textarea code"
              key={`embed-${selection.id}`}
              defaultValue={embedHtml}
              onBlur={(e) => {
                if (e.target.value !== embedHtml) onEmbedHtml(e.target.value);
              }}
              spellCheck={false}
            />
            <p className="sbve-hint">Inner HTML of this element. Changes apply when you click away.</p>
          </>
        ) : null}

        {selection.kind === "element" && selection.widget !== "embed" && !selection.feedback ? (
          <p className="sbve-hint">
            This is a layout container. Use the <strong>Style</strong> tab for spacing, background and size, or select a child
            element to edit its content.
          </p>
        ) : null}
      </div>

      {selection.kind === "element" && selection.widget !== "embed" ? (
        <div className="sbve-section">
          <button type="button" className="sbve-btn small" onClick={() => setShowHtml((v) => !v)} aria-expanded={showHtml}>
            {showHtml ? "Hide HTML" : "Advanced: edit HTML"}
          </button>
          {showHtml ? (
            <>
              <textarea
                id="sbve-embed"
                className="sbve-textarea code"
                key={`embed-${selection.id}`}
                defaultValue={embedHtml}
                onBlur={(e) => {
                  if (e.target.value !== embedHtml) onEmbedHtml(e.target.value);
                }}
                spellCheck={false}
                aria-label="Inner HTML"
                style={{ marginTop: 8 }}
              />
              <p className="sbve-hint">
                Raw inner HTML of this element. Class names like <code>elementor-*</code> come from the original site and are needed by
                its stylesheet — edit with care. Changes apply when you click away.
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="sbve-section">
        <h3>Actions</h3>
        <div className="sbve-row" style={{ marginTop: 0 }}>
          <button type="button" className="sbve-btn small" onClick={onSelectParent} disabled={!selection.hasParent}>
            Select parent
          </button>
          <button type="button" className="sbve-btn small" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="sbve-btn small" onClick={onDone}>
            Done
          </button>
          <button type="button" className="sbve-btn small danger" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}


/** Behavior controls for a selected Popup/Toast/Snackbar panel — everything
 * a person could set by hand-writing the data-sb-* attributes documented in
 * widgets.ts. Reads current values off `feedback` (computed in dom.ts's
 * describe()) and writes back through the same generic onSetAttr used by the
 * "Opens" dropdown above, so this stays in sync with any change made either
 * from here or, for an advanced user, via "Advanced: edit HTML" below it. */
function FeedbackBehaviorFields({
  feedback,
  onSetAttr,
  triggerCandidates,
  onSetIcon,
  onSetTriggerTarget,
  previewing,
  onPreview,
}: {
  feedback: NonNullable<Selection["feedback"]>;
  onSetAttr: (attr: string, value: string) => void;
  triggerCandidates: TriggerCandidate[];
  onSetIcon: (text: string | null) => void;
  onSetTriggerTarget: (candidateId: string) => void;
  previewing: boolean;
  onPreview: () => void;
}) {
  const [targetQuery, setTargetQuery] = useState("");
  const kindLabel = feedback.kind[0].toUpperCase() + feedback.kind.slice(1);
  const isNotice = feedback.kind !== "popup"; // Toast/Snackbar: event triggers
  const isToast = feedback.kind === "toast"; // only toasts have a Type + icon
  // Toasts sit in any corner; a snackbar runs along the bottom (or top) edge.
  const positionOptions =
    feedback.kind === "toast"
      ? [
          ["bottom-right", "Bottom right"],
          ["bottom-left", "Bottom left"],
          ["bottom-center", "Bottom centre"],
          ["top-right", "Top right"],
          ["top-left", "Top left"],
          ["top-center", "Top centre"],
        ]
      : feedback.kind === "snackbar"
        ? [
            ["bottom-center", "Bottom centre"],
            ["bottom-left", "Bottom left"],
            ["top-center", "Top centre"],
          ]
        : null;
  const isEventTrigger = feedback.trigger === "click" || feedback.trigger === "submit";
  const wantedKind = feedback.trigger === "submit" ? "submit" : "click";
  const q = targetQuery.trim().toLowerCase();
  const candidates = triggerCandidates.filter((c) => c.kind === wantedKind);
  const shown = candidates.filter((c) => !q || c.label.toLowerCase().includes(q) || c.id === feedback.triggerTargetId);
  const targetMissing = !!feedback.triggerTargetId && !candidates.some((c) => c.id === feedback.triggerTargetId);

  // Sensible defaults per trigger: event-driven notices show every time,
  // straight away, and a form submit keeps the visitor on the page so the
  // toast isn't wiped by a reload. A load-time message shows once per visit.
  function setTrigger(next: "load" | "click" | "submit" | "none") {
    onSetAttr("data-sb-trigger", next === "none" ? "" : next);
    if (next !== "click" && next !== "submit") onSetAttr("data-sb-trigger-target", "");
    onSetAttr("data-sb-prevent-default", next === "submit" ? "1" : "");
    if (next === "click" || next === "submit") {
      onSetAttr("data-sb-frequency", "always");
      onSetAttr("data-sb-delay", "");
    } else if (next === "load") {
      onSetAttr("data-sb-frequency", "once");
    }
    setTargetQuery("");
  }

  const variantOptions: Array<[NonNullable<typeof feedback.variant>, string]> = [
    ["neutral", "Neutral"],
    ["success", "Success"],
    ["error", "Error"],
    ["warning", "Warning"],
    ["info", "Info"],
    ["delete", "Delete"],
  ];

  return (
    <div className="sbve-section" style={{ borderTop: "1px solid #e5e7eb", marginTop: 8, paddingTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>{kindLabel} behavior</h3>
      <div className="sbve-row" style={{ marginTop: 0 }}>
        <button type="button" className={`sbve-btn small${previewing ? "" : " primary"}`} onClick={onPreview}>
          {previewing ? "Stop preview" : "▶ Preview"}
        </button>
      </div>
      <p className="sbve-hint" style={{ marginTop: 4 }}>
        Preview shows it exactly as visitors will see it, for a few seconds. On the page it&apos;s shown inline so you can edit it —
        click its text{isToast ? " or icon" : feedback.kind === "snackbar" ? " or action" : ", icon or buttons"} to edit that directly.
        Click the empty area of the {feedback.kind} to come back to these settings.
      </p>
      {feedback.kind === "snackbar" ? (
        <p className="sbve-hint" style={{ marginTop: 2 }}>
          A snackbar is a short one-line message with one action (e.g. &quot;Undo&quot;, &quot;View&quot;) — no icon or title, and only one shows
          at a time. Double-click the action to rename it or link it to a page; remove it if you don&apos;t need one. Need an icon, a title or a
          Success/Error look? Use a Toast instead.
        </p>
      ) : null}

      {isToast ? (
        <>
          <label className="sbve-label" htmlFor="sbve-fb-variant">Type</label>
          <div className="sbve-seg" role="group" aria-label="Type" id="sbve-fb-variant">
            {variantOptions.map(([v, l]) => (
              <button
                key={v}
                type="button"
                className={`sbve-seg-btn sbve-v-${v}${(feedback.variant || "neutral") === v ? " active" : ""}`}
                aria-pressed={(feedback.variant || "neutral") === v}
                onClick={() => onSetAttr("data-sb-variant", v)}
              >
                <span className="dot" aria-hidden="true" />
                {l}
              </button>
            ))}
          </div>
          <p className="sbve-hint" style={{ marginTop: 2 }}>Sets the icon, accent edge and progress-bar color automatically.</p>

          <label className="sbve-label" htmlFor="sbve-fb-icon" style={{ marginTop: 10 }}>Icon</label>
          <input
            id="sbve-fb-icon"
            className="sbve-input"
            key={`fb-icon-${feedback.iconAuto}-${feedback.iconText}`}
            defaultValue={feedback.iconAuto ? "" : feedback.iconText}
            placeholder="Automatic (matches Type)"
            onBlur={(e) => onSetIcon(e.target.value)}
          />
          <p className="sbve-hint" style={{ marginTop: 2 }}>
            {feedback.iconAuto ? "Type an emoji or character to use your own icon." : "Custom icon. Clear this field to go back to automatic."}
          </p>
        </>
      ) : null}

      <label className="sbve-label" htmlFor="sbve-fb-trigger" style={{ marginTop: 10 }}>Show it</label>
      <select
        id="sbve-fb-trigger"
        className="sbve-input"
        value={feedback.trigger}
        onChange={(e) => setTrigger(e.target.value as "load" | "click" | "submit" | "none")}
      >
        {isNotice ? <option value="submit">After a form is submitted</option> : null}
        {isNotice ? <option value="click">After a button or link is clicked</option> : null}
        <option value="load">Automatically when a visitor arrives</option>
        <option value="none">Only when a link&apos;s &quot;Opens&quot; field points here</option>
      </select>
      {feedback.trigger === "none" ? (
        <p className="sbve-hint" style={{ marginTop: 2 }}>
          Select a link or button on the page and set its &quot;Opens&quot; field to this {feedback.kind}. It will open instead of navigating.
        </p>
      ) : null}

      {isEventTrigger ? (
        <>
          <label className="sbve-label" htmlFor="sbve-fb-target">{feedback.trigger === "submit" ? "Which form" : "Which button or link"}</label>
          {candidates.length > 8 ? (
            <input
              className="sbve-input"
              style={{ marginBottom: 6 }}
              value={targetQuery}
              onChange={(e) => setTargetQuery(e.target.value)}
              placeholder={`Search ${candidates.length} ${feedback.trigger === "submit" ? "forms" : "buttons and links"}…`}
              aria-label="Search"
            />
          ) : null}
          <select
            id="sbve-fb-target"
            className="sbve-input"
            value={feedback.triggerTargetId && !targetMissing ? feedback.triggerTargetId : ""}
            onChange={(e) => onSetTriggerTarget(e.target.value)}
          >
            <option value="">— Choose one —</option>
            {shown.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          {candidates.length === 0 ? (
            <p className="sbve-hint" style={{ marginTop: 2 }}>
              {feedback.trigger === "submit" ? "There are no forms on this page yet." : "There are no buttons or links on this page yet."}
            </p>
          ) : null}
          {targetMissing ? (
            <p className="sbve-hint" style={{ marginTop: 2, color: "#b91c1c" }}>
              The element this was linked to is no longer on this page. Choose another.
            </p>
          ) : null}
          {!feedback.triggerTargetId && candidates.length > 0 ? (
            <p className="sbve-hint" style={{ marginTop: 2, color: "#b45309" }}>Choose one — until then this {feedback.kind} never shows.</p>
          ) : null}
          {feedback.trigger === "submit" ? (
            <label className="sbve-toggle" style={{ color: "inherit", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={feedback.preventFormReload}
                onChange={(e) => onSetAttr("data-sb-prevent-default", e.target.checked ? "1" : "")}
              />
              Keep the visitor on this page (recommended unless the form sends data somewhere)
            </label>
          ) : null}
        </>
      ) : null}

      {feedback.trigger !== "none" ? (
        <>
          <label className="sbve-label" htmlFor="sbve-fb-delay" style={{ marginTop: 10 }}>Delay before showing (seconds)</label>
          <input
            id="sbve-fb-delay"
            type="number"
            min={0}
            step={0.5}
            className="sbve-input"
            key={`fb-delay-${feedback.delaySec}`}
            defaultValue={feedback.delaySec}
            onBlur={(e) => {
              const seconds = Math.max(0, Number(e.target.value) || 0);
              onSetAttr("data-sb-delay", seconds > 0 ? String(seconds * 1000) : "");
            }}
          />

          <label className="sbve-label" htmlFor="sbve-fb-freq">How often</label>
          <select id="sbve-fb-freq" className="sbve-input" value={feedback.frequency} onChange={(e) => onSetAttr("data-sb-frequency", e.target.value)}>
            <option value="always">Every time</option>
            <option value="once">Once per visit</option>
          </select>
        </>
      ) : null}

      <label className="sbve-label" htmlFor="sbve-fb-dismiss" style={{ marginTop: 10 }}>
        Auto-close after (seconds — 0 = stays until closed)
      </label>
      <input
        id="sbve-fb-dismiss"
        type="number"
        min={0}
        step={0.5}
        className="sbve-input"
        key={`fb-dismiss-${feedback.autoDismissSec}`}
        defaultValue={feedback.autoDismissSec}
        onBlur={(e) => {
          const seconds = Math.max(0, Number(e.target.value) || 0);
          onSetAttr("data-sb-autodismiss", seconds > 0 ? String(seconds * 1000) : "");
        }}
      />
      {feedback.autoDismissSec > 0 && isNotice ? (
        <p className="sbve-hint" style={{ marginTop: 2 }}>The countdown pauses while a visitor hovers over it or tabs into it.</p>
      ) : null}

      {positionOptions ? (
        <>
          <label className="sbve-label" htmlFor="sbve-fb-pos">Position</label>
          <select id="sbve-fb-pos" className="sbve-input" value={feedback.position} onChange={(e) => onSetAttr("data-sb-position", e.target.value)}>
            {positionOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <p className="sbve-hint" style={{ marginTop: 2 }}>
            {isToast
              ? "Several toasts in the same corner stack instead of overlapping. On phones they span the screen width."
              : "A new snackbar replaces the one showing. On phones it spans the screen width."}
          </p>
        </>
      ) : null}
    </div>
  );
}
