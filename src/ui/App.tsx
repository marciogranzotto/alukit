import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { createViewer } from "../viewer/scene.ts";

const server = signal<"checking" | "up" | "down">("checking");

async function checkServer() {
  try {
    const r = await fetch("/api/health");
    server.value = r.ok ? "up" : "down";
  } catch {
    server.value = "down";
  }
}

export function App() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void checkServer();
    if (!host.current) return;
    const viewer = createViewer(host.current);
    return () => viewer.dispose();
  }, []);

  return (
    <>
      <div ref={host} class="viewport" />
      <div class="hud">AluKit &middot; server: {server}</div>
    </>
  );
}
