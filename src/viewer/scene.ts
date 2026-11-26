import CameraControls from "camera-controls";
// camera-controls needs three's classes installed once.
import * as THREE from "three";
import {
  AmbientLight,
  AxesHelper,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
} from "three";

CameraControls.install({
  THREE: THREE as unknown as Parameters<typeof CameraControls.install>[0]["THREE"],
});

export interface Viewer {
  canvas: HTMLCanvasElement;
  dispose: () => void;
}

/**
 * The world is right-handed with Z up (design §2). three.js is Y up, so the conversion happens
 * here and nowhere else: everything of ours lives under `world`, which is rotated -90 degrees
 * about X (Z up becomes Y up). Lights and the camera stay in three's own frame.
 */
export function createViewer(container: HTMLElement): Viewer {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x1b1f24);

  const world = new Group();
  world.name = "world (Z up)";
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  // The ground grid lies in the world XY plane: GridHelper is built in XZ, so tip it onto XY.
  const grid = new GridHelper(2000, 20, 0x59636e, 0x353c44);
  grid.rotation.x = Math.PI / 2;
  world.add(grid);

  world.add(new AxesHelper(500)); // X red, Y green, Z blue (up)

  // A placeholder block so the first scene shows shading: 200 mm cube standing on the grid.
  const block = new Mesh(
    new BoxGeometry(200, 200, 200),
    new MeshLambertMaterial({ color: 0x9aa7b4 }),
  );
  block.position.set(300, 300, 100);
  world.add(block);

  scene.add(new AmbientLight(0xffffff, 0.6));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(800, 1500, 600);
  scene.add(sun);

  const camera = new PerspectiveCamera(45, 1, 10, 100000);
  camera.position.set(1400, 1000, 1400); // three's frame (Y up): looks at the origin from above
  const controls = new CameraControls(camera, renderer.domElement);
  controls.setTarget(0, 0, 0, false);

  const size = new Vector2();
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    renderer.getSize(size);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let frame = 0;
  const clock = { last: performance.now() };
  const tick = (now: number) => {
    const delta = (now - clock.last) / 1000;
    clock.last = now;
    controls.update(delta);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    canvas: renderer.domElement,
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
