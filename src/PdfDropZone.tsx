import { useRef, useState, useCallback } from "react";
import { Upload, FileWarning } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_CHARS = 60_000;

interface PdfDropZoneProps {
  onTextExtracted: (text: string) => void;
  label: string;
}

export default function PdfDropZone({ onTextExtracted, label }: PdfDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const extractText = useCallback(async (file: File) => {
    if (file.type !== "application/pdf") {
      setFeedback("Solo archivos PDF, por favor.");
      return;
    }

    setFeedback("Leyendo PDF…");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const pdf = await pdfjsLib.getDocument({ data }).promise;

      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        fullText += pageText + "\n";
      }

      const trimmed = fullText.trim();

      // Detect scanned PDF (no text layer)
      if (trimmed.length < 20) {
        setFeedback(
          "Este PDF es un escaneo sin texto seleccionable. Copia y pega el texto, por favor."
        );
        return;
      }

      // Cap at 60k
      if (trimmed.length > MAX_CHARS) {
        const capped = trimmed.slice(0, MAX_CHARS);
        onTextExtracted(capped);
        setFeedback(
          `Se extrajeron los primeros ${MAX_CHARS.toLocaleString()} caracteres. El PDF original tiene más.`
        );
        return;
      }

      onTextExtracted(trimmed);
      setFeedback(null);
    } catch (err) {
      setFeedback("No se pudo leer el PDF. Copia y pega el texto manualmente.");
    }
  }, [onTextExtracted]);

  const handleFile = useCallback(
    (file: File) => {
      extractText(file);
      // Reset input so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    },
    [extractText]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      <div
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-2.5 text-xs font-medium transition-all duration-200 cursor-pointer ${
          dragOver
            ? "border-primary bg-primary/10 text-primary"
            : "border-border text-foreground/40 hover:border-foreground/30 hover:text-foreground/60"
        }`}
      >
        <Upload className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </div>

      {feedback && (
        <div className="mt-1.5 flex items-start gap-1.5">
          <FileWarning className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amarilla" />
          <p className="text-[11px] text-foreground/60 leading-relaxed">{feedback}</p>
        </div>
      )}
    </div>
  );
}