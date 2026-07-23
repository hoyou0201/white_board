"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

type NoteColor = "sun" | "mint" | "sky" | "rose" | "paper";

type Note = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: NoteColor;
};

type NoteSide = "top" | "right" | "bottom" | "left";
type ArrowDirection = "none" | "forward" | "backward" | "both";

type ArrowAnchor = {
  noteId: string;
  side: NoteSide;
};

type ArrowItem = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  direction: ArrowDirection;
  startAnchor: ArrowAnchor | null;
  endAnchor: ArrowAnchor | null;
};

type ViewState = {
  x: number;
  y: number;
  zoom: number;
};

type SelectedItem =
  | { type: "note"; id: string }
  | { type: "arrow"; id: string }
  | null;

type Point = {
  x: number;
  y: number;
};

type DragState =
  | {
      type: "pan";
      pointerId: number;
      startClient: Point;
      startView: ViewState;
    }
  | {
      type: "move-note";
      pointerId: number;
      id: string;
      startWorld: Point;
      startNote: Pick<Note, "x" | "y">;
    }
  | {
      type: "resize-note";
      pointerId: number;
      id: string;
      startWorld: Point;
      startNote: Pick<Note, "width" | "height">;
    }
  | {
      type: "draw-arrow";
      pointerId: number;
      startWorld: Point;
    }
  | {
      type: "resize-arrow";
      pointerId: number;
      id: string;
      handle: "start" | "end";
      startArrow: ArrowItem;
    };

type StoredBoard = {
  notes: Note[];
  arrows: ArrowItem[];
  view: ViewState;
};

const STORAGE_KEY = "codex.memo-whiteboard.v1";
const MIN_ZOOM = 0.24;
const MAX_ZOOM = 2.2;
const MIN_NOTE_WIDTH = 170;
const MIN_NOTE_HEIGHT = 130;
const CONNECT_SNAP_PX = 28;
const DEFAULT_ARROW_IDS = new Set(["arrow-1", "arrow-2"]);
const NOTE_SPAWN_OFFSETS: Point[] = [
  { x: 0, y: 0 },
  { x: 34, y: 34 },
  { x: 68, y: 68 },
  { x: -34, y: 34 },
  { x: 34, y: -34 },
  { x: -34, y: -34 },
  { x: 68, y: 0 },
  { x: 0, y: 68 },
];

const arrowDirections: Array<{
  id: ArrowDirection;
  label: string;
  symbol: string;
}> = [
  { id: "none", label: "No direction", symbol: "—" },
  { id: "forward", label: "Forward", symbol: "→" },
  { id: "backward", label: "Backward", symbol: "←" },
  { id: "both", label: "Both directions", symbol: "↔" },
];

const noteSides: NoteSide[] = ["top", "right", "bottom", "left"];

const noteColors: Array<{ id: NoteColor; label: string }> = [
  { id: "sun", label: "Yellow" },
  { id: "mint", label: "Green" },
  { id: "sky", label: "Blue" },
  { id: "rose", label: "Pink" },
  { id: "paper", label: "White" },
];

const initialNotes: Note[] = [
  {
    id: "note-1",
    x: -160,
    y: -120,
    width: 260,
    height: 184,
    text: "오늘 정리\n\n- 아이디어 모으기\n- 다음 액션 고르기",
    color: "sun",
  },
  {
    id: "note-2",
    x: 210,
    y: -36,
    width: 248,
    height: 164,
    text: "프로젝트\n\n작게 만들고 자주 고치기",
    color: "mint",
  },
  {
    id: "note-3",
    x: 42,
    y: 226,
    width: 270,
    height: 170,
    text: "보류\n\n나중에 다시 볼 생각들",
    color: "sky",
  },
];

const initialArrows: ArrowItem[] = [];

const initialView: ViewState = { x: 520, y: 310, zoom: 1 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function getNoteAnchorPoint(note: Note, side: NoteSide): Point {
  if (side === "top") {
    return { x: note.x + note.width / 2, y: note.y };
  }

  if (side === "right") {
    return { x: note.x + note.width, y: note.y + note.height / 2 };
  }

  if (side === "bottom") {
    return { x: note.x + note.width / 2, y: note.y + note.height };
  }

  return { x: note.x, y: note.y + note.height / 2 };
}

function resolveAnchorPoint(
  anchor: ArrowAnchor | null,
  notes: Note[],
  fallback: Point,
): Point {
  if (!anchor) {
    return fallback;
  }

  const note = notes.find((item) => item.id === anchor.noteId);
  return note ? getNoteAnchorPoint(note, anchor.side) : fallback;
}

function resolveArrow(arrow: ArrowItem, notes: Note[]): ArrowItem {
  const start = resolveAnchorPoint(
    arrow.startAnchor,
    notes,
    { x: arrow.x1, y: arrow.y1 },
  );
  const end = resolveAnchorPoint(
    arrow.endAnchor,
    notes,
    { x: arrow.x2, y: arrow.y2 },
  );

  return {
    ...arrow,
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
  };
}

function normalizeArrow(value: ArrowItem): ArrowItem {
  const direction = arrowDirections.some((item) => item.id === value.direction)
    ? value.direction
    : "forward";

  return {
    ...value,
    direction,
    startAnchor: value.startAnchor ?? null,
    endAnchor: value.endAnchor ?? null,
  };
}

function findOpenNotePosition(notes: Note[], base: Point): Point {
  const available = NOTE_SPAWN_OFFSETS.find((offset) => {
    const x = base.x + offset.x;
    const y = base.y + offset.y;

    return !notes.some(
      (note) => Math.abs(note.x - x) < 20 && Math.abs(note.y - y) < 20,
    );
  });

  if (available) {
    return { x: base.x + available.x, y: base.y + available.y };
  }

  const cascade = 34 * ((notes.length % 8) + 1);
  return { x: base.x + cascade, y: base.y + cascade };
}

function isBoardData(value: unknown): value is StoredBoard {
  if (!value || typeof value !== "object") {
    return false;
  }

  const data = value as Partial<StoredBoard>;
  return Array.isArray(data.notes) && Array.isArray(data.arrows);
}

function shouldIgnoreBoardShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("textarea, input, [contenteditable='true']"));
}

export default function Home() {
  const boardRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [arrows, setArrows] = useState<ArrowItem[]>(initialArrows);
  const [view, setView] = useState<ViewState>(initialView);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draftArrow, setDraftArrow] = useState<ArrowItem | null>(null);
  const [loaded, setLoaded] = useState(false);

  const selectedNote = useMemo(() => {
    if (selected?.type !== "note") {
      return null;
    }

    return notes.find((note) => note.id === selected.id) ?? null;
  }, [notes, selected]);

  const selectedArrow = useMemo(() => {
    if (selected?.type !== "arrow") {
      return null;
    }

    return arrows.find((arrow) => arrow.id === selected.id) ?? null;
  }, [arrows, selected]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const board = boardRef.current;
      if (!board) {
        return { x: 0, y: 0 };
      }
      const rect = board.getBoundingClientRect();

      return {
        x: (clientX - rect.left + board.scrollLeft - view.x) / view.zoom,
        y: (clientY - rect.top + board.scrollTop - view.y) / view.zoom,
      };
    },
    [view],
  );

  const getViewportCenter = useCallback((): Point => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [screenToWorld]);

  const findNearestAnchor = useCallback(
    (point: Point): { anchor: ArrowAnchor; point: Point } | null => {
      const threshold = CONNECT_SNAP_PX / view.zoom;
      let nearest: { anchor: ArrowAnchor; point: Point; distance: number } | null =
        null;

      for (const note of notes) {
        for (const side of noteSides) {
          const anchorPoint = getNoteAnchorPoint(note, side);
          const distance = Math.hypot(
            anchorPoint.x - point.x,
            anchorPoint.y - point.y,
          );

          if (
            distance <= threshold &&
            (!nearest || distance < nearest.distance)
          ) {
            nearest = {
              anchor: { noteId: note.id, side },
              point: anchorPoint,
              distance,
            };
          }
        }
      }

      return nearest
        ? { anchor: nearest.anchor, point: nearest.point }
        : null;
    },
    [notes, view.zoom],
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (isBoardData(parsed)) {
          setNotes(parsed.notes);
          setArrows(
            parsed.arrows
              .map(normalizeArrow)
              .filter(
                (arrow) =>
                  arrow.startAnchor &&
                  arrow.endAnchor &&
                  !DEFAULT_ARROW_IDS.has(arrow.id),
              ),
          );
          setView(parsed.view ?? initialView);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    const payload: StoredBoard = { notes, arrows, view };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [arrows, loaded, notes, view]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreBoardShortcut(event.target)) {
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && selected) {
        event.preventDefault();
        deleteSelected();
      }

      if (event.key === "Escape") {
        setDraftArrow(null);
        setDrag(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const updateNote = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((current) =>
      current.map((note) => (note.id === id ? { ...note, ...patch } : note)),
    );
  }, []);

  const updateArrow = useCallback(
    (id: string, patch: Partial<ArrowItem>) => {
      setArrows((current) =>
        current.map((arrow) =>
          arrow.id === id ? { ...arrow, ...patch } : arrow,
        ),
      );
    },
    [],
  );

  const addNote = useCallback(() => {
    const center = getViewportCenter();
    const position = findOpenNotePosition(notes, {
      x: Math.round(center.x - 130),
      y: Math.round(center.y - 92),
    });
    const nextNote: Note = {
      id: createId("note"),
      x: position.x,
      y: position.y,
      width: 260,
      height: 184,
      text: "",
      color: "sun",
    };

    setNotes((current) => [...current, nextNote]);
    setSelected({ type: "note", id: nextNote.id });
  }, [getViewportCenter, notes]);

  const duplicateNote = useCallback(() => {
    if (!selectedNote) {
      return;
    }

    const nextNote: Note = {
      ...selectedNote,
      id: createId("note"),
      x: selectedNote.x + 34,
      y: selectedNote.y + 34,
    };

    setNotes((current) => [...current, nextNote]);
    setSelected({ type: "note", id: nextNote.id });
  }, [selectedNote]);

  const deleteSelected = useCallback(() => {
    if (!selected) {
      return;
    }

    if (selected.type === "note") {
      setNotes((current) => current.filter((note) => note.id !== selected.id));
      setArrows((current) =>
        current.filter(
          (arrow) =>
            arrow.startAnchor?.noteId !== selected.id &&
            arrow.endAnchor?.noteId !== selected.id,
        ),
      );
    }

    if (selected.type === "arrow") {
      setArrows((current) =>
        current.filter((arrow) => arrow.id !== selected.id),
      );
    }

    setSelected(null);
  }, [selected]);

  const fitContent = useCallback(() => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const resolvedArrows = arrows.map((arrow) => resolveArrow(arrow, notes));
    const boxes = [
      ...notes.map((note) => ({
        left: note.x,
        top: note.y,
        right: note.x + note.width,
        bottom: note.y + note.height,
      })),
      ...resolvedArrows.map((arrow) => ({
        left: Math.min(arrow.x1, arrow.x2),
        top: Math.min(arrow.y1, arrow.y2),
        right: Math.max(arrow.x1, arrow.x2),
        bottom: Math.max(arrow.y1, arrow.y2),
      })),
    ];

    if (!boxes.length) {
      setView(initialView);
      return;
    }

    const left = Math.min(...boxes.map((box) => box.left));
    const top = Math.min(...boxes.map((box) => box.top));
    const right = Math.max(...boxes.map((box) => box.right));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    const width = Math.max(right - left, 1);
    const height = Math.max(bottom - top, 1);
    const nextZoom = clamp(
      Math.min((rect.width - 112) / width, (rect.height - 112) / height),
      0.42,
      1.25,
    );

    setView({
      zoom: nextZoom,
      x: rect.width / 2 - (left + width / 2) * nextZoom,
      y: rect.height / 2 - (top + height / 2) * nextZoom,
    });
  }, [arrows, notes]);

  const handleBoardPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("[data-board-item]")) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(null);

    setDrag({
      type: "pan",
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startView: view,
    });
  };

  const handleBoardPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (drag.type === "pan") {
      setView({
        ...drag.startView,
        x: drag.startView.x + event.clientX - drag.startClient.x,
        y: drag.startView.y + event.clientY - drag.startClient.y,
      });
      return;
    }

    const world = screenToWorld(event.clientX, event.clientY);

    if (drag.type === "move-note") {
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      updateNote(drag.id, {
        x: Math.round(drag.startNote.x + dx),
        y: Math.round(drag.startNote.y + dy),
      });
      return;
    }

    if (drag.type === "resize-note") {
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      updateNote(drag.id, {
        width: Math.round(clamp(drag.startNote.width + dx, MIN_NOTE_WIDTH, 520)),
        height: Math.round(
          clamp(drag.startNote.height + dy, MIN_NOTE_HEIGHT, 440),
        ),
      });
      return;
    }

    if (drag.type === "draw-arrow") {
      const snapped = findNearestAnchor(world);
      setDraftArrow((current) =>
        current
          ? {
              ...current,
              x2: snapped?.point.x ?? world.x,
              y2: snapped?.point.y ?? world.y,
              endAnchor: snapped?.anchor ?? null,
            }
          : current,
      );
      return;
    }

    if (drag.type === "resize-arrow") {
      const snapped = findNearestAnchor(world);
      setArrows((current) =>
        current.map((arrow) =>
          arrow.id === drag.id
            ? {
                ...arrow,
                ...(drag.handle === "start"
                  ? {
                      x1: snapped?.point.x ?? world.x,
                      y1: snapped?.point.y ?? world.y,
                      startAnchor: snapped?.anchor ?? null,
                    }
                  : {
                      x2: snapped?.point.x ?? world.x,
                      y2: snapped?.point.y ?? world.y,
                      endAnchor: snapped?.anchor ?? null,
                    }),
              }
            : arrow,
        ),
      );
    }
  };

  const handleBoardPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (drag.type === "draw-arrow" && draftArrow) {
      const length = Math.hypot(
        draftArrow.x2 - draftArrow.x1,
        draftArrow.y2 - draftArrow.y1,
      );
      const connectsDifferentNotes =
        draftArrow.startAnchor &&
        draftArrow.endAnchor &&
        draftArrow.startAnchor.noteId !== draftArrow.endAnchor.noteId;

      if (length > 28 && connectsDifferentNotes) {
        const nextArrow = {
          ...draftArrow,
          id: createId("arrow"),
        };
        setArrows((current) => [...current, nextArrow]);
        setSelected({ type: "arrow", id: nextArrow.id });
      }
    }

    if (drag.type === "resize-arrow") {
      setArrows((current) =>
        current.map((arrow) => {
          if (arrow.id !== drag.id) {
            return arrow;
          }

          const anchor =
            drag.handle === "start" ? arrow.startAnchor : arrow.endAnchor;
          const otherAnchor =
            drag.handle === "start" ? arrow.endAnchor : arrow.startAnchor;

          return anchor &&
            otherAnchor &&
            anchor.noteId !== otherAnchor.noteId
            ? arrow
            : drag.startArrow;
        }),
      );
    }

    setDraftArrow(null);
    setDrag(null);

    if (boardRef.current?.hasPointerCapture(event.pointerId)) {
      boardRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const board = boardRef.current;
    if (!board) {
      return;
    }
    const rect = board.getBoundingClientRect();

    const worldBefore = screenToWorld(event.clientX, event.clientY);
    const nextZoom = clamp(
      view.zoom * (event.deltaY > 0 ? 0.92 : 1.08),
      MIN_ZOOM,
      MAX_ZOOM,
    );

    setView({
      zoom: nextZoom,
      x:
        event.clientX -
        rect.left +
        board.scrollLeft -
        worldBefore.x * nextZoom,
      y:
        event.clientY -
        rect.top +
        board.scrollTop -
        worldBefore.y * nextZoom,
    });
  };

  const beginNoteMove =
    (note: Note) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const world = screenToWorld(event.clientX, event.clientY);
      boardRef.current?.setPointerCapture(event.pointerId);
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      setSelected({ type: "note", id: note.id });
      setDrag({
        type: "move-note",
        pointerId: event.pointerId,
        id: note.id,
        startWorld: world,
        startNote: { x: note.x, y: note.y },
      });
      event.stopPropagation();
    };

  const beginNoteResize =
    (note: Note) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      const world = screenToWorld(event.clientX, event.clientY);
      boardRef.current?.setPointerCapture(event.pointerId);
      setSelected({ type: "note", id: note.id });
      setDrag({
        type: "resize-note",
        pointerId: event.pointerId,
        id: note.id,
        startWorld: world,
        startNote: { width: note.width, height: note.height },
      });
      event.stopPropagation();
    };

  const beginArrowFromPort =
    (note: Note, side: NoteSide) =>
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      const point = getNoteAnchorPoint(note, side);
      boardRef.current?.setPointerCapture(event.pointerId);
      event.preventDefault();
      setSelected(null);
      setDraftArrow({
        id: "draft",
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
        color: "#3f4a5a",
        direction: "forward",
        startAnchor: { noteId: note.id, side },
        endAnchor: null,
      });
      setDrag({
        type: "draw-arrow",
        pointerId: event.pointerId,
        startWorld: point,
      });
      event.stopPropagation();
    };

  const selectArrow =
    (arrow: ArrowItem) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      setSelected({ type: "arrow", id: arrow.id });
      event.stopPropagation();
    };

  const beginArrowResize =
    (arrow: ArrowItem, handle: "start" | "end") =>
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      boardRef.current?.setPointerCapture(event.pointerId);
      setSelected({ type: "arrow", id: arrow.id });
      setDrag({
        type: "resize-arrow",
        pointerId: event.pointerId,
        id: arrow.id,
        handle,
        startArrow: arrow,
      });
      event.stopPropagation();
    };

  const boardStyle = {
    "--board-x": `${view.x}px`,
    "--board-y": `${view.y}px`,
    "--board-zoom": view.zoom,
    "--grid-size": `${32 * view.zoom}px`,
    "--grid-x": `${view.x}px`,
    "--grid-y": `${view.y}px`,
  } as CSSProperties;

  const visibleArrows = (draftArrow ? [...arrows, draftArrow] : arrows).map(
    (arrow) => resolveArrow(arrow, notes),
  );
  const activeSelection = selectedNote ?? selectedArrow;

  return (
    <main className="whiteboard-app">
      <header className="board-toolbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <div>
            <h1>Memo Board</h1>
            <p>{loaded ? "Saved locally" : "Loading"}</p>
          </div>
        </div>

        <div className="tool-strip" aria-label="Board tools">
          <button className="tool-button primary" type="button" onClick={addNote}>
            <span aria-hidden="true">+</span>
            <span>Note</span>
          </button>
          <button
            className="tool-button"
            type="button"
            onClick={duplicateNote}
            disabled={!selectedNote}
          >
            <span aria-hidden="true">⧉</span>
            <span>Copy</span>
          </button>
          <button
            className="tool-button danger"
            type="button"
            onClick={deleteSelected}
            disabled={!activeSelection}
          >
            <span aria-hidden="true">×</span>
            <span>Delete</span>
          </button>
          {selectedArrow ? (
            <div className="direction-control" aria-label="Arrow direction">
              {arrowDirections.map((direction) => (
                <button
                  aria-label={direction.label}
                  className={
                    selectedArrow.direction === direction.id ? "is-active" : ""
                  }
                  key={direction.id}
                  onClick={() =>
                    updateArrow(selectedArrow.id, {
                      direction: direction.id,
                    })
                  }
                  title={direction.label}
                  type="button"
                >
                  {direction.symbol}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="view-strip" aria-label="View controls">
          <button className="icon-button" type="button" onClick={fitContent}>
            Fit
          </button>
          <span className="zoom-readout">{Math.round(view.zoom * 100)}%</span>
        </div>
      </header>

      <section
        ref={boardRef}
        className={`board-surface ${drag ? "is-dragging" : ""} ${
          drag?.type === "pan" ? "is-panning" : ""
        }`}
        style={boardStyle}
        onPointerDown={handleBoardPointerDown}
        onPointerMove={handleBoardPointerMove}
        onPointerUp={handleBoardPointerUp}
        onPointerCancel={handleBoardPointerUp}
        onWheel={handleWheel}
        aria-label="Infinite memo whiteboard"
      >
        <div className="board-world" aria-live="polite">
          {visibleArrows.map((arrow) => (
            <ArrowElement
              arrow={arrow}
              isDraft={arrow.id === "draft"}
              isSelected={selected?.type === "arrow" && selected.id === arrow.id}
              key={arrow.id}
              onSelect={selectArrow(arrow)}
              onResizeEnd={beginArrowResize(arrow, "end")}
              onResizeStart={beginArrowResize(arrow, "start")}
            />
          ))}

          {notes.map((note) => (
            <article
              className={`sticky-note note-${note.color} ${
                selected?.type === "note" && selected.id === note.id
                  ? "is-selected"
                  : ""
              } ${
                draftArrow ||
                (selected?.type === "note" && selected.id === note.id)
                  ? "show-connectors"
                  : ""
              }`}
              data-board-item="note"
              key={note.id}
              style={{
                left: note.x,
                top: note.y,
                width: note.width,
                height: note.height,
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                setSelected({ type: "note", id: note.id });
              }}
            >
              {noteSides.map((side) => (
                <button
                  aria-label={`Connect arrow to ${side} side`}
                  className={`note-port port-${side}`}
                  data-board-item="connector"
                  key={side}
                  onPointerDown={beginArrowFromPort(note, side)}
                  title={`Connect from ${side}`}
                  type="button"
                />
              ))}
              <div className="note-grip" onPointerDown={beginNoteMove(note)}>
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
              <textarea
                aria-label="Memo text"
                value={note.text}
                onChange={(event) =>
                  updateNote(note.id, { text: event.currentTarget.value })
                }
                onFocus={() => setSelected({ type: "note", id: note.id })}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => event.stopPropagation()}
                placeholder="메모"
                spellCheck={false}
              />
              <div className="note-footer">
                {selected?.type === "note" && selected.id === note.id ? (
                  <div className="color-row" aria-label="Note color">
                    {noteColors.map((color) => (
                      <button
                        aria-label={color.label}
                        className={`color-dot dot-${color.id} ${
                          note.color === color.id ? "is-active" : ""
                        }`}
                        key={color.id}
                        onClick={() => updateNote(note.id, { color: color.id })}
                        type="button"
                      />
                    ))}
                  </div>
                ) : (
                  <span />
                )}
                <button
                  aria-label="Resize note"
                  className="resize-handle"
                  onPointerDown={beginNoteResize(note)}
                  type="button"
                />
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function ArrowElement({
  arrow,
  isDraft,
  isSelected,
  onSelect,
  onResizeEnd,
  onResizeStart,
}: {
  arrow: ArrowItem;
  isDraft: boolean;
  isSelected: boolean;
  onSelect: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const dx = arrow.x2 - arrow.x1;
  const dy = arrow.y2 - arrow.y1;
  const roundGeometry = (value: number) => Math.round(value * 1000) / 1000;
  const length = roundGeometry(Math.max(Math.hypot(dx, dy), 1));
  const angle = roundGeometry((Math.atan2(dy, dx) * 180) / Math.PI);
  const hasStartHead =
    arrow.direction === "backward" || arrow.direction === "both";
  const hasEndHead =
    arrow.direction === "forward" || arrow.direction === "both";

  return (
    <div className={`arrow-layer ${isDraft ? "is-draft" : ""}`}>
      <button
        aria-label="Move arrow"
        className={`arrow-body ${isSelected ? "is-selected" : ""} ${
          hasStartHead ? "has-start-head" : ""
        } ${hasEndHead ? "has-end-head" : ""}`}
        data-board-item="arrow"
        onPointerDown={onSelect}
        style={
          {
            "--arrow-color": arrow.color,
            left: roundGeometry(arrow.x1),
            top: roundGeometry(arrow.y1 - 13),
            width: length,
            transform: `rotate(${angle}deg)`,
          } as CSSProperties
        }
        type="button"
      >
        <span className="arrow-line" />
        {hasStartHead ? (
          <span className="arrow-head arrow-head-start" />
        ) : null}
        {hasEndHead ? <span className="arrow-head arrow-head-end" /> : null}
      </button>
      {!isDraft && isSelected ? (
        <>
          <button
            aria-label="Move arrow start"
            className="arrow-point"
            data-board-item="arrow"
            onPointerDown={onResizeStart}
            style={{ left: arrow.x1, top: arrow.y1 }}
            type="button"
          />
          <button
            aria-label="Move arrow end"
            className="arrow-point"
            data-board-item="arrow"
            onPointerDown={onResizeEnd}
            style={{ left: arrow.x2, top: arrow.y2 }}
            type="button"
          />
        </>
      ) : null}
    </div>
  );
}
