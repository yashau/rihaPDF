import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  type AnnotationColor,
  DEFAULT_COMMENT_COLOR,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_INK_COLOR,
} from "@/domain/annotations";
import type { PageSlot } from "@/domain/slots";
import type { PendingImage, ToolMode } from "@/domain/toolMode";
import type { LoadedSource } from "@/pdf/source/loadSource";
import {
  contentReducer,
  createContentActions,
  createEmptyContentSnapshot,
  type AppContentActions,
  type AppContentAction,
  type AppContentSnapshot,
} from "@/app/state/contentState";

export type AppDocumentState = {
  primaryFilename: string | null;
  setPrimaryFilename: Dispatch<SetStateAction<string | null>>;
  loadedFileKey: number;
  setLoadedFileKey: Dispatch<SetStateAction<number>>;
  sources: Map<string, LoadedSource>;
  setSources: Dispatch<SetStateAction<Map<string, LoadedSource>>>;
  slots: PageSlot[];
  setSlots: Dispatch<SetStateAction<PageSlot[]>>;
  slotsRef: RefObject<PageSlot[]>;
  slotById: Map<string, PageSlot>;
};

export type AppContentState = AppContentSnapshot & {
  dispatchContent: Dispatch<AppContentAction>;
  contentActions: AppContentActions;
};

export type AppToolState = {
  tool: ToolMode;
  setTool: Dispatch<SetStateAction<ToolMode>>;
  pendingImage: PendingImage | null;
  setPendingImage: Dispatch<SetStateAction<PendingImage | null>>;
  inkColor: AnnotationColor;
  setInkColor: Dispatch<SetStateAction<AnnotationColor>>;
  inkThickness: number;
  setInkThickness: Dispatch<SetStateAction<number>>;
  highlightColor: AnnotationColor;
  setHighlightColor: Dispatch<SetStateAction<AnnotationColor>>;
  commentColor: AnnotationColor;
  setCommentColor: Dispatch<SetStateAction<AnnotationColor>>;
};

export function useAppDocumentState(): AppDocumentState {
  const [primaryFilename, setPrimaryFilename] = useState<string | null>(null);
  const [loadedFileKey, setLoadedFileKey] = useState(0);
  const [sources, setSources] = useState<Map<string, LoadedSource>>(() => new Map());
  const [slots, setSlots] = useState<PageSlot[]>([]);
  const slotsRef = useRef<PageSlot[]>([]);

  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  const slotById = useMemo(() => new Map<string, PageSlot>(slots.map((s) => [s.id, s])), [slots]);

  return {
    primaryFilename,
    setPrimaryFilename,
    loadedFileKey,
    setLoadedFileKey,
    sources,
    setSources,
    slots,
    setSlots,
    slotsRef,
    slotById,
  };
}

export function useAppContentState(): AppContentState {
  const [state, dispatchContent] = useReducer(
    contentReducer,
    undefined,
    createEmptyContentSnapshot,
  );
  const contentActions = useMemo(() => createContentActions(dispatchContent), [dispatchContent]);

  return {
    ...state,
    dispatchContent,
    contentActions,
  };
}

export function useAppToolState(): AppToolState {
  const [tool, setTool] = useState<ToolMode>("select");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [inkColor, setInkColor] = useState<AnnotationColor>(DEFAULT_INK_COLOR);
  const [inkThickness, setInkThickness] = useState<number>(1.5);
  const [highlightColor, setHighlightColor] = useState<AnnotationColor>(DEFAULT_HIGHLIGHT_COLOR);
  const [commentColor, setCommentColor] = useState<AnnotationColor>(DEFAULT_COMMENT_COLOR);

  return {
    tool,
    setTool,
    pendingImage,
    setPendingImage,
    inkColor,
    setInkColor,
    inkThickness,
    setInkThickness,
    highlightColor,
    setHighlightColor,
    commentColor,
    setCommentColor,
  };
}
