import type { Annotation, AnnotationColor } from "@/domain/annotations";
import type {
  CrossPageArrival,
  CrossPageImageArrival,
  EditValue,
  ImageMoveValue,
} from "@/domain/editState";
import type { FormField, FormValue } from "@/domain/formFields";
import type { ImageInsertion, TextInsertion } from "@/domain/insertions";
import type { Selection } from "@/domain/selection";
import type { PageSlot } from "@/domain/slots";
import type { ToolMode } from "@/domain/toolMode";
import type { RenderedPage } from "@/pdf/render/pdf";
import type { LoadedSource } from "@/pdf/source/loadSource";
import type { Redaction } from "@/domain/redactions";

export type PageListDocumentReadModel = {
  slots: PageSlot[];
  sources: Map<string, LoadedSource>;
  previewCanvases: Map<string, HTMLCanvasElement>;
  renderScale: number;
  documentZoom: number;
};

export type PageListContentReadModel = {
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  insertedTexts: Map<string, TextInsertion[]>;
  insertedImages: Map<string, ImageInsertion[]>;
  annotations: Map<string, Annotation[]>;
  redactions: Map<string, Redaction[]>;
  shapeDeletes: Map<string, Set<string>>;
  editingByPage: Map<string, string>;
  formValues: Map<string, Map<string, FormValue>>;
};

export type PageListToolReadModel = {
  tool: ToolMode;
  inkColor: AnnotationColor;
  inkThickness: number;
  highlightColor: AnnotationColor;
};

export type PageListController = {
  onEdit: (slotId: string, runId: string, value: EditValue) => void;
  onImageMove: (slotId: string, imageId: string, value: ImageMoveValue) => void;
  onEditingChange: (slotId: string, runId: string | null) => void;
  onCanvasClick: (slotId: string, pageIndex: number, pdfX: number, pdfY: number) => void;
  onTextInsertChange: (slotId: string, id: string, patch: Partial<TextInsertion>) => void;
  onTextInsertDelete: (slotId: string, id: string) => void;
  onImageInsertChange: (slotId: string, id: string, patch: Partial<ImageInsertion>) => void;
  onImageInsertDelete: (slotId: string, id: string) => void;
  onSelectImage: (slotId: string, imageId: string) => void;
  onSelectInsertedImage: (slotId: string, id: string) => void;
  onSelectShape: (slotId: string, shapeId: string) => void;
  onAnnotationAdd: (slotId: string, annotation: Annotation) => void;
  onAnnotationChange: (slotId: string, id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (slotId: string, id: string) => void;
  onRedactionAdd: (slotId: string, redaction: Redaction) => void;
  onRedactionChange: (slotId: string, id: string, patch: Partial<Redaction>) => void;
  onSelectRedaction: (slotId: string, id: string) => void;
  onSelectHighlight: (slotId: string, id: string) => void;
  onSelectInk: (slotId: string, id: string) => void;
  onDeleteSelection: () => void;
  onFormFieldChange: (sourceKey: string, fullName: string, value: FormValue) => void;
};

export type PageViewReadModel = {
  slotId: string;
  page: RenderedPage;
  pageIndex: number;
  sourceKey: string;
  previewCanvas: HTMLCanvasElement | null;
  documentZoom: number;
  formFields: FormField[];
  formValues: Map<string, FormValue>;
};

export type PageContentReadModel = {
  edits: Map<string, EditValue>;
  imageMoves: Map<string, ImageMoveValue>;
  insertedTexts: TextInsertion[];
  insertedImages: ImageInsertion[];
  annotations: Annotation[];
  redactions: Redaction[];
  editingId: string | null;
  deletedShapeIds: Set<string>;
  crossPageArrivals: CrossPageArrival[];
  crossPageImageArrivals: CrossPageImageArrival[];
};

export type PageSelectionReadModel = {
  selectedImageId: string | null;
  selectedInsertedImageId: string | null;
  selectedShapeId: string | null;
  selectedRedactionId: string | null;
  selectedHighlightId: string | null;
  selectedInkId: string | null;
};

export type PageController = {
  onEdit: (runId: string, value: EditValue) => void;
  onImageMove: (imageId: string, value: ImageMoveValue) => void;
  onEditingChange: (runId: string | null) => void;
  onCanvasClick: (pdfX: number, pdfY: number) => void;
  onTextInsertChange: (id: string, patch: Partial<TextInsertion>) => void;
  onTextInsertDelete: (id: string) => void;
  onImageInsertChange: (id: string, patch: Partial<ImageInsertion>) => void;
  onImageInsertDelete: (id: string) => void;
  onSelectImage: (imageId: string) => void;
  onSelectInsertedImage: (id: string) => void;
  onSelectShape: (shapeId: string) => void;
  onAnnotationAdd: (annotation: Annotation) => void;
  onAnnotationChange: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
  onRedactionAdd: (redaction: Redaction) => void;
  onRedactionChange: (id: string, patch: Partial<Redaction>) => void;
  onSelectRedaction: (id: string) => void;
  onSelectHighlight: (id: string) => void;
  onSelectInk: (id: string) => void;
  onDeleteSelection: () => void;
  onSourceEdit: (sourceSlotId: string, runId: string, value: EditValue) => void;
  onSourceImageMove: (sourceSlotId: string, imageId: string, value: ImageMoveValue) => void;
  onFormFieldChange: (fullName: string, value: FormValue) => void;
};

export type PageReadModel = {
  view: PageViewReadModel;
  content: PageContentReadModel;
  toolState: PageListToolReadModel;
  selection: PageSelectionReadModel;
};

export type PageListSelectionReadModel = {
  selection: Selection;
};
