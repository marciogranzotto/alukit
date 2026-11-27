/**
 * What the inspector shows with nothing selected (D-UX-4): the project panel. The inspector (S5)
 * renders it in its place and nothing else; S2.12 makes it First steps, the project's summary and
 * the params table. Today it says how to select something, as the properties panel did. Owner: S2.
 */
export function ProjectPanel() {
  return (
    <div class="panel-empty">
      Select a bar, part or connection: click it, Shift-drag a box, or pick it in the tree.
    </div>
  );
}
