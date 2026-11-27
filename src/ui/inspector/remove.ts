import { compareIds } from "#core/ids.ts";
import type { DryRun } from "../client/dryrun.ts";
import type { Model } from "../model.ts";
import { copyOf, isObject, patternOf, refKind } from "./words.ts";

/**
 * Delete, with its cascade (D-UX-13), planned: which refs of a selection can be removed, in which
 * order, what the dry run of `removeEntity {cascade: true}` says goes beyond the selection, and
 * the `setPattern` that leaves a pattern copy out (`removeEntity` refuses copies). The flow that
 * asks the server and the person is `Delete.tsx`. Pure. Owner: S5.
 */

export type Command = { cmd: string; args?: unknown };

/** A pattern copy the selection holds, as the pattern names it. */
export interface CopyRef {
  id: string;
  pattern: string;
  k: number;
}

/** The selection, sorted by what Delete does with each ref. */
export interface DeleteTargets {
  /** Entities `removeEntity` takes, referrers first. */
  entities: string[];
  /** Pattern copies, which are left out of their pattern instead. */
  copies: CopyRef[];
  /** Refs Delete does nothing to, each with why (a corner, an end, a catalog item). */
  others: { id: string; why: string }[];
}

/**
 * Referrers come first, so a cascade does not remove an entity the batch names later: a
 * pattern names its template, a part its bar, a connection its bars, a run its bars, a bar its
 * nodes and other bars' ends, and an item is named by what uses it. Within a kind the newer id
 * goes first, as a newer entity is the likelier referrer. An order this misses is caught by the
 * retry (`withoutVanished`).
 */
const RANK: readonly string[] = ["pt", "p", "c", "r", "b", "n", "project"];

function rank(id: string): number {
  const prefix = id.startsWith("project:") ? "project" : (/^[a-z]+/.exec(id)?.[0] ?? "");
  const i = RANK.indexOf(prefix);
  return i < 0 ? RANK.length : i;
}

export function removalOrder(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => rank(a) - rank(b) || compareIds(b, a));
}

const WHY_NOT: Readonly<Record<string, string>> = {
  corner: "a corner is where bars meet, not a thing: delete its connections or bars",
  end: "a bar end goes with its bar",
  item: "a catalog item is not in the project: delete what uses it",
  "open-item": "an open item is resolved in Problems, not deleted",
  supplier: "a supplier is not in the project",
};

export function deleteTargets(m: Model, selection: Iterable<string>): DeleteTargets {
  const entities: string[] = [];
  const copies: CopyRef[] = [];
  const others: { id: string; why: string }[] = [];
  const items = isObject(m.doc.items) ? m.doc.items : {};
  for (const id of selection) {
    const kind = refKind(m, id);
    if (kind === "copy") {
      const c = copyOf(id);
      const pattern = patternOf(m, id);
      if (c && pattern) copies.push({ id, pattern, k: c.k });
      else others.push({ id, why: "its pattern is not found" });
    } else if (kind === "item" && id.startsWith("project:") && id.slice(8) in items) {
      entities.push(id);
    } else if (["bar", "part", "connection", "node", "run", "pattern", "record"].includes(kind)) {
      entities.push(id);
    } else {
      others.push({ id, why: WHY_NOT[kind] ?? "it is not in the document" });
    }
  }
  return {
    entities: removalOrder(entities),
    copies: copies.sort((a, b) => compareIds(a.id, b.id)),
    others,
  };
}

/** The batch that removes these entities with their cascade, in this order. */
export function removeBatch(ids: readonly string[]): Command[] {
  return ids.map((id) => ({ cmd: "removeEntity", args: { id, cascade: true } }));
}

/**
 * After a refused dry run of `removeBatch(ids)`: the ids without the one that refused because it
 * was no longer there (an earlier command's cascade removed it, or another step did), for another
 * dry run; undefined when the refusal is anything else, which Delete shows as it is.
 */
export function withoutVanished(ids: readonly string[], dry: DryRun): string[] | undefined {
  if (dry.ok) return undefined;
  const index = dry.failed?.index;
  const named = index === undefined ? undefined : ids[index];
  // Without the index, the refusing command is the one a "missing" complaint names.
  const gone = dry.errors.find(
    (e) =>
      e.code === "missing" &&
      e.entity !== undefined &&
      ids.includes(e.entity) &&
      (named === undefined || e.entity === named),
  )?.entity;
  return gone === undefined ? undefined : ids.filter((id) => id !== gone);
}

/** What a dry run of the removal says goes, beyond what was asked. */
export interface DeletePlan {
  /** Every entity the step would remove, the selection's and the cascade's, in id order. */
  removed: string[];
  /** Removed although not selected: what the cascade adds. */
  extra: string[];
  /** Kept but changed: lists that lose a member (a butt losing one of its ends). */
  changed: string[];
  /** Nothing beyond the selection: send it at once. */
  plain: boolean;
}

export function deletePlan(selected: readonly string[], dry: DryRun & { ok: true }): DeletePlan {
  const removed = [...dry.effects.removed].sort(compareIds);
  const gone = new Set(removed);
  const asked = new Set(selected);
  const changed = [...new Set(dry.results.flatMap((r) => r.changed ?? []))]
    .filter((id) => !gone.has(id))
    .sort(compareIds);
  const extra = removed.filter((id) => !asked.has(id));
  return { removed, extra, changed, plain: extra.length === 0 && changed.length === 0 };
}

/**
 * The batch that leaves pattern copies out: one `setPattern` per pattern, adding each copy's
 * number to its `skip`, in order.
 */
export function skipBatch(m: Model, copies: readonly CopyRef[]): Command[] {
  const by = new Map<string, Set<number>>();
  for (const c of copies) by.set(c.pattern, (by.get(c.pattern) ?? new Set()).add(c.k));
  const patterns = isObject(m.doc.patterns) ? m.doc.patterns : {};
  return [...by.entries()]
    .sort(([a], [b]) => compareIds(a, b))
    .map(([pattern, ks]) => {
      const p = patterns[pattern];
      const was = isObject(p) && Array.isArray(p.skip) ? (p.skip as number[]) : [];
      const skip = [...new Set([...was, ...ks])].sort((a, b) => a - b);
      return { cmd: "setPattern", args: { id: pattern, set: { skip } } };
    });
}

/**
 * What leaving a copy out takes with it: that copy of every entity in its pattern's template (the
 * copied bar, its parts and its connections), as derive names copies (`<template id>@<k>`).
 */
export function copyMembers(m: Model, c: CopyRef): string[] {
  const patterns = isObject(m.doc.patterns) ? m.doc.patterns : {};
  const p = patterns[c.pattern];
  const template = isObject(p) && Array.isArray(p.template) ? (p.template as string[]) : [];
  return template.map((t) => `${t}@${c.k}`).sort(compareIds);
}
