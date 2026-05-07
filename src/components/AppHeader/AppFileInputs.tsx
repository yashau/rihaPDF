export function AppFileInputs({
  fileInputRef,
  imageFileInputRef,
  onPickPdf,
  onPickImage,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  imageFileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickPdf: (file: File) => void;
  onPickImage: (file: File) => void;
}) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        data-testid="open-pdf-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickPdf(f);
          e.target.value = "";
        }}
      />
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickImage(f);
          e.target.value = "";
        }}
      />
    </>
  );
}
