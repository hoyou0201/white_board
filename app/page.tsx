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

type ArrowItem = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
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

type Tool = "select" | "arrow";

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
      type: "move-arrow";
      pointerId: number;
      id: string;
      startWorld: Point;
      startArrow: ArrowItem;
    }
  | {
      type: "resize-arrow";
      pointerId: number;
      id: string;
      handle: "start" | "end";
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

const initialArrows: ArrowItem[] = [
  {
    id: "arrow-1",
    x1: 102,
    y1: -20,
    x2: 206,
    y2: 20,
    color: "#3f4a5a",
  },
  {
    id: "arrow-2",
    x1: 248,
    y1: 132,
    x2: 186,
    y2: 226,
    color: "#3f4a5a",
  },
];

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
  const [tool, setTool] = useState<Tool>("select");
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
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) {
        return { x: 0, y: 0 };
      }

      return {
        x: (clientX - rect.left - view.x) / view.zoom,
        y: (clientY - rect.top - view.y) / view.zoom,
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

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (isBoardData(parsed)) {
          setNotes(parsed.notes);
          setArrows(parsed.arrows);
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
        setTool("select");
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

  const addNote = useCallback(() => {
    const center = getViewportCenter();
    const nextNote: Note = {
      id: createId("note"),
      x: Math.round(center.x - 130),
      y: Math.round(center.y - 92),
      width: 260,
      height: 184,
      text: "",
      color: "sun",
    };

    setNotes((current) => [...current, nextNote]);
    setSelected({ type: "note", id: nextNote.id });
    setTool("select");
  }, [getViewportCenter]);

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

    const boxes = [
      ...notes.map((note) => ({
        left: note.x,
        top: note.y,
        right: note.x + note.width,
        bottom: note.y + note.height,
      })),
      ...arrows.map((arrow) => ({
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

    const world = screenToWorld(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(null);

    if (tool === "arrow") {
      setDraftArrow({
        id: "draft",
        x1: world.x,
        y1: world.y,
        x2: world.x,
        y2: world.y,
        color: "#3f4a5a",
      });
      setDrag({
        type: "draw-arrow",
        pointerId: event.pointerId,
        startWorld: world,
      });
      return;
    }

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
      setDraftArrow((current) =>
        current
          ? {
              ...current,
              x2: world.x,
              y2: world.y,
            }
          : current,
      );
      return;
    }

    if (drag.type === "move-arrow") {
      const dx = world.x - drag.startWorld.x;
      const dy = world.y - drag.startWorld.y;
      setArrows((current) =>
        current.map((arrow) =>
          arrow.id === drag.id
            ? {
                ...arrow,
                x1: drag.startArrow.x1 + dx,
                y1: drag.startArrow.y1 + dy,
                x2: drag.startArrow.x2 + dx,
                y2: drag.startArrow.y2 + dy,
              }
            : arrow,
        ),
      );
      return;
    }

    if (drag.type === "resize-arrow") {
      setArrows((current) =>
        current.map((arrow) =>
          arrow.id === drag.id
            ? {
                ...arrow,
                ...(drag.handle === "start"
                  ? { x1: world.x, y1: world.y }
                  : { x2: world.x, y2: world.y }),
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

      if (length > 28) {
        const nextArrow = { ...draftArrow, id: createId("arrow") };
        setArrows((current) => [...current, nextArrow]);
        setSelected({ type: "arrow", id: nextArrow.id });
      }
    }

    setDraftArrow(null);
    setDrag(null);

    if (boardRef.current?.hasPointerCapture(event.pointerId)) {
      boardRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const worldBefore = screenToWorld(event.clientX, event.clientY);
    const nextZoom = clamp(
      view.zoom * (event.deltaY > 0 ? 0.92 : 1.08),
      MIN_ZOOM,
      MAX_ZOOM,
    );

    setView({
      zoom: nextZoom,
      x: event.clientX - rect.left - worldBefore.x * nextZoom,
      y: event.clientY - rect.top - worldBefore.y * nextZoom,
    });
  };

  const beginNoteMove =
    (note: Note) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const world = screenToWorld(event.clientX, event.clientY);
      boardRef.current?.setPointerCapture(event.pointerId);
      setTool("select");
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

  const beginArrowMove =
    (arrow: ArrowItem) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      const world = screenToWorld(event.clientX, event.clientY);
      boardRef.current?.setPointerCapture(event.pointerId);
      setTool("select");
      setSelected({ type: "arrow", id: arrow.id });
      setDrag({
        type: "move-arrow",
        pointerId: event.pointerId,
        id: arrow.id,
        startWorld: world,
        startArrow: arrow,
      });
      event.stopPropagation();
    };

  const beginArrowResize =
    (arrow: ArrowItem, handle: "start" | "end") =>
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      boardRef.current?.setPointerCapture(event.pointerId);
      setTool("select");
      setSelected({ type: "arrow", id: arrow.id });
      setDrag({
        type: "resize-arrow",
        pointerId: event.pointerId,
        id: arrow.id,
        handle,
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

  const visibleArrows = draftArrow ? [...arrows, draftArrow] : arrows;
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
            className={`tool-button ${tool === "select" ? "is-active" : ""}`}
            type="button"
            onClick={() => setTool("select")}
          >
            <span aria-hidden="true">↕</span>
            <span>Move</span>
          </button>
          <button
            className={`tool-button ${tool === "arrow" ? "is-active" : ""}`}
            type="button"
            onClick={() => setTool("arrow")}
          >
            <span aria-hidden="true">→</span>
            <span>Arrow</span>
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
        className={`board-surface ${tool === "arrow" ? "is-arrow-tool" : ""} ${
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
              onMove={beginArrowMove(arrow)}
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
                onPointerDown={(event) => event.stopPropagation()}
                placeholder="메모"
                spellCheck={false}
              />
              <div className="note-footer">
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
  onMove,
  onResizeEnd,
  onResizeStart,
}: {
  arrow: ArrowItem;
  isDraft: boolean;
  isSelected: boolean;
  onMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const dx = arrow.x2 - arrow.x1;
  const dy = arrow.y2 - arrow.y1;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  return (
    <div className={`arrow-layer ${isDraft ? "is-draft" : ""}`}>
      <button
        aria-label="Move arrow"
        className={`arrow-body ${isSelected ? "is-selected" : ""}`}
        data-board-item="arrow"
        onPointerDown={onMove}
        style={
          {
            "--arrow-color": arrow.color,
            left: arrow.x1,
            top: arrow.y1 - 13,
            width: length,
            transform: `rotate(${angle}deg)`,
          } as CSSProperties
        }
        type="button"
      >
        <span className="arrow-line" />
        <span className="arrow-head" />
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
