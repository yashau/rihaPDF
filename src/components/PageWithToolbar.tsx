import { PdfPage } from "./PdfPage";
import type { PageController, PageReadModel } from "./pageViewModels";

export function PageWithToolbar({
  model,
  controller,
}: {
  model: PageReadModel;
  controller: PageController;
}) {
  const { slotId, pageIndex, documentZoom } = model.view;
  return (
    <div
      id={`page-slot-${slotId}`}
      className={`flex flex-col gap-2 scroll-mt-6 w-full ${
        documentZoom > 1.001 ? "items-start" : "items-center"
      }`}
    >
      <div className="flex gap-2 items-center text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">Page {pageIndex + 1}</span>
      </div>
      <PdfPage model={model} controller={controller} />
    </div>
  );
}
