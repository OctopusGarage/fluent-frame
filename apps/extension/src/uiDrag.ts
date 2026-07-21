type DragTarget = "panel" | "subtitle" | "videoNow";

export type DragController = {
  bind(): void;
};

type DragControllerDeps = {
  doc: Document;
  root: HTMLElement;
  byId<T extends HTMLElement>(id: string): T;
};

type DragState = {
  target: DragTarget;
  startMouseX: number;
  startMouseY: number;
  startLeft: number;
  startTop: number;
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function createDragController({ doc, root, byId }: DragControllerDeps): DragController {
  let dragState: DragState | undefined;

  function viewportSize(): { width: number; height: number } {
    const win = doc.defaultView;
    return {
      width: win?.innerWidth ?? doc.documentElement.clientWidth,
      height: win?.innerHeight ?? doc.documentElement.clientHeight,
    };
  }

  function draggedElement(target: DragTarget): HTMLElement {
    return target === "panel"
      ? byId("ff-panel")
      : target === "videoNow"
        ? byId("ff-video-now")
        : byId("ff-overlay");
  }

  function moveDraggedElement(clientX: number, clientY: number): void {
    if (!dragState) {
      return;
    }
    const element = draggedElement(dragState.target);
    const viewport = viewportSize();
    const nextLeft = clamp(dragState.startLeft + clientX - dragState.startMouseX, 8, viewport.width - dragState.width - 8);
    const nextTop = clamp(dragState.startTop + clientY - dragState.startMouseY, 8, viewport.height - dragState.height - 8);
    element.style.left = `${Math.round(nextLeft)}px`;
    element.style.top = `${Math.round(nextTop)}px`;
    element.style.right = "auto";
    element.style.bottom = "auto";
    if (dragState.target === "subtitle") {
      element.style.transform = "none";
      root.dataset.subtitleDragged = "true";
    } else if (dragState.target === "videoNow") {
      root.dataset.videoNowDragged = "true";
    } else {
      root.dataset.dragged = "true";
    }
  }

  function endDrag(): void {
    dragState = undefined;
    root.removeAttribute("data-dragging");
  }

  function startDrag(event: MouseEvent, target: DragTarget): void {
    if (!(event instanceof MouseEvent) || event.button !== 0) {
      return;
    }
    const rect = draggedElement(target).getBoundingClientRect();
    dragState = {
      target,
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    root.dataset.dragging = "true";
    event.preventDefault();
  }

  return {
    bind() {
      byId("ff-panel").querySelector(".ff-header")?.addEventListener("mousedown", (event) => {
        if (event instanceof MouseEvent) {
          startDrag(event, "panel");
        }
      });
      root.querySelector(".ff-caption-card")?.addEventListener("mousedown", (event) => {
        if (event instanceof MouseEvent) {
          startDrag(event, "subtitle");
        }
      });
      byId("ff-video-now").addEventListener("mousedown", (event) => {
        if (event instanceof MouseEvent) {
          startDrag(event, "videoNow");
        }
      });
      doc.addEventListener("mousemove", (event) => {
        moveDraggedElement(event.clientX, event.clientY);
      });
      doc.addEventListener("mouseup", endDrag);
    },
  };
}
