import { signal } from "@preact/signals";
import { usedItems } from "../../catalog/PartsBin.tsx";
import { pins, recent } from "../../catalog/state.ts";
import type { Model } from "../../model.ts";
import { model } from "../../store.ts";
import { runOf } from "../commands.ts";
import {
  activeTool,
  type ConnectPick,
  connectPicks,
  connectType,
  type FaceOptions,
  faceOptions,
} from "../state.ts";

/**
 * A face connection's form (design §4.5; the editing audit's E-UX-14): its fastening, fastener or
 * rod, stack, stations and gaps. The Connect tool fills it to make a joint, the inspector to edit
 * one, so both write a joint the same way. A field written in a form the form cannot show (a
 * sleeve in the stack) is `fixed`: shown in words, read only, and kept as written. Owner: E5.
 */

/**
 * The items a fastener, a stack or a hinge may be picked from (S5.9): the parts bin's, what the
 * project uses (bars aside), then what was armed and pinned, each once.
 */
export function BinList({ id }: { id: string }) {
  const m = model.value;
  const seen = new Set<string>();
  const items: { id: string; name: string }[] = [];
  const add = (x: { id: string; name?: string | undefined }) => {
    if (seen.has(x.id)) return;
    seen.add(x.id);
    items.push({ id: x.id, name: x.name ?? "" });
  };
  if (m) for (const u of usedItems(m)) if (u.kind !== "bar") add({ id: u.item.id, name: u.name });
  for (const b of [...recent.value, ...pins.value]) add(b);
  return (
    <datalist id={id} data-testid={id}>
      {items.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </datalist>
  );
}

export function FaceForm({
  value: f,
  onChange,
  listId,
  fixed = {},
  disabled = false,
}: {
  value: FaceOptions;
  onChange: (next: FaceOptions) => void;
  /** The datalist the item fields suggest from. */
  listId: string;
  fixed?: Partial<Record<keyof FaceOptions, string>>;
  disabled?: boolean;
}) {
  const set = (next: Partial<FaceOptions>) => onChange({ ...f, ...next });
  const kept = (k: keyof FaceOptions) =>
    fixed[k] !== undefined ? `written as ${fixed[k]}: kept as written` : undefined;
  const text = (
    k: keyof FaceOptions,
    label: string,
    placeholder: string,
    list?: string,
    wide = false,
  ) => (
    <label class={wide ? "wide" : undefined}>
      {label}{" "}
      <input
        data-testid={`face-${k}`}
        class={wide ? "wide" : undefined}
        placeholder={placeholder}
        value={f[k] as string}
        type="text"
        list={list}
        disabled={disabled || fixed[k] !== undefined}
        title={kept(k)}
        onInput={(e) => set({ [k]: (e.target as HTMLInputElement).value })}
      />
    </label>
  );
  return (
    <>
      <div class="tp-row">
        <label
          title={
            "none: resting; bolt: through every layer; T-nut: into the last layer's groove; " +
            "screw: tapped into the last layer; blind: set from one side, gripping in the " +
            "last layer's bore or behind it"
          }
        >
          fastening{" "}
          <select
            data-testid="face-fastening"
            value={f.fastening}
            disabled={disabled}
            onChange={(e) =>
              set({ fastening: (e.target as HTMLSelectElement).value as FaceOptions["fastening"] })
            }
          >
            <option value="none">none (resting)</option>
            <option value="bolt">bolt</option>
            <option value="tnut">T-nut</option>
            <option value="screw">screw</option>
            <option value="blind">blind</option>
          </select>
        </label>
      </div>
      {f.fastening !== "none" && (
        <>
          <div class="tp-row">
            {text("fastener", f.rod ? "rod stock" : "fastener", "an item id", listId)}
            <label>
              <input
                type="checkbox"
                data-testid="face-rod"
                checked={f.rod}
                disabled={disabled}
                onChange={() => set({ rod: !f.rod })}
              />{" "}
              cut from bar stock
            </label>
            {f.rod && text("rodLen", "length", "mm")}
          </div>
          <div class="tp-row">{text("stack", "stack", "items, head to nut", listId, true)}</div>
          <div class="tp-row">
            {text("at", "at", "mm along the first layer, e.g. 100, 300")}
            {text("across", "across", "mm, e.g. -15, 15")}
            <label title={kept("railHoles")}>
              <input
                type="checkbox"
                data-testid="face-railHoles"
                checked={f.railHoles}
                disabled={disabled || fixed.railHoles !== undefined}
                onChange={() => set({ railHoles: !f.railHoles })}
              />{" "}
              at the rail's holes{fixed.railHoles !== undefined ? ` (${fixed.railHoles})` : ""}
            </label>
          </div>
          {f.fastening === "screw" && (
            <div class="tp-row">{text("tapDepth", "tap depth", "mm (through when empty)")}</div>
          )}
        </>
      )}
      <div class="tp-row">{text("gaps", "gaps", "mm per pair of layers")}</div>
    </>
  );
}

/**
 * The face joint Connect is re-picking the layers of (E-UX-14): its Apply then replaces that
 * joint's layers, and any field changed in its form, as one `setConnection`.
 */
export const connectReplacing = signal<string | undefined>(undefined);

/** A layer as Connect picks it, with a point to mark it by. */
function layerPick(m: Model, ref: string): ConnectPick {
  if (ref.startsWith("p")) {
    const p = m.derived.parts[ref];
    return { ref, kind: "part", p: p?.point ?? p?.origin ?? [0, 0, 0] };
  }
  const bar = ref.startsWith("r")
    ? Object.keys(m.derived.bars).find((b) => runOf(m.doc, b) === ref)
    : ref;
  const d = bar ? m.derived.bars[bar] : undefined;
  const p: [number, number, number] = d
    ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2, (d.a[2] + d.b[2]) / 2]
    : [0, 0, 0];
  return { ref, kind: ref.startsWith("r") ? "run" : "bar", p };
}

/**
 * Re-pick a face joint's layers in Connect: the tool opens on a face joint with the joint's layers
 * picked, head to nut, and its form as the inspector's draft, offering to replace the joint.
 */
export function startRelayer(
  m: Model,
  id: string,
  layers: readonly string[],
  options: FaceOptions,
): void {
  // The tool first: changing tools clears what the last one lit.
  activeTool.value = "connect";
  connectType.value = "face";
  faceOptions.value = options;
  connectReplacing.value = id;
  connectPicks.value = layers.map((ref) => layerPick(m, ref));
}
